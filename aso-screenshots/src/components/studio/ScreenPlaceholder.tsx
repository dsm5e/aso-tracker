interface Props {
  accent?: string;
}

/**
 * Default app-like UI rendered inside an empty device — gives the catalog preview
 * a "complete" feel before the user uploads any actual screenshots.
 *
 * Mimics a generic content list (status bar, search field, list rows with thumb +
 * two text lines, bottom tab bar). Colours derive from accent so each preset still
 * feels distinct.
 */
export function ScreenPlaceholder({ accent = '#888' }: Props) {
  // Slightly off-white panel reads better against accented mounts
  const PANEL = '#FCFAF5';
  const LINE = `${accent}33`; // ~20% alpha
  const STRONG = accent;

  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: '100%',
        background: PANEL,
        display: 'flex',
        flexDirection: 'column',
        padding: '110px 28px 40px',
        gap: 18,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Status bar block */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ width: 90, height: 14, borderRadius: 4, background: LINE }} />
        <span style={{ width: 56, height: 14, borderRadius: 4, background: LINE }} />
      </div>

      {/* Big card / hero */}
      <div
        style={{
          height: 240,
          borderRadius: 28,
          background: `linear-gradient(135deg, ${accent}30 0%, ${accent}10 100%)`,
          boxShadow: `inset 0 0 0 1px ${accent}22`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ width: 64, height: 64, borderRadius: 16, background: STRONG, opacity: 0.5 }} />
      </div>

      {/* List rows */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '14px 0',
            borderBottom: i < 3 ? `1px solid ${LINE}` : 'none',
          }}
        >
          <span style={{ width: 56, height: 56, borderRadius: 14, background: STRONG, opacity: 0.55 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            <span style={{ height: 14, width: '70%', borderRadius: 4, background: STRONG, opacity: 0.65 }} />
            <span style={{ height: 10, width: '50%', borderRadius: 3, background: LINE }} />
          </div>
          <span style={{ width: 32, height: 14, borderRadius: 4, background: LINE }} />
        </div>
      ))}

      {/* Spacer pushes tab bar down */}
      <div style={{ flex: 1 }} />

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          padding: '14px 0 6px',
          borderTop: `1px solid ${LINE}`,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: i === 0 ? STRONG : `${STRONG}44`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
