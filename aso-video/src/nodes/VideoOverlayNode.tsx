// Composite an OVERLAY video on top of a BASE video starting at a given time.
// Base audio is preserved (overlay muted) so a single voice carries through.
//
// Use case: Kling face-shot is the base, screen recording is the overlay —
// at e.g. 5s the screen recording covers the frame while the base voice
// keeps narrating. Replaces a stitch + voiceover-mismatch flow.
import { NodeShell, patchData, triggerRun, stopProp } from './common';
import { openLightbox } from '../components/Lightbox';

type Position = 'fullscreen' | 'phone-screenshot' | 'card' | 'polaroid' | 'center' | 'top' | 'bottom';

interface Data {
  start?: number;            // seconds — when overlay begins
  duration?: number;         // total output duration (default = base duration)
  keepBaseAudio?: boolean;
  position?: Position;
  fadeMs?: number;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  error?: string;
  label?: string;
}

export function VideoOverlayNode({ id, data }: { id: string; data: Data }) {
  return (
    <NodeShell
      id={id}
      type="video-overlay"
      title={data.label ?? 'Video Overlay'}
      status={data.status}
      inputs={[
        { id: 'base', label: 'base video' },
        { id: 'overlay', label: 'overlay video' },
      ]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel="Composite (free)"
    >
      <div className="nodrag vid-grid2">
        <div>
          <span className="vid-label">Start (s)</span>
          <input className="ds-input"
            type="number" min={0} step={0.5}
            value={data.start ?? 5}
            onChange={(e) => patchData(id, { start: Number(e.target.value) })}
            onMouseDown={stopProp}
          />
        </div>
        <div>
          <span className="vid-label">Duration (s)</span>
          <input className="ds-input"
            type="number" min={0} step={0.5}
            value={data.duration ?? ''}
            placeholder="auto"
            onChange={(e) => patchData(id, { duration: e.target.value ? Number(e.target.value) : undefined })}
            onMouseDown={stopProp}
          />
        </div>
      </div>
      <div className="nodrag">
        <span className="vid-label">Position</span>
        <select
          className="nodrag ds-select"
          onMouseDown={stopProp}
          value={data.position ?? 'phone-screenshot'}
          onChange={(e) => patchData(id, { position: e.target.value as Position })}
        >
          <option value="phone-screenshot">📱 phone-screenshot — 70% width, big rounded</option>
          <option value="card">🟦 card — 80% width, small rounded</option>
          <option value="polaroid">📷 polaroid — 75% + white frame</option>
          <option value="center">⊙ center — fit, transparent letterbox</option>
          <option value="fullscreen">⬛ fullscreen — cover entire frame</option>
          <option value="top">▔ top banner</option>
          <option value="bottom">▁ bottom banner</option>
        </select>
      </div>
      <label className="nodrag vid-check">
        <input
          type="checkbox"
          checked={data.keepBaseAudio !== false}
          onChange={(e) => patchData(id, { keepBaseAudio: e.target.checked })}
        />
        keep base audio (mute overlay)
      </label>
      {data.error && <div className="vid-err">{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <>
          <video key={data.outputUrl} src={data.outputUrl} controls style={{ width: '100%', borderRadius: 'var(--ds-radius-control)', background: '#000' }} />
          <button
            className="nodrag ds-btn ds-btn-sm"
            onClick={() => openLightbox({ kind: 'video', src: data.outputUrl! })}
            title="open fullscreen"
            style={{ alignSelf: 'flex-start' }}
          >⛶ fullscreen</button>
        </>
      )}
    </NodeShell>
  );
}
