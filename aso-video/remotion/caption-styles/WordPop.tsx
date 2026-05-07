import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const WordPop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 120, mass: 0.6 },
    from: 0.6,
    to: 1,
  });
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          color: '#fff',
          fontSize: 140,
          fontWeight: 900,
          textTransform: 'uppercase',
          fontFamily:
            'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
          WebkitTextStroke: '4px #000',
          // @ts-expect-error paint-order is valid CSS
          paintOrder: 'stroke fill',
          textShadow: '0 10px 40px rgba(0,0,0,0.7)',
          transform: `scale(${scale})`,
          letterSpacing: -2,
        }}
      >
        DREAMS
      </span>
    </div>
  );
};
