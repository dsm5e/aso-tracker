import React from 'react';

export const MrBeast: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 1650,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 40px',
      }}
    >
      <span
        style={{
          color: '#000',
          fontSize: 90,
          fontWeight: 900,
          textTransform: 'uppercase',
          fontFamily:
            'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
          background: '#FFE92F',
          padding: '30px 40px',
          borderRadius: 16,
          textAlign: 'center',
          lineHeight: 1.05,
          letterSpacing: -1,
          boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        }}
      >
        DID YOU KNOW DREAMS PREDICT YOUR FUTURE
      </span>
    </div>
  );
};
