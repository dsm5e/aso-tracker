/**
 * Compile-time contract fixture for the append-only ASO experiment API.
 * It intentionally lives in src so `tsc -b` fails when the frontend drifts
 * from the concrete backend shape (numeric id, locales[], change array and
 * append-only event history).
 */
import type { AsoExperiment, AsoExperimentInput } from './api';

export const ASO_EXPERIMENT_INPUT_FIXTURE = {
  name: 'DICOM in subtitle',
  status: 'draft',
  hypothesis: 'A localized DICOM intent improves qualified visibility.',
  locales: ['us', 'br'],
  metadataChanges: [
    { field: 'subtitle', before: 'CT & MRI Viewer', after: 'DICOM CT & MRI Viewer', locale: 'us' },
  ],
  notes: null,
  beforeStart: null,
  beforeEnd: null,
  afterStart: null,
  afterEnd: null,
} satisfies AsoExperimentInput;

export const ASO_EXPERIMENT_RESPONSE_FIXTURE = {
  ...ASO_EXPERIMENT_INPUT_FIXTURE,
  id: 42,
  appId: 'medscan',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  archivedAt: null,
  events: [{ id: 1, action: 'created', payload: {}, createdAt: '2026-09-04T00:00:00.000Z' }],
} satisfies AsoExperiment;
