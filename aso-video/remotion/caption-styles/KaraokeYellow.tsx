import React from 'react';

const WORDS = 'DID YOU KNOW DREAMS PREDICT YOUR FUTURE'.split(' ');

export const KaraokeYellow: React.FC = () => {
  // For static comparison: half spoken (yellow), half upcoming (white)
  const split = Math.ceil(WORDS.length / 2);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 1700,
        textAlign: 'center',
        padding: '0 60px',
        fontSize: 80,
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: -1,
        fontFamily:
          'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
        lineHeight: 1.05,
      }}
    >
      {WORDS.map((w, i) => (
        <span
          key={i}
          style={{
            color: i < split ? '#FFD700' : '#fff',
            WebkitTextStroke: '6px #000',
            // @ts-expect-error paint-order is valid CSS
            paintOrder: 'stroke fill',
            textShadow: '0 6px 20px rgba(0,0,0,0.6)',
            margin: '0 8px',
            display: 'inline-block',
          }}
        >
          {w}
        </span>
      ))}
    </div>
  );
};
