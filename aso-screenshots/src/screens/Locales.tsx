import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Globe, Languages, Loader2, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import { Button, PageHeader } from '../components/shared';
import { MockupCanvas } from '../components/studio/MockupCanvas';
import { useStudio, type LocaleEntry } from '../state/studio';
import { CURATED_LOCALES, findLocaleSpec } from '../lib/locales';
import { translateLocale, refitLocale, refitAllLocales } from '../lib/translateBatch';
import { applyLocaleToSlot } from '../lib/applyLocale';
import { clog } from '../lib/clog';

const PER_BATCH_USD = 0.0005; // ballpark for ~15 strings via gpt-4o-mini

/**
 * Phase 6 — Locales. Pick target locales, run AI translation for each,
 * inspect / hand-edit results. The same AI bg lives across locales — only
 * the HTML headline / pill overlays change per locale at render time.
 */
export function LocalesScreen() {
  const nav = useNavigate();
  const screenshots = useStudio((s) => s.screenshots);
  const locales = useStudio((s) => s.locales);
  const removeLocale = useStudio((s) => s.removeLocale);
  const addLocale = useStudio((s) => s.addLocale);

  // Per-locale busy set — parallel translations show their own spinners.
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const isAnyBusy = busy.size > 0;
  // AbortControllers keyed by locale so the user can cancel an accidental
  // click without waiting for the server response.
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  // Track which locales are already added — chips stay visible in the picker
  // but get an active accent treatment + click toggles add/remove.
  const usedCodes = useMemo(() => new Set(locales.map((l) => l.code)), [locales]);
  const available = CURATED_LOCALES.filter((s) => !usedCodes.has(s.code));

  const onAdd = (code: string) => {
    const spec = findLocaleSpec(code);
    if (!spec) return;
    addLocale({
      id: code,
      code: spec.code,
      name: spec.name,
      flag: spec.flag,
      rtl: spec.rtl,
      fontOverride: spec.font,
    });
  };

  const onTranslate = async (code: string) => {
    if (busy.has(code)) return;
    const ctrl = new AbortController();
    abortControllers.current.set(code, ctrl);
    setBusy((prev) => new Set(prev).add(code));
    try {
      await translateLocale(code, ctrl.signal);
    } catch (e) {
      const msg = (e as Error).message;
      // Aborts are user-initiated cancellations — no error UI for those.
      if ((e as Error).name !== 'AbortError') {
        clog.error('locales', `translate failed: ${msg}`);
        alert(`Translation failed for ${code}: ${msg}`);
      }
    } finally {
      abortControllers.current.delete(code);
      setBusy((prev) => { const n = new Set(prev); n.delete(code); return n; });
    }
  };

  /** Fan out every pending locale in parallel — gpt-4o-mini handles concurrent
   *  calls fine, so 5 locales translate in ~5s wall-clock instead of 25s. */
  const onTranslateAll = async () => {
    const codes = locales.map((l) => l.code).filter((c) => !busy.has(c));
    if (!codes.length) return;
    setBusy((prev) => { const n = new Set(prev); codes.forEach((c) => n.add(c)); return n; });
    const controllers = codes.map((c) => {
      const ctrl = new AbortController();
      abortControllers.current.set(c, ctrl);
      return [c, ctrl] as const;
    });
    await Promise.all(
      controllers.map(([c, ctrl]) =>
        translateLocale(c, ctrl.signal).catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          clog.error('locales', `translate-all failed at ${c}: ${(e as Error).message}`);
        }),
      ),
    );
    codes.forEach((c) => abortControllers.current.delete(c));
    setBusy((prev) => { const n = new Set(prev); codes.forEach((c) => n.delete(c)); return n; });
  };

  const onCancel = (code: string) => {
    abortControllers.current.get(code)?.abort();
  };

  const totalCost = (locales.length * PER_BATCH_USD).toFixed(4);

  if (!screenshots.length) {
    return (
      <div style={{ padding: 'var(--s-9)', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <h2 className="ds-h2">No screenshots yet</h2>
        <p style={{ color: 'var(--fg-2)', fontSize: 13 }}>
          Fill the editor first — Locales translates the existing slot strings.
        </p>
        <Button variant="primary" onClick={() => nav('/editor')}>← Editor</Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--s-7)', maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        title="Locales"
        sub="AI-translate slot headlines + pills via gpt-4o-mini. Same AI background reused for every locale — only the HTML overlay changes."
        actions={locales.length > 0 && (
          <>
            <span className="tabular ds-note">
              ~${totalCost} · {locales.length} locale{locales.length === 1 ? '' : 's'}
            </span>
            <Button variant="ghost" onClick={() => refitAllLocales()} disabled={isAnyBusy} leftIcon={<RefreshCcw size={14} />}>
              Refit all
            </Button>
            <Button variant="ai" onClick={onTranslateAll} disabled={isAnyBusy} leftIcon={<Languages size={14} />}>
              {isAnyBusy ? `Translating ${busy.size}…` : 'Translate all'}
            </Button>
          </>
        )}
      />

      {/* Locale picker — grouped by tier so the user starts with high-ROI
          markets and works outward. Tier 1 = global launch core, Tier 2 =
          major secondary, Tier 3 = long-tail. */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 className="ds-card-title" style={{ margin: 0 }}>Add locales</h3>
          {available.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => available.forEach((spec) => onAdd(spec.code))}
              leftIcon={<Plus size={12} />}
              title={`Add all ${available.length} remaining locales`}
            >
              Add all ({available.length})
            </Button>
          )}
        </div>
        {([1, 2, 3] as const).map((tier) => {
          const tierLocales = CURATED_LOCALES.filter((l) => l.tier === tier);
          if (tierLocales.length === 0) return null;
          const labels: Record<typeof tier, string> = {
            1: 'Tier 1 · Global launch core',
            2: 'Tier 2 · Major secondary',
            3: 'Tier 3 · Long-tail',
          };
          const subs: Record<typeof tier, string> = {
            1: '12 highest-revenue markets',
            2: 'Clear ROI after Tier 1',
            3: 'Opportunistic, low effort',
          };
          return (
            <div key={tier}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <h3 className="ds-group-label" style={{ margin: 0, color: 'var(--fg-1)' }}>{labels[tier]}</h3>
                <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{subs[tier]}</span>
                <span style={{ fontSize: 12, color: 'var(--fg-2)', marginLeft: 'auto' }}>{tierLocales.length} available</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tierLocales.map((spec) => {
                  const active = usedCodes.has(spec.code);
                  return (
                    <button
                      key={spec.code}
                      type="button"
                      onClick={() => {
                        if (active) removeLocale(spec.code);
                        else onAdd(spec.code);
                      }}
                      className="btn btn--sm"
                      style={{
                        gap: 6,
                        // Active = added → accent-soft bg + accent text (DESIGN.md active state).
                        ...(active ? { background: 'var(--ds-accent-soft)', borderColor: 'transparent', color: 'var(--ds-accent)', fontWeight: 600 } : null),
                      }}
                      title={active ? `Click to remove ${spec.name}` : `Add ${spec.name} (${spec.code})`}
                    >
                      <span>{spec.flag}</span>
                      <span>{spec.name}</span>
                      {spec.rtl && <span style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--fg-2)' }}>RTL</span>}
                      {active ? <Check size={14} /> : <Plus size={14} style={{ color: 'var(--fg-2)' }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {available.length === 0 && (
          <span className="ds-note">All App Store locales already added.</span>
        )}
      </section>

      {/* Selected locales */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {locales.length === 0 ? (
          <div className="ds-card ds-note" style={{ padding: 24, textAlign: 'center' }}>
            <Globe size={28} style={{ marginBottom: 8, color: 'var(--fg-3)' }} />
            <div>No locales yet — pick from above to start.</div>
          </div>
        ) : (
          locales.map((loc) => (
            <LocaleCard
              key={loc.id}
              loc={loc}
              busy={busy.has(loc.code)}
              onTranslate={() => onTranslate(loc.code)}
              onCancel={() => onCancel(loc.code)}
              onRefit={() => refitLocale(loc.code)}
              onRemove={() => {
                if (window.confirm(`Remove ${loc.name}? Translations will be lost.`)) removeLocale(loc.id);
              }}
            />
          ))
        )}
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" onClick={() => nav('/polish')} disabled={isAnyBusy}>← AI Polish</Button>
        {(() => {
          const untranslated = locales.filter((l) => !l.aiTranslated);
          const blocked = isAnyBusy || untranslated.length > 0;
          const label = isAnyBusy
            ? `Translating ${busy.size}…`
            : untranslated.length > 0
              ? `${untranslated.length} locale${untranslated.length === 1 ? '' : 's'} pending`
              : 'Continue → Export';
          const tip = isAnyBusy
            ? 'Wait for translation to finish before continuing'
            : untranslated.length > 0
              ? `Translate ${untranslated.map((l) => l.code).join(', ')} first`
              : undefined;
          return (
            <Button
              variant="primary"
              onClick={() => nav('/export')}
              disabled={blocked}
              title={tip}
            >
              {label}
            </Button>
          );
        })()}
      </div>
    </div>
  );
}

function LocaleCard({ loc, busy, onTranslate, onCancel, onRefit, onRemove }: { loc: LocaleEntry; busy: boolean; onTranslate: () => void; onCancel: () => void; onRefit: () => void; onRemove: () => void }) {
  const screenshots = useStudio((s) => s.screenshots);
  const updateLocaleSlotAdjustment = useStudio((s) => s.updateLocaleSlotAdjustment);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const status = busy ? 'translating' : loc.aiTranslated ? 'done' : 'pending';

  // Auto-refit iPad slots that have a fallback translation but no adjustment yet.
  // Runs once after translation completes — no API call, pure local computation.
  const refitDoneRef = useRef(false);
  useEffect(() => {
    if (!loc.aiTranslated || busy || refitDoneRef.current) return;
    const ipadSlots = screenshots.filter((s) => s.device === 'ipad');
    const needsRefit = ipadSlots.some((s) => !loc.slotAdjustments?.[s.id]);
    if (needsRefit) {
      refitDoneRef.current = true;
      refitLocale(loc.code);
    }
  }, [loc.aiTranslated, busy, loc.code, loc.slotAdjustments, screenshots]);

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        background: 'var(--ds-panel)',
        boxShadow: 'var(--ds-shadow)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 24 }}>{loc.flag}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span className="ds-card-title">
            {loc.name} <span style={{ color: 'var(--fg-2)', fontSize: 14, fontWeight: 400 }}>· {loc.code}</span>
            {loc.rtl && <span className="ds-badge" style={{ marginLeft: 8 }}>RTL</span>}
          </span>
          <span className="ds-note">
            {loc.fontOverride ? `Font: ${loc.fontOverride}` : 'Default font'}
            {' · '}
            {Object.keys(loc.translations ?? {}).length} translated
          </span>
        </div>
        <StatusBadge status={status} />
        {status === 'done' && !busy && (
          <Button variant="ghost" onClick={onRefit} title="Recompute auto-fit (no API call)">
            Re-fit
          </Button>
        )}
        {busy ? (
          <>
            <Button variant="ghost" leftIcon={<Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />} disabled>
              Translating…
            </Button>
            <Button variant="ghost" onClick={onCancel} leftIcon={<X size={12} />} title="Cancel translation">
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant={status === 'done' ? 'ghost' : 'default'}
            onClick={onTranslate}
            leftIcon={<Languages size={12} />}
          >
            {status === 'done' ? 'Re-translate' : 'AI translate'}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove" title="Remove locale">
          <Trash2 size={16} />
        </Button>
      </div>

      {/* Per-slot preview — iPhone strip, then iPad strip below. Click a
          thumbnail to enter edit mode and drag the headline per-locale. */}
      {loc.aiTranslated && (() => {
        const iphoneSlots = screenshots.filter((s) => !s.device || s.device === 'iphone');
        const ipadSlots = screenshots.filter((s) => s.device === 'ipad');
        const renderStrip = (slots: typeof screenshots, device: 'iphone' | 'ipad') => {
          if (!slots.length) return null;
          const fw = device === 'ipad' ? 140 : 90;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ipadSlots.length > 0 && (
                <span className="ds-group-label">
                  {device === 'ipad' ? 'iPad' : 'iPhone'}
                </span>
              )}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {slots.map((ss) => {
                  const localised = applyLocaleToSlot(ss, loc);
                  const isEditing = editingSlot === ss.id;
                  return (
                    <button
                      key={ss.id}
                      type="button"
                      onClick={() => setEditingSlot(isEditing ? null : ss.id)}
                      style={{
                        width: fw + 4, flex: 'none',
                        border: isEditing ? '2px solid var(--accent)' : '2px solid transparent',
                        borderRadius: 8, padding: 0,
                        background: 'transparent', cursor: 'pointer',
                      }}
                      title={isEditing ? 'Editing — click to close' : 'Open in editor'}
                    >
                      <MockupCanvas
                        screenshot={localised}
                        device={device}
                        fitWidth={fw}
                        showDropZone={false}
                        viewModeOverride={ss.action?.aiImageUrl ? 'enhanced' : 'scaffold'}
                        localeMeta={{ rtl: loc.rtl, fontOverride: loc.fontOverride, lang: loc.code }}
                        deviceBaseTitlePx={ss.titlePx}
                        deviceBaseSubPx={ss.subPx}
                        showTextBoundary
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        };
        return (
          <div style={{ borderTop: '1px solid var(--line-1)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {renderStrip(iphoneSlots, 'iphone')}
            {renderStrip(ipadSlots, 'ipad')}

          {/* Inline editor — bigger draggable canvas for the active slot */}
          {editingSlot && (() => {
            const ss = screenshots.find((s) => s.id === editingSlot);
            if (!ss) return null;
            const localised = applyLocaleToSlot(ss, loc);
            const device = ss.device ?? 'iphone';
            const editorFw = device === 'ipad' ? 300 : 220;
            return (
              <div
                style={{
                  display: 'flex', gap: 14,
                  padding: 12,
                  background: 'var(--ds-panel-2)',
                  borderRadius: 8,
                }}
              >
                <div style={{ flex: 'none' }}>
                  <MockupCanvas
                    screenshot={localised}
                    device={device}
                    fitWidth={editorFw}
                    showDropZone={false}
                    viewModeOverride={ss.action?.aiImageUrl ? 'enhanced' : 'scaffold'}
                    localeMeta={{ rtl: loc.rtl, fontOverride: loc.fontOverride, lang: loc.code }}
                    deviceBaseTitlePx={ss.titlePx}
                    deviceBaseSubPx={ss.subPx}
                    showTextBoundary
                    editable={{
                      onMove: (dx, dy) => {
                        const cur = loc.slotAdjustments?.[ss.id] ?? {};
                        updateLocaleSlotAdjustment(loc.id, ss.id, {
                          textX: (cur.textX ?? 0) + dx,
                          textY: (cur.textY ?? 0) + dy,
                        });
                      },
                    }}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                  <div className="ds-card-title">Adjust for {loc.name}</div>
                  <div className="ds-note">Drag the headline on the canvas to reposition (per-locale).</div>
                  <SizeSliders
                    titlePx={localised.titlePx}
                    subPx={localised.subPx}
                    baseTitlePx={ss.titlePx}
                    baseSubPx={ss.subPx}
                    onChange={(patch) => updateLocaleSlotAdjustment(loc.id, ss.id, patch)}
                  />
                  <button
                    type="button"
                    onClick={() => updateLocaleSlotAdjustment(loc.id, ss.id, { textX: 0, textY: 0, titlePx: undefined, subPx: undefined })}
                    className="btn btn--sm"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Reset locale adjustments
                  </button>
                </div>
              </div>
            );
          })()}
          </div>
        );
      })()}
    </div>
  );
}

function SizeSliders({ titlePx, subPx, baseTitlePx, baseSubPx, onChange }: {
  titlePx?: number; subPx?: number;
  baseTitlePx?: number; baseSubPx?: number;
  onChange: (patch: { titlePx?: number; subPx?: number }) => void;
}) {
  const t = titlePx ?? baseTitlePx ?? 200;
  const s = subPx ?? baseSubPx ?? 80;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 70 }}>Title px</span>
        <input
          type="range" min={60} max={400} step={2} value={t}
          onChange={(e) => onChange({ titlePx: Number(e.target.value) })}
          className="slider" style={{ flex: 1 }}
        />
        <span className="tabular muted" style={{ width: 36, textAlign: 'right' }}>{t}</span>
      </label>
      <label style={{ fontSize: 13, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 70 }}>Sub px</span>
        <input
          type="range" min={30} max={180} step={2} value={s}
          onChange={(e) => onChange({ subPx: Number(e.target.value) })}
          className="slider" style={{ flex: 1 }}
        />
        <span className="tabular muted" style={{ width: 36, textAlign: 'right' }}>{s}</span>
      </label>
    </div>
  );
}


function StatusBadge({ status }: { status: 'pending' | 'translating' | 'done' }) {
  if (status === 'translating') {
    return (
      <span className="ds-badge">
        <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
        Translating
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className="ds-badge ds-badge-good">
        <Check size={11} />
        Done
      </span>
    );
  }
  return <span className="ds-badge ds-badge-muted">Pending</span>;
}
