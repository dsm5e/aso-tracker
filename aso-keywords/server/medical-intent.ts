function normalized(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// High-signal vocabulary for MedScan discovery. Short ambiguous tokens such as
// "x", "ct", "opg" and "idv" are deliberately not sufficient on their own.
// They are accepted when the result/app name supplies additional medical
// context (for example "IDV - IMAIOS DICOM Viewer").
const MEDSCAN_MEDICAL_INTENT = /(?:\bdicom\b|dicomdir|dicomweb|\bdcm\b|\bcbct\b|\bpacs\b|\bmri\b|\birm\b|\bnifti\b|ct[\s-]?(?:scan|viewer|image|imaging)|x[\s-]?ray|rayos?\s+x|raios?\s+x|radiol|radiogr|tomograf|resonan|resson|risonan|röntgen|roentgen|rontgen|rentgen|рентген|томограф|\bмрт\b|medical|medic[ao]|médical|imagerie|imaging|dental|dentist|orthodont|\bortho(?:kit|cal)?\b|cone\s+beam|implant\s+planning|pathology|hounsfield|slicer|radiant|osirix|horos|weasis|imaios|microdicom|lumadicom|medscan|diagnocat|sectra|carestream|medfilm|postdicom|romexis|sidexis|ondemand3d|3dicom|orthanc|ohif|exocad|intelerad|ambra\s+health|blue\s+sky\s+plan|visualizador\s+dicom|visor\s+dicom|dicom\s+betrachter|diagnostic|hospital|exame|befund|imej\s+perubatan|immagini\s+mediche|hình\s+ảnh\s+y\s+khoa|أشعة|تصوير|엑스레이|치과|교정|医療|医学|放射線|核磁|磁共振|断层|斷層|医学影像|醫學影像|рентген)/iu;

export function hasMedScanMedicalIntent(value: string): boolean {
  return MEDSCAN_MEDICAL_INTENT.test(normalized(value));
}

export function isMedScanCompetitorEvidence(keyword: string, name: string, developer = ''): boolean {
  // A relevant query alone is not enough: App Store occasionally returns a
  // game or another unrelated app for an ambiguous acronym. Require medical
  // context in the observed app identity as well. `keyword` stays in the
  // signature to make the evidence contract explicit and reject empty rows.
  return Boolean(normalized(keyword)) && hasMedScanMedicalIntent(`${name} ${developer}`);
}

// --- Keyword ideas: MedScan-specific relevance lexicon -----------------------

/** Product and company names seen in the DICOM/dental niche. A phrase that
 * contains one of these is a brand query, not a generic intent. */
export const MEDSCAN_KNOWN_BRANDS = new Set([
  'slicer', 'radiant', 'osirix', 'horos', 'weasis', 'imaios', 'idv', 'microdicom',
  'lumadicom', 'medscan', 'diagnocat', 'sectra', 'carestream', 'medfilm', 'postdicom',
  'romexis', 'sidexis', 'ondemand3d', '3dicom', 'orthanc', 'ohif', 'exocad',
  'intelerad', 'ambra', 'falcon', 'emma', 'mesdicom', 'slicora', 'medicai',
  'dicompocket', 'berlincaseviewer', 'orthokit', 'orthocal', 'mimics', 'invesalius',
  'synapse', 'agfa', 'philips', 'siemens', 'fujifilm', 'planmeca', 'vatech', 'dentsply',
  'kompath', 'bee', 'mobiuss', 'nanodicom', 'imagej', 'fiji', 'medixant',
]);

/** Words that turn a medical-looking phrase into another intent (pranks,
 * games, property software, astrology…). */
const MEDSCAN_OFF_TOPIC = /(?:prank|joke|fake|funny|minecraft|game|simulator|\bvr\b|helmet|\bfx\b|filter|camera|c[aá]mara|kamera|vision|horoscope|astrolog|birth\s+chart|tarot|\brent\b|payment|resident|portal|tenant|callmax|angus|quiz|trivia|flashcard|anatomy|tattoo|cloth|body\s+scanner|see\s+through)/iu;

/** Acronyms that are ambiguous on their own ("mri software" is property
 * management, "x-ray scanner" is a prank) and need a viewer/imaging word. */
const MEDSCAN_AMBIGUOUS = /\b(?:mri|ct|x-?ray|xray|irm)\b/giu;
const MEDSCAN_CONTEXT = /(?:viewer|\bview\b|reader|\bopen|dicom|\bdcm\b|image|imaging|radiolog|\bfilm|report|result|stud(?:y|ies)|\bfiles?\b|\b3d\b|cbct|dental|medical|pacs|visor|visualizador|betrachter|просмотр|снимк|(?:ct|mri)[\s-]?scan)/iu;

export function isMedScanOffTopic(value: string): boolean {
  return MEDSCAN_OFF_TOPIC.test(normalized(value));
}

/** True when the phrase has a medical-imaging signal beyond a bare ambiguous
 * acronym: either a viewer/imaging context word or another medical term. */
export function hasMedScanViewerContext(value: string): boolean {
  const text = normalized(value);
  if (MEDSCAN_CONTEXT.test(text)) return true;
  return hasMedScanMedicalIntent(text.replace(MEDSCAN_AMBIGUOUS, ' '));
}

export const MEDSCAN_CLUSTERS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'dental', label: 'Стоматология и КЛКТ', pattern: /(?:dental|dentist|cbct|cone\s+beam|orthodont|implant|\bopg\b|panoram|치과|стомат)/iu },
  { id: 'dicom', label: 'DICOM и PACS', pattern: /(?:dicom|\bdcm\b|pacs|nifti)/iu },
  { id: 'mri', label: 'МРТ', pattern: /(?:\bmri\b|\birm\b|resonan|resson|risonan|\bмрт\b|magnetic)/iu },
  { id: 'ct', label: 'КТ', pattern: /(?:\bct\b|tomograf|томограф|cat\s+scan)/iu },
  { id: 'xray', label: 'Рентген', pattern: /(?:x-?ray|xray|rayos?\s+x|raios?\s+x|röntgen|roentgen|rontgen|rentgen|рентген|radiogr)/iu },
];

export function medScanCluster(value: string): { id: string; label: string } {
  const text = normalized(value);
  const match = MEDSCAN_CLUSTERS.find((cluster) => cluster.pattern.test(text));
  return match ? { id: match.id, label: match.label } : { id: 'imaging', label: 'Медицинские снимки' };
}
