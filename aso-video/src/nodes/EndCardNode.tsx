// End Card — Remotion-rendered branded outro that gets concatenated to the
// end of the input video. Designed to live AFTER Captions in the pipeline so
// the talking-head portion gets subtitles and the branded segment stays clean.
import { NodeShell, inputStyle, labelStyle, patchData, triggerRun } from './common';
import { openLightbox } from '../components/Lightbox';

interface Data {
  label?: string;
  duration?: number;
  cta?: string;
  subtitle?: string;
  brand?: string;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  error?: string;
  progress?: number;
  stage?: string;
}

export function EndCardNode({ id, data }: { id: string; data: Data }) {
  const duration = data.duration ?? 3.0;
  const cta = data.cta ?? 'Try Dream Free';
  const subtitle = data.subtitle ?? 'Decode every dream';
  const brand = data.brand ?? 'Dream';

  return (
    <NodeShell
      id={id}
      type="end-card"
      title={data.label || 'End Card (Remotion)'}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      inputs={[{ id: 'video', label: 'video' }]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel={`Render & Concat (${duration.toFixed(1)}s, free)`}
    >
      <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <span style={labelStyle}>Brand</span>
          <input type="text" value={brand} onChange={(e) => patchData(id, { brand: e.target.value })} style={inputStyle} />
        </div>
        <div>
          <span style={labelStyle}>Duration (sec)</span>
          <input type="number" min={1} max={10} step={0.5} value={duration} onChange={(e) => patchData(id, { duration: Number(e.target.value) })} style={inputStyle} />
        </div>
      </div>
      <div className="nodrag">
        <span style={labelStyle}>Subtitle</span>
        <input type="text" value={subtitle} onChange={(e) => patchData(id, { subtitle: e.target.value })} style={inputStyle} />
      </div>
      <div className="nodrag">
        <span style={labelStyle}>CTA</span>
        <input type="text" value={cta} onChange={(e) => patchData(id, { cta: e.target.value })} style={inputStyle} />
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
