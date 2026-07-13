import { db } from './db.js';
import { loadKeywords } from './config.js';

export interface KeywordSuggestion {
  keyword: string;
  source: 'apple_autocomplete' | 'competitor_title';
  score: number;
  evidence: string;
}

const STOREFRONT: Record<string, string> = {
  us: '143441', fr: '143442', de: '143443', gb: '143444', at: '143445',
  be: '143446', fi: '143447', gr: '143448', ie: '143449', it: '143450',
  lu: '143451', nl: '143452', pt: '143453', es: '143454', ca: '143455',
  se: '143456', no: '143457', dk: '143458', ch: '143459', au: '143460',
  nz: '143461', jp: '143462', hk: '143463', sg: '143464', cn: '143465',
  kr: '143466', in: '143467', mx: '143468', ru: '143469', tw: '143470',
  vn: '143471', za: '143472', my: '143473', ph: '143474', th: '143475',
  id: '143476', pk: '143477', pl: '143478', sa: '143479', tr: '143480',
  ae: '143481', hu: '143482', cl: '143483', np: '143484', pa: '143485',
  lk: '143486', ro: '143487', cz: '143489', sk: '143496', br: '143503',
};

const STOP_WORDS = new Set([
  'app', 'apps', 'mobile', 'iphone', 'ipad', 'free', 'best', 'the', 'and', 'for',
  'with', 'your', 'daily', 'official', 'pro', 'plus', 'premium', 'tracker',
]);

function decodeXML(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function appleHints(seed: string, locale: string): Promise<string[]> {
  const country = locale.split('-')[0].toLowerCase();
  const params = new URLSearchParams({
    clientApplication: 'MacSearchAds',
    term: seed,
    country: country.toUpperCase(),
  });
  const storefront = STOREFRONT[country];
  if (storefront) params.set('s', storefront);
  try {
    const response = await fetch(
      `https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints?${params}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) return [];
    const xml = await response.text();
    return Array.from(xml.matchAll(/<string>([\s\S]*?)<\/string>/g))
      .map((match) => decodeXML(match[1]).trim())
      .filter((value) => value && value !== 'Suggestions' && !value.startsWith('http'));
  } catch {
    return [];
  }
}

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();
}

function competitorCandidates(appId: string, locale: string) {
  const rows = db.prepare(
    `SELECT s.top5_json
       FROM snapshots s
       JOIN (
         SELECT locale, keyword, MAX(id) AS max_id
         FROM snapshots
         WHERE app = ? AND locale = ?
         GROUP BY locale, keyword
       ) latest ON s.id = latest.max_id`
  ).all(appId, locale) as Array<{ top5_json: string }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    let apps: Array<{ name?: string }> = [];
    try { apps = JSON.parse(row.top5_json) as Array<{ name?: string }>; } catch { continue; }
    for (const app of apps) {
      const segments = String(app.name || '').split(/[:|–—-]/g);
      for (const segment of segments) {
        const candidate = normalized(segment);
        const words = candidate.split(/\s+/).filter(Boolean);
        if (candidate.length < 4 || words.length > 5) continue;
        if (words.every((word) => STOP_WORDS.has(word))) continue;
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export async function keywordSuggestions(appId: string, locale: string): Promise<KeywordSuggestion[]> {
  const tracked = new Set((loadKeywords(appId)[locale] ?? []).map(normalized));
  const result = new Map<string, KeywordSuggestion>();
  const competitorCounts = competitorCandidates(appId, locale);

  for (const [keyword, count] of competitorCounts) {
    if (tracked.has(keyword)) continue;
    result.set(keyword, {
      keyword,
      source: 'competitor_title',
      score: Math.min(95, 42 + count * 8),
      evidence: `Used by ${count} top-ranking competitor${count === 1 ? '' : 's'}`,
    });
  }

  // Apple hints are fetched only for the strongest existing seeds. They are
  // treated as discovery evidence, not as traffic/difficulty scores.
  const seeds = Array.from(tracked).filter((seed) => seed.length >= 4).slice(0, 10);
  const hintGroups = await Promise.all(seeds.map((seed) => appleHints(seed, locale)));
  for (let index = 0; index < hintGroups.length; index++) {
    const seed = seeds[index];
    for (const rawHint of hintGroups[index]) {
      const keyword = normalized(rawHint);
      if (!keyword || keyword === seed || tracked.has(keyword)) continue;
      const existing = result.get(keyword);
      result.set(keyword, {
        keyword,
        source: 'apple_autocomplete',
        score: Math.max(existing?.score ?? 0, 90),
        evidence: `Apple autocomplete from “${seed}”`,
      });
    }
  }

  return Array.from(result.values())
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .slice(0, 80);
}
