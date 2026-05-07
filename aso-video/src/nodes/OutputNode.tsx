import { NodeShell, labelStyle } from './common';
import { openLightbox } from '../components/Lightbox';
import { MockupFrame } from '../components/TikTokMockup';

interface Data {
  label?: string;
  // Upstream video URL is injected by App.tsx when building rfNodes,
  // so this component doesn't need access to the full graph (keeping
  // nodeTypes stable across SSE updates).
  upstreamUrl?: string;
}

export function OutputNode({ id, data }: { id: string; data: Data }) {
  const upstreamUrl = data.upstreamUrl;
  return (
    <NodeShell
      id={id}
      type="output"
      title={data.label ?? 'Output'}
      inputs={[{ id: 'video', label: 'video' }]}
    >
      {upstreamUrl ? (
        <>
          {/* `key` forces remount when src changes — otherwise <video> keeps showing the previously loaded media.
              MockupFrame overlays TikTok chrome (profile rail, caption bar, etc.) for visual preview only —
              not rendered into the actual mp4. */}
          <MockupFrame>
            <video key={upstreamUrl} src={upstreamUrl} controls style={{ width: '100%', height: 'auto', borderRadius: 6, background: '#000', display: 'block' }} />
          </MockupFrame>
          <button
            className="nodrag"
            onClick={() => openLightbox({ kind: 'video', src: upstreamUrl })}
            title="open fullscreen"
            style={{ marginTop: 4, background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 10px', cursor: 'zoom-in', fontSize: 11, alignSelf: 'flex-start' }}
          >⛶ fullscreen</button>
        </>
      ) : (
        <div style={{ ...labelStyle, padding: 16, textAlign: 'center', border: '1px dashed #2a2a2a', borderRadius: 6 }}>
          connect a video output here
        </div>
      )}
    </NodeShell>
  );
}
