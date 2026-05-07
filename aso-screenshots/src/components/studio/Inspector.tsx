import React from 'react';
import { Star, RotateCcw } from 'lucide-react';
import { Button, Card, Input, Slider, Toggle, SegmentedControl } from '../shared';
import { PRESETS, getPreset } from '../../lib/presets';
import { CURATED_FONTS } from '../../lib/fonts';
import { HERO_INGREDIENTS } from '../../lib/heroIngredients';
import { useStudio, type Screenshot, type ActionData, type HeroIngredients } from '../../state/studio';

// Full list lives in lib/fonts.ts — kept there so fontLoader.ts can preload them all.

/** Inline icon-uploader shown when the "App icon (large)" hero ingredient is on.
 *  Stores object URL on project state so all hero slots / Re-enhance attempts share it. */
function AppIconUploader() {
  const appIconUrl = useStudio((s) => s.appIconUrl);
  const setProject = useStudio((s) => s.setProject);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProject({ appIconUrl: URL.createObjectURL(file) });
    e.target.value = '';
  };
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0 0' }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          width: 56, height: 56, borderRadius: 12,
          border: appIconUrl ? '0' : '1px dashed var(--line-2)',
          background: appIconUrl ? 'transparent' : 'var(--bg-2)',
          padding: 0, cursor: 'pointer',
          overflow: 'hidden',
        }}
        title="Загрузить иконку приложения"
      >
        {appIconUrl ? (
          <img src={appIconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>+ icon</span>
        )}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>
          {appIconUrl ? 'Иконка загружена — AI получит её через image_urls.' : 'Загрузи PNG/JPG, чтобы AI использовал точную иконку.'}
        </span>
        {appIconUrl && (
          <button
            type="button"
            onClick={() => setProject({ appIconUrl: null })}
            style={{
              alignSelf: 'flex-start', padding: 0, border: 0, background: 'transparent',
              color: 'var(--neg)', fontSize: 11, cursor: 'pointer',
            }}
          >
            Удалить
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
    </div>
  );
}

/** Tiny icon button that snaps a slider back to its default — appears next to every field. */
function ResetDot({ active, onClick, title }: { active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? 'Reset to default'}
      style={{
        appearance: 'none', border: 0, background: 'transparent',
        color: active ? 'var(--fg-2)' : 'var(--fg-4)',
        cursor: active ? 'pointer' : 'default',
        opacity: active ? 1 : 0.4,
        padding: '2px 4px', marginLeft: 6,
        display: 'inline-flex', alignItems: 'center',
        verticalAlign: 'middle',
      }}
      disabled={!active}
    >
      <RotateCcw size={10} />
    </button>
  );
}

const ACCENT_PALETTE = [
  { hex: '#3B82F6', name: 'Blue' },
  { hex: '#5B21B6', name: 'Violet' },
  { hex: '#10B981', name: 'Green' },
  { hex: '#FF6B35', name: 'Orange' },
  { hex: '#EC4899', name: 'Pink' },
  { hex: '#0F172A', name: 'Charcoal' },
  { hex: '#F5F5F5', name: 'Bone' },
];

interface Props {
  screenshot: Screenshot;
}

export function Inspector({ screenshot: ss }: Props) {
  const { updateScreenshot, appColor, setProject, viewMode } = useStudio();
  const isEnhanced = viewMode === 'enhanced';
  const isScaffold = viewMode === 'scaffold';

  const set = (patch: Partial<Screenshot>) => updateScreenshot(ss.id, patch);
  const setHeadline = (patch: Partial<Screenshot['headline']>) =>
    updateScreenshot(ss.id, { headline: { ...ss.headline, ...patch } });
  const setAction = (patch: Partial<ActionData>) => {
    const cur: ActionData = ss.action ?? {
      primary: '1K+ Ratings', secondary: '4.9 Average', showStars: true, hideDevice: false,
      themeHint: '', aiImageUrl: null, lastPrompt: null, generateState: 'idle',
    };
    set({ action: { ...cur, ...patch } });
  };

  return (
    <aside
      style={{
        width: 'var(--inspector-w)',
        borderLeft: '1px solid var(--line-1)',
        background: 'var(--bg-1)',
        overflow: 'auto',
        minHeight: 0,
      }}
    >
      <Card>
        {/* Hero label — read-only badge, only shown on action slots. The toggle is gone:
            heroes are added/deleted via the "+ Add hero (AI)" button in the sidebar so
            we never end up with two heroes in one template. */}
        {ss.kind === 'action' && (
          <Card.Section title="Тип кадра">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Star size={12} style={{ color: 'var(--ai)', flex: 'none' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ai)' }}>Hero / Заглавный кадр</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  Декорации + соц-доказательство — только один hero в шаблоне.
                </span>
              </div>
            </div>
          </Card.Section>
        )}

        {ss.kind === 'action' && (() => {
          const action: ActionData = ss.action ?? {
            primary: '1K+ Ratings', secondary: '4.9 Average', showStars: true, hideDevice: false,
            themeHint: '', aiImageUrl: null, lastPrompt: null, generateState: 'idle',
          };
          return (
            <>
              <Card.Section title="Тема для AI">
                <Input
                  label="Тема приложения"
                  placeholder="e.g. dream interpretation, AI calorie tracker, PDF signing"
                  value={action.themeHint}
                  onChange={(e) => setAction({ themeHint: e.target.value })}
                  hint="One-line hint for AI to pick relevant imagery / decorations. Used by Enhance button in the top toolbar."
                />
              </Card.Section>

              {(() => {
                const preset = getPreset(ss.presetId);
                const templateAvailable = !!preset?.heroPrompt;
                const useCustom = action.useCustomPrompt ?? false;
                return (
                  <Card.Section
                    title="Промпт шаблона"
                    rightSlot={
                      templateAvailable && useCustom ? (
                        <button
                          type="button"
                          onClick={() => setAction({ customPrompt: preset!.heroPrompt })}
                          title="Reset to the template's default prompt"
                          style={{
                            appearance: 'none', border: 0, background: 'transparent',
                            color: 'var(--fg-3)', cursor: 'pointer', fontSize: 11,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <RotateCcw size={11} /> reset
                        </button>
                      ) : null
                    }
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 12 }}>
                          {templateAvailable ? 'Стиль-промпт шаблона' : 'У шаблона нет своего промпта'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.3 }}>
                          {templateAvailable
                            ? 'Когда включён — AI получит этот текст вместо дефолтного. Поддерживает {appName}, {verb}, {themeHint}, {appColor}, {effectiveBackground}, {decorationsHint}, {headlineZone}, {extraPromptBlock}.'
                            : 'AI будет использовать дефолтный hero-builder.'}
                        </span>
                      </div>
                      <Toggle
                        checked={useCustom}
                        onChange={(on) => {
                          if (on && !action.customPrompt && preset?.heroPrompt) {
                            setAction({ useCustomPrompt: true, customPrompt: preset.heroPrompt });
                          } else {
                            setAction({ useCustomPrompt: on });
                          }
                        }}
                        disabled={!templateAvailable}
                      />
                    </div>
                    {useCustom && (
                      <>
                        <div style={{ height: 8 }} />
                        <textarea
                          className="textarea"
                          rows={10}
                          spellCheck={false}
                          value={action.customPrompt ?? ''}
                          onChange={(e) => setAction({ customPrompt: e.target.value })}
                          placeholder="Polish this hero scaffold for {appName}…"
                          style={{
                            width: '100%',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            lineHeight: 1.45,
                            padding: 8,
                            borderRadius: 'var(--r-2)',
                            border: '1px solid var(--line-2)',
                            background: 'var(--bg-2)',
                            color: 'var(--fg-0)',
                            resize: 'vertical',
                            minHeight: 120,
                          }}
                        />
                      </>
                    )}
                  </Card.Section>
                );
              })()}

              <Card.Section title="Композиция">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12 }}>Скрыть устройство</span>
                  <Toggle checked={action.hideDevice} onChange={(on) => setAction({ hideDevice: on })} />
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--fg-3)' }}>
                  Когда скрыто — на hero рисуется только заголовок + ингредиенты, без iPhone.
                </p>
              </Card.Section>

              <Card.Section title="Ингредиенты hero (AI)">
                <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.4 }}>
                  Включи нужные элементы — они не рисуются на scaffold, а добавляются в AI-промпт. gpt-image-2 запекает их в финальный рендер.
                </p>
                {HERO_INGREDIENTS.map((ing) => {
                  const checked = !!action.ingredients?.[ing.key];
                  const ingParams = action.ingredientParams?.[ing.key] ?? {};
                  const setParam = (fieldKey: string, value: string) => {
                    const cur = action.ingredientParams ?? {};
                    setAction({
                      ingredientParams: {
                        ...cur,
                        [ing.key]: { ...(cur[ing.key] ?? {}), [fieldKey]: value },
                      },
                    });
                  };
                  return (
                    <div
                      key={ing.key}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 8,
                        padding: '8px 0',
                        borderBottom: '1px solid var(--line-1)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-0)' }}>{ing.label}</span>
                          <span style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.3 }}>{ing.hint}</span>
                        </div>
                        <Toggle
                          checked={checked}
                          onChange={(on) => {
                            const cur: HeroIngredients = action.ingredients ?? {};
                            setAction({ ingredients: { ...cur, [ing.key]: on } });
                          }}
                        />
                      </div>
                      {/* App-icon ingredient gets a file picker so the AI receives the
                          actual brand mark via image_urls, not just a generic "rounded square". */}
                      {ing.key === 'appIcon' && checked && (
                        <AppIconUploader />
                      )}
                      {/* Editable text fields shown when the toggle is on. Values are
                          interpolated into the ingredient's prompt at request time. */}
                      {checked && ing.fields && ing.fields.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                          {ing.fields.map((f) =>
                            f.key === 'position' ? (
                              <div key={f.key}>
                                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 4 }}>{f.label}</div>
                                <SegmentedControl
                                  items={[
                                    { value: 'top', label: 'Сверху' },
                                    { value: 'bottom', label: 'Снизу' },
                                  ]}
                                  value={(ingParams[f.key] || 'top') as 'top' | 'bottom'}
                                  onChange={(v) => setParam(f.key, v)}
                                />
                              </div>
                            ) : (
                              <Input
                                key={f.key}
                                label={f.label}
                                placeholder={f.placeholder ?? f.default}
                                value={ingParams[f.key] ?? ''}
                                onChange={(e) => setParam(f.key, e.target.value)}
                              />
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card.Section>

              {action.aiImageUrl && isEnhanced && (
                <Card.Section
                  title="Сдвиг AI-картинки"
                  rightSlot={
                    <button
                      type="button"
                      onClick={() => setAction({ aiOffsetX: 0, aiOffsetY: 0, aiScale: 1 })}
                      title="Reset transform"
                      style={{
                        appearance: 'none', border: 0, background: 'transparent',
                        color: 'var(--fg-3)', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                      }}
                    >
                      <RotateCcw size={11} />
                      reset
                    </button>
                  }
                >
                  <div className="field">
                    <label className="field-label">
                      Move X <span className="tabular muted">{action.aiOffsetX ?? 0}</span>
                      <ResetDot active={(action.aiOffsetX ?? 0) !== 0} onClick={() => setAction({ aiOffsetX: 0 })} />
                    </label>
                    <Slider
                      value={action.aiOffsetX ?? 0}
                      min={-800} max={800} step={5}
                      onChange={(v) => setAction({ aiOffsetX: v })}
                    />
                  </div>
                  <div style={{ height: 10 }} />
                  <div className="field">
                    <label className="field-label">
                      Move Y <span className="tabular muted">{action.aiOffsetY ?? 0}</span>
                      <ResetDot active={(action.aiOffsetY ?? 0) !== 0} onClick={() => setAction({ aiOffsetY: 0 })} />
                    </label>
                    <Slider
                      value={action.aiOffsetY ?? 0}
                      min={-1500} max={1500} step={5}
                      onChange={(v) => setAction({ aiOffsetY: v })}
                    />
                  </div>
                  <div style={{ height: 10 }} />
                  <div className="field">
                    <label className="field-label">
                      Zoom <span className="tabular muted">{Math.round(((action.aiScale ?? 1)) * 100)}%</span>
                      <ResetDot active={(action.aiScale ?? 1) !== 1} onClick={() => setAction({ aiScale: 1 })} />
                    </label>
                    <Slider
                      value={Math.round((action.aiScale ?? 1) * 100)}
                      min={50} max={200} step={2}
                      onChange={(v) => setAction({ aiScale: v / 100 })}
                    />
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 10.5, color: 'var(--fg-3)' }}>
                    Adjusts only the existing AI render — no regeneration cost.
                  </p>
                </Card.Section>
              )}
            </>
          );
        })()}

        {/* Background + Style sections removed — Style is picked at step 2 (Catalog),
            and Background is now driven by the Accent color (parametric palette). */}

        <Card.Section title="Цвет">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {ACCENT_PALETTE.map((c) => {
              const active = appColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setProject({ appColor: c.hex })}
                  title={c.name}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    borderRadius: 'var(--r-2)',
                    background: c.hex,
                    border: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    cursor: 'pointer',
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)',
                  }}
                />
              );
            })}
          </div>
          <div style={{ height: 8 }} />
          <div className="field">
            <label className="field-label">Акцент (все слоты)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(appColor) ? appColor : '#3B82F6'}
                onInput={(e) => setProject({ appColor: (e.target as HTMLInputElement).value })}
                onChange={(e) => setProject({ appColor: e.target.value })}
                style={{
                  width: 40, height: 32, padding: 0,
                  border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                  background: 'transparent', cursor: 'pointer',
                }}
                title="Open color picker"
              />
              <Input
                placeholder="#5B21B6"
                value={appColor}
                onChange={(e) => setProject({ appColor: e.target.value })}
                style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>
          <div style={{ height: 12 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>Переопределить фон слота</span>
            <Toggle
              checked={!!ss.backgroundOverride}
              onChange={(on) => set({ backgroundOverride: on ? (appColor ?? '#3B82F6') : null })}
            />
          </div>
          {ss.backgroundOverride && (
            <>
              <div style={{ height: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(ss.backgroundOverride) ? ss.backgroundOverride : '#3B82F6'}
                  onInput={(e) => set({ backgroundOverride: (e.target as HTMLInputElement).value })}
                  onChange={(e) => set({ backgroundOverride: e.target.value })}
                  style={{
                    width: 40, height: 32, padding: 0,
                    border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                    background: 'transparent', cursor: 'pointer',
                  }}
                />
                <Input
                  placeholder={getPreset(ss.presetId)?.background.css ?? '#EEE9FB'}
                  value={ss.backgroundOverride}
                  onChange={(e) => set({ backgroundOverride: e.target.value || null })}
                  style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-3)' }}>
                Только для этого слота. Для dotted-фонов точки тонируются автоматически.
              </p>
            </>
          )}
        </Card.Section>

        {ss.kind === 'regular' && (
          <Card.Section title="AI Polish">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-0)' }}>Designer callout</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.3 }}>
                  Магнифай ключевого UI-элемента в bubble со стрелкой. Включается только при polish.
                </span>
              </div>
              <Toggle
                checked={!!ss.polishCallout}
                onChange={(on) => set({ polishCallout: on })}
              />
            </div>
          </Card.Section>
        )}

        <Card.Section title="Заголовок">
          <Input
            label="Глагол / Title"
            placeholder="TRACK"
            value={ss.headline.verb}
            onChange={(e) => setHeadline({ verb: e.target.value })}
          />
          <div style={{ height: 10 }} />
          <Input
            label="Подзаголовок"
            placeholder="EVERY DAY"
            value={ss.headline.descriptor}
            onChange={(e) => setHeadline({ descriptor: e.target.value })}
          />
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">Шрифт</label>
            <select
              className="select"
              value={ss.font}
              onChange={(e) => set({ font: e.target.value })}
            >
              {(() => {
                const byCat: Record<string, typeof CURATED_FONTS> = { sans: [], serif: [], display: [], mono: [] };
                for (const f of CURATED_FONTS) byCat[f.category].push(f);
                const presetFont = getPreset(ss.presetId)?.text.font;
                const labels: Record<string, string> = { sans: 'Sans', serif: 'Serif', display: 'Display', mono: 'Mono' };
                return (
                  <>
                    {presetFont && !CURATED_FONTS.some((f) => f.family === presetFont) && (
                      <optgroup label="From preset">
                        <option value={presetFont} style={{ fontFamily: presetFont }}>{presetFont}</option>
                      </optgroup>
                    )}
                    {(['sans', 'serif', 'display', 'mono'] as const).map((cat) => (
                      <optgroup key={cat} label={labels[cat]}>
                        {byCat[cat].map((f) => (
                          <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                            {f.family}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </>
                );
              })()}
            </select>
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              Размер заголовка <span className="tabular muted">{ss.titlePx ?? 220}px</span>
              <ResetDot active={(ss.titlePx ?? 220) !== 220} onClick={() => set({ titlePx: 220 })} />
            </label>
            <Slider value={ss.titlePx ?? 220} min={80} max={420} step={5} onChange={(v) => set({ titlePx: v })} />
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              Размер подзаголовка <span className="tabular muted">{ss.subPx ?? 100}px</span>
              <ResetDot active={(ss.subPx ?? 100) !== 100} onClick={() => set({ subPx: 100 })} />
            </label>
            <Slider value={ss.subPx ?? 100} min={40} max={220} step={2} onChange={(v) => set({ subPx: v })} />
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              Позиция (верх → низ) <span className="tabular muted">{Math.round((ss.textYFraction ?? 0.07) * 100)}%</span>
              <ResetDot active={(ss.textYFraction ?? 0.07) !== 0.07} onClick={() => set({ textYFraction: 0.07 })} />
            </label>
            <Slider value={Math.round((ss.textYFraction ?? 0.07) * 100)} min={0} max={92} step={1} onChange={(v) => set({ textYFraction: v / 100 })} />
          </div>
          <div style={{ height: 10 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-2)', marginBottom: 4 }}>
            Сдвиг X <span className="tabular muted">{ss.textX}</span>
            <ResetDot active={ss.textX !== 0} onClick={() => set({ textX: 0 })} />
          </div>
          <Slider value={ss.textX} min={-600} max={600} step={5} onChange={(v) => set({ textX: v })} />
          <div style={{ height: 8 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-2)', marginBottom: 4 }}>
            Сдвиг Y <span className="tabular muted">{ss.textY}</span>
            <ResetDot active={ss.textY !== 0} onClick={() => set({ textY: 0 })} />
          </div>
          <Slider value={ss.textY} min={-600} max={600} step={5} onChange={(v) => set({ textY: v })} />
        </Card.Section>

        <Card.Section title="Pill / бейдж">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>Бейдж над заголовком</span>
            <Toggle
              checked={ss.pill !== undefined}
              onChange={(on) => set(on
                ? { pill: '', pillBg: '#E04A6F', pillFg: '#FFFFFF' }
                : { pill: undefined, pillBg: undefined, pillFg: undefined }
              )}
            />
          </div>
          {ss.pill !== undefined && (
            <>
              <div style={{ height: 10 }} />
              <Input
                label="Текст pill"
                placeholder="NEW · FREE TRIAL"
                value={ss.pill}
                onChange={(e) => set({ pill: e.target.value })}
              />
              <div style={{ height: 10 }} />
              <div className="field">
                <label className="field-label">Цвета pill</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(ss.pillBg ?? '') ? (ss.pillBg as string) : '#E04A6F'}
                    onInput={(e) => set({ pillBg: (e.target as HTMLInputElement).value })}
                    onChange={(e) => set({ pillBg: e.target.value })}
                    title="Pill background"
                    style={{
                      width: 40, height: 32, padding: 0,
                      border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                      background: 'transparent', cursor: 'pointer',
                    }}
                  />
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(ss.pillFg ?? '') ? (ss.pillFg as string) : '#FFFFFF'}
                    onInput={(e) => set({ pillFg: (e.target as HTMLInputElement).value })}
                    onChange={(e) => set({ pillFg: e.target.value })}
                    title="Pill text color"
                    style={{
                      width: 40, height: 32, padding: 0,
                      border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                      background: 'transparent', cursor: 'pointer',
                    }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>фон / текст</span>
                </div>
              </div>
            </>
          )}
        </Card.Section>



        {isScaffold && (<>
        <Card.Section title="Позиция устройства">
          <div className="field">
            <label className="field-label">
              Сдвиг X <span className="tabular muted">{ss.deviceX ?? 0}</span>
            </label>
            {/* Wide range so a paired cross-slot can be slid all the way across both
                canvases (one canvas = 1290 px, two = 2580). ±1500 covers single-slot
                drama plus full cross-slot translation. */}
            <Slider value={ss.deviceX ?? 0} min={-1500} max={1500} step={5} onChange={(v) => set({ deviceX: v })} />
            <ResetDot active={(ss.deviceX ?? 0) !== 0} onClick={() => set({ deviceX: 0 })} />
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              Сдвиг Y <span className="tabular muted">{ss.deviceY ?? 0}</span>
            </label>
            <Slider value={ss.deviceY ?? 0} min={-1500} max={1500} step={5} onChange={(v) => set({ deviceY: v })} />
            <ResetDot active={(ss.deviceY ?? 0) !== 0} onClick={() => set({ deviceY: 0 })} />
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              Масштаб <span className="tabular muted">{((ss.deviceScale ?? 1) * 100).toFixed(0)}%</span>
            </label>
            <Slider
              value={Math.round((ss.deviceScale ?? 1) * 100)}
              min={20}
              max={400}
              step={5}
              onChange={(v) => set({ deviceScale: v / 100 })}
            />
            <ResetDot active={(ss.deviceScale ?? 1) !== 1} onClick={() => set({ deviceScale: 1 })} />
          </div>
        </Card.Section>

        <Card.Section title="Наклон устройства">
          <div className="field">
            <label className="field-label">
              Z (поворот) <span className="tabular muted">{ss.tiltDeg}°</span>
            </label>
            <Slider value={ss.tiltDeg} min={-180} max={180} step={1} onChange={(v) => set({ tiltDeg: v })} />
            <ResetDot active={ss.tiltDeg !== 0} onClick={() => set({ tiltDeg: 0 })} />
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              X (вперёд/назад) <span className="tabular muted">{ss.tiltX ?? 0}°</span>
            </label>
            <Slider value={ss.tiltX ?? 0} min={-90} max={90} step={1} onChange={(v) => set({ tiltX: v })} />
            <ResetDot active={(ss.tiltX ?? 0) !== 0} onClick={() => set({ tiltX: 0 })} />
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              Y (влево/вправо) <span className="tabular muted">{ss.tiltY ?? 0}°</span>
            </label>
            <Slider value={ss.tiltY ?? 0} min={-90} max={90} step={1} onChange={(v) => set({ tiltY: v })} />
            <ResetDot active={(ss.tiltY ?? 0) !== 0} onClick={() => set({ tiltY: 0 })} />
          </div>
        </Card.Section>

        <Card.Section title="Позиция текста">
          <div className="field">
            <label className="field-label">
              Текст X <span className="tabular muted">{ss.textX}</span>
            </label>
            <Slider value={ss.textX} min={-1000} max={1000} step={5} onChange={(v) => set({ textX: v })} />
            <ResetDot active={ss.textX !== 0} onClick={() => set({ textX: 0 })} />
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label className="field-label">
              Текст Y <span className="tabular muted">{ss.textY}</span>
            </label>
            <Slider value={ss.textY} min={-2000} max={2000} step={5} onChange={(v) => set({ textY: v })} />
            <ResetDot active={ss.textY !== 0} onClick={() => set({ textY: 0 })} />
          </div>
        </Card.Section>
        </>)}
      </Card>
    </aside>
  );
}
