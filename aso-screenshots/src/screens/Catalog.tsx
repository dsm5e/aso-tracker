import { useNavigate } from 'react-router-dom';
import { Button, Card, SegmentedControl } from '../components/shared';
import { PresetSampleStrip } from '../components/studio/PresetSampleStrip';
import { PRESETS } from '../lib/presets';
import { useStudio } from '../state/studio';

export function CatalogScreen() {
  const nav = useNavigate();
  const { selectedPresetId, pickPreset, catalogFilter, setCatalogFilter, screenshots, appColor, setProject } = useStudio();

  const visible = PRESETS.filter((p) => catalogFilter === 'all' || p.kind === catalogFilter);

  const primarySourceUrl = screenshots[0]?.sourceUrl ?? null;

  return (
    <div style={{ padding: 'var(--s-7)', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Style catalog</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--fg-2)', fontSize: 13 }}>
            Each row is a 5-screenshot preview of how the style scales across an App Store listing. Click a row to pick.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Project-wide accent — every preset thumbnail re-tints live so you can
              compare styles already wearing your brand color. Same swatches as
              Inspector's accent picker so the two stay in sync. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Accent
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                '#3B82F6', '#5B21B6', '#10B981', '#FF6B35', '#EC4899', '#E04A6F', '#0F172A',
              ].map((hex) => {
                const active = appColor.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setProject({ appColor: hex })}
                    title={hex}
                    style={{
                      width: 22, height: 22,
                      borderRadius: 6,
                      background: hex,
                      border: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                      cursor: 'pointer',
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
                      padding: 0,
                    }}
                  />
                );
              })}
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(appColor) ? appColor : '#3B82F6'}
                // onInput fires while dragging in the OS picker → live preview
                // across all template thumbnails. onChange covers final commit.
                onInput={(e) => setProject({ appColor: (e.target as HTMLInputElement).value })}
                onChange={(e) => setProject({ appColor: e.target.value })}
                title="Custom hex"
                style={{
                  width: 22, height: 22, padding: 0,
                  border: '1px solid var(--line-2)', borderRadius: 6,
                  background: 'transparent', cursor: 'pointer',
                }}
              />
            </div>
          </div>

          <SegmentedControl
            items={[
              { value: 'all', label: 'All' },
              { value: 'real', label: 'Real' },
              { value: 'abstract', label: 'Abstract' },
            ]}
            value={catalogFilter}
            onChange={setCatalogFilter}
          />
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visible.map((p) => {
          const active = p.id === selectedPresetId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPreset(p.id)}
              className="preset-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: 14,
                borderRadius: 'var(--r-4)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--line-1)'}`,
                background: 'var(--bg-1)',
                cursor: 'pointer',
                transition: 'all .12s',
                textAlign: 'left',
                color: 'inherit',
                font: 'inherit',
                boxShadow: active ? '0 0 0 3px var(--accent-ring)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {p.kind}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.4 }}>{p.description}</span>
                </div>
                {active && (
                  <span
                    style={{
                      padding: '2px 8px',
                      background: 'var(--accent)',
                      color: 'var(--accent-fg)',
                      fontSize: 10,
                      fontWeight: 600,
                      borderRadius: 'var(--r-pill)',
                      flex: 'none',
                    }}
                  >
                    SELECTED
                  </span>
                )}
              </div>

              <PresetSampleStrip preset={p} accentOverride={appColor} primarySourceUrl={primarySourceUrl} />

              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>For: {p.recommendedFor}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          {(() => {
            const cur = PRESETS.find((p) => p.id === selectedPresetId);
            if (!cur) return 'Pick a preset above. You can switch styles anytime in the Editor.';
            return `Selected: ${cur.name}`;
          })()}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => nav('/setup')}>← Back</Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!selectedPresetId}
            onClick={() => {
              // Re-seed screenshots from the chosen preset right before navigating —
              // ensures Editor opens populated with all template samples even if a
              // previous (persisted) session left state.screenshots empty or stale.
              if (selectedPresetId) pickPreset(selectedPresetId);
              nav('/editor');
            }}
          >
            Continue → Editor
          </Button>
        </div>
      </div>

      {!selectedPresetId && (
        <Card>
          <Card.Section>
            <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>
              Tip: thumbnails preview the style with your first uploaded screenshot if you've added one. Otherwise placeholder content is shown.
            </span>
          </Card.Section>
        </Card>
      )}
    </div>
  );
}
