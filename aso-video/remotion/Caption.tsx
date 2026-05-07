import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

type CaptionProps = {
  text: string;
  // localFrame is provided implicitly via useCurrentFrame because Caption
  // is rendered inside a <Sequence>, which already shifts the frame counter.
};

export const Caption: React.FC<CaptionProps> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Spring fade-in over ~0.25s
  const enter = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 140, mass: 0.6 },
  });

  const opacity = interpolate(enter, [0, 1], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(enter, [0, 1], [30, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 220, // above TikTok safe zone (~150px UI)
        display: 'flex',
        justifyContent: 'center',
        padding: '0 60px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          color: '#ffffff',
          fontSize: 80,
          fontWeight: 900,
          fontFamily:
            'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
          textAlign: 'center',
          lineHeight: 1.05,
          letterSpacing: -1,
          // CapCut classic: white fill + thick black outline + drop shadow
          WebkitTextStroke: '6px #000',
          // paintOrder lets the stroke sit behind the fill so letters stay crisp
          paintOrder: 'stroke fill',
          textShadow:
            '0 6px 18px rgba(0,0,0,0.85), 0 2px 4px rgba(0,0,0,0.9)',
          textTransform: 'uppercase',
          maxWidth: '90%',
        }}
      >
        {text}
      </div>
    </div>
  );
};
