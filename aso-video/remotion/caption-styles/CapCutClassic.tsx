import React from 'react';

export const CapCutClassic: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 1700,
        textAlign: 'center',
        padding: '0 60px',
      }}
    >
      <span
        style={{
          color: '#fff',
          fontSize: 80,
          fontWeight: 900,
          textTransform: 'uppercase',
          letterSpacing: -1,
          fontFamily:
            'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
          WebkitTextStroke: '6px #000',
          // @ts-expect-error paint-order is valid CSS
          paintOrder: 'stroke fill',
          textShadow: '0 6px 20px rgba(0,0,0,0.6)',
          lineHeight: 1.05,
        }}
      >
        DID YOU KNOW DREAMS PREDICT YOUR FUTURE
      </span>
    </div>
  );
};
