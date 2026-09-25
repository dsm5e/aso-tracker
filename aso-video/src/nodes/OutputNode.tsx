import { NodeShell } from './common';
import { openLightbox } from '../components/Lightbox';
import { MockupFrame, MockupProvider, useMockupToggle } from '../components/TikTokMockup';

interface Data {
  label?: string;
  // Upstream video URL is injected by App.tsx when building rfNodes,
  // so this component doesn't need access to the full graph (keeping
  // nodeTypes stable across SSE updates).
  upstreamUrl?: string;
}

export function OutputNode({ id, data }: { id: string; data: Data }) {
  const upstreamUrl = data.upstreamUrl;
  // The toggle persists in localStorage so it survives reloads — same hook
  // we used to use from the toolbar, just relocated to live with the preview.
  const [mockup, setMockup] = useMockupToggle();
  return (
    <NodeShell
      id={id}
      type="output"
      title={data.label ?? 'Output'}
      inputs={[{ id: 'video', label: 'video' }]}
    >
      {upstreamUrl ? (
        <>
          <label
            className="nodrag vid-check"
            title="Overlay TikTok UI chrome on the preview — visual only, not baked into mp4"
          >
            <input
              type="checkbox"
              checked={mockup}
              onChange={(e) => setMockup(e.target.checked)}
            />
            📱 TikTok mockup
          </label>
          {/* `key` forces remount when src changes — otherwise <video> keeps showing the previously loaded media.
              MockupFrame overlays TikTok chrome (profile rail, caption bar, etc.) for visual preview only —
              not rendered into the actual mp4. The Provider scopes the toggle to this node so
              other Output nodes (rare but possible) can have their own mockup state. */}
          <MockupProvider enabled={mockup}>
            <MockupFrame>
              <video key={upstreamUrl} src={upstreamUrl} controls style={{ width: '100%', height: 'auto', borderRadius: 'var(--ds-radius-control)', background: '#000', display: 'block' }} />
            </MockupFrame>
          </MockupProvider>
          <button
            className="nodrag ds-btn ds-btn-sm"
            onClick={() => openLightbox({ kind: 'video', src: upstreamUrl })}
            title="open fullscreen"
            style={{ alignSelf: 'flex-start' }}
          >⛶ fullscreen</button>
        </>
      ) : (
        <div className="vid-note" style={{ padding: 16, textAlign: 'center', border: '1px dashed var(--ds-border)', borderRadius: 'var(--ds-radius-card)' }}>
          connect a video output here
        </div>
      )}
    </NodeShell>
  );
}
