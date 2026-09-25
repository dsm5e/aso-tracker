import assert from "node:assert/strict";
import test from "node:test";
import { hasMedicalIntent } from "./decision-matrix.ts";

test("keeps MedScan medical and competitor intents out of generic Apple noise", () => {
  for (const keyword of ["dicom", "DICOM viewer", "cbct", "MRI CT viewer", "raio x", "визуализатор DICOM", "osirix", "IDV"]) {
    assert.equal(hasMedicalIntent(keyword), true, keyword);
  }
  for (const keyword of ["pubg mobile", "reddit", "chatgpt", "intercom", "x", "dico"]) {
    assert.equal(hasMedicalIntent(keyword), false, keyword);
  }
});
