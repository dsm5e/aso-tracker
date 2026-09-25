#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { db } from '../server/db.js';
import { findPosition, RateLimited, searchItunes, type SearchResult } from '../server/itunes.js';

const APP_ID = 'medscan';
const BUNDLE_ID = 'com.medscan.dicom.ct.mri.radiology.scan.viewer';

const LOCALE_COUNTRY: Record<string, string> = {
  'en-US': 'us', 'en-GB': 'gb', 'en-AU': 'au', 'en-CA': 'ca',
  'pt-BR': 'br', 'pt-PT': 'pt', 'es-ES': 'es', 'es-MX': 'mx',
  'de-DE': 'de', 'fr-FR': 'fr', 'fr-CA': 'ca', it: 'it', ja: 'jp', ko: 'kr',
  'zh-Hans': 'cn', 'zh-Hant': 'tw', pl: 'pl', ca: 'es', 'sl-SI': 'si', cs: 'cz',
  no: 'no', sk: 'sk', sv: 'se', hu: 'hu', uk: 'ua', 'nl-NL': 'nl', ru: 'ru',
  hr: 'hr', ro: 'ro', tr: 'tr', da: 'dk', fi: 'fi', el: 'gr', th: 'th',
  'te-IN': 'in', 'pa-IN': 'in', 'ta-IN': 'in', 'ur-PK': 'pk', 'gu-IN': 'in',
  'or-IN': 'in', 'kn-IN': 'in', he: 'il', id: 'id', vi: 'vn', 'mr-IN': 'in',
  // The public iTunes Search API has no working BD storefront (it returns an
  // empty corpus even for `dicom viewer`). Validate Bengali metadata against
  // the India storefront where the bn-BD localization is also searchable.
  'ml-IN': 'in', ms: 'my', 'ar-SA': 'sa', hi: 'in', 'bn-BD': 'in',
};

// This deliberately excludes ambiguous identity-only tokens such as DCM and
// generic “viewer/browser” translations. They count only when a result also
// carries a clinical DICOM/PACS/radiology marker.
const DICOM_IDENTITY = /(?:dicom|\bcbct\b|\bpacs\b|medical imaging|imagerie m[eé]dicale|medizinische bild|radiolog|radiogr|x[ -]?ray|röntgen|рентген|\bмрт\b|tomograf|\bmri\b|cone beam|mammogr|angiogr|醫學影像|医学影像|放射線|核磁|磁共振|영상의학|의료영상|엑스레이|أشعة|تصوير طبي)/iu;
const MEDICAL_GENRES = new Set(['Medical', 'Health & Fitness', 'Medicine']);

type MetadataLocale = { title: string; subtitle: string; keywords: string };
type MetadataFile = { localizations: Record<string, MetadataLocale> };
type TopApp = { name: string; id: string; dev: string; tid?: number; pos?: number; genre?: string };
type Serp = { country: string; query: string; position: number | null; total: number; top5: TopApp[]; source: 'snapshot' | 'live' };
type Verdict = 'validated' | 'modifier' | 'weak' | 'reject' | 'no_data';
type AuditRow = {
  country: string;
  locales: string[];
  keyword: string;
  exact: Serp;
  compound: Serp | null;
  alternate: Serp | null;
  verdict: Verdict;
  reason: string;
};

function args() {
  const values: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  if (!values.metadata) throw new Error('Pass --metadata=/absolute/path/to/metadata.json');
  return {
    metadata: resolve(values.metadata),
    raw: resolve(values.raw || './data/metadata-serp-audit.json'),
    report: resolve(values.report || './data/metadata-serp-audit.md'),
    cache: resolve(values.cache || './data/metadata-serp-audit-cache.json'),
    sleepMs: Math.max(250, Number(values.sleep || 1000)),
  };
}

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function snapshot(country: string, query: string): Serp | null {
  const row = db.prepare(`
    SELECT position, total, top5_json
    FROM snapshots
    WHERE app = ? AND locale = ? AND lower(keyword) = lower(?) AND error IS NULL
    ORDER BY date DESC, id DESC LIMIT 1
  `).get(APP_ID, country, query) as { position: number | null; total: number; top5_json: string } | undefined;
  if (!row) return null;
  let top5: TopApp[] = [];
  try { top5 = JSON.parse(row.top5_json || '[]') as TopApp[]; } catch { /* malformed legacy row */ }
  return { country, query, position: row.position, total: row.total, top5, source: 'snapshot' };
}

function liveSerp(country: string, query: string, results: SearchResult[]): Serp {
  const found = findPosition(results, BUNDLE_ID);
  return {
    country,
    query,
    position: found.position,
    total: found.total,
    top5: results.slice(0, 5).map((app, index) => ({
      name: app.trackName || '', id: app.bundleId || '', dev: app.artistName || '',
      tid: app.trackId, pos: index + 1, genre: app.primaryGenreName,
    })),
    source: 'live',
  };
}

function signal(serp: Serp) {
  const dicomApps = serp.top5.filter((app) => DICOM_IDENTITY.test(`${app.name} ${app.dev}`)).length;
  const medicalApps = serp.top5.filter((app) => app.genre && MEDICAL_GENRES.has(app.genre)).length;
  const self = serp.position !== null;
  const selfTop5 = serp.position !== null && serp.position <= 5;
  const direct = dicomApps >= 2 || (selfTop5 && dicomApps >= 1) || (dicomApps >= 1 && medicalApps >= 3);
  const adjacent = direct || medicalApps >= 3 || dicomApps >= 1 || (self && serp.position! <= 10);
  return { self, dicomApps, medicalApps, direct, adjacent };
}

function compoundFor(keyword: string) {
  if (/\b(?:dicom|dcm)\b/iu.test(keyword)) return `${keyword} viewer`;
  return `dicom ${keyword}`;
}

function decide(exact: Serp, compounds: Serp[]): Pick<AuditRow, 'verdict' | 'reason'> {
  const a = signal(exact);
  if (a.direct) return { verdict: 'validated', reason: `точная выдача: MedScan ${a.self ? `#${exact.position}` : 'не найден'}, DICOM-релевантных ${a.dicomApps}/5` };
  const directCompound = compounds.find((item) => signal(item).direct);
  if (directCompound) {
    const b = signal(directCompound);
    return { verdict: 'modifier', reason: `только в связке «${directCompound.query}»: MedScan ${b.self ? `#${directCompound.position}` : 'не найден'}, DICOM-релевантных ${b.dicomApps}/5` };
  }
  if (exact.total === 0 && compounds.every((item) => item.total === 0)) {
    return { verdict: 'no_data', reason: 'Apple не вернул приложений ни по точному, ни по составным запросам' };
  }
  if (a.adjacent || compounds.some((item) => signal(item).adjacent)) return { verdict: 'weak', reason: 'есть медицинский сигнал, но DICOM-интент выдачи слабый' };
  return { verdict: 'reject', reason: 'ни точная, ни составная выдача не подтверждают медицинский DICOM-интент' };
}

async function loadCache(path: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, Serp>;
  } catch {
    return {};
  }
}

async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function markdown(rows: AuditRow[], metadataPath: string) {
  const counts = rows.reduce<Record<Verdict, number>>((acc, row) => {
    acc[row.verdict] += 1;
    return acc;
  }, { validated: 0, modifier: 0, weak: 0, reject: 0, no_data: 0 });
  const lines = [
    '# MedScan ASO — SERP validation of every metadata keyword', '',
    `- Source manifest: \`${metadataPath}\``,
    `- Checked storefront × keyword pairs: **${rows.length}**`,
    `- Exact-query validated: **${counts.validated}**`,
    `- Valid only as a DICOM modifier: **${counts.modifier}**`,
    `- Weak / needs a decision: **${counts.weak}**`,
    `- Reject: **${counts.reject}**`, '',
    `- No App Store results: **${counts.no_data}**`, '',
    'A keyword marked “modifier” is not claimed as a good standalone query. It is retained only when Apple returns a relevant DICOM SERP for the phrase formed with `dicom`/`viewer`.', '',
    '| Store | Locale(s) | Keyword | Exact | Compounds | Verdict | Evidence |',
    '|---|---|---|---:|---|---|---|',
  ];
  for (const row of rows) {
    const exact = row.exact.position ? `#${row.exact.position}` : '—';
    const compounds = [row.compound, row.alternate].filter((item): item is Serp => Boolean(item))
      .map((item) => `${item.query}: ${item.position ? `#${item.position}` : '—'}`).join('; ') || '—';
    lines.push(`| ${row.country.toUpperCase()} | ${row.locales.join(', ')} | ${row.keyword.replaceAll('|', '\\|')} | ${exact} | ${compounds.replaceAll('|', '\\|')} | ${row.verdict} | ${row.reason.replaceAll('|', '\\|')} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = args();
  const metadata = JSON.parse(await readFile(options.metadata, 'utf8')) as MetadataFile;
  const grouped = new Map<string, { country: string; keyword: string; locales: Set<string> }>();
  for (const [locale, fields] of Object.entries(metadata.localizations)) {
    const country = LOCALE_COUNTRY[locale];
    if (!country) throw new Error(`No storefront mapping for ${locale}`);
    for (const raw of fields.keywords.split(',')) {
      const keyword = normalize(raw);
      if (!keyword) continue;
      const key = `${country}\u0000${keyword}`;
      const item = grouped.get(key) || { country, keyword, locales: new Set<string>() };
      item.locales.add(locale);
      grouped.set(key, item);
    }
  }

  const items = [...grouped.values()].sort((a, b) => a.country.localeCompare(b.country) || a.keyword.localeCompare(b.keyword));
  const cache = await loadCache(options.cache);
  let networkCalls = 0;
  const get = async (country: string, query: string): Promise<Serp> => {
    const key = `${country}\u0000${normalize(query)}`;
    if (cache[key]) return cache[key];
    const saved = snapshot(country, query);
    if (saved) {
      cache[key] = saved;
      return saved;
    }
    const result = liveSerp(country, query, await searchItunes(country, query, { sleepMs: options.sleepMs }));
    cache[key] = result;
    networkCalls += 1;
    await save(options.cache, cache);
    return result;
  };

  console.log(`Checking ${items.length} unique storefront × metadata-keyword pairs (sleep ${options.sleepMs} ms; resumable cache).`);
  const rows: AuditRow[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    try {
      const exact = await get(item.country, item.keyword);
      const compoundQuery = compoundFor(item.keyword);
      const compound = signal(exact).direct || normalize(compoundQuery) === item.keyword
        ? null
        : await get(item.country, compoundQuery);
      const alternateQuery = /\b(?:dicom|dcm)\b/iu.test(item.keyword)
        ? `viewer ${item.keyword}`
        : `${item.keyword} dicom`;
      const alternate = signal(exact).direct || (compound && signal(compound).direct) || normalize(alternateQuery) === item.keyword || normalize(alternateQuery) === normalize(compoundQuery)
        ? null
        : await get(item.country, alternateQuery);
      const compounds = [compound, alternate].filter((candidate): candidate is Serp => Boolean(candidate));
      const decision = decide(exact, compounds);
      rows.push({ country: item.country, keyword: item.keyword, locales: [...item.locales].sort(), exact, compound, alternate, ...decision });
    } catch (error) {
      if (error instanceof RateLimited) {
        await save(options.raw, rows);
        console.error(`RATE_LIMIT after ${index}/${items.length}: ${error.message}`);
        process.exitCode = 2;
        return;
      }
      throw error;
    }
    if ((index + 1) % 10 === 0 || index + 1 === items.length) {
      const partial = rows.reduce<Record<Verdict, number>>((acc, row) => { acc[row.verdict] += 1; return acc; }, { validated: 0, modifier: 0, weak: 0, reject: 0, no_data: 0 });
      await save(options.raw, rows);
      console.log(`[${index + 1}/${items.length}] live=${networkCalls} · validated=${partial.validated} modifier=${partial.modifier} weak=${partial.weak} reject=${partial.reject} no_data=${partial.no_data}`);
    }
  }

  await save(options.raw, rows);
  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, markdown(rows, options.metadata), 'utf8');
  console.log(`Done. Raw: ${options.raw}`);
  console.log(`Report: ${options.report}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
