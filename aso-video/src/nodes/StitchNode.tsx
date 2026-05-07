// Stitch — concatenate two videos end-to-end via ffmpeg. Used when
// multi-prompt Kling drops lip-sync on shot 1 — split into single-prompt
// Kling A (5s, reliable lip-sync) + multi-prompt Kling B (10s) and stitch.
import { NodeShell, labelStyle } from './common';
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
      <div style={{ ...labelStyle, padding: '6px 4px', lineHeight: 1.4 }}>
        Concatenates A then B end-to-end. Both rescaled to 1080×1920 30fps. Audio joined.
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
