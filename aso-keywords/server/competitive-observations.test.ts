import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePaidObservation, productPageIdFromEvidence } from './paid-observations.js';
import { normalizeAsoExperimentInput, normalizeMetadataSnapshotInput, publicPayloadToInput } from './metadata-history.js';
import { assertSafeAppId } from './config.js';

test('paid observation keeps an observed slot separate from traffic share and confirms CPP only by ppid URL evidence', () => {
  const observation = normalizePaidObservation({
    locale: 'US',
    keyword: ' dicom viewer ',
    source: 'manual_app_store_observation',
    idempotencyKey: 'capture_20260904',
    evidenceUrl: 'https://capture.example/search',
    paidResults: [{
      name: 'IDV', rank: 1, placement: 'SEARCH_RESULTS', appId: '1444841062',
      clickUrl: 'https://apps.apple.com/us/app/id1444841062?ppid=idv-cpp-7',
    }],
  }, Date.parse('2026-09-04T00:00:00Z'));
  assert.equal(observation.locale, 'us');
  assert.equal(observation.keyword, 'dicom viewer');
  assert.equal(observation.paidResults[0].productPageId, 'idv-cpp-7');
  assert.equal(observation.paidResults[0].cppEvidence, 'confirmed');
  assert.equal(observation.idempotencyKey, 'capture_20260904');
  assert.equal(productPageIdFromEvidence('a ppid=fake in prose'), null);
  assert.equal(productPageIdFromEvidence('https://evidence.example/capture?ppid=fake-cpp'), null);
  assert.equal(productPageIdFromEvidence('https://apps.apple.com/us/app/id1444841062?ppid=real-cpp'), 'real-cpp');
  assert.equal('trafficShare' in observation, false);
});

test('paid observation rejects unbounded/fake paid result imports', () => {
  assert.throws(() => normalizePaidObservation({
    locale: 'us', keyword: 'dicom', source: 'sensor_tower_scrape', paidResults: [],
  }), /source must be one of/);
  assert.throws(() => normalizePaidObservation({
    locale: 'us', keyword: 'dicom', source: 'manual_app_store_observation',
    paidResults: [{ name: 'IDV', rank: 0, placement: 'SEARCH_RESULTS' }],
  }), /rank/);
  assert.throws(() => normalizePaidObservation({
    locale: 'us', keyword: 'dicom', source: 'manual_app_store_observation',
    paidResults: [{ name: 'IDV', rank: 1, placement: 'TODAY_TAB' }],
  }), /placement/);
  assert.throws(() => normalizePaidObservation({
    locale: 'us', keyword: 'dicom', observedAt: 'next Tuesday', source: 'manual_app_store_observation',
    paidResults: [{ name: 'IDV', rank: 1, placement: 'SEARCH_RESULTS' }],
  }), /ISO date/);
});

test('metadata makes private ASC fields explicit and validates ASO before/after windows', () => {
  const metadata = normalizeMetadataSnapshotInput({
    locale: 'br', source: 'manual_asc_export', title: 'MedScan', subtitle: 'DICOM viewer', keywords: 'dicom,ct',
  }, Date.parse('2026-09-04T00:00:00Z'));
  assert.equal(metadata.subtitle, 'DICOM viewer');
  assert.equal(metadata.keywords, 'dicom,ct');
  assert.throws(() => normalizeAsoExperimentInput({
    name: 'Bad dates', beforeStart: '2026-09-03T00:00:00Z', beforeEnd: '2026-09-01T00:00:00Z',
  }), /beforeStart must be before/);
  assert.throws(() => normalizeAsoExperimentInput({ name: 'Bad status', status: 'archived' }), /status must be one of/);
  const experiment = normalizeAsoExperimentInput({
    name: 'DICOM title test', status: 'running', locales: ['US', 'br'],
    beforeStart: '2026-08-01T00:00:00Z', beforeEnd: '2026-08-15T00:00:00Z',
    afterStart: '2026-08-16T00:00:00Z', afterEnd: '2026-08-30T00:00:00Z',
    metadataChanges: [{ field: 'title', before: 'MedScan', after: 'MedScan DICOM Viewer', locale: 'us' }],
  });
  assert.deepEqual(experiment.locales, ['us', 'br']);
  assert.equal(experiment.metadataChanges?.[0]?.field, 'title');
  assert.throws(() => normalizeAsoExperimentInput({ name: null }, true), /name required/);
  assert.throws(() => normalizeMetadataSnapshotInput({
    locale: 'us', source: 'manual_asc_export', observedAt: 'tomorrow sometime',
  }), /ISO date/);
});

test('public capture refuses a lookup response for a different app and app ids cannot escape the keyword directory', () => {
  assert.equal(publicPayloadToInput({ results: [{ trackId: 6762091560, trackName: 'MedScan' }] }, 'us', '6762091560')?.title, 'MedScan');
  assert.equal(publicPayloadToInput({ results: [{ trackId: 123, trackName: 'Other app' }] }, 'us', '6762091560'), null);
  assert.equal(assertSafeAppId('medscan-2'), 'medscan-2');
  assert.throws(() => assertSafeAppId('../state'), /app id/);
  assert.throws(() => assertSafeAppId('medscan/../../other'), /app id/);
});
