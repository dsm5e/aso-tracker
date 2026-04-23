import { db } from './db.js';
import { loadApps, loadKeywords } from './config.js';
import { getGenre, getGenreById, getGenresBatch } from './genres.js';

export interface Top5Item {
  name: string;
  bundleId?: string;
  id?: string; // sometimes bundleId is stored here
  dev: string;
  genre?: string;
}

export interface RelevanceRow {
  locale: string;
  keyword: string;
  ourPosition: number | null;
  ourGenre: string;
  top5: Top5Item[];
  genreHistogram: Array<{ genre: string; count: number }>;
  matchCount: number;
  relevance: number; // 0-100
  flag: 'match' | 'ambiguous' | 'mismatch' | 'unknown';
}

const FLAG_MATCH = 'match' as const;
const FLAG_AMBIGUOUS = 'ambiguous' as const;
const FLAG_MISMATCH = 'mismatch' as const;
const FLAG_UNKNOWN = 'unknown' as const;

function classifyRelevance(top5: Top5Item[], ourGenre: string): {
  matchCount: number;
  relevance: number;
  histogram: Array<{ genre: string; count: number }>;
  flag: RelevanceRow['flag'];
} {
  if (!ourGenre) {
    return { matchCount: 0, relevance: 0, histogram: [], flag: FLAG_UNKNOWN };
  }
  const knownGenres = top5.filter((t) => t.genre).map((t) => t.genre!);
  if (knownGenres.length === 0) {
    return { matchCount: 0, relevance: 0, histogram: [], flag: FLAG_UNKNOWN };
  }
  const histMap = new Map<string, number>();
  for (const g of knownGenres) {
    histMap.set(g, (histMap.get(g) ?? 0) + 1);
  }
  const histogram = Array.from(histMap.entries())
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count);

  const matchCount = histMap.get(ourGenre) ?? 0;
  const relevance = Math.round((matchCount / knownGenres.length) * 100);
  const flag =
    relevance >= 80 ? FLAG_MATCH : relevance >= 40 ? FLAG_AMBIGUOUS : FLAG_MISMATCH;
  return { matchCount, relevance, histogram, flag };
}

/**
 * Compute keyword relevance for one app, optionally filtered by locale.
 * Fetches our genre once + enriches all top-5 competitors with their genres.
 */
export async function keywordRelevance(
  appId: string,
  localeFilter?: string
): Promise<RelevanceRow[]> {
  const apps = loadApps();
  const app = apps.find((a) => a.id === appId);
  if (!app) return [];

  // Try by bundleId first (cheap cache hit), fall back to iTunesId lookup
  // because config bundle can differ from the real one in the App Store.
  let ourInfo = await getGenre(app.bundle);
  if (!ourInfo && app.iTunesId) ourInfo = await getGenreById(app.iTunesId);
  const ourGenre = ourInfo?.genre ?? '';

  // Resolve our real bundleId to filter ourselves from top-5.
  // App Store often has a different bundleId than what's in tracker config.
  let ourRealBundleId = app.bundle;
  if (app.iTunesId) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/lookup?id=${encodeURIComponent(app.iTunesId)}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ bundleId?: string }> };
        if (data.results?.[0]?.bundleId) ourRealBundleId = data.results[0].bundleId;
      }
    } catch {}
  }
  const selfBundles = new Set([app.bundle, ourRealBundleId].filter(Boolean));
  const selfTid = app.iTunesId ? Number(app.iTunesId) : NaN;

  // Grab latest top5 per (locale, keyword) from today or most recent date
  const { d: latest } = db
    .prepare(`SELECT MAX(date) as d FROM snapshots WHERE app = ?`)
    .get(appId) as { d: string | null };
  if (!latest) return [];

  const params: Array<string | number> = [appId, latest];
  let sql = `
    SELECT s.locale, s.keyword, s.position, s.top5_json
    FROM snapshots s
    WHERE s.app = ? AND s.date = ?
  `;
  if (localeFilter) {
    sql += ` AND s.locale = ?`;
    params.push(localeFilter);
  }
  const rows = db.prepare(sql).all(...params) as Array<{
    locale: string;
    keyword: string;
    position: number | null;
    top5_json: string;
  }>;

  // Collect all unique bundle ids in top5 to batch-resolve genres.
  // Also exclude ourselves from top-5 — we don't compete with our own app.
  const allBundles = new Set<string>();
  const parsed: Array<{
    locale: string;
    keyword: string;
    position: number | null;
    top5raw: Array<{ name?: string; id?: string; bundleId?: string; dev?: string; tid?: number }>;
  }> = [];
  for (const r of rows) {
    let arr: Array<{ name?: string; id?: string; bundleId?: string; dev?: string; tid?: number }> = [];
    try { arr = JSON.parse(r.top5_json || '[]'); } catch {}
    arr = arr.filter((it) => {
      if (Number.isFinite(selfTid) && it.tid === selfTid) return false;
      const b = it.bundleId || it.id || '';
      return !selfBundles.has(b);
    });
    for (const it of arr) {
      const b = it.bundleId || it.id;
      if (b) allBundles.add(b);
    }
    parsed.push({ locale: r.locale, keyword: r.keyword, position: r.position, top5raw: arr });
  }

  const genreMap = await getGenresBatch(Array.from(allBundles));

  const out: RelevanceRow[] = [];
  for (const p of parsed) {
    const top5: Top5Item[] = p.top5raw.map((it) => {
      const bid = it.bundleId || it.id || '';
      const g = genreMap.get(bid);
      return {
        name: it.name || '',
        bundleId: bid,
        id: bid,
        dev: it.dev || '',
        genre: g?.genre,
      };
    });
    const cls = classifyRelevance(top5, ourGenre);
    out.push({
      locale: p.locale,
      keyword: p.keyword,
      ourPosition: p.position,
      ourGenre,
      top5,
      genreHistogram: cls.histogram,
      matchCount: cls.matchCount,
      relevance: cls.relevance,
      flag: cls.flag,
    });
  }
  return out;
}

/**
 * Build a rich prompt for Claude Code to analyze + fix a flagged keyword.
 * Includes all context Claude needs to propose a strategy and, with approval,
 * use asc-mcp to apply metadata changes.
 */
export async function buildClaudePrompt(
  appId: string,
  keyword: string,
  locale: string
): Promise<string | null> {
  const apps = loadApps();
  const app = apps.find((a) => a.id === appId);
  if (!app) return null;

  const rows = await keywordRelevance(appId, locale);
  const target = rows.find((r) => r.keyword === keyword);
  if (!target) return null;

  const kwCfg = loadKeywords(appId);
  const currentKeywordsForLocale = kwCfg[locale] ?? [];

  const top5Lines = target.top5
    .map(
      (t, i) =>
        `${i + 1}. ${t.name}${t.bundleId ? ` (${t.bundleId})` : ''} — ${
          t.genre || 'unknown'
        }${t.dev ? ` · by ${t.dev}` : ''}`
    )
    .join('\n');

  const histLine = target.genreHistogram
    .map((h) => `${h.count}× ${h.genre}`)
    .join(', ');

  return `I'm working with the aso-tracker dashboard on my app **${app.name}** (bundleId: \`${app.bundle}\`, iTunes ID: \`${app.iTunesId}\`). The dashboard flagged a keyword relevance issue.

## Context

- **Keyword:** \`${keyword}\`
- **Locale:** \`${locale}\`
- **Our category:** ${target.ourGenre || 'unknown'}
- **Our current rank:** ${target.ourPosition ? `#${target.ourPosition}` : 'unranked'}
- **Top-5 genre mix:** ${histLine || 'unknown'}
- **Relevance score:** ${target.relevance}% (${target.matchCount}/${target.top5.filter((t) => t.genre).length} in our category)
- **Flag:** ${target.flag}

## Top-5 on this keyword right now

${top5Lines}

## Our current \`${locale}\` keyword list in the tracker

\`\`\`
${currentKeywordsForLocale.join(', ')}
\`\`\`

## What I need from you

1. **Analyze** why this mismatch exists. Is \`${keyword}\` culturally claimed by a different category in \`${locale}\`? Is it a gaming slang term? An ambiguous word? Cross-reference with what you know about ${locale.toUpperCase()} culture.

2. **Fetch our current App Store metadata** for the \`${locale}\` localization via \`asc-mcp\` (\`apps_get_metadata\` with \`app_id: ${app.iTunesId}\`, \`locale: ${locale}-${locale.toUpperCase()}\` or equivalent). Show me title, subtitle, and the keyword field so we can see the full picture.

3. **Recommend ONE of these actions** with reasoning:
   a) **Remove** \`${keyword}\` from the \`${locale}\` keyword field and free up those characters for a better dream-related keyword
   b) **Keep** it, arguing for broader intent catch (explain expected conversion trade-off)
   c) **Adjust** title/subtitle to pull dream-journal intent above the mismatched results

4. If the recommendation involves metadata changes, **show me the exact diff** (old vs new) side by side.

5. **DO NOT apply any changes** until I explicitly approve with "да, деплой" or similar. Always wait for my go-ahead before any \`asc-mcp\` write operations.

Think carefully about the ${locale.toUpperCase()} market and cultural context — don't just auto-remove. Some seemingly mismatched keywords have long-tail value.`;
}
