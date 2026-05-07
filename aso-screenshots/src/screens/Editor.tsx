import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, RefreshCcw, RotateCcw, Save, Sparkles, Wand2, X } from 'lucide-react';
import { Button, SegmentedControl } from '../components/shared';
import { Inspector } from '../components/studio/Inspector';
import { MockupCanvas } from '../components/studio/MockupCanvas';
import { ScreenshotSidebar } from '../components/studio/ScreenshotSidebar';
import { useStudio } from '../state/studio';
import { useEnhance } from '../lib/useEnhance';
import { useKeyGate } from '../state/keyGate';
import { getPreset } from '../lib/presets';

// /api on direct :5180/studio/, /studio-api when proxied via Keywords origin :5173/studio/.
const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

export function EditorScreen() {
  const nav = useNavigate();
  const {
    screenshots,
    activeScreenshotId,
    setActiveScreenshot,
    selectedPresetId,
    updateScreenshot,
    viewMode,
    setViewMode,
    previewDevice,
    setPreviewDevice,
  } = useStudio();

  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
  const { enhance, discard, isGenerating, error: enhanceError, hasResult } = useEnhance();
  const ensureKey = useKeyGate((s) => s.ensureKey);
  const onEnhance = () => { void ensureKey('FAL_API_KEY', 'AI hero generation', enhance); };

  // Build a Preset JSON from the current Editor state and POST it. mode='update' rewrites
  // the existing preset; 'new' prompts for a name and writes a new file.
  const saveTemplate = async (mode: 'update' | 'new') => {
    if (saving === 'saving') return;
    const basePreset = selectedPresetId ? getPreset(selectedPresetId) : undefined;
    if (!basePreset) {
      alert('No preset selected to save.');
      return;
    }
    let id = basePreset.id;
    let name = basePreset.name;
    if (mode === 'new') {
      const userName = prompt('Name for the new template?', `${basePreset.name} (custom)`);
      if (!userName) return;
      name = userName;
      id = userName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `template-${Date.now()}`;
    } else {
      // mode === 'update' — destructive, confirm before overwriting
      if (!window.confirm(`Overwrite the "${basePreset.name}" template with current device positions, fonts and headlines? This will affect anyone using this preset later.`)) return;
    }
    // Snapshot per-screenshot transforms back into preset.samples — what user tweaked
    // (deviceX/Y, text font, etc.) becomes the new template's defaults. Merge over the
    // original sample at the same index so per-sample fields the editor doesn't expose
    // (groupId, screenSrc) survive intact.
    //
    // IMPORTANT: action (hero) slots are per-PROJECT, not part of the template — drop
    // them before snapshotting so a saved template doesn't accidentally bake in a hero.
    const regularScreenshots = screenshots.filter((s) => s.kind === 'regular');
    const samples = regularScreenshots.map((s, i) => {
      const orig = basePreset.samples?.[i] ?? {};
      return {
        ...orig,
        verb: s.headline.verb,
        descriptor: s.headline.descriptor,
        device: {
          ...(s.deviceX ? { offsetX: s.deviceX } : {}),
          ...(s.deviceY ? { offsetY: s.deviceY } : {}),
          ...(s.tiltDeg ? { rotateZ: s.tiltDeg } : {}),
          ...(s.deviceScale && s.deviceScale !== 1 ? { scale: s.deviceScale } : {}),
        },
        text: {
          ...(s.textYFraction !== undefined ? { yFraction: s.textYFraction } : {}),
          ...(s.titlePx ? { titlePx: s.titlePx } : {}),
          ...(s.subPx ? { subPx: s.subPx } : {}),
        },
        // Per-slot bg + pill survive what the user edited in this session.
        ...(s.backgroundOverride ? { bgColor: s.backgroundOverride } : orig.bgColor ? { bgColor: orig.bgColor } : {}),
        ...(s.pill !== undefined ? { pill: s.pill } : {}),
        ...(s.pillBg ? { pillBg: s.pillBg } : {}),
        ...(s.pillFg ? { pillFg: s.pillFg } : {}),
        ...(s.groupId ? { groupId: s.groupId } : {}),
      };
    });
    const preset = {
      ...basePreset,
      id,
      name,
      text: { ...basePreset.text, font: active?.font ?? basePreset.text.font },
      samples,
    };
    setSaving('saving');
    try {
      const r = await fetch(`${API_BASE}/templates/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, preset }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaving('ok');
      setTimeout(() => setSaving('idle'), 1500);
    } catch (e) {
      console.error(e);
      setSaving('err');
      setTimeout(() => setSaving('idle'), 2500);
    }
  };

  const resetLayout = () => {
    if (!active) return;
    if (!window.confirm("Reset this slot's device tilt, position, scale, and text offset? Other slots aren't affected.")) return;
    updateScreenshot(active.id, {
      tiltDeg: 0,
      tiltX: 0,
      tiltY: 0,
      deviceX: 0,
      deviceY: 0,
      deviceScale: 1,
      textX: 0,
      textY: 0,
    });
  };

  const resetTemplate = () => {
    if (!selectedPresetId) return;
    const ok = window.confirm(
      'Reset every slot back to the template defaults? Uploaded screenshots are kept; positions, headlines, fonts and sizes will be restored.',
    );
    if (!ok) return;
    // pickPreset() merges samples with existing sourceUrls — exactly the "soft reset"
    // the user wants: layout starts over, uploads survive.
    pickPreset(selectedPresetId);
  };

  // Auto-select first screenshot on mount or when active is missing
  useEffect(() => {
    if (!activeScreenshotId && screenshots.length > 0) {
      setActiveScreenshot(screenshots[0].id);
    }
  }, [activeScreenshotId, screenshots, setActiveScreenshot]);

  // Apply selectedPresetId to any screenshot that doesn't have a preset yet
  useEffect(() => {
    if (!selectedPresetId) return;
    screenshots.forEach((s) => {
      if (!s.presetId) updateScreenshot(s.id, { presetId: selectedPresetId });
    });
  }, [selectedPresetId, screenshots, updateScreenshot]);

  // If the user lands on Editor with an empty screenshots list but a preset selected
  // (e.g. fresh session, persisted state was empty), seed the sidebar from the preset's
  // samples so all template slots are immediately visible.
  const pickPreset = useStudio((st) => st.pickPreset);
  useEffect(() => {
    if (!selectedPresetId) return;
    if (screenshots.length === 0) {
      pickPreset(selectedPresetId);
    }
  }, [selectedPresetId, screenshots.length, pickPreset]);

  // Measure canvas wrap to fit
  useEffect(() => {
    if (!canvasWrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const el = canvasWrapRef.current;
      if (!el) return;
      const padding = 32; // breathing room
      setFit({ w: el.clientWidth - padding * 2, h: el.clientHeight - padding * 2 });
    });
    ro.observe(canvasWrapRef.current);
    return () => ro.disconnect();
  }, []);

  const active = screenshots.find((s) => s.id === activeScreenshotId);

  if (screenshots.length === 0) {
    return (
      <div style={{ padding: 'var(--s-9)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>No screenshots yet</h2>
        <p style={{ color: 'var(--fg-2)', textAlign: 'center', maxWidth: 460 }}>
          Add at least one simulator screenshot in Setup to start composing.
        </p>
        <Button variant="primary" onClick={() => nav('/setup')}>← Back to Setup</Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--sidebar-w) 1fr var(--inspector-w)', height: 'calc(100vh - var(--topbar-h))', minHeight: 0 }}>
      <ScreenshotSidebar />

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-canvas)' }}>
        <div
          style={{
            height: 48,
            padding: '0 16px',
            borderBottom: '1px solid var(--line-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--bg-1)',
          }}
        >
          <SegmentedControl
            items={[
              { value: 'scaffold', label: 'Scaffold', icon: <Eye size={12} /> },
              {
                value: 'enhanced',
                label: 'Enhanced',
                icon: <Sparkles size={12} />,
                // Tab is selectable only after the user has actually generated an AI image.
                disabled: !active?.action?.aiImageUrl,
              },
            ]}
            value={viewMode}
            onChange={setViewMode}
          />
          <SegmentedControl
            items={[
              { value: 'iphone', label: 'iPhone' },
              {
                value: 'ipad',
                label: 'iPad',
                disabled: !screenshots.some((s) => s.device === 'ipad'),
              },
            ]}
            value={previewDevice}
            onChange={(v) => setPreviewDevice(v as 'iphone' | 'ipad')}
          />
          <span className="tabular muted" style={{ fontSize: 11 }}>
            {active ? (previewDevice === 'ipad' ? '2048 × 2732' : '1290 × 2796') : ''}
          </span>
          <span style={{ flex: 1 }} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Reset layout"
            title="Reset device tilt / position / scale / text offset to defaults"
            onClick={resetLayout}
            disabled={!active}
          >
            <RotateCcw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Reset entire template"
            title="Reset every slot back to template defaults (uploaded screenshots preserved)"
            onClick={resetTemplate}
            disabled={!selectedPresetId}
          >
            <RefreshCcw size={14} />
          </Button>
          {hasResult && active?.kind === 'action' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Discard AI version"
              title="Discard AI version (revert to scaffold)"
              onClick={discard}
              disabled={isGenerating}
            >
              <X size={14} />
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => saveTemplate('update')}
            disabled={!selectedPresetId || saving === 'saving'}
            leftIcon={<Save size={13} />}
            title="Overwrite the current template with these positions, fonts, headlines, pills and per-slot backgrounds"
          >
            {saving === 'saving' ? 'Saving…' : saving === 'ok' ? 'Saved ✓' : saving === 'err' ? 'Failed' : 'Update'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => saveTemplate('new')}
            disabled={!selectedPresetId || saving === 'saving'}
            title="Save current state as a new template (asks for a name)"
          >
            Save as new
          </Button>
          {/* Enhance is a HERO-only action — regular slots use the AI Polish
              screen (Phase 5) for batch refinement with a separate prompt. */}
          {active?.kind === 'action' && (
            <Button
              variant="ai"
              disabled={isGenerating}
              onClick={onEnhance}
              leftIcon={isGenerating ? <Sparkles size={14} /> : <Wand2 size={14} />}
              title={enhanceError ? `Last error: ${enhanceError}` : undefined}
            >
              {isGenerating ? 'Enhancing…' : hasResult ? 'Re-enhance' : 'Enhance with AI'}
            </Button>
          )}
        </div>

        <div ref={canvasWrapRef} style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 16, overflow: 'hidden', position: 'relative' }}>
          {/* AI history rail — vertical column of past Re-enhance results pinned to the
              left edge so the user can flip between attempts without re-generating. The
              "selected" thumb is the one currently shown in the canvas (= action.aiImageUrl). */}
          {viewMode === 'enhanced' && active?.kind === 'action' && active?.action?.aiHistory && active.action.aiHistory.length >= 2 && (
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 12,
                bottom: 12,
                width: 64,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                overflowY: 'auto',
                padding: 4,
                background: 'var(--bg-1)',
                borderRadius: 'var(--r-3)',
                boxShadow: 'inset 0 0 0 1px var(--line-1)',
                zIndex: 4,
              }}
              title="Past Re-enhance results — click to switch"
            >
              {active.action.aiHistory.map((url, i) => {
                const isCurrent = url === active.action?.aiImageUrl;
                return (
                  <button
                    key={url}
                    onClick={() => {
                      const cur = active.action!;
                      const ss = active;
                      // Apply via updateScreenshot directly to swap aiImageUrl
                      const next = { ...cur, aiImageUrl: url };
                      // hack — use the updateScreenshot from useStudio via global state
                      useStudio.getState().updateScreenshot(ss.id, { action: next });
                    }}
                    style={{
                      flex: '0 0 auto',
                      height: 100,
                      padding: 0,
                      border: `2px solid ${isCurrent ? 'var(--accent)' : 'transparent'}`,
                      borderRadius: 'var(--r-2)',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      background: '#000',
                      position: 'relative',
                    }}
                    title={`Attempt ${i + 1}${isCurrent ? ' (current)' : ''}`}
                  >
                    <img
                      src={url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 2,
                        right: 4,
                        fontSize: 9,
                        fontWeight: 600,
                        color: '#fff',
                        textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                      }}
                    >
                      {i + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {active && fit && <MockupCanvas screenshot={active} device={previewDevice} fitWidth={fit.w} fitHeight={fit.h} />}

          {/* Loader overlay during AI enhancement — covers the canvas with a pulsing
              backdrop so the user knows something's happening. */}
          {isGenerating && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(4px)',
                zIndex: 5,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 14,
                  padding: '20px 28px',
                  background: 'var(--bg-1)',
                  borderRadius: 'var(--r-3)',
                  boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
                  border: '1px solid var(--line-1)',
                }}
              >
                <div
                  style={{
                    width: 38, height: 38, borderRadius: '50%',
                    border: '3px solid var(--line-1)',
                    borderTopColor: 'var(--ai)',
                    animation: 'spin 0.9s linear infinite',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-0)' }}>Enhancing with AI…</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>~20-30s · gpt-image-2 medium quality</span>
                </div>
              </div>
            </div>
          )}

          {/* Error toast — visible until next attempt */}
          {!isGenerating && enhanceError && (
            <div
              style={{
                position: 'absolute',
                top: 12, left: 12, right: 12,
                background: 'rgba(220, 38, 38, 0.12)',
                border: '1px solid rgba(220, 38, 38, 0.4)',
                color: '#fca5a5',
                borderRadius: 'var(--r-3)',
                padding: '10px 14px',
                fontSize: 12,
                lineHeight: 1.4,
                zIndex: 5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <span style={{ fontWeight: 600, flex: 'none' }}>AI enhance failed:</span>
              <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{enhanceError}</span>
            </div>
          )}
        </div>

        {/* Group strip — when the active screenshot is part of a cross-pair (groupId set),
            render the whole group side-by-side at small scale so the user can see the
            assembled phone. The active one is highlighted; the others are read-only previews. */}
        {active?.groupId && (() => {
          const group = screenshots.filter((s) => s.groupId === active.groupId);
          if (group.length < 2) return null;
          const stripCellW = Math.min(220, Math.floor((fit?.w ?? 600) / group.length) - 8);
          return (
            <div
              style={{
                borderTop: '1px solid var(--line-1)',
                background: 'var(--bg-1)',
                padding: '10px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg-2)' }}>
                <span>Cross-pair preview ({group.length} slots, one shared phone)</span>
                <span style={{ opacity: 0.6 }}>· active slot highlighted · click to switch</span>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                {group.map((g) => {
                  const isActive = g.id === active.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setActiveScreenshot(g.id)}
                      style={{
                        flex: 'none',
                        padding: 0,
                        border: isActive ? '2px solid var(--accent)' : '1px solid var(--line-1)',
                        borderRadius: 8,
                        background: 'transparent',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        outline: 'none',
                      }}
                      title={isActive ? 'Active' : 'Click to edit this slot'}
                    >
                      <MockupCanvas screenshot={g} device={g.device ?? 'iphone'} fitWidth={stripCellW} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {active && <Inspector screenshot={active} />}
    </div>
  );
}
