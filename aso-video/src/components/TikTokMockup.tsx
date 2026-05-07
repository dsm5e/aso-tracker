// TikTok UI mockup overlay — purely visual decoration on top of any <video>.
// Renders profile/action rail on the right, caption text on the bottom-left
// and a music sticker, mimicking TikTok's in-feed look so we can preview
// how an ad will sit on the platform without baking the chrome into the mp4.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const MockupCtx = createContext<boolean>(false);

export function MockupProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <MockupCtx.Provider value={enabled}>{children}</MockupCtx.Provider>;
}

export function useMockup(): boolean {
  return useContext(MockupCtx);
}

const STORAGE = 'aso-video.tikTokMockup';
export function useMockupToggle(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE, v ? '1' : '0'); } catch {}
  }, [v]);
  return [v, setV];
}

/**
 * Wrap any <video> inside this component to overlay TikTok chrome.
 * Children should be the video element and any controls. Mockup renders
 * absolutely on top, pointer-events: none so video controls still work.
 */
export function MockupFrame({ children }: { children: ReactNode }) {
  const enabled = useMockup();
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {children}
      {enabled && <TikTokOverlay />}
    </div>
  );
}

function TikTokOverlay() {
  return (
    <div style={overlayRoot}>
      {/* top — search + tabs */}
      <div style={topBar}>
        <span style={{ opacity: 0.7 }}>Following</span>
        <span style={{ fontWeight: 600 }}>For You</span>
        <span style={{ opacity: 0.6 }}>🔍</span>
      </div>

      {/* right action rail */}
      <div style={rightRail}>
        <div style={avatar}>
          <span style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', background: '#ef4458', color: '#fff', borderRadius: 8, fontSize: 9, padding: '0 4px', lineHeight: '12px' }}>+</span>
        </div>
        <div style={actionBtn}><div style={iconBox}>♥</div><span style={countText}>1.2M</span></div>
        <div style={actionBtn}><div style={iconBox}>💬</div><span style={countText}>4.5K</span></div>
        <div style={actionBtn}><div style={iconBox}>🔖</div><span style={countText}>32K</span></div>
        <div style={actionBtn}><div style={iconBox}>↗</div><span style={countText}>Share</span></div>
        <div style={{ ...spinningDisc }} />
      </div>

      {/* bottom-left caption */}
      <div style={bottomCaption}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>@nomly_dreams</div>
        <div style={{ fontSize: 11, marginTop: 2, lineHeight: 1.3 }}>
          Sleep paralysis is NOT a demon 😱 #dreamsexplained #sleeptok
        </div>
        <div style={{ fontSize: 10, marginTop: 6, opacity: 0.85 }}>♪ original sound — nomly_dreams</div>
      </div>

      {/* bottom — caption-bar safe zone marker */}
      <div style={bottomBar} />
    </div>
  );
}

const overlayRoot: React.CSSProperties = {
  position: 'absolute', inset: 0,
  pointerEvents: 'none',
  color: '#fff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  overflow: 'hidden',
  borderRadius: 6,
};
const topBar: React.CSSProperties = {
  position: 'absolute', top: 8, left: 0, right: 0,
  display: 'flex', justifyContent: 'center', gap: 14,
  fontSize: 12, fontWeight: 500,
};
const rightRail: React.CSSProperties = {
  position: 'absolute', right: 6, bottom: 70,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
};
const avatar: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 18,
  border: '2px solid #fff',
  background: 'linear-gradient(135deg, #6b46c1, #ec4899)',
  position: 'relative', marginBottom: 4,
};
const actionBtn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
};
const iconBox: React.CSSProperties = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 18,
};
const countText: React.CSSProperties = {
  fontSize: 9, fontWeight: 600,
};
const spinningDisc: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 14,
  background: 'radial-gradient(circle at center, #444 0%, #444 24%, #000 26%, #000 100%)',
  border: '1px solid #fff',
  marginTop: 4,
  animation: 'asov-mockup-spin 4s linear infinite',
};
const bottomCaption: React.CSSProperties = {
  position: 'absolute', left: 8, right: 70, bottom: 32,
};
const bottomBar: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0,
  height: 24,
  background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 100%)',
};
