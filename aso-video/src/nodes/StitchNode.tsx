// Stitch — concatenate two videos end-to-end via ffmpeg. Used when
// multi-prompt Kling drops lip-sync on shot 1 — split into single-prompt
// Kling A (5s, reliable lip-sync) + multi-prompt Kling B (10s) and stitch.
import { NodeShell } from './common';
import { openLightbox } from '../components/Lightbox';

interface Data {
  label?: string;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  error?: string;
  progress?: number;
  stage?: string;
}

import { triggerRun } from './common';

export function StitchNode({ id, data }: { id: string; data: Data }) {
  return (
    <NodeShell
      id={id}
      type="stitch"
      title={data.label || 'Stitch (concat A → B)'}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      inputs={[
        { id: 'video_a', label: 'video A (first)' },
        { id: 'video_b', label: 'video B (after A)' },
      ]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel="Stitch (free)"
    >
      <div className="vid-note">
        Concatenates A then B end-to-end. Both rescaled to 1080×1920 30fps. Audio joined.
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
