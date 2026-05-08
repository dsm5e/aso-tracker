// Composite an OVERLAY video on top of a BASE video starting at a given time.
// Base audio is preserved (overlay muted) so a single voice carries through.
//
// Use case: Kling face-shot is the base, screen recording is the overlay —
// at e.g. 5s the screen recording covers the frame while the base voice
// keeps narrating. Replaces a stitch + voiceover-mismatch flow.
import { NodeShell, inputStyle, labelStyle, patchData, triggerRun, stopProp } from './common';
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
      <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <span style={labelStyle}>Start (s)</span>
          <input
            type="number" min={0} step={0.5}
            value={data.start ?? 5}
            onChange={(e) => patchData(id, { start: Number(e.target.value) })}
            onMouseDown={stopProp}
            style={inputStyle}
          />
        </div>
        <div>
          <span style={labelStyle}>Duration (s)</span>
          <input
            type="number" min={0} step={0.5}
            value={data.duration ?? ''}
            placeholder="auto"
            onChange={(e) => patchData(id, { duration: e.target.value ? Number(e.target.value) : undefined })}
            onMouseDown={stopProp}
            style={inputStyle}
          />
        </div>
      </div>
      <div className="nodrag">
        <span style={labelStyle}>Position</span>
        <select
          className="nodrag"
          onMouseDown={stopProp}
          value={data.position ?? 'phone-screenshot'}
          onChange={(e) => patchData(id, { position: e.target.value as Position })}
          style={inputStyle}
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
      <label className="nodrag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a3a3a3', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={data.keepBaseAudio !== false}
          onChange={(e) => patchData(id, { keepBaseAudio: e.target.checked })}
        />
        keep base audio (mute overlay)
      </label>
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <>
          <video key={data.outputUrl} src={data.outputUrl} controls style={{ width: '100%', borderRadius: 6, background: '#000' }} />
          <button
            className="nodrag"
            onClick={() => openLightbox({ kind: 'video', src: data.outputUrl! })}
            title="open fullscreen"
            style={{ marginTop: 4, background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', cursor: 'zoom-in', fontSize: 11, alignSelf: 'flex-start' }}
          >⛶ fullscreen</button>
        </>
      )}
    </NodeShell>
  );
}
