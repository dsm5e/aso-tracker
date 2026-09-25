#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

type Fields = { status?: string; title: string; subtitle: string; keywords: string; decision?: string };
type Draft = { appId?: string; version?: string; localizations: Record<string, Fields> };
type AuditRow = { locales: string[]; keyword: string; verdict: 'validated' | 'modifier' | 'weak' | 'reject' | 'no_data' };

const TITLES: Record<string, string> = {
  'en-US': 'DICOM Viewer: CT, MRI & X-Ray',
  'en-GB': 'DICOM Viewer: CT, MRI & X-Ray',
  'en-AU': 'DICOM Viewer: CT, MRI & X-Ray',
  'en-CA': 'DICOM Viewer: CT, MRI & X-Ray',
  'pt-BR': 'Visualizador DICOM: TC RM RX',
  'pt-PT': 'Visualizador DICOM: TC RM RX',
  'es-ES': 'Visor DICOM: TAC RM Rayos X',
  'es-MX': 'Visor DICOM: TAC RM Rayos X',
  'de-DE': 'DICOM Viewer: CT MRT Röntgen',
  'fr-FR': 'DICOM Viewer: CT IRM X-Ray',
  'fr-CA': 'DICOM Viewer: CT IRM X-Ray',
  it: 'Visore DICOM: TAC RM Raggi X',
  ja: 'DICOM ビューア: CT MRI レントゲン',
  ko: 'DICOM 뷰어: CT MRI 엑스레이',
  'zh-Hans': 'DICOM 阅片: CT MRI X光',
  'zh-Hant': 'DICOM 閱片: CT MRI X光',
  pl: 'DICOM Viewer: TK RM Rentgen',
  ca: 'Visor DICOM: TC RM Raigs X',
  'sl-SI': 'DICOM Viewer: CT MRI X-Ray',
  cs: 'DICOM Viewer: CT MRI Rentgen',
  no: 'DICOM Viewer: CT MR Røntgen',
  sk: 'DICOM Viewer: CT MRI Rentgen',
  sv: 'DICOM Viewer: CT MR Röntgen',
  hu: 'DICOM Viewer: CT MRI Röntgen',
  uk: 'DICOM Viewer: КТ МРТ Рентген',
  'nl-NL': 'DICOM Viewer: CT MRI Röntgen',
  ru: 'DICOM Viewer: КТ МРТ Рентген',
  hr: 'DICOM Viewer: CT MRI Rendgen',
  ro: 'DICOM Viewer: CT RMN X-Ray',
  tr: 'DICOM Viewer: BT MR Röntgen',
  da: 'DICOM Viewer: CT MR Røntgen',
  fi: 'DICOM Viewer: CT MRI Röntgen',
  el: 'DICOM Viewer: CT MRI X-Ray',
  th: 'DICOM Viewer: CT MRI X-Ray',
  'te-IN': 'DICOM Viewer: CT MRI X-Ray',
  'pa-IN': 'DICOM Viewer: CT MRI X-Ray',
  'ta-IN': 'DICOM Viewer: CT MRI X-Ray',
  'ur-PK': 'DICOM Viewer: CT MRI X-Ray',
  'gu-IN': 'DICOM Viewer: CT MRI X-Ray',
  'or-IN': 'DICOM Viewer: CT MRI X-Ray',
  'kn-IN': 'DICOM Viewer: CT MRI X-Ray',
  he: 'DICOM Viewer: CT MRI רנטגן',
  id: 'DICOM Viewer: CT MRI Rontgen',
  vi: 'DICOM Viewer: CT MRI X-quang',
  'mr-IN': 'DICOM Viewer: CT MRI X-Ray',
  'ml-IN': 'DICOM Viewer: CT MRI X-Ray',
  ms: 'DICOM Viewer: CT MRI X-Ray',
  'ar-SA': 'عارض DICOM: CT MRI أشعة',
  hi: 'DICOM Viewer: CT MRI X-Ray',
  'bn-BD': 'DICOM Viewer: CT MRI X-Ray',
};

const SUBTITLES: Record<string, string> = {
  'en-US': 'PACS, MPR & Medical Imaging',
  'en-GB': 'NHS Radiology, PACS & MPR',
  'en-AU': 'Medical Imaging, PACS & MPR',
  'en-CA': 'Radiology, PACS & Vet Imaging',
  'zh-Hans': 'PACS·MPR·医学影像·放射科',
  'zh-Hant': 'PACS·MPR·醫學影像·放射科',
  uk: 'Радіологія, УЗД, MPR і PACS',
  ru: 'Радиология, УЗИ, MPR и PACS',
  he: 'רדיולוגיה, אולטרסאונד, PACS',
  'ar-SA': 'تصوير طبي، موجات صوتية، PACS',
};

for (const locale of ['te-IN', 'pa-IN', 'ta-IN', 'ur-PK', 'gu-IN', 'or-IN', 'kn-IN', 'mr-IN', 'ml-IN', 'hi', 'bn-BD']) {
  SUBTITLES[locale] = 'PACS, MPR, 3D & CBCT';
}

const MANUAL_KEEP = new Map([
  ['es-ES\u0000magnetica', 'Validated as the full phrase “resonancia magnetica” in ES.'],
  ['es-MX\u0000magnetica', 'Validated as the full phrase “resonancia magnetica” in MX.'],
]);

const MANUAL_ADDITIONS: Record<string, string[]> = {
  // Slovenia's translated modifiers returned empty/noisy SERPs. These English
  // professional combinations were checked in SI on 2026-09-04; MedScan is
  // #1–2 on each retained DICOM phrase.
  'sl-SI': ['mpr', '3d', 'nifti', 'mammography', 'tomography', 'spine'],
  // Pakistan: both combinations return MedScan #1 and a medical SERP.
  'ur-PK': ['tomography', 'nifti'],
};

const BUSINESS_DROP = new Set([
  // A “free” modifier is relevant but conflicts with the paid subscription
  // funnel and the premium positioning of the new metadata.
  'de-DE\u0000kostenlos',
]);

function parseArgs() {
  const values: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  if (!values.draft || !values.audit || !values.output) {
    throw new Error('Pass --draft=... --audit=... --output=... [--report=...]');
  }
  return {
    draft: resolve(values.draft), audit: resolve(values.audit), output: resolve(values.output),
    report: resolve(values.report || `${values.output}.md`),
  };
}

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim();
}

// App Store Connect enforces the metadata limits before normalization. Count
// Unicode code points (including combining marks), which is deliberately more
// conservative than user-perceived graphemes and avoids a late ASC rejection
// for scripts such as Thai.
function length(value: string) { return Array.from(value).length; }

function visibleTokens(title: string, subtitle: string) {
  return new Set(normalize(`${title} ${subtitle}`).split(/[^\p{L}\p{N}+-]+/u).filter(Boolean));
}

async function main() {
  const options = parseArgs();
  const draft = JSON.parse(await readFile(options.draft, 'utf8')) as Draft;
  const audit = JSON.parse(await readFile(options.audit, 'utf8')) as AuditRow[];
  const verdict = new Map<string, AuditRow['verdict']>();
  for (const row of audit) for (const locale of row.locales) verdict.set(`${locale}\u0000${normalize(row.keyword)}`, row.verdict);

  const localizations: Record<string, Fields & { removed: Array<{ keyword: string; reason: string }> }> = {};
  const failures: string[] = [];
  for (const [locale, current] of Object.entries(draft.localizations)) {
    const title = TITLES[locale];
    const subtitle = SUBTITLES[locale] || current.subtitle;
    if (!title) failures.push(`${locale}: missing title`);
    if (length(title || '') > 30) failures.push(`${locale}: title ${length(title)} > 30`);
    if (length(subtitle) > 30) failures.push(`${locale}: subtitle ${length(subtitle)} > 30`);

    const visible = visibleTokens(title || '', subtitle);
    const kept: string[] = [];
    const removed: Array<{ keyword: string; reason: string }> = [];
    for (const raw of current.keywords.split(',').map((item) => item.trim()).filter(Boolean)) {
      const key = `${locale}\u0000${normalize(raw)}`;
      const rawTokens = normalize(raw).split(/[^\p{L}\p{N}+-]+/u).filter(Boolean);
      if (rawTokens.length > 0 && rawTokens.every((token) => visible.has(token))) {
        removed.push({ keyword: raw, reason: 'duplicate of title/subtitle' });
        continue;
      }
      if (BUSINESS_DROP.has(key)) {
        removed.push({ keyword: raw, reason: 'relevant SERP but wrong paid-product intent' });
        continue;
      }
      const state = verdict.get(key);
      if (state === 'validated' || state === 'modifier' || MANUAL_KEEP.has(key)) {
        kept.push(raw);
      } else {
        removed.push({ keyword: raw, reason: state || 'not audited' });
      }
    }

    for (const addition of MANUAL_ADDITIONS[locale] || []) {
      if (!kept.some((item) => normalize(item) === normalize(addition)) && !visible.has(normalize(addition))) kept.push(addition);
    }
    // The brand was #1–10 in all 89 tracked storefronts before this change.
    // Keep it first so trimming lower-priority tail terms can never erase
    // branded eligibility after MedScan leaves the title.
    if (!visible.has('medscan') && !kept.some((item) => normalize(item) === 'medscan')) kept.unshift('medscan');
    while (length(kept.join(',')) > 100) {
      const dropped = kept.pop();
      if (dropped) removed.push({ keyword: dropped, reason: 'trimmed to 100-character limit' });
    }
    if (length(kept.join(',')) > 100) failures.push(`${locale}: keywords ${length(kept.join(','))} > 100`);

    localizations[locale] = {
      status: 'deploy', title, subtitle, keywords: kept.join(','), removed,
      decision: 'DICOM-first visible metadata; keyword field contains only SERP-validated direct terms/modifiers plus the measured MedScan brand.',
    };
  }
  if (Object.keys(localizations).length !== 50) failures.push(`expected 50 locales, got ${Object.keys(localizations).length}`);
  if (failures.length) throw new Error(`Manifest validation failed:\n${failures.join('\n')}`);

  const output = {
    appId: '6762091560', version: '1.10.0', generatedAt: new Date().toISOString(),
    sourceDraft: options.draft, sourceSerpAudit: options.audit,
    policy: {
      title: 'DICOM viewer + CT/MRI/X-ray intent; MedScan moved to keyword field',
      keywords: 'Only strict SERP validated/modifier terms; weak/reject/no-data removed, except documented phrase-level evidence',
    },
    localizations,
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const lines = [
    '# MedScan ASO deploy manifest — 1.10.0', '',
    `Generated from the full 559-pair strict SERP audit. No App Store Connect write is performed by this generator.`, '',
    '| Locale | Title | Subtitle | Keywords | Removed |',
    '|---|---|---|---:|---:|',
  ];
  for (const [locale, fields] of Object.entries(localizations)) {
    lines.push(`| ${locale} | ${fields.title} (${length(fields.title)}/30) | ${fields.subtitle} (${length(fields.subtitle)}/30) | ${length(fields.keywords)}/100 | ${fields.removed.length} |`);
  }
  await writeFile(options.report, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${Object.keys(localizations).length} validated localizations to ${options.output}`);
  console.log(`Report: ${options.report}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
