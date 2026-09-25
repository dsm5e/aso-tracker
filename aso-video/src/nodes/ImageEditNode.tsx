import { HistoryPicker } from '../components/HistoryPicker';
import { openLightbox } from '../components/Lightbox';
import { NodeShell, patchData, stopProp, triggerRun } from './common';

interface Data {
  label?: string;
  prompt?: string;
  model?: 'flux-kontext-pro' | 'nano-banana-2-edit' | 'gpt-image-2-edit';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  error?: string;
  progress?: number;
  stage?: string;
  cost?: number;
}

export function ImageEditNode({ id, data }: { id: string; data: Data }) {
  const model = data.model ?? 'flux-kontext-pro';
  return (
    <NodeShell
      id={id}
      type="image-edit"
      title={data.label ?? 'Hairstyle Edit'}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      accentColor="var(--vid-cat-gen)"
      inputs={[{ id: 'image', label: 'master image' }]}
      outputs={[{ id: 'image', label: 'edited image' }]}
      onRun={() => triggerRun(id)}
      runLabel={model === 'gpt-image-2-edit' ? 'Edit with GPT' : 'Edit (~$0.04)'}
    >
      <HistoryPicker kind="image" onPick={(url) => patchData(id, { status: 'done', outputUrl: url, error: undefined })} />
      <div className="nodrag">
        <span className="vid-label">Edit model</span>
        <select className="ds-select" value={model} onMouseDown={stopProp} onChange={(e) => patchData(id, { model: e.target.value })}>
          <option value="flux-kontext-pro">Flux Kontext Pro (~$0.04)</option>
          <option value="nano-banana-2-edit">Nano Banana 2 Edit (~$0.04)</option>
          <option value="gpt-image-2-edit">GPT Image 2 Edit</option>
        </select>
      </div>
      {model === 'gpt-image-2-edit' && (
        <div className="nodrag">
          <span className="vid-label">Quality</span>
          <select className="ds-select" value={data.quality ?? 'medium'} onMouseDown={stopProp} onChange={(e) => patchData(id, { quality: e.target.value })}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="auto">auto</option>
          </select>
        </div>
      )}
      <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <span className="vid-label">Change only</span>
        <textarea className="ds-textarea"
          value={data.prompt ?? ''}
          onChange={(e) => patchData(id, { prompt: e.target.value })}
          placeholder="Change only the hairstyle to… Keep identity, clothes, pose, framing, light and background unchanged."
          style={{ minHeight: 84, resize: 'vertical' }}
        />
      </div>
      {data.error && <div className="vid-err">{data.error}</div>}
      {data.outputUrl && (
        <>
          <img src={data.outputUrl} alt="" onClick={() => openLightbox({ kind: 'image', src: data.outputUrl! })} style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 'var(--ds-radius-control)', background: 'var(--ds-panel-2)', cursor: 'zoom-in' }} />
          {typeof data.cost === 'number' && <div className="vid-meta">cost ${data.cost.toFixed(3)}</div>}
        </>
      )}
    </NodeShell>
  );
}
