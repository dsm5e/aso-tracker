// End Card composition for Dream — branded outro that gets concatenated to
// the end of a UGC ad. Dark background with purple radial glow + twinkling
// stars, centred app icon (pulsing), "Dream" wordmark, subtitle, big CTA pill.
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const EC_FPS = 30;
export const EC_WIDTH = 1080;
export const EC_HEIGHT = 1920;
export const EC_DURATION_FRAMES = 90; // 3 seconds

// Brand palette (mirrors dream.nomly.space tailwind config)
const C = {
  bg: '#0D0D1A',
  card: '#1A1A2E',
  purple: '#B4A0E5',
  purpleDeep: '#6B5B95',
  accent: '#C4B5FD',
};

interface Props {
  cta?: string;
  subtitle?: string;
  brand?: string;
}

export const EndCard: React.FC<Props> = ({
  cta = 'Try Dream Free',
  subtitle = 'Decode every dream',
  brand = 'Dream',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Icon entrance — overshoot scale via spring
  const iconScale = spring({ frame, fps, config: { damping: 12, stiffness: 90 }, from: 0.4, to: 1, durationInFrames: 30 });
  const iconOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  // Subtle ongoing pulse
  const pulse = 1 + Math.sin((frame / fps) * 2.4) * 0.025;

  // Heading slide+fade
  const headDelay = 6;
  const headY = spring({ frame: frame - headDelay, fps, config: { damping: 14 }, from: 50, to: 0, durationInFrames: 25 });
  const headO = interpolate(frame - headDelay, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Subtitle a beat after
  const subDelay = 16;
  const subY = spring({ frame: frame - subDelay, fps, config: { damping: 14 }, from: 30, to: 0, durationInFrames: 25 });
  const subO = interpolate(frame - subDelay, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // CTA pop-in
  const ctaDelay = 28;
  const ctaScale = spring({ frame: frame - ctaDelay, fps, config: { damping: 8, stiffness: 130 }, from: 0.6, to: 1, durationInFrames: 30 });
  const ctaO = interpolate(frame - ctaDelay, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Background radial glow drifts
  const glowX = 50 + Math.sin((frame / fps) * 0.4) * 8;
  const glowY = 40 + Math.cos((frame / fps) * 0.5) * 6;

  // Pseudo-random stars (deterministic from index so same every frame)
  const STARS = 60;
  const stars = Array.from({ length: STARS }, (_, i) => {
    const x = (i * 167.31) % EC_WIDTH;
    const y = (i * 91.7) % EC_HEIGHT;
    const r = (i % 3) + 1;
    const tw = (Math.sin((frame / fps) * (1.5 + (i % 7) * 0.1) + i) + 1) / 2;
    return { x, y, r, tw };
  });

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden', fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
      {/* Drifting radial glow */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at ${glowX}% ${glowY}%, rgba(180,160,229,0.22), transparent 55%)`,
      }} />
      {/* Soft second glow at lower-left */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at 30% 80%, rgba(196,181,253,0.10), transparent 50%)`,
      }} />

      {/* Stars */}
      {stars.map((s, i) => (
        <div key={i} style={{
          position: 'absolute', left: s.x, top: s.y,
          width: s.r, height: s.r, borderRadius: s.r,
          background: '#fff',
          opacity: 0.25 + s.tw * 0.55,
          boxShadow: s.r >= 2 ? '0 0 4px rgba(255,255,255,0.6)' : 'none',
        }} />
      ))}

      {/* Centered content */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '0 80px', textAlign: 'center',
      }}>
        <Img
          src={staticFile('dream-icon.png')}
          style={{
            width: 300, height: 300, borderRadius: 72,
            opacity: iconOpacity,
            transform: `scale(${iconScale * pulse})`,
            boxShadow: `0 40px 90px rgba(180,160,229,0.45), 0 0 60px rgba(180,160,229,0.35)`,
            marginBottom: 70,
          }}
        />

        <h1 style={{
          fontSize: 140, fontWeight: 800, color: '#fff', margin: 0,
          letterSpacing: -3,
          opacity: headO,
          transform: `translateY(${headY}px)`,
          lineHeight: 1,
        }}>{brand}</h1>

        <p style={{
          fontSize: 50, color: C.purple, margin: '24px 0 0 0',
          fontWeight: 500, letterSpacing: -0.5,
          opacity: subO,
          transform: `translateY(${subY}px)`,
        }}>{subtitle}</p>

        <div style={{
          marginTop: 110,
          padding: '36px 90px',
          background: C.purple,
          color: C.bg,
          borderRadius: 200,
          fontSize: 56, fontWeight: 800,
          opacity: ctaO,
          transform: `scale(${ctaScale})`,
          boxShadow: '0 24px 70px rgba(180,160,229,0.55)',
          letterSpacing: -0.4,
        }}>{cta} →</div>

        <p style={{
          marginTop: 50,
          fontSize: 30, color: 'rgba(255,255,255,0.55)',
          opacity: ctaO,
          letterSpacing: 1,
        }}>by Nomly</p>
      </div>
    </AbsoluteFill>
  );
};
