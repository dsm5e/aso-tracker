import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, RefreshCcw, Sparkles, StopCircle, Wand2, X } from 'lucide-react';
import { Button } from '../components/shared';
import { MockupCanvas } from '../components/studio/MockupCanvas';
import { useStudio, type Screenshot } from '../state/studio';
import { polishBatch, polishSlot } from '../lib/polishBatch';
import { useKeyGate } from '../state/keyGate';

const PER_RENDER_USD = 0.05;

export function PolishScreen() {
  const nav = useNavigate();
  const screenshots = useStudio((s) => s.screenshots);
  const updateScreenshot = useStudio((s) => s.updateScreenshot);
  const setActiveScreenshot = useStudio((s) => s.setActiveScreenshot);
  const setViewMode = useStudio((s) => s.setViewMode);
  const setPreviewDevice = useStudio((s) => s.setPreviewDevice);

  const regulars = useMemo(() => screenshots.filter((s) => s.kind === 'regular'), [screenshots]);
  const iphoneSlots = useMemo(() => regulars.filter((s) => !s.device || s.device === 'iphone'), [regulars]);
  const ipadSlots = useMemo(() => regulars.filter((s) => s.device === 'ipad'), [regulars]);
  const hasBothDevices = iphoneSlots.length > 0 && ipadSlots.length > 0;
  const heroes = useMemo(() => screenshots.filter((s) => s.kind === 'action'), [screenshots]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(regulars.map((s) => s.id)));
  const [running, setRunning] = useState(false);
  const stopRequested = useRef(false);

  const totalSelected = selected.size;
  const cost = (totalSelected * PER_RENDER_USD).toFixed(2);
  const doneInBatch = regulars.filter((s) => selected.has(s.id) && !!s.action?.aiImageUrl).length;
  // Set, not single id — parallel polish means several slots are generating
  // at once, each card needs its own spinner.
  const generatingIds = useMemo(
    () => new Set(
      screenshots.filter((s) => s.action?.generateState === 'generating').map((s) => s.id),
    ),
    [screenshots],
  );

  const toggleSelected = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const ensureKey = useKeyGate((s) => s.ensureKey);

  const onPolishAll = async () => {
    if (running || !totalSelected) return;
    void ensureKey('FAL_API_KEY', 'AI Polish', async () => {
      stopRequested.current = false;
      setRunning(true);
      try {
        const queue = regulars
          .filter((s) => selected.has(s.id))
          .map((s) => s.id);
        await polishBatch(queue, {
          shouldStop: () => stopRequested.current,
        });
      } finally {
        setRunning(false);
      }
    });
  };

  const onStop = () => { stopRequested.current = true; };

  const onPolishOne = async (id: string) => {
    // Individual re-polish runs independently of the batch — polishSlot manages
    // its own generateState per slot. Don't touch `running` here so the batch
    // progress bar stays alive while a single re-polish fires alongside it.
    void ensureKey('FAL_API_KEY', 'AI Polish', async () => {
      try { await polishSlot(id); } catch {/* error stored on slot.action.errorMessage */}
    });
  };

  const onDiscardOne = (ss: Screenshot) => {
    const a = ss.action;
    if (!a) return;
    updateScreenshot(ss.id, {
      action: { ...a, aiImageUrl: null, generateState: 'idle', errorMessage: undefined },
    });
  };

  const onCancelStuck = (ss: Screenshot) => {
    const a = ss.action;
    if (!a) return;
    // Reset stuck generating state without clearing an existing aiImageUrl.
    updateScreenshot(ss.id, {
      action: { ...a, generateState: a.aiImageUrl ? 'done' : 'idle', errorMessage: undefined },
    });
    // Deselect so the slot no longer counts toward batch progress total.
    setSelected((prev) => { const n = new Set(prev); n.delete(ss.id); return n; });
  };

  /** Open this slot in the Editor — sets active + scaffold view so the user
   *  can tweak text / device pose / pill / bg before polishing. */
  const onOpenInEditor = (ss: Screenshot) => {
    setActiveScreenshot(ss.id);
    setPreviewDevice(ss.device ?? 'iphone');
    setViewMode('scaffold');
    nav('/editor');
  };

  if (!regulars.length) {
    return (
      <div style={{ padding: 'var(--s-9)', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>No regular slots to polish</h2>
        <p style={{ color: 'var(--fg-2)', fontSize: 13 }}>
          Add screenshots in the Editor first. Polish only applies to non-hero slots.
        </p>
        <Button variant="primary" onClick={() => nav('/editor')}>← Back to Editor</Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--s-7)', maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>AI Polish</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--fg-2)', fontSize: 13, maxWidth: 720 }}>
            Replace the flat scaffold with photoreal devices + subtle highlights.
            Same layout — only the rendering quality is upgraded. Hero slots shown separately below — generate from here or re-enhance if already done in Editor.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="tabular" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            ${cost} · {totalSelected} selected
          </span>
          {running ? (
            <Button variant="ghost" onClick={onStop} leftIcon={<StopCircle size={14} />}>
              Stop
            </Button>
          ) : (
            <Button
              variant="ai"
              onClick={onPolishAll}
              disabled={!totalSelected}
              leftIcon={<Wand2 size={14} />}
            >
              Polish {totalSelected}
            </Button>
          )}
        </div>
      </header>

      {/* Progress bar — shown while a batch is in flight or any slot is mid-call */}
      {(running || generatingIds.size > 0) && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg-1)',
            borderRadius: 10,
            border: '1px solid var(--line-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12,
            color: 'var(--fg-1)',
          }}
        >
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--ai)' }} />
          <span>
            {totalSelected > 0 ? `${doneInBatch} of ${totalSelected} done` : 'Polishing…'}
          </span>
          <div style={{ flex: 1, height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: totalSelected > 0 ? `${(doneInBatch / totalSelected) * 100}%` : '100%',
                height: '100%',
                background: 'var(--ai)',
                transition: 'width .3s',
                animation: totalSelected === 0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }}
            />
          </div>
        </div>
      )}

      {[
        { label: 'iPhone', slots: iphoneSlots },
        { label: 'iPad', slots: ipadSlots },
      ]
        .filter((g) => g.slots.length > 0)
        .map((group) => (
          <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ipadSlots.length > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--fg-3)',
                }}
              >
                {group.label}
              </span>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${hasBothDevices ? 180 : 260}px, 1fr))`,
                gap: hasBothDevices ? 10 : 16,
              }}
            >
              {group.slots.map((ss) => (
                <PolishCard
                  key={ss.id}
                  slot={ss}
                  checked={selected.has(ss.id)}
                  disabled={running}
                  isGenerating={generatingIds.has(ss.id)}
                  onToggle={(on) => toggleSelected(ss.id, on)}
                  onPolish={() => onPolishOne(ss.id)}
                  onDiscard={() => onDiscardOne(ss)}
                  onCancelStuck={() => onCancelStuck(ss)}
                  onOpenInEditor={() => onOpenInEditor(ss)}
                  compact={hasBothDevices}
                />
              ))}
            </div>
          </div>
        ))}


      {heroes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--fg-3)' }}>
            Hero
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${hasBothDevices ? 180 : 260}px, 1fr))`, gap: hasBothDevices ? 10 : 16 }}>
            {heroes.map((ss) => (
              <PolishCard
                key={ss.id}
                slot={ss}
                checked={false}
                disabled={running}
                isGenerating={generatingIds.has(ss.id)}
                onToggle={() => {}}
                onPolish={() => onPolishOne(ss.id)}
                onDiscard={() => onDiscardOne(ss)}
                onCancelStuck={() => onCancelStuck(ss)}
                onOpenInEditor={() => onOpenInEditor(ss)}
                compact={hasBothDevices}
                isHero
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Button variant="ghost" onClick={() => nav('/editor')}>← Editor</Button>
        <Button variant="primary" size="lg" onClick={() => nav('/locales')}>Continue → Locales</Button>
      </div>
    </div>
  );
}

interface CardProps {
  slot: Screenshot;
  checked: boolean;
  disabled: boolean;
  isGenerating: boolean;
  compact?: boolean;
  isHero?: boolean;
  onToggle: (on: boolean) => void;
  onPolish: () => void;
  onDiscard: () => void;
  onCancelStuck: () => void;
  onOpenInEditor: () => void;
}

function PolishCard({ slot, checked, disabled, isGenerating, onToggle, onPolish, onDiscard, onCancelStuck, onOpenInEditor, compact, isHero }: CardProps) {
  const status: 'idle' | 'queued' | 'generating' | 'done' | 'error' = isGenerating
    ? 'generating'
    : slot.action?.generateState === 'error'
      ? 'error'
      : slot.action?.aiImageUrl
        ? 'done'
        : 'idle';
  const errorMsg = slot.action?.errorMessage;

  return (
    <div
      data-canvas-slot={slot.id}
      style={{
        borderRadius: 12,
        border: `2px solid ${checked ? 'var(--accent)' : 'var(--line-1)'}`,
        background: 'var(--bg-1)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color .12s',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: '1px solid var(--line-1)',
          minHeight: 40,
        }}
      >
        {!isHero && (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={disabled}
            style={{ flex: 'none' }}
          />
        )}
        {isHero && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ai)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Hero</span>
        )}
        <span
          style={{
            flex: 1,
            fontSize: compact ? 11 : 12,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--fg-0)',
          }}
          title={slot.headline.verb}
        >
          {slot.headline.verb || 'Untitled'}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* Mini canvas — click to open this slot in Editor (scaffold view) so
          the user can tweak text / device pose / pill / bg before polishing.
          The data-canvas-slot wrapper above lets polishBatch find this
          canvas's inner element to capture during the fal.ai call. */}
      <button
        type="button"
        onClick={onOpenInEditor}
        title="Open this slot in Editor"
        style={{
          padding: compact ? 8 : 14,
          background: 'var(--bg-canvas)',
          display: 'grid',
          placeItems: 'center',
          border: 0,
          width: '100%',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <PolishCardCanvas slot={slot} compact={compact} />
        {/* Hidden scaffold-mode canvas for re-polish capture. Always renders
            the original DOM scaffold (no AI overlay) regardless of whether
            the slot has been polished. captureScaffoldFor targets this
            element via its data-canvas-slot wrapper so re-polish always
            sends a clean scaffold to fal.ai, not a degraded AI render. */}
        <div
          data-scaffold-slot={slot.id}
          style={{
            position: 'absolute',
            left: -99999,
            top: 0,
            width: slot.device === 'ipad' ? 2048 : 1290,
            height: slot.device === 'ipad' ? 2732 : 2796,
            pointerEvents: 'none',
            visibility: 'hidden',
          }}
          aria-hidden
        >
          <MockupCanvas
            screenshot={slot}
            device={slot.device ?? 'iphone'}
            fitWidth={slot.device === 'ipad' ? 2048 : 1290}
            fitHeight={slot.device === 'ipad' ? 2732 : 2796}
            showDropZone={false}
            viewModeOverride="scaffold"
          />
        </div>
      </button>

<div style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--line-1)' }}>
        {status === 'done' && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDiscard}
            disabled={disabled}
            title="Discard polish, revert to scaffold"
            aria-label="Discard polish"
          >
            <X size={13} />
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {isGenerating ? (
          <Button
            variant="ghost"
            onClick={onCancelStuck}
            leftIcon={<X size={12} />}
            title="Cancel stuck request and reset"
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant={status === 'done' ? 'ghost' : 'ai'}
            onClick={onPolish}
            leftIcon={status === 'done' ? <RefreshCcw size={12} /> : <Wand2 size={12} />}
          >
            {status === 'done' ? 'Re-polish' : 'Polish'}
          </Button>
        )}
      </div>

      {errorMsg && status === 'error' && (
        <div style={{ padding: '6px 10px', background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 11 }}>
          {errorMsg}
        </div>
      )}
    </div>
  );
}

function PolishCardCanvas({ slot, compact }: { slot: Screenshot; compact?: boolean }) {
  const fw = compact ? 130 : 204;
  const fh = compact ? 282 : 442;
  return (
    <MockupCanvas
      screenshot={slot}
      device={slot.device ?? 'iphone'}
      fitWidth={fw}
      fitHeight={fh}
      showDropZone={false}
      viewModeOverride={slot.action?.aiImageUrl ? 'enhanced' : 'scaffold'}
    />
  );
}

function StatusBadge({ status }: { status: 'idle' | 'queued' | 'generating' | 'done' | 'error' }) {
  if (status === 'idle') {
    return <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>—</span>;
  }
  if (status === 'queued') {
    return <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>Queued</span>;
  }
  if (status === 'generating') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ai)' }}>
        <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
        Polishing
      </span>
    );
  }
  if (status === 'error') {
    return <span style={{ fontSize: 11, color: 'var(--neg)' }}>Error</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ok)' }}>
      <CheckCircle2 size={11} />
      Done
    </span>
  );
}
