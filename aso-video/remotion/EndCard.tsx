// End Card composition for Dream — branded outro that gets concatenated to
// the end of a UGC ad. Dark background with purple radial glow + twinkling
// stars, centred app icon (pulsing), "Dream" wordmark, subtitle, big CTA pill.
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const EC_FPS = 30;
export const EC_WIDTH = 1080;
export const EC_HEIGHT = 1920;
export const EC_DURATION_FRAMES = 90; // 3 seconds

// Per-brand palette + assets. Selected by the `brand` prop (case-insensitive).
// Default = Dream (purple cosmic). MedScan = clinical sage-green on near-black,
// mirroring the iOS LaunchScreen (scan-line sweep + pulse rings + serif "MedScan").
interface BrandTheme {
  bg: string;          // base background
  cardGlow: string;    // main radial glow rgba
  cardGlow2: string;   // secondary glow rgba
  accent: string;      // main accent (icon shadow, subtitle, CTA fill)
  accentDim: string;   // darker accent for gradient pairs
  subtitleColor: string;
  motif: 'stars' | 'scan';
  iconFile: string;    // staticFile() path
  iconShadow: string;
  brandFont: string;   // font-family for the brand wordmark
}

const THEMES: Record<string, BrandTheme> = {
  dream: {
    bg: '#0D0D1A',
    cardGlow: 'rgba(180,160,229,0.22)',
    cardGlow2: 'rgba(196,181,253,0.10)',
    accent: '#B4A0E5',
    accentDim: '#6B5B95',
    subtitleColor: '#B4A0E5',
    motif: 'stars',
    iconFile: 'dream-icon.png',
    iconShadow: '0 40px 90px rgba(180,160,229,0.45), 0 0 60px rgba(180,160,229,0.35)',
    brandFont: 'Helvetica Neue, Helvetica, Arial, sans-serif',
  },
  medscan: {
    // Mirrors MedScan iOS LaunchScreen — near-black bg, sage-green accent #8FB099.
    bg: '#0F0F0F',
    cardGlow: 'rgba(143,176,153,0.10)',
    cardGlow2: 'rgba(107,143,113,0.07)',
    accent: '#8FB099',
    accentDim: '#6B8F71',
    subtitleColor: 'rgba(143,176,153,0.65)',
    motif: 'scan',
    iconFile: 'medscan-icon.png',
    iconShadow: '0 40px 90px rgba(143,176,153,0.30), 0 0 80px rgba(143,176,153,0.20)',
    brandFont: 'Georgia, "Times New Roman", serif',
  },
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
  const theme = THEMES[brand.toLowerCase()] ?? THEMES.dream;
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
    <AbsoluteFill style={{ background: theme.bg, overflow: 'hidden', fontFamily: theme.brandFont }}>
      {/* Drifting radial glow */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at ${glowX}% ${glowY}%, ${theme.cardGlow}, transparent 55%)`,
      }} />
      {/* Soft second glow at lower-left */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at 30% 80%, ${theme.cardGlow2}, transparent 50%)`,
      }} />

      {/* Motif: stars (Dream) or scan-line sweep + pulse rings (MedScan) */}
      {theme.motif === 'stars' && stars.map((s, i) => (
        <div key={i} style={{
          position: 'absolute', left: s.x, top: s.y,
          width: s.r, height: s.r, borderRadius: s.r,
          background: '#fff',
          opacity: 0.25 + s.tw * 0.55,
          boxShadow: s.r >= 2 ? '0 0 4px rgba(255,255,255,0.6)' : 'none',
        }} />
      ))}
      {theme.motif === 'scan' && (() => {
        // Scan line sweep — gradient band travels top → bottom once during the
        // first ~1.3s, then fades. Matches MedScan LaunchScreen.swift cadence.
        const sweepProgress = Math.min(1, frame / (fps * 1.3));
        const sweepY = -200 + sweepProgress * (EC_HEIGHT + 400);
        const sweepOpacity = frame < fps * 1.45
          ? Math.min(1, frame / 5)
          : Math.max(0, 1 - (frame - fps * 1.45) / (fps * 0.25));
        // Pulse rings — two staggered concentric strokes, ease-out fade.
        const pulse1 = (frame - 18) / (fps * 1.05);
        const pulse2 = (frame - 26) / (fps * 1.1);
        const ring = (p: number, baseSize: number, baseOpacity: number) => p < 0 || p > 1 ? null : (
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            width: baseSize, height: baseSize, marginLeft: -baseSize / 2, marginTop: -baseSize / 2,
            borderRadius: '50%',
            border: `1.5px solid ${theme.accent}`,
            opacity: baseOpacity * (1 - p),
            transform: `scale(${1 + p * 0.75})`,
          }} />
        );
        return (
          <>
            {/* Horizontal scan-line band */}
            <div style={{
              position: 'absolute', left: 0, right: 0,
              top: sweepY, height: 80,
              background: `linear-gradient(to bottom, transparent, ${theme.accent}14, ${theme.accent}38, ${theme.accent}14, transparent)`,
              filter: 'blur(4px)',
              opacity: sweepOpacity,
            }} />
            {/* Pulse rings (positioned roughly where the icon sits — content
                center, ~y=900 in 1920 height). Adjust offset if icon moves. */}
            <div style={{ position: 'absolute', left: '50%', top: '50%', marginTop: -180 }}>
              {ring(pulse1, 200, 0.55)}
              {ring(pulse2, 240, 0.35)}
            </div>
          </>
        );
      })()}

      {/* Centered content */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '0 80px', textAlign: 'center',
      }}>
        <Img
          src={staticFile(theme.iconFile)}
          style={{
            width: 300, height: 300, borderRadius: 72,
            opacity: iconOpacity,
            transform: `scale(${iconScale * pulse})`,
            boxShadow: theme.iconShadow,
            marginBottom: 70,
          }}
        />

        <h1 style={{
          fontSize: 140,
          fontWeight: theme.motif === 'scan' ? 400 : 800,
          color: theme.motif === 'scan' ? '#F5F5F5' : '#fff',
          fontFamily: theme.brandFont,
          margin: 0,
          letterSpacing: theme.motif === 'scan' ? -1 : -3,
          opacity: headO,
          transform: `translateY(${headY}px)`,
          lineHeight: 1,
        }}>{brand}</h1>

        <p style={{
          fontSize: theme.motif === 'scan' ? 36 : 50,
          color: theme.subtitleColor,
          margin: '24px 0 0 0',
          fontWeight: theme.motif === 'scan' ? 500 : 500,
          letterSpacing: theme.motif === 'scan' ? 4 : -0.5,
          textTransform: theme.motif === 'scan' ? 'uppercase' : 'none',
          opacity: subO,
          transform: `translateY(${subY}px)`,
        }}>{subtitle}</p>

        <div style={{
          marginTop: 110,
          padding: '36px 90px',
          background: theme.accent,
          color: theme.bg,
          borderRadius: 200,
          fontSize: 56, fontWeight: 800,
          opacity: ctaO,
          transform: `scale(${ctaScale})`,
          boxShadow: `0 24px 70px ${theme.cardGlow}`,
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
