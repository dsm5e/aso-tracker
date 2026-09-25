// Group — visual backdrop you put behind a chain of nodes to mark them as a
// logical sequence (e.g. "the 3 overlays that fire after Stitch"). Renders
// underneath other nodes via a low zIndex. Resize with the bottom-right grip.
//
// Sequential execution is already enforced by the topological chain + the
// backend's "upstream is loading" block, so this is purely a visual hint
// for now. Drag-into-group auto-attach + auto-arrange-row is v2.
import { NodeResizeControl } from '@xyflow/react';
import { patchNode } from '../store/graphClient';
import { useState } from 'react';

interface Data {
  label?: string;
  color?: string;     // tint of the backdrop
}

export function GroupNode({ id, data }: { id: string; data: Data }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label ?? 'Group');
  const tint = data.color ?? 'var(--vid-cat-source)';

  async function saveLabel() {
    setEditing(false);
    const v = draft.trim() || null;
    await patchNode(id, { data: { label: v } });
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%', height: '100%',
        // A soft tinted area reads as "container, not card" without an outline.
        background: `color-mix(in srgb, ${tint} 8%, transparent)`,
        borderRadius: 'var(--ds-radius-card)',
        boxSizing: 'border-box',
      }}
    >
      <NodeResizeControl
        position="bottom-right"
        minWidth={400} minHeight={240}
        style={{ background: 'transparent', border: 'none', width: 18, height: 18, right: 2, bottom: 2 }}
      >
        <div style={{
          position: 'absolute', right: 4, bottom: 4,
          width: 10, height: 10,
          borderRight: `2px solid color-mix(in srgb, ${tint} 60%, transparent)`,
          borderBottom: `2px solid color-mix(in srgb, ${tint} 60%, transparent)`,
          borderBottomRightRadius: 2,
          pointerEvents: 'none',
        }} />
      </NodeResizeControl>

      {/* Header label sits at the top-left, doesn't capture clicks elsewhere
          so children can be selected normally. */}
      <div
        className="nodrag"
        style={{
          position: 'absolute', top: 8, left: 14,
          display: 'flex', alignItems: 'center', gap: 8,
          height: 32, padding: '0 10px', boxSizing: 'border-box',
          background: 'var(--ds-panel)',
          borderRadius: 'var(--ds-radius-card)', boxShadow: 'var(--ds-shadow)',
          fontSize: 14, fontWeight: 600,
          color: tint,
          pointerEvents: 'auto',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>▦ Group</span>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="ds-input"
            style={{ height: 26, padding: '0 8px', fontSize: 14, fontWeight: 600, borderRadius: 'var(--ds-radius-inner)' }}
          />
        ) : (
          <span
            onDoubleClick={() => { setDraft(data.label ?? ''); setEditing(true); }}
            title="Double-click to rename"
            style={{ cursor: 'text' }}
          >{data.label || 'Group'}</span>
        )}
      </div>
    </div>
  );
}
