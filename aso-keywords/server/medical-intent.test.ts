import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMedScanMedicalIntent, isMedScanCompetitorEvidence } from './medical-intent.js';

test('keeps MedScan discovery medical and rejects gaming noise', () => {
  for (const term of [
    'dicom viewer',
    'CT scan viewer',
    'resonancia magnetica',
    'aplicativo de raio x',
    'просмотр рентген',
    '의료 영상 DICOM',
    'IDV - IMAIOS DICOM Viewer',
  ]) assert.equal(hasMedScanMedicalIntent(term), true, term);

  for (const term of ['pubg mobile', 'reddit', 'chatgpt', 'OP.GG', 'Glorious Island']) {
    assert.equal(hasMedScanMedicalIntent(term), false, term);
  }
});

test('allows ambiguous query only when the observed app supplies medical context', () => {
  assert.equal(isMedScanCompetitorEvidence('idv', 'IDV - IMAIOS DICOM Viewer', 'IMAIOS'), true);
  assert.equal(isMedScanCompetitorEvidence('opg', 'OP.GG', 'OP.GG'), false);
  assert.equal(isMedScanCompetitorEvidence('dental x-ray', 'PUBG MOBILE', 'Tencent'), false);
  assert.equal(isMedScanCompetitorEvidence('opg', 'OrthoCal – Dental Analyses', 'Dorcas'), true);
});
