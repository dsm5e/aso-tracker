import React from 'react';

export const SubtleMinimal: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 180,
        textAlign: 'center',
        padding: '0 80px',
      }}
    >
      <span
        style={{
          color: '#fff',
          fontSize: 50,
          fontWeight: 400,
          fontFamily:
            'Inter, "SF Pro Text", system-ui, -apple-system, sans-serif',
          lineHeight: 1.3,
          letterSpacing: 0.2,
        }}
      >
        Did you know dreams predict your future
      </span>
    </div>
  );
};
