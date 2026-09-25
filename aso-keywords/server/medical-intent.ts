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
