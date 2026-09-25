// End Card — Remotion-rendered branded outro that gets concatenated to the
// end of the input video. Designed to live AFTER Captions in the pipeline so
// the talking-head portion gets subtitles and the branded segment stays clean.
import { NodeShell, patchData, triggerRun } from './common';
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
      <div className="nodrag vid-grid2">
        <div>
          <span className="vid-label">Brand</span>
          <input className="ds-input" type="text" value={brand} onChange={(e) => patchData(id, { brand: e.target.value })} />
        </div>
        <div>
          <span className="vid-label">Duration (sec)</span>
          <input className="ds-input" type="number" min={1} max={10} step={0.5} value={duration} onChange={(e) => patchData(id, { duration: Number(e.target.value) })} />
        </div>
      </div>
      <div className="nodrag">
        <span className="vid-label">Subtitle</span>
        <input className="ds-input" type="text" value={subtitle} onChange={(e) => patchData(id, { subtitle: e.target.value })} />
      </div>
      <div className="nodrag">
        <span className="vid-label">CTA</span>
        <input className="ds-input" type="text" value={cta} onChange={(e) => patchData(id, { cta: e.target.value })} />
      </div>
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
