import React from 'react';

export const NeonGlow: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 1650,
        textAlign: 'center',
        padding: '0 80px',
      }}
    >
      <span
        style={{
          color: '#fff',
          fontSize: 70,
          fontWeight: 500,
          fontFamily: '"Cinzel", "Playfair Display", Georgia, serif',
          letterSpacing: 1,
          lineHeight: 1.2,
          textShadow: [
            '0 0 4px #fff',
            '0 0 12px #FF1493',
            '0 0 24px #FF1493',
            '0 0 40px #00FFFF',
            '0 0 60px #00FFFF',
          ].join(', '),
        }}
      >
        did you know dreams predict your future
      </span>
    </div>
  );
};
