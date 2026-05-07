// Image Overlay — burns an image on top of a video between (start, end) with
// fade in/out. Used for jump-scares (monster reveal), phone mockups, brand
// outros. Generic — chain anywhere in the pipeline.
import { NodeShell, inputStyle, labelStyle, patchData, triggerRun, stopProp } from './common';
import { openLightbox } from '../components/Lightbox';

type Position =
  | 'fullscreen'
  | 'center'
  | 'top'
  | 'bottom'
  | 'card'
  | 'polaroid'
  | 'phone-screenshot';

interface Data {
  label?: string;
  start?: number;
  end?: number;
  position?: Position;
  fadeMs?: number;
  opacity?: number;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  error?: string;
  progress?: number;
  stage?: string;
}

const POSITION_LABEL: Record<Position, string> = {
  card: 'Card (80% wide, rounded 24px, TikTok meme)',
  polaroid: 'Polaroid (75% wide, white frame 40px)',
  'phone-screenshot': 'Phone Screenshot (70% wide, rounded 60px)',
  fullscreen: 'Fullscreen (cover entire frame)',
  center: 'Center (fit + letterbox)',
  top: 'Top (full-width banner)',
  bottom: 'Bottom (full-width banner)',
};

export function ImageOverlayNode({ id, data }: { id: string; data: Data }) {
  const start = data.start ?? 2.0;
  const end = data.end ?? 3.5;
  const position: Position = data.position ?? 'card';
  const fadeMs = data.fadeMs ?? 200;
  const opacity = data.opacity ?? 1.0;

  return (
    <NodeShell
      id={id}
      type="image-overlay"
      title={data.label || 'Image Overlay'}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      inputs={[
        { id: 'video', label: 'video' },
        { id: 'image', label: 'image' },
      ]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel={`Burn Overlay (${(end - start).toFixed(1)}s, free)`}
    >
      <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <span style={labelStyle}>Start (sec)</span>
          <input
            type="number" min={0} step={0.1} value={start}
            onChange={(e) => patchData(id, { start: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>
        <div>
          <span style={labelStyle}>End (sec)</span>
          <input
            type="number" min={0.1} step={0.1} value={end}
            onChange={(e) => patchData(id, { end: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>
      </div>
      <div className="nodrag">
        <span style={labelStyle}>Position</span>
        <select
          className="nodrag" onMouseDown={stopProp}
          value={position}
          onChange={(e) => patchData(id, { position: e.target.value as Position })}
          style={inputStyle}
        >
          {(Object.keys(POSITION_LABEL) as Position[]).map((p) => (
            <option key={p} value={p}>{POSITION_LABEL[p]}</option>
          ))}
        </select>
      </div>
      <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <span style={labelStyle}>Fade (ms)</span>
          <input
            type="number" min={0} max={2000} step={50} value={fadeMs}
            onChange={(e) => patchData(id, { fadeMs: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>
        <div>
          <span style={labelStyle}>Opacity (0-1)</span>
          <input
            type="number" min={0} max={1} step={0.05} value={opacity}
            onChange={(e) => patchData(id, { opacity: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>
      </div>
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <>
          <video key={data.outputUrl} src={data.outputUrl} controls style={{ width: '100%', borderRadius: 6, background: '#000' }} />
          <button
            className="nodrag"
            onClick={() => openLightbox({ kind: 'video', src: data.outputUrl! })}
            title="open fullscreen"
            style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', cursor: 'zoom-in', fontSize: 11, alignSelf: 'flex-start' }}
          >⛶ fullscreen</button>
        </>
      )}
    </NodeShell>
  );
}
