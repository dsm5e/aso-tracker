import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Link2, Link2Off, Plus, Smartphone, Sparkles, Tablet, Trash2, Wand2 } from 'lucide-react';
import { Button, Pill } from '../shared';
import { useStudio, type Screenshot } from '../../state/studio';

export function ScreenshotSidebar() {
  const {
    screenshots,
    activeScreenshotId,
    setActiveScreenshot,
    reorderScreenshots,
    addScreenshot,
    removeScreenshot,
    selectedPresetId,
    multiSelect,
    toggleMultiSelect,
    clearMultiSelect,
    pairSelected,
    unpairGroup,
    devices,
    previewDevice,
    setPreviewDevice,
    addIpadVariant,
  } = useStudio();

  // Filter slots by current device view
  const visibleScreenshots = screenshots.filter((s) =>
    previewDevice === 'ipad' ? s.device === 'ipad' : !s.device || s.device === 'iphone',
  );

  const hasIpadSlots = screenshots.some((s) => s.device === 'ipad');

  const active = visibleScreenshots.find((s) => s.id === activeScreenshotId);
  const activeGroup = active?.groupId;
  const groupSize = activeGroup ? visibleScreenshots.filter((s) => s.groupId === activeGroup).length : 0;

  const handleRowClick = (id: string, shiftKey: boolean) => {
    if (shiftKey) toggleMultiSelect(id);
    else {
      setActiveScreenshot(id);
      if (multiSelect.length) clearMultiSelect();
    }
  };

  const onPair = () => {
    if (multiSelect.length < 2) return;
    if (!confirm(`Pair ${multiSelect.length} slots into one cross-group? Their device positions will sync to display a single shared phone.`)) return;
    pairSelected();
  };

  const onUnpair = () => {
    if (!activeGroup) return;
    if (!confirm('Unpair this group? Each slot becomes independently positionable again.')) return;
    unpairGroup(activeGroup);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.over.id === e.active.id) return;
    const oldIndex = visibleScreenshots.findIndex((s) => s.id === e.active.id);
    const newIndex = visibleScreenshots.findIndex((s) => s.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    reorderScreenshots(arrayMove(visibleScreenshots, oldIndex, newIndex).map((s) => s.id));
  };

  const handleAdd = () => {
    const ss = addScreenshot({
      presetId: selectedPresetId || '',
      device: previewDevice,
    });
    setActiveScreenshot(ss.id);
  };

  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        borderRight: '1px solid var(--line-1)',
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--line-1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--fg-2)',
            }}
          >
            Screenshots
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{visibleScreenshots.length} / 10</span>
        </div>
        {/* Device tabs — shown when project has both devices */}
        {devices === 'both' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {(['iphone', 'ipad'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setPreviewDevice(d);
                  // Auto-select first slot of the switched device
                  const first = screenshots.find((s) =>
                    d === 'ipad' ? s.device === 'ipad' : !s.device || s.device === 'iphone',
                  );
                  if (first) setActiveScreenshot(first.id);
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '5px 0',
                  borderRadius: 'var(--r-2)',
                  border: 'none',
                  background: previewDevice === d ? 'var(--accent)' : 'var(--bg-2)',
                  color: previewDevice === d ? 'var(--accent-fg)' : 'var(--fg-2)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all .1s',
                }}
              >
                {d === 'iphone' ? <Smartphone size={11} /> : <Tablet size={11} />}
                {d === 'iphone' ? 'iPhone' : 'iPad'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {(() => {
          // Only ONE hero per template — once an 'action' slot exists, the button
          // becomes disabled (greyed out) so the user can't accidentally add a second.
          const heroExists = visibleScreenshots.some((s) => s.kind === 'action');
          return (
            <button
              type="button"
              disabled={heroExists}
              onClick={() => {
                if (heroExists) return;
                const ss = addScreenshot(
                  { kind: 'action', presetId: selectedPresetId || '', device: previewDevice },
                  { atIndex: 0 },
                );
                setActiveScreenshot(ss.id);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                marginBottom: 8,
                border: '1px dashed var(--ai)',
                borderRadius: 'var(--r-3)',
                background: 'var(--ai-soft)',
                color: 'var(--ai)',
                cursor: heroExists ? 'not-allowed' : 'pointer',
                opacity: heroExists ? 0.4 : 1,
                fontSize: 12,
                fontWeight: 600,
              }}
              title={
                heroExists
                  ? 'A hero already exists in this template — only one allowed'
                  : 'Hero / selling screenshot — fully AI-generated from text intent'
              }
            >
              <Wand2 size={14} />
              {heroExists ? 'Hero already added' : 'Add hero (AI)'}
              <Sparkles size={11} style={{ marginLeft: 'auto' }} />
            </button>
          );
        })()}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visibleScreenshots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(() => {
                // Bucket consecutive paired rows into a wrapper that draws a vertical
                // accent line + lock icon along their left edges — visual confirmation
                // that they're one shared phone.
                const out: React.ReactNode[] = [];
                let i = 0;
                while (i < visibleScreenshots.length) {
                  const s = visibleScreenshots[i];
                  const isGrouped = !!s.groupId;
                  if (!isGrouped) {
                    out.push(
                      <SortableRow
                        key={s.id}
                        ss={s}
                        active={s.id === activeScreenshotId}
                        selected={multiSelect.includes(s.id)}
                        onSelect={(e) => handleRowClick(s.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                        onRemove={() => removeScreenshot(s.id)}
                      />,
                    );
                    i++;
                    continue;
                  }
                  // Collect run of consecutive members of this group
                  const group: typeof visibleScreenshots = [];
                  while (i < visibleScreenshots.length && visibleScreenshots[i].groupId === s.groupId) {
                    group.push(visibleScreenshots[i]);
                    i++;
                  }
                  out.push(
                    <div
                      key={s.groupId}
                      style={{
                        position: 'relative',
                        paddingLeft: 16,
                        margin: '4px 0',
                      }}
                    >
                      {/* Vertical chain line */}
                      <div
                        style={{
                          position: 'absolute',
                          left: 5,
                          top: 8,
                          bottom: 8,
                          width: 2,
                          background: 'var(--accent)',
                          borderRadius: 1,
                        }}
                      />
                      {/* Lock badge at the top of the line */}
                      <div
                        style={{
                          position: 'absolute',
                          left: -1,
                          top: 0,
                          width: 14,
                          height: 14,
                          borderRadius: 999,
                          background: 'var(--accent)',
                          display: 'grid',
                          placeItems: 'center',
                          color: 'var(--accent-fg)',
                        }}
                        title={`Paired (${group.length} slots — one shared phone)`}
                      >
                        <Link2 size={9} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {group.map((g) => (
                          <SortableRow
                            key={g.id}
                            ss={g}
                            active={g.id === activeScreenshotId}
                            selected={multiSelect.includes(g.id)}
                            onSelect={(e) => handleRowClick(g.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                            onRemove={() => removeScreenshot(g.id)}
                          />
                        ))}
                      </div>
                    </div>,
                  );
                }
                return out;
              })()}
            </div>
          </SortableContext>
        </DndContext>

        {visibleScreenshots.length === 0 && (
          <div style={{ padding: 16, color: 'var(--fg-3)', fontSize: 12, textAlign: 'center' }}>
            {previewDevice === 'ipad'
              ? 'No iPad slots yet. They were copied from iPhone — check your device toggle.'
              : 'No screenshots yet. Add your first to get started.'}
          </div>
        )}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--line-1)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Pair button — appears once 2+ slots are shift-selected */}
        {multiSelect.length >= 2 && (
          <Button
            variant="primary"
            onClick={onPair}
            leftIcon={<Link2 size={14} />}
            style={{ width: '100%', justifyContent: 'center', height: 32 }}
            title="Make these slots share a single device — moves & tilt sync, sourceUrl mirrors"
          >
            Pair {multiSelect.length} slots
          </Button>
        )}
        {/* Unpair — when standing on a paired slot */}
        {activeGroup && groupSize >= 2 && (
          <Button
            variant="ghost"
            onClick={onUnpair}
            leftIcon={<Link2Off size={14} />}
            style={{ width: '100%', justifyContent: 'center', height: 32 }}
            title="Break this cross-group apart"
          >
            Unpair group ({groupSize})
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={handleAdd}
          leftIcon={<Plus size={14} />}
          style={{ width: '100%', justifyContent: 'center', height: 32 }}
          title="Adds an empty slot — drop a screenshot inside the phone in the canvas"
        >
          Add screen
        </Button>
        {/* Add iPad — visible when project is iPhone-only and no iPad slots exist yet */}
        {devices !== 'both' && !hasIpadSlots && (
          <Button
            variant="ghost"
            onClick={addIpadVariant}
            leftIcon={<Tablet size={14} />}
            style={{ width: '100%', justifyContent: 'center', height: 32, color: 'var(--fg-2)' }}
            title="Copy all iPhone slots to iPad — content and text are inherited, AI images reset for regeneration"
          >
            + Add iPad
          </Button>
        )}
        {multiSelect.length === 1 && (
          <span style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'center' }}>
            Shift-click another slot to pair them
          </span>
        )}
      </div>
    </aside>
  );
}

function SortableRow({
  ss,
  active,
  selected,
  onSelect,
  onRemove,
}: {
  ss: Screenshot;
  active: boolean;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ss.id,
  });

  const isHero = ss.kind === 'action';
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: selected
      ? 'inset 0 0 0 2px var(--accent)'
      : isHero
        ? 'inset 0 0 0 1px var(--ai), 0 0 0 1px var(--ai-soft)'
        : undefined,
    // Hero gets a subtle purple-tinted bg so it stands out as the only "selling" screen.
    background: isHero ? 'var(--ai-soft)' : undefined,
    // Hard-clip overflow so screenshot thumbnails can't bleed into adjacent rows.
    overflow: 'hidden',
    // Reserve enough vertical space for the 60-px thumbnail + breathing room.
    minHeight: 76,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`list-row ${active ? 'active' : ''}`}
      role="button"
      title={
        isHero
          ? 'Hero / Action screen — first selling screenshot'
          : ss.groupId
            ? `Paired (group ${ss.groupId})`
            : undefined
      }
    >
      <span
        {...attributes}
        {...listeners}
        style={{ display: 'flex', cursor: 'grab', color: isHero ? 'var(--ai)' : 'var(--fg-3)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {isHero ? <Sparkles size={14} /> : <GripVertical size={14} />}
      </span>
      <div
        style={{
          width: 36,
          height: 60,
          borderRadius: 6,
          background: '#000',
          flex: '0 0 36px',
          overflow: 'hidden',
          border: '1px solid var(--line-2)',
          alignSelf: 'center',
          position: 'relative',
        }}
      >
        {/* Hero rows show their AI-generated render once it exists — that's the
            asset that flows downstream into AI Polish / Locales / Export. Falls
            back to the user's inner sourceUrl screenshot for regular slots. */}
        {(() => {
          const aiUrl = ss.kind === 'action' ? ss.action?.aiImageUrl : null;
          const thumbSrc = aiUrl ?? ss.sourceUrl;
          if (!thumbSrc) return null;
          return (
            <img
              src={thumbSrc}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          );
        })()}
        {ss.kind === 'action' && ss.action?.aiImageUrl && (
          <span
            style={{
              position: 'absolute',
              bottom: 2, right: 2,
              width: 10, height: 10,
              borderRadius: 999,
              background: 'var(--ai)',
              boxShadow: '0 0 0 1.5px var(--bg-1)',
            }}
            title="AI-generated render — used downstream"
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ss.headline.verb || ss.filename || 'Untitled'}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--fg-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ss.headline.descriptor || 'no descriptor'}
        </span>
      </div>
      {ss.enhanceState === 'done' && (
        <Pill variant="ai">
          <Sparkles size={10} />
        </Pill>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          appearance: 'none',
          border: 0,
          background: 'transparent',
          color: 'var(--fg-3)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
        title="Remove"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
