import React from 'react';

const WORDS = ['DID', 'YOU', 'KNOW', 'DREAMS'];

export const BubblePop: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 1700,
        display: 'flex',
        justifyContent: 'center',
        gap: 16,
        flexWrap: 'wrap',
        padding: '0 40px',
      }}
    >
      {WORDS.map((w, i) => (
        <span
          key={i}
          style={{
            background: '#fff',
            color: '#000',
            padding: '14px 28px',
            borderRadius: 999,
            fontSize: 60,
            fontWeight: 800,
            fontFamily:
              'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
            letterSpacing: -1,
            boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
          }}
        >
          {w}
        </span>
      ))}
    </div>
  );
};
