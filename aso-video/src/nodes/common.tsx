// Shared bits for all custom node types.
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { Handle, Position, NodeResizeControl } from '@xyflow/react';
import { patchNode, deleteNode, runNode } from '../store/graphClient';

// Inline editable title — double-click to rename. Saves to data.label on blur
// or Enter; Escape cancels. Empty saves restore the default title.
function EditableTitle({ id, title }: { id: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  function start(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(title);
    setEditing(true);
  }
  async function save() {
    setEditing(false);
    const v = draft.trim();
    // Empty string clears the override; we send null to drop the field.
    await patchNode(id, { data: { label: v || null } });
  }
  function cancel() { setEditing(false); }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') cancel();
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          flex: 1, background: 'var(--ds-input-bg)', color: 'var(--ds-strong)',
          border: '1px solid var(--ds-accent)', borderRadius: 4,
          padding: '2px 6px', fontWeight: 600, fontSize: 12,
          fontFamily: 'inherit', minWidth: 0,
        }}
      />
    );
  }
  return (
    <span
      onDoubleClick={start}
      title="Double-click to rename"
      style={{ flex: 1, cursor: 'text', userSelect: 'none' }}
    >{title}</span>
  );
}

export const COLORS: Record<string, string> = {
  // Role categories (see ds-bridge.css): source / AI generation / compositor / output.
  'reference-image': 'var(--vid-cat-source)',
  'reference-video': 'var(--vid-cat-source)',
  'flux-image': 'var(--vid-cat-gen)',
  'image-gen': 'var(--vid-cat-gen)',
  'image-edit': 'var(--vid-cat-gen)',
  'video-gen': 'var(--vid-cat-gen)',
  'tts-voice': 'var(--vid-cat-gen)',
  captions: 'var(--vid-cat-compose)',
  'split-screen': 'var(--vid-cat-compose)',
  'image-overlay': 'var(--vid-cat-compose)',
  'video-overlay': 'var(--vid-cat-compose)',
  'end-card': 'var(--vid-cat-compose)',
  stitch: 'var(--vid-cat-compose)',
  transcribe: 'var(--vid-cat-compose)',
  group: 'var(--vid-cat-source)',
  output: 'var(--vid-cat-output)',
};

const STATUS_DOT: Record<string, string> = {
  idle: 'var(--ds-s-neutral)',
  loading: 'var(--ds-warn)',
  done: 'var(--ds-good)',
  error: 'var(--ds-bad)',
};

export function StatusDot({ status }: { status?: string }) {
  const color = STATUS_DOT[status ?? 'idle'] ?? STATUS_DOT.idle;
  const pulse = status === 'loading';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 5,
        background: color,
        boxShadow: pulse ? `0 0 6px ${color}` : 'none',
        animation: pulse ? 'asov-pulse 1s ease-in-out infinite' : undefined,
      }}
    />
  );
}

export interface NodeShellProps {
  id: string;
  type: string;
  title: string;
  status?: string;
  /** Optional per-handle `color` (CSS color string) overrides the default gray. */
  inputs?: { id: string; label: string; color?: string }[];
  outputs?: { id: string; label: string; color?: string }[];
  children: ReactNode;
  onRun?: () => void;
  runLabel?: string;
  /** 0..1 from fal.ai progress; undefined = no bar shown. */
  progress?: number;
  /** Short stage label shown next to the progress bar. */
  stage?: string;
  /**
   * Auto-expand the card to a wider max width — e.g. when the prompt textarea
   * has a lot of text. The collapse ▼/▶ icon still works for manual shrink.
   */
  wide?: boolean;
  /** Override the type-based header colour (e.g. character vs asset variants). */
  accentColor?: string;
  /**
   * True when an upstream node is currently `loading` — the Run button is
   * disabled and the card gets a subtle warning tint so the user sees why
   * they can't fire this node yet.
   */
  blocked?: boolean;
}

export function NodeShell({ id, type, title, status, inputs = [], outputs = [], children, onRun, runLabel, progress, stage, wide, accentColor, blocked }: NodeShellProps) {
  void wide;
  const [open, setOpen] = useState(true);
  const headerColor = accentColor ?? COLORS[type] ?? 'var(--ds-muted)';

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--ds-panel)',
        color: 'var(--ds-text)',
        borderRadius: 12,
        boxShadow: 'var(--ds-shadow)',
        // Fill the React Flow wrapper exactly so NodeResizeControl bounds and
        // visible card edges match. The wrapper's width is set by App.tsx
        // (default per type) and updated by NodeResizeControl on drag.
        width: '100%',
        height: '100%',
        minWidth: 200,
        border: '1px solid var(--ds-border)',
        // Category shows as a thin top rule; the card itself stays neutral.
        borderTop: `3px solid ${headerColor}`,
        overflow: 'hidden',
        fontFamily: 'var(--ds-font)',
        fontSize: 12,
        // Flex column so the body can grow to fill the resized card height.
        // Without this, content sat at the top with empty space at the bottom
        // when the user resized vertically.
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {blocked && (
        // Barely-noticeable amber wash — signals the card is waiting on an
        // upstream without screaming for attention.
        <div style={{
          position: 'absolute', inset: 0,
          background: 'color-mix(in srgb, var(--ds-warn) 6%, transparent)',
          borderRadius: 12,
          pointerEvents: 'none',
          zIndex: 1,
        }} />
      )}
      {/* Single subtle resize grip in the bottom-right corner — like a
          <textarea> resize handle. No corner/edge selection markers. */}
      <NodeResizeControl
        position="bottom-right"
        minWidth={240}
        minHeight={120}
        style={{
          background: 'transparent',
          border: 'none',
          width: 18,
          height: 18,
          right: 2,
          bottom: 2,
        }}
      >
        <div style={{
          position: 'absolute', right: 4, bottom: 4,
          width: 10, height: 10,
          borderRight: '2px solid var(--ds-axis)',
          borderBottom: '2px solid var(--ds-axis)',
          borderBottomRightRadius: 2,
          pointerEvents: 'none',
        }} />
      </NodeResizeControl>
      {/* input handles */}
      {inputs.map((h, i) => (
        <Handle
          key={`in-${h.id}`}
          id={h.id}
          type="target"
          position={Position.Left}
          style={{ top: 60 + i * 24, background: h.color ?? 'var(--ds-muted)', width: 10, height: 10, border: h.color ? `2px solid ${h.color}` : '2px solid var(--ds-panel)' }}
        />
      ))}
      {/* output handles */}
      {outputs.map((h, i) => (
        <Handle
          key={`out-${h.id}`}
          id={h.id}
          type="source"
          position={Position.Right}
          style={{ top: 60 + i * 24, background: h.color ?? 'var(--ds-muted)', width: 10, height: 10, border: h.color ? `2px solid ${h.color}` : '2px solid var(--ds-panel)' }}
        />
      ))}

      <div
        style={{
          background: 'var(--ds-panel)',
          borderBottom: '1px solid var(--ds-hairline)',
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--ds-strong)',
          fontWeight: 600,
        }}
      >
        <span
          onClick={() => setOpen((v) => !v)}
          style={{ cursor: 'pointer', fontSize: 10, opacity: 0.85, userSelect: 'none' }}
        >{open ? '▼' : '▶'}</span>
        <EditableTitle id={id} title={title} />
        <StatusDot status={status} />
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Delete node?')) deleteNode(id);
          }}
          title="delete"
          style={{ cursor: 'pointer', fontSize: 11, opacity: 0.85, marginLeft: 4 }}
        >×</span>
      </div>

      {open && (
        // Body fills remaining vertical space below the header. Long prompts
        // / lists stay scrollable inside the resized card; children marked
        // `data-grow` (e.g. prompt textareas) flex-grow inside.
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
          {children}
          {status === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ds-muted)' }}>
                <span>{stage ?? 'working…'}</span>
                <span>{typeof progress === 'number' ? `${Math.round(progress * 100)}%` : ''}</span>
              </div>
              <div style={{ height: 6, background: 'var(--ds-panel-2)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--ds-border)' }}>
                <div
                  style={{
                    height: '100%',
                    width: typeof progress === 'number' ? `${Math.max(2, progress * 100)}%` : '100%',
                    background: headerColor,
                    transition: 'width 0.3s ease',
                    animation: typeof progress === 'number' ? undefined : 'asov-pulse 1.2s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          )}
          {onRun && (
            <button
              className="nodrag"
              onClick={onRun}
              disabled={status === 'loading' || blocked}
              title={blocked ? 'Upstream node hasn\'t finished yet — run it first' : undefined}
              style={{
                ...btnStyle(),
                opacity: blocked ? 0.6 : 1,
                background: blocked ? 'var(--ds-dim)' : btnStyle().background,
                color: blocked ? 'var(--ds-muted)' : btnStyle().color,
                cursor: blocked ? 'not-allowed' : 'pointer',
              }}
            >
              {blocked ? '⏳ wait for upstream' : (status === 'loading' ? '…running' : (runLabel ?? '▶ Run'))}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--ds-input-bg)',
  color: 'var(--ds-text)',
  border: '1px solid var(--ds-border)',
  borderRadius: 'var(--ds-radius-control)',
  padding: '6px 8px',
  fontFamily: 'inherit',
  fontSize: 12,
  boxSizing: 'border-box',
};

/** Stop React Flow from intercepting mousedown on form controls (select dropdowns close otherwise). */
export const stopProp = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

export const labelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--ds-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

export function btnStyle(accent = 'var(--ds-accent)'): CSSProperties {
  return {
    background: accent,
    color: 'var(--ds-on-accent)',
    border: 'none',
    borderRadius: 'var(--ds-radius-control)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
  };
}

// Helper for nodes to commit a data patch back to the server.
export async function patchData(id: string, data: Record<string, unknown>) {
  await patchNode(id, { data });
}

// Optimistically clear previous error/output and flip into loading before
// dispatching the run — the server-side state machine does the same thing,
// but if the run fails fast (validation error in <200ms) the loading flicker
// never reaches the browser and it looks like nothing happened.
//
// Also clears the stale `outputUrl` so downstream nodes can't accidentally
// reuse the previous run's file while this one is mid-flight.
//
// If the server returns an error (e.g. "Upstream X hasn't been run yet"),
// roll back the optimistic loading state and surface the error message as
// both a toast AND on the node itself, so the canvas doesn't pretend the
// node is still running forever.
export async function triggerRun(id: string) {
  await patchNode(id, {
    data: {
      status: 'loading',
      error: null,
      progress: undefined,
      stage: 'pending',
      outputUrl: null,
    },
  });
  try {
    const result = await runNode(id);
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      const msg = String(result.error);
      // Roll back optimistic loading; preserve the message on the node and
      // alert the user immediately so they know WHY nothing happened.
      await patchNode(id, {
        data: { status: 'idle', error: msg, stage: null, progress: undefined },
      });
      showRunError(msg);
    }
  } catch (e) {
    const msg = (e as Error).message || 'run failed';
    await patchNode(id, {
      data: { status: 'idle', error: msg, stage: null, progress: undefined },
    });
    showRunError(msg);
  }
}

// Lightweight toast — single bottom-of-screen banner that fades after 6s.
// Avoids pulling in a toast library for one alert pattern. The element is
// re-used across calls so rapid-fire errors stack visually.
function showRunError(msg: string): void {
  const id = '__aso_video_run_err__';
  let host = document.getElementById(id) as HTMLDivElement | null;
  if (!host) {
    host = document.createElement('div');
    host.id = id;
    Object.assign(host.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '99999', display: 'flex', flexDirection: 'column-reverse', gap: '8px',
      pointerEvents: 'none', maxWidth: 'min(640px, 92vw)',
    } as CSSStyleDeclaration);
    document.body.appendChild(host);
  }
  const item = document.createElement('div');
  item.textContent = `⚠ ${msg}`;
  Object.assign(item.style, {
    background: 'var(--ds-bad-soft)', border: '1px solid var(--ds-bad)', color: 'var(--ds-bad)',
    padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
    boxShadow: 'var(--ds-shadow-pop)', maxWidth: '100%',
    wordBreak: 'break-word', whiteSpace: 'pre-wrap',
    transition: 'opacity 320ms ease, transform 320ms ease',
    opacity: '0', transform: 'translateY(8px)',
  } as CSSStyleDeclaration);
  host.appendChild(item);
  requestAnimationFrame(() => {
    item.style.opacity = '1';
    item.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    setTimeout(() => item.remove(), 360);
  }, 6000);
}
