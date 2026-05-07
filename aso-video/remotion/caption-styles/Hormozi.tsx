import React from 'react';

const STACK: { word: string; color: string }[] = [
  { word: 'DID', color: '#fff' },
  { word: 'YOU', color: '#FFD700' },
  { word: 'KNOW', color: '#FF3B30' },
];

export const Hormozi: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 480,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {STACK.map((item, i) => (
        <span
          key={i}
          style={{
            color: item.color,
            fontSize: 130,
            fontWeight: 900,
            textTransform: 'uppercase',
            fontFamily:
              'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
            WebkitTextStroke: '5px #000',
            // @ts-expect-error paint-order is valid CSS
            paintOrder: 'stroke fill',
            textShadow: '0 8px 28px rgba(0,0,0,0.65)',
            letterSpacing: -2,
            lineHeight: 1,
          }}
        >
          {item.word}
        </span>
      ))}
    </div>
  );
};
