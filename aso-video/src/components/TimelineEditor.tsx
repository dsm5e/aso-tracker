import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, GraphPayload } from '../store/types';
import { runNode as runGraphNode } from '../store/graphClient';

type Layout = { x: number; y: number; width: number; height: number; opacity: number };
type TimelineData = {
  start: number;
  duration: number;
  track: number;
  role?: 'video' | 'overlay' | 'audio';
  label?: string;
  layout?: Partial<Layout>;
};
type TransitionData = { type: 'slide-bounce-up' | 'mask-wipe'; duration: number };

const PX_PER_SECOND = 74;
const TRACK_HEIGHT = 52;
const TRACKS = ['V1 · Main', 'V2 · Generated', 'V3 · UI / Mask', 'T1 · Text', 'A1 · SFX'];
// Track colours — categorical, from the DS series.
const COLORS = ['var(--ds-c1)', 'var(--ds-c3)', 'var(--ds-c2)', 'var(--ds-c4)', 'var(--ds-muted)'];

function timelineOf(node: GraphNode): TimelineData | null {
  const raw = node.data.timeline as Partial<TimelineData> | undefined;
  if (!raw || typeof raw.start !== 'number' || typeof raw.duration !== 'number') return null;
  return {
    start: Math.max(0, raw.start),
    duration: Math.max(0.1, raw.duration),
    track: Math.max(0, Math.min(TRACKS.length - 1, raw.track ?? 0)),
    role: raw.role ?? 'video',
    label: raw.label,
    layout: raw.layout,
  };
}

function mediaUrl(node: GraphNode): string | undefined {
  const d = node.data as { outputUrl?: string; url?: string };
  return d.outputUrl ?? d.url;
}

function transitionOf(node: GraphNode): TransitionData | null {
  const raw = node.data.transitionIn as Partial<TransitionData> | undefined;
  if (!raw || (raw.type !== 'slide-bounce-up' && raw.type !== 'mask-wipe')) return null;
  return { type: raw.type, duration: Math.max(0.06, Number(raw.duration) || 0.22) };
}

function defaultLayout(track: number): Layout {
  return track <= 1
    ? { x: 0, y: 0, width: 100, height: 100, opacity: 1 }
    : { x: 8, y: 12, width: 84, height: 42, opacity: 1 };
}

function resolvedLayout(t: TimelineData): Layout {
  return { ...defaultLayout(t.track), ...(t.layout ?? {}) };
}

export function TimelineEditor({
  graph,
  changedIds,
  onPatch,
}: {
  graph: GraphPayload;
  changedIds?: Set<string>;
  onPatch: (id: string, data: Record<string, unknown>) => Promise<unknown>;
}) {
  const clips = useMemo(
    () => graph.nodes
      .map((node) => ({ node, timeline: timelineOf(node) }))
      .filter((x): x is { node: GraphNode; timeline: TimelineData } => !!x.timeline),
    [graph],
  );
  const duration = Math.max(18, ...clips.map((x) => x.timeline.start + x.timeline.duration));
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(clips[0]?.node.id ?? null);
  const [previewMode, setPreviewMode] = useState<'photo' | 'video'>('photo');
  const [videoAction, setVideoAction] = useState<'idle' | 'approving' | 'generating'>('idle');
  const [draft, setDraft] = useState<Record<string, TimelineData>>({});
  const raf = useRef<number | null>(null);
  const lastTick = useRef(0);
  const timelineSurfaceRef = useRef<HTMLDivElement>(null);

  const effective = (id: string, original: TimelineData) => draft[id] ?? original;
  const selected = clips.find((x) => x.node.id === selectedId) ?? null;
  const selectedTimeline = selected ? effective(selected.node.id, selected.timeline) : null;
  const linkedVideo = useMemo(() => {
    if (!selected) return null;
    const edge = graph.edges.find((item) => item.source === selected.node.id
      && item.targetHandle?.startsWith('image_url'));
    return edge ? graph.nodes.find((node) => node.id === edge.target && node.type === 'video-gen') ?? null : null;
  }, [graph.edges, graph.nodes, selected]);
  const selectedPhotoUrl = selected ? mediaUrl(selected.node) : undefined;
  const linkedVideoUrl = linkedVideo ? mediaUrl(linkedVideo) : undefined;
  const selectedTransition = selected ? transitionOf(selected.node) : null;
  const approvedImageUrl = linkedVideo?.data.approvedImageUrl as string | null | undefined;
  const videoSourceUrl = linkedVideo?.data.sourceImageUrl as string | null | undefined;
  const photoApproved = !!selectedPhotoUrl && approvedImageUrl === selectedPhotoUrl;
  const videoFresh = !!linkedVideoUrl && !!selectedPhotoUrl && videoSourceUrl === selectedPhotoUrl;

  useEffect(() => {
    const disposers: Array<() => void> = [];
    for (const node of graph.nodes) {
      const urls = [
        mediaUrl(node),
        (node.data.motionDesign as { sourceUrl?: string } | undefined)?.sourceUrl,
      ].filter((url): url is string => !!url);
      for (const url of urls) {
        if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) {
          const image = new Image();
          image.decoding = 'async';
          image.src = url;
          void image.decode().catch(() => {});
        } else if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) {
          const video = document.createElement('video');
          video.preload = 'auto';
          video.muted = true;
          video.src = url;
          video.load();
          disposers.push(() => {
            video.removeAttribute('src');
            video.load();
          });
        }
      }
    }
    return () => disposers.forEach((dispose) => dispose());
  }, [graph.nodes]);

  useEffect(() => {
    setPreviewMode('photo');
  }, [selectedId]);

  async function approveSelectedPhoto() {
    if (!linkedVideo || !selectedPhotoUrl) return;
    setVideoAction('approving');
    try {
      await onPatch(linkedVideo.id, {
        approvedImageUrl: selectedPhotoUrl,
        error: undefined,
      });
    } finally {
      setVideoAction('idle');
    }
  }

  async function generateLinkedVideo() {
    if (!linkedVideo || !photoApproved) return;
    setVideoAction('generating');
    try {
      await runGraphNode(linkedVideo.id);
    } finally {
      setVideoAction('idle');
    }
  }

  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    lastTick.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTick.current) / 1000;
      lastTick.current = now;
      setPlayhead((p) => {
        const next = p + dt;
        if (next >= duration) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, duration]);

  async function commit(node: GraphNode, timeline: TimelineData) {
    setDraft((cur) => {
      const next = { ...cur };
      delete next[node.id];
      return next;
    });
    await onPatch(node.id, { timeline });
  }

  function beginTimelineDrag(e: React.PointerEvent, node: GraphNode, original: TimelineData, mode: 'move' | 'trim-left' | 'trim-right') {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(node.id);
    const startX = e.clientX;
    const initial = effective(node.id, original);
    let latest = initial;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / PX_PER_SECOND;
      if (mode === 'move') latest = { ...initial, start: Math.max(0, initial.start + delta) };
      if (mode === 'trim-left') {
        const start = Math.max(0, Math.min(initial.start + initial.duration - 0.1, initial.start + delta));
        latest = { ...initial, start, duration: initial.duration + initial.start - start };
      }
      if (mode === 'trim-right') latest = { ...initial, duration: Math.max(0.1, initial.duration + delta) };
      setDraft((cur) => ({ ...cur, [node.id]: latest }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void commit(node, latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function beginCanvasDrag(e: React.PointerEvent, node: GraphNode, original: TimelineData) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(node.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const initial = effective(node.id, original);
    const layout = resolvedLayout(initial);
    let latest = initial;
    const move = (ev: PointerEvent) => {
      const nextLayout = {
        ...layout,
        x: Math.max(-50, Math.min(150, layout.x + (ev.clientX - startX) / 3.2)),
        y: Math.max(-50, Math.min(150, layout.y + (ev.clientY - startY) / 5.7)),
      };
      latest = { ...initial, layout: nextLayout };
      setDraft((cur) => ({ ...cur, [node.id]: latest }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void commit(node, latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function beginPlayheadDrag(e: React.PointerEvent<HTMLElement>) {
    e.preventDefault();
    const seek = (clientX: number) => {
      const surface = timelineSurfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      setPlayhead(Math.max(0, Math.min(duration, (clientX - rect.left) / PX_PER_SECOND)));
    };
    seek(e.clientX);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const active = clips
    .map((x) => ({ ...x, timeline: effective(x.node.id, x.timeline) }))
    .filter((x) => playhead >= x.timeline.start && playhead < x.timeline.start + x.timeline.duration)
    .sort((a, b) => a.timeline.track - b.timeline.track);

  return (
    <div className="timeline-editor" style={{ position: 'absolute', top: 'var(--vid-chrome-top, 76px)', right: 0, bottom: 0, left: 'var(--aso-library-width, 40px)', display: 'grid', background: 'var(--ds-bg)', minHeight: 0 }}>
      <div className="timeline-preview-row" style={{ minHeight: 0 }}>
        <div style={{ display: 'grid', placeItems: 'center', padding: 16, overflow: 'hidden' }}>
          <div className="timeline-stage" style={{ aspectRatio: '9 / 16', position: 'relative', overflow: 'hidden', background: '#050505', boxShadow: 'var(--ds-shadow-pop)', borderRadius: 8 }}>
            {active.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ds-subtle)', fontSize: 12 }}>Move the playhead onto a clip</div>
            )}
            {active.filter(({ node, timeline }) => timeline.role === 'audio' && !!mediaUrl(node)).map(({ node, timeline }) => (
              <SyncedAudio
                key={`audio-${node.id}`}
                src={mediaUrl(node)!}
                time={Math.max(0, playhead - timeline.start)}
                playing={playing}
                volume={typeof node.data.volume === 'number' ? node.data.volume : 1}
              />
            ))}
            {active.map(({ node, timeline }) => {
              // Audio nodes only occupy timeline tracks. They are never visual
              // layers, even while selected or when their source URL is a
              // video container.
              if (timeline.role === 'audio') return null;
              const url = mediaUrl(node);
              const motion = node.data.motionDesign as { kind?: string; sourceUrl?: string } | undefined;
              const localTime = Math.max(0, playhead - timeline.start);
              if (motion?.kind) {
                return (
                  <MotionDesignLayer
                    key={node.id}
                    kind={motion.kind}
                    time={localTime}
                    duration={timeline.duration}
                    transition={transitionOf(node)}
                    playing={playing}
                    sourceUrl={motion.sourceUrl ?? '/video/hair-app/model-master-v1.png'}
                    selected={selectedId === node.id}
                    onPointerDown={(e) => beginCanvasDrag(e, node, timeline)}
                  />
                );
              }
              // Empty compositor/text/UI nodes are planning placeholders. Do
              // not paint coloured boxes into the final-frame preview: they
              // become visible only after a real render/upload exists.
              if (!url) return null;
              const layout = resolvedLayout(timeline);
              const style: React.CSSProperties = {
                position: 'absolute',
                left: `${layout.x}%`,
                top: `${layout.y}%`,
                width: `${layout.width}%`,
                height: `${layout.height}%`,
                opacity: layout.opacity,
                objectFit: 'cover',
                cursor: 'move',
                outline: selectedId === node.id ? '2px solid var(--ds-accent)' : 'none',
                zIndex: timeline.track + 1,
              };
              if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) {
                const isResultFrame = String(timeline.label ?? '').startsWith('Result ');
                const transition = transitionOf(node);
                const maskDuration = transition?.type === 'mask-wipe' ? transition.duration : 0.22;
                const maskProgress = Math.max(0, Math.min(1, localTime / maskDuration));
                const previous = isResultFrame
                  ? clips
                    .map((item) => ({ ...item, timeline: effective(item.node.id, item.timeline) }))
                    .filter((item) => item.timeline.role === 'video'
                      && item.timeline.track === timeline.track
                      && item.timeline.start < timeline.start
                      && item.timeline.start + item.timeline.duration <= timeline.start + 0.001)
                    .sort((a, b) => (b.timeline.start + b.timeline.duration) - (a.timeline.start + a.timeline.duration))[0]
                  : undefined;
                const previousUrl = previous ? mediaUrl(previous.node) : undefined;
                if (previousUrl && transition?.type === 'mask-wipe' && maskProgress < 1) {
                  const edgeTop = Math.min(104, maskProgress * 108);
                  const edgeBottom = Math.max(-12, edgeTop - 16);
                  return (
                    <Fragment key={node.id}>
                      <img
                        src={url}
                        alt=""
                        draggable={false}
                        style={{
                          ...style,
                          zIndex: timeline.track + 1.4,
                          clipPath: `polygon(0 0, ${edgeTop}% 0, ${edgeBottom}% 100%, 0 100%)`,
                        }}
                        onPointerDown={(e) => beginCanvasDrag(e, node, timeline)}
                      />
                      <img
                        src={previousUrl}
                        alt=""
                        draggable={false}
                        style={{
                          ...style,
                          zIndex: timeline.track + 1.3,
                          clipPath: `polygon(${edgeTop}% 0, 100% 0, 100% 100%, ${edgeBottom}% 100%)`,
                          pointerEvents: 'none',
                        }}
                      />
                      <div style={{
                        position: 'absolute',
                        top: `${layout.y}%`,
                        height: `${layout.height}%`,
                        left: `${layout.x + layout.width * (edgeBottom / 100)}%`,
                        width: `${layout.width * 0.17}%`,
                        zIndex: timeline.track + 1.6,
                        transform: 'skewX(-9deg)',
                        transformOrigin: '50% 50%',
                        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,.08) 20%, rgba(255,255,255,.38) 38%, rgba(255,255,255,.78) 50%, rgba(255,255,255,.38) 62%, rgba(255,255,255,.08) 80%, transparent 100%)',
                        filter: 'blur(2.8px)',
                        pointerEvents: 'none',
                      }} />
                    </Fragment>
                  );
                }
                return <img key={node.id} src={url} alt="" draggable={false} style={style} onPointerDown={(e) => beginCanvasDrag(e, node, timeline)} />;
              }
              return <SyncedVideo key={node.id} src={url} time={localTime} playing={playing} style={style} onPointerDown={(e) => beginCanvasDrag(e, node, timeline)} />;
            })}
          </div>
        </div>
        <div className="timeline-inspector" style={{ padding: 16, overflowY: 'auto', background: 'var(--ds-panel)', borderRadius: 'var(--ds-radius-card)', boxShadow: 'var(--ds-shadow)', minWidth: 0 }}>
          <div className="ds-card-title" style={{ marginBottom: 8 }}>Inspector</div>
          {!selected || !selectedTimeline ? <div className="ds-note">Select a clip.</div> : (
            <>
              <div style={{ fontSize: 14, color: 'var(--ds-strong)', fontWeight: 600, marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedTimeline.label ?? String(selected.node.data.label ?? selected.node.type)}</div>
              {linkedVideo && selectedPhotoUrl && (
                <div style={{ padding: 12, marginBottom: 12, borderRadius: 'var(--ds-radius-card)', background: 'var(--ds-panel-2)' }}>
                  <div className="ds-seg" role="tablist" style={{ display: 'flex', marginBottom: 10 }}>
                    {(['photo', 'video'] as const).map((mode) => (
                      <button
                        key={mode}
                        role="tab"
                        aria-selected={previewMode === mode}
                        onClick={() => setPreviewMode(mode)}
                        style={{ flex: 1 }}
                      >
                        {mode === 'photo' ? 'Photo' : 'Video'}
                      </button>
                    ))}
                  </div>
                  <div style={{ width: 84, maxWidth: '100%', aspectRatio: '9 / 16', margin: '0 auto', overflow: 'hidden', borderRadius: 'var(--ds-radius-inner)', background: '#050505', position: 'relative' }}>
                    {previewMode === 'video' && videoFresh
                      ? <video src={linkedVideoUrl} controls muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <img src={selectedPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    {previewMode === 'video' && !videoFresh && (
                      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 18, textAlign: 'center', background: '#050505b8', color: '#fbbf24', fontSize: 11 }}>
                        {linkedVideoUrl ? 'Video is stale — approve and regenerate from this photo' : 'No video generated for this photo yet'}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <button
                      className="ds-btn ds-btn-sm"
                      onClick={approveSelectedPhoto}
                      disabled={photoApproved || videoAction !== 'idle'}
                      style={{ flex: '1 1 auto', color: photoApproved ? 'var(--ds-good)' : undefined }}
                    >
                      {photoApproved ? '✓ Approved' : videoAction === 'approving' ? 'Approving…' : 'Approve photo'}
                    </button>
                    <button
                      className="ds-btn ds-btn-sm ds-btn-primary"
                      onClick={generateLinkedVideo}
                      disabled={!photoApproved || videoAction !== 'idle'}
                      style={{ flex: '1 1 auto' }}
                    >
                      {videoAction === 'generating' ? 'Starting…' : videoFresh ? 'Regenerate' : 'Generate video'}
                    </button>
                  </div>
                  <div style={{ marginTop: 8, color: videoFresh ? 'var(--ds-good)' : photoApproved ? 'var(--ds-warn)' : 'var(--ds-muted)', fontSize: 12, lineHeight: '17px' }}>
                    {videoFresh ? 'Video matches the current photo' : photoApproved ? 'Photo approved; video is ready to generate' : 'Approval prevents accidental paid generations'}
                  </div>
                </div>
              )}
              {selectedTransition && (
                <div style={{ padding: 12, marginBottom: 12, borderRadius: 'var(--ds-radius-card)', background: 'var(--ds-warn-soft)' }}>
                  <div style={{ color: 'var(--ds-warn)', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                    Transition · {selectedTransition.type === 'mask-wipe' ? 'Mask wipe' : 'Slide bounce up'}
                  </div>
                  <Field
                    label="Duration"
                    value={selectedTransition.duration}
                    step={0.02}
                    onChange={(duration) => onPatch(selected.node.id, {
                      transitionIn: { ...selectedTransition, duration: Math.max(0.06, duration) },
                    })}
                  />
                </div>
              )}
              <Field label="Start" value={selectedTimeline.start} step={0.1} onChange={(v) => commit(selected.node, { ...selectedTimeline, start: Math.max(0, v) })} />
              <Field label="Duration" value={selectedTimeline.duration} step={0.1} onChange={(v) => commit(selected.node, { ...selectedTimeline, duration: Math.max(0.1, v) })} />
              <Field label="Track" value={selectedTimeline.track + 1} step={1} onChange={(v) => commit(selected.node, { ...selectedTimeline, track: Math.max(0, Math.min(TRACKS.length - 1, Math.round(v) - 1)) })} />
              <div className="vid-label" style={{ margin: '16px 0 8px' }}>Layout</div>
              {(['x', 'y', 'width', 'height', 'opacity'] as const).map((key) => (
                <Field
                  key={key}
                  label={key}
                  value={resolvedLayout(selectedTimeline)[key]}
                  step={key === 'opacity' ? 0.05 : 1}
                  onChange={(v) => commit(selected.node, { ...selectedTimeline, layout: { ...resolvedLayout(selectedTimeline), [key]: v } })}
                />
              ))}
              <div className="ds-note" style={{ marginTop: 12 }}>Drag the selected layer in the preview. Drag clip body to move; drag its edges to trim.</div>
            </>
          )}
        </div>
      </div>

      <div className="timeline-tracks" style={{ background: 'var(--ds-panel)', borderRadius: 'var(--ds-radius-card)', boxShadow: 'var(--ds-shadow)', overflow: 'hidden', display: 'grid', gridTemplateRows: '48px 1fr', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <button className="ds-btn ds-btn-sm" onClick={() => setPlaying((v) => !v)} title={playing ? 'Pause' : 'Play'} style={{ width: 32, padding: 0 }}>{playing ? 'Ⅱ' : '▶'}</button>
          <button className="ds-btn ds-btn-sm" onClick={() => { setPlaying(false); setPlayhead(0); }} title="Stop" style={{ width: 32, padding: 0 }}>■</button>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 500, color: 'var(--ds-text)', minWidth: 70 }}>{playhead.toFixed(2)}s</span>
          <input type="range" min={0} max={duration} step={1 / 30} value={playhead} onChange={(e) => setPlayhead(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--ds-accent)' }} />
          <span className="vid-meta">30 fps · {duration.toFixed(1)}s</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '116px 1fr', minHeight: 0, overflow: 'auto' }}>
          <div style={{ paddingTop: 26, background: 'var(--ds-panel-2)', position: 'sticky', left: 0, zIndex: 5 }}>
            <div style={{ height: 30, padding: '9px 10px', boxSizing: 'border-box', color: 'var(--ds-warn)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>FX · Transitions</div>
            {TRACKS.map((track, i) => <div key={track} style={{ height: TRACK_HEIGHT, padding: '17px 10px', boxSizing: 'border-box', background: i % 2 ? 'var(--vid-row-alt-2)' : undefined, fontSize: 12, fontWeight: 500, color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>{track}</div>)}
          </div>
          <div ref={timelineSurfaceRef} style={{ position: 'relative', minWidth: duration * PX_PER_SECOND, paddingTop: 26 }}>
            <div onPointerDown={beginPlayheadDrag} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 26, cursor: 'ew-resize', touchAction: 'none', background: 'var(--ds-panel-2)' }}>
              {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => <span key={i} style={{ position: 'absolute', left: i * PX_PER_SECOND, top: 6, fontSize: 11, color: 'var(--ds-subtle)', borderLeft: '1px solid var(--ds-axis)', paddingLeft: 3 }}>{i}s</span>)}
            </div>
            <div style={{ height: 30, position: 'relative', background: 'color-mix(in srgb, var(--ds-panel-2) 50%, var(--ds-panel))' }}>
              {clips.map(({ node, timeline: original }) => {
                const transition = transitionOf(node);
                if (!transition) return null;
                const timeline = effective(node.id, original);
                return (
                  <button
                    key={`transition-${node.id}`}
                    onClick={() => setSelectedId(node.id)}
                    title={`${transition.type} · ${transition.duration.toFixed(2)}s`}
                    style={{
                      position: 'absolute',
                      left: timeline.start * PX_PER_SECOND,
                      top: 4,
                      width: Math.max(24, transition.duration * PX_PER_SECOND),
                      height: 22,
                      padding: '0 6px',
                      borderRadius: 'var(--ds-radius-inner)',
                      border: selectedId === node.id ? '1px solid var(--ds-strong)' : '1px solid transparent',
                      background: transition.type === 'mask-wipe' ? 'var(--ds-c2)' : 'var(--ds-c4)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                    }}
                  >
                    {transition.type === 'mask-wipe' ? 'Mask' : 'Bounce'}
                  </button>
                );
              })}
            </div>
            {TRACKS.map((_, track) => (
              <div key={track} style={{ height: TRACK_HEIGHT, position: 'relative', backgroundColor: track % 2 ? 'var(--vid-row-alt)' : undefined, backgroundImage: `repeating-linear-gradient(90deg, transparent 0, transparent ${PX_PER_SECOND - 1}px, var(--ds-grid) ${PX_PER_SECOND}px)` }}>
                {clips.filter((x) => effective(x.node.id, x.timeline).track === track).map(({ node, timeline: original }) => {
                  const timeline = effective(node.id, original);
                  return (
                    <div
                      key={node.id}
                      onPointerDown={(e) => beginTimelineDrag(e, node, timeline, 'move')}
                      onClick={() => setSelectedId(node.id)}
                      style={{
                        position: 'absolute', left: timeline.start * PX_PER_SECOND, top: 6,
                        width: Math.max(18, timeline.duration * PX_PER_SECOND), height: TRACK_HEIGHT - 12,
                        borderRadius: 'var(--ds-radius-inner)', background: COLORS[track], border: selectedId === node.id ? '2px solid var(--ds-strong)' : '1px solid transparent',
                        boxSizing: 'border-box', overflow: 'hidden', cursor: 'grab',
                        boxShadow: changedIds?.has(node.id)
                          ? '0 0 0 2px var(--ds-accent), var(--ds-shadow-pop)'
                          : 'var(--ds-shadow)',
                        transition: 'box-shadow 180ms ease, filter 180ms ease',
                        filter: changedIds?.has(node.id) ? 'brightness(1.28)' : 'none',
                      }}
                    >
                      <div onPointerDown={(e) => beginTimelineDrag(e, node, timeline, 'trim-left')} style={{ position: 'absolute', inset: '0 auto 0 0', width: 7, cursor: 'ew-resize', background: '#ffffff44' }} />
                      <span style={{ display: 'block', padding: '11px 12px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }}>{timeline.label ?? String(node.data.label ?? node.type)}</span>
                      <div onPointerDown={(e) => beginTimelineDrag(e, node, timeline, 'trim-right')} style={{ position: 'absolute', inset: '0 0 0 auto', width: 7, cursor: 'ew-resize', background: '#ffffff44' }} />
                    </div>
                  );
                })}
              </div>
            ))}
            <div onPointerDown={beginPlayheadDrag} style={{ position: 'absolute', left: playhead * PX_PER_SECOND, top: 0, bottom: 0, width: 9, transform: 'translateX(-4px)', background: 'transparent', cursor: 'ew-resize', touchAction: 'none', zIndex: 10 }}>
              <div style={{ position: 'absolute', left: 4, top: 0, bottom: 0, width: 1, background: 'var(--ds-bad)', pointerEvents: 'none' }} />
              <div style={{ width: 9, height: 9, background: 'var(--ds-bad)', transform: 'rotate(45deg)', pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MotionDesignLayer({
  kind,
  time,
  duration,
  transition,
  playing,
  sourceUrl,
  selected,
  onPointerDown,
}: {
  kind: string;
  time: number;
  duration: number;
  transition: TransitionData | null;
  playing: boolean;
  sourceUrl: string;
  selected: boolean;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
}) {
  const accent = '#FF79B0';
  const accentSoft = '#FFD0E1';
  const accentDeep = '#43152C';
  const progress = Math.max(0, Math.min(1, time / Math.max(0.001, duration)));
  const easeInOut = (v: number) => v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
  const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);
  const shell: React.CSSProperties = {
    position: 'absolute', inset: 0, zIndex: 8, cursor: 'move',
    outline: selected ? `2px solid ${accent}` : 'none',
    overflow: 'hidden', pointerEvents: 'auto',
  };

  if (kind === 'face-scan') {
    // The scan scene enters as a real bottom-to-top slide: the outgoing
    // fifth hook frame is displaced upward while the scan frame rises under
    // it. No flash/wipe stripe between the two pictures.
    const entryDuration = transition?.type === 'slide-bounce-up' ? transition.duration : 0.52;
    const entryT = Math.max(0, Math.min(1, time / entryDuration));
    // A finger-driven vertical swipe: accelerate hard through most of the
    // distance, overshoot the resting point, then rebound downward once.
    const swipe = entryT < 0.72
      ? 1.075 * (1 - Math.pow(1 - entryT / 0.72, 4))
      : 1 + 0.075 * (1 - (entryT - 0.72) / 0.28) * Math.cos(((entryT - 0.72) / 0.28) * Math.PI / 2);
    const settle = entryT >= 1 ? 1 : swipe;
    const velocitySquash = Math.sin(Math.min(1, entryT / 0.72) * Math.PI) * 0.018;
    // Cover the overshoot so the lower edge of the incoming frame never
    // becomes visible. The zoom peaks around the swipe/overshoot, then
    // returns to the exact original framing during the rebound.
    const transitionZoom = entryT < 0.72
      ? 1 + 0.14 * (1 - Math.pow(1 - entryT / 0.72, 3))
      : 1 + 0.14 * (1 - (entryT - 0.72) / 0.28);
    const scanProgress = Math.max(0, Math.min(1, (progress - 0.11) / 0.71));
    const overlayIn = easeOut(Math.max(0, Math.min(1, (progress - 0.11) * 8)));
    const scanY = 17 + 52 * easeInOut(scanProgress);
    const resultIn = easeOut(Math.max(0, Math.min(1, (progress - 0.62) * 5)));
    const breathe = 1 + Math.sin(scanProgress * Math.PI * 4) * 0.012;
    return (
      <div style={shell} onPointerDown={onPointerDown}>
        {/\.(mp4|mov|webm)(\?|$)/i.test(sourceUrl) ? (
          <SyncedVideo
            src={sourceUrl}
            time={Math.max(0, time)}
            playing={playing}
            style={{ position: 'absolute', inset: 0, zIndex: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `translateY(${(1 - settle) * 100}%) scale(${transitionZoom}) scaleX(${1 - velocitySquash}) scaleY(${1 + velocitySquash})`, transformOrigin: '50% 50%', pointerEvents: 'none' }}
            onPointerDown={() => {}}
          />
        ) : (
          <img
            src={sourceUrl}
            alt=""
            style={{ position: 'absolute', inset: 0, zIndex: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `translateY(${(1 - settle) * 100}%) scale(${transitionZoom}) scaleX(${1 - velocitySquash}) scaleY(${1 + velocitySquash})`, transformOrigin: '50% 50%', pointerEvents: 'none' }}
          />
        )}
        {entryT < 1 && (
          <img
            src="/video/hair-app/hook-05-shorter-fal-9x16.png"
            alt=""
            style={{ position: 'absolute', inset: 0, zIndex: 2, width: '100%', height: '100%', objectFit: 'cover', transform: `translateY(${-settle * 100}%) scale(${transitionZoom}) scaleX(${1 - velocitySquash}) scaleY(${1 + velocitySquash})`, transformOrigin: '50% 50%', pointerEvents: 'none' }}
          />
        )}
        <div style={{ position: 'absolute', top: '4.2%', left: '14%', right: '14%', height: '5.8%', borderRadius: 18, background: `linear-gradient(135deg, ${accentSoft}, ${accent})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 850, letterSpacing: '.1px', textShadow: '0 1px 3px #7c204d55', boxShadow: `0 7px 22px ${accent}42`, opacity: overlayIn, transform: `translateY(${(1 - overlayIn) * -8 + Math.sin(scanProgress * Math.PI * 2) * 1.2}px)` }}>Find Your Faceshape</div>
        <div style={{ position: 'absolute', left: '7%', right: '7%', top: `${scanY}%`, height: 2.5, background: `linear-gradient(90deg, transparent, ${accent}, #fff, ${accent}, transparent)`, boxShadow: `0 0 18px 6px ${accent}`, opacity: 0.92 * overlayIn }} />
        {[
          { left: '7%', top: '15%', borderWidth: '3px 0 0 3px', borderRadius: '18px 0 0 0' },
          { right: '7%', top: '15%', borderWidth: '3px 3px 0 0', borderRadius: '0 18px 0 0' },
          { left: '7%', bottom: '20%', borderWidth: '0 0 3px 3px', borderRadius: '0 0 0 18px' },
          { right: '7%', bottom: '20%', borderWidth: '0 3px 3px 0', borderRadius: '0 0 18px 0' },
        ].map((s, i) => <div key={i} style={{ position: 'absolute', width: '15%', height: '10%', borderColor: accent, borderStyle: 'solid', filter: `drop-shadow(0 0 5px ${accent}88)`, opacity: overlayIn, transform: `scale(${breathe})`, ...s }} />)}
        <div style={{
          position: 'absolute', left: '16%', right: '16%', bottom: '10%',
          transform: `translateY(${(1 - resultIn) * 14 + Math.sin(time * 4.4) * 2.4}px) scale(${(0.88 + resultIn * 0.12) * (1 + Math.sin(time * 4.4) * 0.018)})`,
          opacity: resultIn, padding: '7px 8px', borderRadius: 28,
          background: `linear-gradient(135deg, ${accentSoft}, ${accent})`, color: '#fff',
          textAlign: 'center', fontSize: 12, lineHeight: 1, fontWeight: 900,
          whiteSpace: 'nowrap', textShadow: '0 1px 3px #7c204d55',
          boxShadow: `0 ${7 + Math.sin(time * 4.4) * 2}px ${22 + Math.sin(time * 4.4) * 5}px ${accent}50`,
        }}>Soft Heart</div>
      </div>
    );
  }

  if (kind === 'selector-ribbon') {
    const ribbonSources = [
      '/video/hair-app/result-01-textured-bob-fashion.png',
      '/video/hair-app/result-02-full-bob-fashion.png',
      '/video/hair-app/result-03-hollywood-waves-fashion.png',
      '/video/hair-app/result-04-sleek-fashion.png',
      '/video/hair-app/result-05-curly-bob-fashion.png',
      '/video/hair-app/hook-01-home-ponytail-v2.png',
      '/video/hair-app/hook-02-wider-fal.png',
      '/video/hair-app/hook-03-unbalanced-fal.png',
      '/video/hair-app/hook-04-centered-fal.png',
      '/video/hair-app/hook-05-shorter-fal-9x16.png',
      '/video/hair-app/hook-01-low-bun.png',
      '/video/hair-app/model-master-blonde-v5-dimensional-light.png',
      '/video/hair-app/model-master-v7-scan-identity.png',
    ];
    const items = Array.from({ length: ribbonSources.length }, (_, i) => i);
    const continuousIndex = progress * (items.length - 1);
    const selectedIndex = Math.max(0, Math.min(items.length - 1, Math.round(continuousIndex)));
    return (
      <div style={shell} onPointerDown={onPointerDown}>
        <img
          src={ribbonSources[selectedIndex] ?? sourceUrl}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 18%', pointerEvents: 'none' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 54%, rgba(20,6,14,.18))', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: '5%', right: '5%', bottom: '13%', height: '20%', border: `2px solid ${accent}`, borderRadius: 20, background: '#160D14e8', overflow: 'hidden', boxShadow: `0 10px 28px #2b0d1c66, 0 0 16px ${accent}45` }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            {items.map((i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${50 + (i - continuousIndex) * 23}%`,
                top: '10%',
                height: '80%',
                aspectRatio: '3 / 4',
                borderRadius: 10,
                overflow: 'hidden',
                border: i === selectedIndex ? `2px solid ${accentSoft}` : '1px solid #ffffff55',
                background: '#ddd',
                boxShadow: i === selectedIndex ? '0 6px 15px #0007' : '0 4px 10px #0005',
                transform: `translateX(-50%) translateY(${Math.sin(progress * Math.PI * 2 + i * 0.72) * 5}%)`,
                transition: 'border-color 100ms linear, box-shadow 100ms linear',
              }}>
                <img src={ribbonSources[i % ribbonSources.length] ?? sourceUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 18%', display: 'block' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'hairstyle-ui') {
    const titles = [
      { at: 0.00, title: 'Layered Textured Bob' },
      { at: 0.85, title: 'Full Textured Bob' },
      { at: 1.85, title: 'Hollywood Waves' },
      { at: 2.95, title: 'Sleek Straight Hair' },
      { at: 3.80, title: 'Curly French Bob' },
    ];
    let title = titles[0].title;
    for (const item of titles) if (time >= item.at) title = item.title;
    const cutTimes = [0.85, 1.85, 2.95, 3.80];
    const nearestCut = cutTimes.reduce((best, cut) => (
      Math.abs(time - cut) < Math.abs(time - best) ? cut : best
    ), cutTimes[0]);
    const clickTime = time - nearestCut;
    const firstCut = cutTimes[0];
    const cursorVisible = time >= firstCut - 0.34;
    const cursorApproach = easeOut(Math.max(0, Math.min(1, (time - (firstCut - 0.34)) / 0.27)));
    const clickPress = Math.max(0, 1 - Math.abs(clickTime) / 0.085);
    return (
      <div style={shell} onPointerDown={onPointerDown}>
        <div style={{ position: 'absolute', top: '4.2%', left: '17%', right: '17%', height: '5.4%', borderRadius: 18, background: `linear-gradient(135deg, ${accentSoft}, ${accent})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 8.7, fontWeight: 900, boxShadow: `0 7px 22px ${accent}45`, textShadow: '0 1px 3px #7c204d66', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 7px', boxSizing: 'border-box', transform: `translateY(${Math.sin(time * 2.4) * 1.1}px)` }}>{title}</div>
        <div style={{ position: 'absolute', left: '30%', right: '30%', top: '69%', height: '4.2%', borderRadius: 18, background: '#F8DCE8e8', color: accentDeep, display: 'grid', placeItems: 'center', fontSize: 8.5, fontWeight: 800, boxShadow: '0 4px 12px #3e102322' }}>Faceshape:</div>
        <div style={{ position: 'absolute', left: '18%', right: '18%', top: '75%', padding: '7px 7px', borderRadius: 28, background: `linear-gradient(135deg, ${accentSoft}, ${accent})`, color: '#fff', textAlign: 'center', fontSize: 11.5, lineHeight: 1, fontWeight: 900, whiteSpace: 'nowrap', textShadow: '0 1px 3px #7c204d66', boxShadow: `0 8px 24px ${accent}48` }}>Soft Heart</div>
        <div style={{
          position: 'absolute', left: '43%', top: '84%', width: '14%', aspectRatio: '1',
          borderRadius: '50%', background: `linear-gradient(135deg, ${accentSoft}, ${accent})`,
          color: '#fff', display: 'grid', placeItems: 'center',
          boxShadow: clickPress > 0.05 ? `0 2px 8px ${accent}55, inset 0 2px 7px #8f245755` : `0 7px 20px ${accent}44`,
          transform: `rotate(${Math.floor(time / 0.2) * 24 + clickPress * 28}deg) scale(${1 + Math.sin(time * 4) * 0.025 - clickPress * 0.12})`,
        }}>
          <div style={{ width: '58%', height: '58%' }}><UiIcon name="refresh" /></div>
        </div>
        {cursorVisible && (
          <div style={{
            position: 'absolute',
            left: `${67 - cursorApproach * 18}%`,
            top: `${94 - cursorApproach * 5}%`,
            width: '8.5%',
            aspectRatio: '1',
            zIndex: 14,
            color: '#fff',
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.85))',
            transform: `translate(${clickPress * 1.5}px, ${clickPress * 2}px) scale(${1 - clickPress * 0.06})`,
            pointerEvents: 'none',
          }}>
            <MouseCursorIcon />
          </div>
        )}
      </div>
    );
  }

  if (kind === 'store-end-card') {
    const intro = easeOut(Math.min(1, progress * 3.2));
    const badgesIn = easeOut(Math.max(0, Math.min(1, (progress - 0.24) * 3.2)));
    const pulse = 1 + Math.sin(progress * Math.PI * 4) * 0.022;
    return (
      <div style={{ ...shell, background: '#2A1020' }} onPointerDown={onPointerDown}>
        <img src={sourceUrl} alt="" style={{ position: 'absolute', inset: '-8%', width: '116%', height: '116%', objectFit: 'cover', filter: 'blur(24px) saturate(.72)', transform: `scale(${1.05 + progress * 0.035})`, opacity: 0.48 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(28,8,20,.42), rgba(34,10,24,.72) 55%, rgba(18,7,15,.92))' }} />
        <div style={{ position: 'absolute', width: '82%', aspectRatio: '1', left: '9%', top: '11%', borderRadius: '50%', background: `radial-gradient(circle, ${accent}42, transparent 66%)`, transform: `scale(${0.86 + intro * 0.18})`, opacity: intro }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8% 10%', boxSizing: 'border-box', textAlign: 'center' }}>
          <div style={{
            width: '34%', aspectRatio: '1', borderRadius: '27%',
            background: `linear-gradient(145deg, ${accentSoft}, ${accent} 52%, #B63875)`,
            boxShadow: `0 18px 42px ${accent}65, inset 0 1px 0 #ffffff99`,
            display: 'grid', placeItems: 'center', color: accentDeep,
            opacity: intro, transform: `translateY(${(1 - intro) * 24}px) scale(${(0.72 + intro * 0.28) * pulse})`,
          }}>
            <div style={{ position: 'relative', width: '66%', height: '66%' }}>
              <div style={{ position: 'absolute', inset: '9% 8%', border: '3px solid currentColor', borderRadius: '48% 48% 42% 42%', borderBottomColor: 'transparent', transform: 'rotate(-5deg)' }} />
              <div style={{ position: 'absolute', left: '19%', right: '19%', top: '22%', height: '47%', borderLeft: '3px solid currentColor', borderRight: '3px solid currentColor', borderRadius: '50%', transform: 'skewX(-8deg)' }} />
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: '5%', fontSize: 13, fontWeight: 950, letterSpacing: '-.8px' }}>AI</span>
            </div>
          </div>
          <div style={{ marginTop: '8%', color: '#FFF7FB', fontSize: 18, lineHeight: 1, fontWeight: 900, letterSpacing: '-.55px', opacity: intro, transform: `translateY(${(1 - intro) * 15}px)` }}>AI Haircut</div>
          <div style={{ marginTop: '3%', color: '#F7C8DC', fontSize: 8.5, lineHeight: 1.25, fontWeight: 650, letterSpacing: '.1px', opacity: intro }}>Find the hairstyle made for you</div>
          <div style={{ width: '82%', marginTop: '12%', display: 'grid', gap: 7, opacity: badgesIn, transform: `translateY(${(1 - badgesIn) * 18}px)` }}>
            <StoreBadge store="apple" />
            <StoreBadge store="google" />
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'hook-captions') {
    // Word changes are locked to the actual picture cuts. Previously they
    // were divided evenly across the whole caption clip, which let the photo
    // cut first and made the pop feel late.
    const wordCues = [
      { at: 0.00, word: 'Ugly?' },
      { at: 1.57, word: 'You' },
      { at: 1.893, word: 'Haven’t' },
      { at: 2.347, word: 'Found' },
      { at: 2.50, word: 'The Right' },
      { at: 2.856, word: 'Hairstyle' },
    ];
    let cueIndex = 0;
    for (let i = 0; i < wordCues.length; i += 1) {
      if (time >= wordCues[i].at) cueIndex = i;
    }
    const cue = wordCues[cueIndex];
    const nextAt = wordCues[cueIndex + 1]?.at ?? duration;
    const cueTime = Math.max(0, time - cue.at);
    const cueDuration = Math.max(0.001, nextAt - cue.at);
    const wordPhase = Math.min(1, cueTime / cueDuration);
    // Start on the exact cut and finish the back-out pop in ~140 ms.
    const popT = Math.min(1, cueTime / 0.14);
    // back.out-like overshoot, evaluated directly from playhead time.
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const pop = 1 + c3 * Math.pow(popT - 1, 3) + c1 * Math.pow(popT - 1, 2);
    const fadeOut = wordPhase > 0.84 ? 1 - (wordPhase - 0.84) / 0.16 : 1;
    const phrases = [
      { at: 0.00, first: 'THIS HAIRSTYLE', second: '' },
      { at: 1.57, first: 'makes my face', second: 'look WIDER' },
      { at: 1.893, first: 'makes my face', second: 'look UNBALANCED' },
      { at: 2.347, first: 'makes my face', second: 'look CENTERED' },
      { at: 2.50, first: 'makes my face', second: 'look SHORTER' },
    ];
    let phrase = phrases[0];
    for (const item of phrases) if (time >= item.at) phrase = item;
    return (
      <div style={{ ...shell, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', left: '8%', right: '8%', top: '66%',
          textAlign: 'center', color: '#fff', fontSize: 11.5, lineHeight: 1.18,
          fontWeight: 520, letterSpacing: '-.15px',
          textShadow: '0 2px 5px #0009',
          opacity: 0.9,
        }}>
          <div>{phrase.first}</div>
          {phrase.second && <div>{phrase.second}</div>}
        </div>
        <div style={{
          position: 'absolute', left: '6%', right: '6%', top: '80%',
          textAlign: 'center', color: '#fff', fontSize: 20, lineHeight: 1,
          fontWeight: 950, letterSpacing: '-.6px',
          WebkitTextStroke: '1.2px #171017',
          paintOrder: 'stroke fill',
          textShadow: '0 4px 7px #0008',
          opacity: fadeOut,
          transform: `translateY(${(1 - pop) * 13}px) scale(${0.68 + pop * 0.32}) rotate(${(1 - pop) * -2.5}deg)`,
          transformOrigin: '50% 60%',
        }}>{cue.word}</div>
      </div>
    );
  }

  return null;
}

function StoreBadge({ store }: { store: 'apple' | 'google' }) {
  return (
    <div style={{ height: 36, borderRadius: 10, background: '#09090B', border: '1px solid #ffffff26', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', boxSizing: 'border-box', boxShadow: '0 8px 20px #0006' }}>
      {store === 'apple' ? (
        <svg viewBox="0 0 24 28" width="16" height="20" style={{ marginRight: 9, flex: '0 0 auto' }}>
          <path fill="#fff" d="M19.2 14.8c0-3.3 2.7-4.9 2.8-5-1.5-2.2-3.9-2.5-4.8-2.5-2-.2-4 1.2-5 1.2-1.1 0-2.7-1.2-4.5-1.1-2.3 0-4.5 1.4-5.7 3.5-2.5 4.3-.6 10.5 1.7 14 .1.1.2.3.3.5h.1c1.1 1.6 2.5 3.4 4.3 3.3 1.7-.1 2.4-1.1 4.5-1.1 2 0 2.6 1.1 4.5 1 1.9 0 3.1-1.6 4.2-3.3 1.3-1.9 1.8-3.7 1.8-3.8-.1 0-4.2-1.6-4.2-6.7zM15.9 5.2c.9-1.1 1.5-2.7 1.3-4.2-1.4.1-3 .9-4 2-.9 1-1.6 2.6-1.4 4.1 1.5.1 3.1-.8 4.1-1.9z" />
        </svg>
      ) : (
        <svg viewBox="0 0 28 28" width="17" height="19" style={{ marginRight: 9, flex: '0 0 auto' }}>
          <path fill="#34A853" d="M2 2l15 12L2 26z" /><path fill="#4285F4" d="M17 14l4-3 5 3-5 3z" /><path fill="#FBBC04" d="M2 2l19 9-4 3z" /><path fill="#EA4335" d="M2 26l15-12 4 3z" />
        </svg>
      )}
      <div style={{ textAlign: 'left', fontSize: 12, lineHeight: 1, fontWeight: 650, whiteSpace: 'nowrap' }}>{store === 'apple' ? 'App Store' : 'Google Play'}</div>
    </div>
  );
}

type UiIconName = 'refresh';
function UiIcon({ name }: { name: UiIconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      {name === 'refresh' && <><path {...common} d="M20 7v5h-5M4 17v-5h5" /><path {...common} d="M6.1 8a7 7 0 0111.8-1L20 12M4 12l2.1 5a7 7 0 0011.8-1" /></>}
    </svg>
  );
}

function MouseCursorIcon() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
      <path
        d="M5.2 3.4 25.8 18c1 .7.55 2.3-.68 2.38l-8.05.62-3.7 7.18c-.58 1.12-2.22.8-2.36-.45L3.2 5.02C2.86 3.73 4.08 2.62 5.2 3.4Z"
        fill="#fff"
        stroke="#171017"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SyncedVideo({ src, time, playing, style, onPointerDown }: { src: string; time: number; playing: boolean; style: React.CSSProperties; onPointerDown: React.PointerEventHandler<HTMLVideoElement> }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(false), [src]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (Math.abs(video.currentTime - time) > 0.12) video.currentTime = time;
    if (playing) void video.play().catch(() => {});
    else video.pause();
  }, [time, playing]);
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      onLoadedData={() => setReady(true)}
      style={{ ...style, opacity: ready ? style.opacity ?? 1 : 0 }}
      onPointerDown={onPointerDown}
    />
  );
}

function SyncedAudio({ src, time, playing, volume = 1 }: { src: string; time: number; playing: boolean; volume?: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, volume));
    if (Math.abs(audio.currentTime - time) > 0.08) audio.currentTime = time;
    if (playing) void audio.play().catch(() => {});
    else audio.pause();
  }, [time, playing, volume]);
  return <audio ref={ref} src={src} preload="auto" />;
}

function Field({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (value: number) => void }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--ds-muted)' }}>
      <span>{label}</span>
      <input className="ds-input" type="number" value={Number(value.toFixed(3))} step={step} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%', height: 'var(--ds-control-h-sm)', padding: '0 10px', fontSize: 13 }} />
    </label>
  );
}
