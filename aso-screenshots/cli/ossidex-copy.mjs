/**
 * Ossidex (ex-MedScan) — screenshot captions. Frame keys → [headline, subline].
 * A = main set (feature-led, continuity with the 1.10 set).
 * B/C/D = PPO treatments built on the doctors' pains map (vault «Doctor feedback —
 * pains map — 2026-09-22»):
 *   B «No laptop»      — carrying a laptop to consultations; showing the patient
 *   C «Any scanner»    — every CBCT vendor ships its own viewer on the disc
 *   D «In seconds»     — no time to fight software while the next patient waits
 * Only verifiable product facts: no prices, no rankings, no "free".
 */
export const LAURELS = {
  en: ['Any\nCBCT scanner', 'DICOM\n& NIfTI', 'Private\nno sign-up'],
  ru: ['Любой\nКЛКТ-томограф', 'DICOM\nи NIfTI', 'Приватно\nбез регистрации'],
};

export const QUOTE = {
  en: '“Panoramic arch from a CBCT\nin seconds — right on my iPad.”\n— Dr. R., Oral Surgeon',
  ru: '«Панорама из КЛКТ за секунды —\nпрямо на iPad.»\n— Доктор Р., хирург-стоматолог',
};

// variant → ordered frames [frameKey, headline, subline]
export const VARIANTS = {
  en: {
    A: [
      ['arch', 'Panoramic arch', 'Cross-sections from any CBCT'],
      ['mpr', 'Three planes at once', 'Axial · Sagittal · Coronal'],
      ['3d', '3D volume rendering', 'Rotate, clip & explore'],
      ['measure', 'Measure in mm', 'Ruler · Angle · HU'],
      ['library', 'Open any scan', 'CT · MRI · CBCT · NIfTI'],
      ['import', 'From any source', 'Disc · ZIP · Files · Messengers'],
    ],
    B: [
      ['arch', 'Leave the laptop', 'CBCT on your iPhone & iPad'],
      ['3d', 'Show patients in 3D', 'Right in the consultation'],
      ['measure', 'Check the site in mm', 'Bone height & width in seconds'],
      ['mpr', 'Every plane in your pocket', 'Axial · Sagittal · Coronal'],
      ['import', 'Scan sent in a chat?', 'Open it straight from the message'],
      ['library', 'Cases by patient', 'Stored on your device'],
    ],
    C: [
      ['arch', 'One viewer for every CBCT', 'No vendor software needed'],
      ['import', 'Case from another clinic?', 'Open the disc, ZIP or folder'],
      ['mpr', 'Standard DICOM, any brand', 'Axial · Sagittal · Coronal'],
      ['measure', 'Same tools on every scan', 'Ruler · Angle · HU'],
      ['3d', 'Full 3D volume', 'From any scanner'],
      ['library', 'CT, MRI & NIfTI too', 'One library for all your cases'],
    ],
    D: [
      ['arch', 'CBCT open in seconds', 'Before the next patient walks in'],
      ['measure', 'Fits or not? Check in mm', 'Quick look, decide on the spot'],
      ['mpr', 'Every plane, one tap', 'Axial · Sagittal · Coronal'],
      ['3d', '3D without a workstation', 'Rotate, clip & explore'],
      ['import', 'From chat to scan', 'Disc · ZIP · Files · Messengers'],
      ['library', 'All your cases, offline', 'Organized by patient'],
    ],
  },
};
