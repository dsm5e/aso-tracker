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
  const tint = data.color ?? '#A855F7';

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
        background: `${tint}10`,           // 6% tint
        border: `2px dashed ${tint}55`,    // dashed to read as "container, not card"
        borderRadius: 14,
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
          borderRight: `2px solid ${tint}99`,
          borderBottom: `2px solid ${tint}99`,
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
          padding: '4px 10px',
          background: 'rgba(15,15,15,0.7)',
          border: `1px solid ${tint}66`,
          borderRadius: 8,
          fontSize: 11, fontWeight: 600,
          color: tint,
          pointerEvents: 'auto',
        }}
      >
        <span style={{ fontSize: 10, opacity: 0.7 }}>▦ GROUP</span>
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
            style={{ background: '#0a0a0a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}
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
