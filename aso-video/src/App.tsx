// ComfyUI-style node graph editor for aso-video.
// Server (~/.aso-studio/video/graph.json) is the source of truth — we
// subscribe via SSE and mirror the graph into React Flow.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  API,
  fetchGraph,
  subscribe,
  createNode,
  patchNode,
  deleteNode,
  createEdge,
  deleteEdge,
  runAll,
  listWorkflows,
  loadWorkflow,
  saveWorkflow,
  deleteWorkflow,
  listInfluencers,
  deleteInfluencer,
  type Influencer,
} from './store/graphClient';
import type { GraphPayload, NodeType } from './store/types';
import { ReferenceImageNode } from './nodes/ReferenceImageNode';
import { ReferenceVideoNode } from './nodes/ReferenceVideoNode';
import { FluxImageNode } from './nodes/FluxImageNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { TtsVoiceNode } from './nodes/TtsVoiceNode';
import { CaptionsNode } from './nodes/CaptionsNode';
import { SplitScreenNode } from './nodes/SplitScreenNode';
import { ImageOverlayNode } from './nodes/ImageOverlayNode';
import { EndCardNode } from './nodes/EndCardNode';
import { StitchNode } from './nodes/StitchNode';
import { VideoOverlayNode } from './nodes/VideoOverlayNode';
import { TranscribeNode } from './nodes/TranscribeNode';
import { GroupNode } from './nodes/GroupNode';
import { OutputNode } from './nodes/OutputNode';
import { installBridge } from './lib/claudeBridge';
import { LightboxRoot } from './components/Lightbox';
import { LibrarySidebar } from './components/LibrarySidebar';
import { BrandSwitcher } from './components/BrandSwitcher';
// MockupProvider/useMockupToggle now live inside OutputNode itself.
import SettingsModal from './components/SettingsModal';

// Categories for the + Add Node menu. Order matters — sources first, then
// processors, then sink.
interface NodeMenuItem { type: NodeType; label: string; hint?: string }
const NODE_MENU_SECTIONS: { title: string; items: NodeMenuItem[] }[] = [
  {
    title: 'Sources',
    items: [
      { type: 'flux-image', label: '🎨 Image Gen (AI)', hint: 'gpt-image-2 / flux 1.1 — character or asset' },
      { type: 'video-gen', label: '🎬 Video Gen (AI)', hint: 'Kling / Seedance / Happy Horse, multi-shot supported' },
      { type: 'tts-voice', label: '🎙 TTS Voice', hint: 'TikTok TTS voiceover' },
      { type: 'reference-image', label: '🖼 Reference Image (upload)', hint: 'static png/jpg from disk' },
      { type: 'reference-video', label: '📼 Reference Video (upload)', hint: 'b-roll / slime / footage' },
    ],
  },
  {
    title: 'Compositors',
    items: [
      { type: 'image-overlay', label: '✨ Image Overlay', hint: 'burn image on video at time range (jump-scare, end-card-style)' },
      { type: 'split-screen', label: '🟰 Split Screen', hint: 'stack talking head over b-roll vertically' },
      { type: 'captions', label: '💬 Captions (CapCut style)', hint: 'whisper STT + burn ASS subtitles' },
      { type: 'stitch', label: '🔗 Stitch', hint: 'concatenate two videos end-to-end (A then B)' },
      { type: 'video-overlay', label: '🎯 Video Overlay', hint: 'composite overlay video on top of base, base audio kept' },
      { type: 'transcribe', label: '👁 Transcribe (STT peek)', hint: 'whisper word timings, pass-through video' },
      { type: 'end-card', label: '🌙 End Card (Dream branded)', hint: 'animated Remotion outro concatenated to tail' },
    ],
  },
  {
    title: 'Layout',
    items: [
      { type: 'group', label: '▦ Group (backdrop)', hint: 'translucent container under a sequence of nodes — purely visual' },
    ],
  },
  {
    title: 'Output',
    items: [
      { type: 'output', label: '📤 Output (final preview)', hint: 'final mp4 preview, optional TikTok mockup overlay' },
    ],
  },
];

// Flat lookup for places that just need a label (delete confirms etc).
const NODE_TYPE_LABELS: Record<NodeType, string> = NODE_MENU_SECTIONS.flatMap((s) => s.items)
  .reduce((acc, it) => { acc[it.type] = it.label; return acc; }, {} as Record<NodeType, string>);

function GraphEditor() {
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showInf, setShowInf] = useState(false);
  // Tracks last SSE delivery time. If we go >12s without one (heartbeat is
  // 15s on the server), we mark the connection stale and force-poll.
  const [lastSseAt, setLastSseAt] = useState<number>(Date.now());
  const rf = useReactFlow();

  /**
   * Topology-aware auto-arrange.
   *
   * Two-tier layout:
   *  1. "Main chain" nodes flow left → right by topological depth, the way
   *     the data actually pipes through (Kling → Overlay → Captions → …).
   *  2. "Side input" sources (e.g. an Image Gen node feeding only the `image`
   *     handle of an Overlay, or the App Screenshot feeding `image_url_2` of
   *     Kling) get co-located in the same column as their consumer, stacked
   *     directly below it. This is way more readable than dumping every
   *     in-degree-0 source into column 0.
   *
   * Uses each card's *measured* width/height so wide/tall nodes don't overlap.
   */
  async function handleAutoLayout() {
    const flowNodes = rf.getNodes();
    const flowEdges = rf.getEdges();
    if (!flowNodes.length) return;

    // Per-type primary input handle (the "main pipeline" connection). Other
    // handles are treated as side inputs.
    const PRIMARY_HANDLE: Record<string, string> = {
      'video-gen': 'image_url',
      'image-overlay': 'video',
      'captions': 'video',
      'split-screen': 'top',
      'end-card': 'video',
      'output': 'video',
    };

    // Identify side-input sources: in-degree 0, single outgoing edge, the
    // edge plugs into a non-primary handle on its consumer.
    const sideOf = new Map<string, string>(); // sourceId → consumerId
    for (const n of flowNodes) {
      const incoming = flowEdges.filter((e) => e.target === n.id);
      if (incoming.length > 0) continue;
      const outgoing = flowEdges.filter((e) => e.source === n.id);
      if (outgoing.length !== 1) continue;
      const e = outgoing[0];
      const consumer = flowNodes.find((m) => m.id === e.target);
      if (!consumer) continue;
      const primary = PRIMARY_HANDLE[consumer.type ?? ''];
      if (primary && e.targetHandle !== primary) {
        sideOf.set(n.id, consumer.id);
      }
    }

    // Topo order excluding side-input edges so depth reflects only the main
    // chain.
    const inDeg = new Map<string, number>(flowNodes.map((n) => [n.id, 0]));
    for (const e of flowEdges) {
      if (sideOf.has(e.source)) continue;
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, d] of inDeg) if (d === 0 && !sideOf.has(id)) queue.push(id);
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const e of flowEdges) {
        if (e.source !== id || sideOf.has(e.source)) continue;
        const d = (inDeg.get(e.target) ?? 0) - 1;
        inDeg.set(e.target, d);
        if (d === 0) queue.push(e.target);
      }
    }

    // Depth = longest main-chain path from any non-side source.
    const depth = new Map<string, number>(flowNodes.map((n) => [n.id, 0]));
    for (const id of order) {
      const here = depth.get(id) ?? 0;
      for (const e of flowEdges) {
        if (e.source !== id || sideOf.has(e.source)) continue;
        const next = depth.get(e.target) ?? 0;
        if (here + 1 > next) depth.set(e.target, here + 1);
      }
    }
    // Side inputs inherit their consumer's depth (same column).
    for (const [src, consumer] of sideOf) {
      depth.set(src, depth.get(consumer) ?? 0);
    }

    // Group by depth column; sort within column by current y so user's
    // intent (which row each node was on) is roughly preserved.
    const cols = new Map<number, Node[]>();
    for (const n of flowNodes) {
      const d = depth.get(n.id) ?? 0;
      if (!cols.has(d)) cols.set(d, []);
      cols.get(d)!.push(n);
    }

    const COL_GAP = 80;
    const ROW_GAP = 60;
    const X0 = 40;
    const Y0 = 40;
    const sortedDepths = [...cols.keys()].sort((a, b) => a - b);

    type Patch = { id: string; pos: { x: number; y: number } };
    const patches: Patch[] = [];
    let cursorX = X0;
    for (const d of sortedDepths) {
      const colNodes = cols.get(d)!;

      // Split into main + side; side input goes right after its consumer.
      const sideByConsumer = new Map<string, Node[]>();
      const main: Node[] = [];
      for (const n of colNodes) {
        const c = sideOf.get(n.id);
        if (c) {
          if (!sideByConsumer.has(c)) sideByConsumer.set(c, []);
          sideByConsumer.get(c)!.push(n);
        } else {
          main.push(n);
        }
      }
      main.sort((a, b) => a.position.y - b.position.y);

      // Build vertical sequence: main₁ → its sides → main₂ → its sides → …
      const sequence: Node[] = [];
      for (const m of main) {
        sequence.push(m);
        for (const s of sideByConsumer.get(m.id) ?? []) sequence.push(s);
      }

      // Column width = widest node in this column.
      const colWidth = Math.max(
        260,
        ...colNodes.map((n) =>
          (n.measured?.width as number | undefined) ??
          (n.width as number | undefined) ??
          320,
        ),
      );

      let cursorY = Y0;
      for (const n of sequence) {
        patches.push({ id: n.id, pos: { x: cursorX, y: cursorY } });
        const h = (n.measured?.height as number | undefined) ?? (n.height as number | undefined) ?? 360;
        cursorY += h + ROW_GAP;
      }
      cursorX += colWidth + COL_GAP;
    }

    setRfNodes((cur) => {
      const byId = new Map(patches.map((p) => [p.id, p.pos]));
      return cur.map((n) => {
        const np = byId.get(n.id);
        return np ? { ...n, position: np } : n;
      });
    });
    await Promise.all(patches.map((p) => patchNode(p.id, { position: p.pos })));
  }
  const graphRef = useRef<GraphPayload | null>(null);

  // Hydrate + subscribe to SSE.
  // External-reload pipeline: when an agent (Claude) edits the canvas — either
  // by writing a workflow JSON file on disk OR by hitting any /api/graph/* route
  // with `?external=1` — the server fires `external-reload` immediately followed
  // by a refreshed `graph` event. We snapshot the previous graph on the hint,
  // then diff against the next graph and animate every kind of change:
  //   - ADDED / CHANGED nodes → yellow pulsing outline (flashingIds)
  //   - REMOVED nodes        → red ghost-fade (ghostNodes kept briefly)
  //   - ADDED edges          → animated yellow stroke (flashingEdgeIds)
  //   - REMOVED edges        → red ghost-fade (ghostEdges kept briefly)
  const externalDiffPendingRef = useRef<{ prev: GraphPayload | null } | null>(null);
  // History caps: smaller persisted limit so undo stack survives reload without
  // blowing past localStorage quotas (graph snapshots can be 20-50KB each).
  const HISTORY_CAP = 25;
  const ACTIVITY_CAP = 200;
  const LS_HISTORY = 'aso-video.history';
  const LS_REDO = 'aso-video.redo';
  const LS_ACTIVITY = 'aso-video.activity';
  function loadStack<T>(key: string): T[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function saveStack<T>(key: string, value: T[]): void {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch {
      // Quota probably hit — drop the oldest half and retry once.
      try { localStorage.setItem(key, JSON.stringify(value.slice(-Math.floor(value.length / 2)))); } catch {}
    }
  }
  const historyRef = useRef<GraphPayload[]>(loadStack<GraphPayload>(LS_HISTORY));
  const redoRef = useRef<GraphPayload[]>(loadStack<GraphPayload>(LS_REDO));
  const suppressHistoryRef = useRef(false);
  const [historyDepth, setHistoryDepth] = useState(historyRef.current.length);
  const [redoDepth, setRedoDepth] = useState(redoRef.current.length);
  const [showActivity, setShowActivity] = useState(false);
  type ActivityEntry = { id: string; ts: number; type: 'agent' | 'user'; summary: string; details: string[] };
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>(() => loadStack<ActivityEntry>(LS_ACTIVITY));
  function pushActivity(entry: Omit<ActivityEntry, 'id' | 'ts'>): void {
    setActivityLog((prev) => {
      const ts = Date.now();
      // Coalesce consecutive identical summaries within a 4s window so a flurry
      // of identical "moved 1" or repeated agent updates doesn't flood the log
      // with N copies. We still bump the timestamp + count on the existing
      // entry so the user sees it's "fresh" activity.
      const head = prev[0];
      if (head && head.summary === entry.summary && head.type === entry.type && (ts - head.ts) < 4000) {
        const merged: ActivityEntry = {
          ...head,
          ts,
          details: head.details, // already represents the action; details same
          summary: head.summary.match(/×\d+$/) ? head.summary.replace(/×\d+$/, (m) => `×${parseInt(m.slice(1), 10) + 1}`) : `${head.summary} ×2`,
        };
        const next = [merged, ...prev.slice(1)];
        saveStack(LS_ACTIVITY, next);
        return next;
      }
      const next = [{ ...entry, id: Math.random().toString(36).slice(2), ts }, ...prev].slice(0, ACTIVITY_CAP);
      saveStack(LS_ACTIVITY, next);
      return next;
    });
  }
  function persistHistory(): void {
    saveStack(LS_HISTORY, historyRef.current);
    saveStack(LS_REDO, redoRef.current);
  }
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());
  const [ghostNodes, setGhostNodes] = useState<Map<string, { position: {x:number;y:number}; type: string; data: Record<string,unknown> }>>(new Map());
  const [flashingEdgeIds, setFlashingEdgeIds] = useState<Set<string>>(new Set());
  const [ghostEdges, setGhostEdges] = useState<Map<string, { source: string; sourceHandle: string; target: string; targetHandle: string }>>(new Map());
  useEffect(() => {
    let mounted = true;
    fetchGraph().then((g) => { if (mounted) { setGraph(g); graphRef.current = g; } });
    listWorkflows().then((w) => mounted && setWorkflows(w));
    listInfluencers().then((i) => mounted && setInfluencers(i));
    const applyGraph = (g: GraphPayload) => {
      setLastSseAt(Date.now());
      const prev = graphRef.current ? JSON.stringify(graphRef.current) : '';
      const next = JSON.stringify(g);
      if (prev === next) return;

      // Undo/redo history — push prev snapshot before applying new one. Skip
      // when this update IS the result of an undo/redo (suppressHistoryRef set).
      if (!suppressHistoryRef.current && graphRef.current) {
        historyRef.current.push(graphRef.current);
        if (historyRef.current.length > HISTORY_CAP) historyRef.current.shift();
        // Any non-undo edit invalidates the redo branch.
        redoRef.current = [];
      }
      const wasUndoRedo = suppressHistoryRef.current;
      suppressHistoryRef.current = false;
      setHistoryDepth(historyRef.current.length);
      setRedoDepth(redoRef.current.length);
      persistHistory();

      // Always diff prev → next so the activity log captures ALL changes
      // (agent-driven via ?external=1 AND user-driven via UI). Animation +
      // ghost-fade only fire when an `external-reload` hint arrived first.
      const pending = externalDiffPendingRef.current;
      const isExternal = !!pending;
      if (pending) externalDiffPendingRef.current = null;
      const prevSnapshot: GraphPayload | null = isExternal ? (pending!.prev ?? graphRef.current) : graphRef.current;
      if (prevSnapshot) {
        const prevNodesById = new Map(prevSnapshot.nodes.map((n) => [n.id, n]));
        const newNodeIds = new Set(g.nodes.map((n) => n.id));
        const moved: string[] = [];
        const dataChanged: string[] = [];
        const added: string[] = [];
        const removedNodeGhosts = new Map<string, { position: {x:number;y:number}; type: string; data: Record<string,unknown> }>();
        const IGNORE_DATA_KEYS = new Set(['status','progress','stage','elapsed','cost','outputUrl','error','blocked','upstreamUrl','cached','words']);
        const stripVolatile = (d: Record<string, unknown>) => {
          const o: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(d)) if (!IGNORE_DATA_KEYS.has(k)) o[k] = v;
          return o;
        };
        for (const n of g.nodes) {
          const before = prevNodesById.get(n.id);
          if (!before) { added.push(n.id); continue; }
          const posChanged = before.position.x !== n.position.x || before.position.y !== n.position.y;
          const dChanged = JSON.stringify(stripVolatile(before.data)) !== JSON.stringify(stripVolatile(n.data));
          if (posChanged) moved.push(n.id);
          if (dChanged) dataChanged.push(n.id);
        }
        for (const n of prevSnapshot.nodes) {
          if (!newNodeIds.has(n.id)) {
            removedNodeGhosts.set(n.id, { position: n.position, type: n.type, data: n.data });
          }
        }

        const prevEdgeIds = new Set(prevSnapshot.edges.map((e) => e.id));
        const newEdgeIds = new Set(g.edges.map((e) => e.id));
        const addedEdges = new Set<string>();
        const removedEdgeGhosts = new Map<string, { source: string; sourceHandle: string; target: string; targetHandle: string }>();
        for (const e of g.edges) if (!prevEdgeIds.has(e.id)) addedEdges.add(e.id);
        for (const e of prevSnapshot.edges) {
          if (!newEdgeIds.has(e.id)) {
            removedEdgeGhosts.set(e.id, { source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle });
          }
        }

        // Animation only on external (agent) edits — user UI moves don't flash.
        if (isExternal) {
          const changedSet = new Set([...moved, ...dataChanged, ...added]);
          if (changedSet.size > 0) {
            setFlashingIds(changedSet);
            setTimeout(() => mounted && setFlashingIds(new Set()), 1700);
          }
          if (removedNodeGhosts.size > 0) {
            setGhostNodes(removedNodeGhosts);
            setTimeout(() => mounted && setGhostNodes(new Map()), 1500);
          }
          if (addedEdges.size > 0) {
            setFlashingEdgeIds(addedEdges);
            setTimeout(() => mounted && setFlashingEdgeIds(new Set()), 1700);
          }
          if (removedEdgeGhosts.size > 0) {
            setGhostEdges(removedEdgeGhosts);
            setTimeout(() => mounted && setGhostEdges(new Map()), 1500);
          }
        }

        // Activity log entry — composed for both agent + user actions. Skip
        // entirely for undo/redo: the original action already has an entry,
        // duplicating with `↶ ...` just bloats the log.
        if (!wasUndoRedo) {
          const parts: string[] = [];
          if (added.length) parts.push(`+${added.length} node${added.length > 1 ? 's' : ''}`);
          if (moved.length) parts.push(`moved ${moved.length}`);
          if (dataChanged.length) parts.push(`edited ${dataChanged.length}`);
          if (removedNodeGhosts.size) parts.push(`−${removedNodeGhosts.size} node${removedNodeGhosts.size > 1 ? 's' : ''}`);
          if (addedEdges.size) parts.push(`+${addedEdges.size} edge${addedEdges.size > 1 ? 's' : ''}`);
          if (removedEdgeGhosts.size) parts.push(`−${removedEdgeGhosts.size} edge${removedEdgeGhosts.size > 1 ? 's' : ''}`);
          if (parts.length > 0) {
            const labelOf = (id: string) => {
              const n = g.nodes.find((x) => x.id === id) ?? prevSnapshot.nodes.find((x) => x.id === id);
              return (n?.data as { label?: string } | undefined)?.label ?? n?.type ?? id;
            };
            const details: string[] = [];
            for (const id of moved) details.push(`moved: ${labelOf(id)}`);
            for (const id of dataChanged) details.push(`edited: ${labelOf(id)}`);
            for (const id of added) details.push(`added: ${labelOf(id)}`);
            for (const id of removedNodeGhosts.keys()) details.push(`removed: ${labelOf(id)}`);
            const kind: 'agent' | 'user' = isExternal ? 'agent' : 'user';
            const prefix = isExternal ? '✦' : '·';
            pushActivity({ type: kind, summary: `${prefix} ${parts.join(', ')}`, details });
          }
        }
      }

      graphRef.current = g;
      setGraph(g);
    };
    const onExternalReload = () => {
      externalDiffPendingRef.current = { prev: graphRef.current };
    };
    const dispose = subscribe(applyGraph, onExternalReload);
    const uninstall = installBridge(() => graphRef.current);
    return () => { mounted = false; dispose(); uninstall(); };
  }, []);

  // Cmd/Ctrl + Z (undo) and Cmd/Ctrl + Shift+Z / Cmd/Ctrl + Y (redo). The
  // history stack is fed by the SSE applyGraph above; pressing undo PUTs the
  // previous snapshot back to the server with `?external=1` so the diff
  // animation runs in reverse.
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!t || !(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    }
    async function pushGraphAsExternal(payload: GraphPayload): Promise<void> {
      suppressHistoryRef.current = true;
      await fetch(`${API}/graph?external=1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    async function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      // Undo: Cmd/Ctrl+Z (no shift)
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        const prev = historyRef.current.pop();
        if (!prev) return;
        if (graphRef.current) redoRef.current.push(graphRef.current);
        await pushGraphAsExternal(prev);
        return;
      }
      // Redo: Cmd/Ctrl+Shift+Z OR Cmd/Ctrl+Y
      if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        const next = redoRef.current.pop();
        if (!next) return;
        if (graphRef.current) historyRef.current.push(graphRef.current);
        await pushGraphAsExternal(next);
        return;
      }
    }
    // Capture phase + document so we win against React Flow's own keyboard
    // handling (it eats certain meta combos for selection / pan).
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Safety-net poll — pull a fresh graph every 5s in case an SSE update was
  // dropped. Uses the same content-diff guard as SSE so identical payloads
  // don't trigger re-renders.
  useEffect(() => {
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const fresh = await fetchGraph();
        const prev = graphRef.current ? JSON.stringify(graphRef.current) : '';
        const next = JSON.stringify(fresh);
        if (prev === next) return;
        graphRef.current = fresh;
        setGraph(fresh);
      } catch {}
    };
    const interval = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // Stable nodeTypes — must NOT be recreated on every render or React Flow
  // remounts every node, breaking controlled <select> visual state.
  const nodeTypes = useMemo(() => ({
    'reference-image': ReferenceImageNode as never,
    'reference-video': ReferenceVideoNode as never,
    'flux-image': FluxImageNode as never,
    'video-gen': VideoGenNode as never,
    'tts-voice': TtsVoiceNode as never,
    captions: CaptionsNode as never,
    'split-screen': SplitScreenNode as never,
    'image-overlay': ImageOverlayNode as never,
    'end-card': EndCardNode as never,
    stitch: StitchNode as never,
    'video-overlay': VideoOverlayNode as never,
    transcribe: TranscribeNode as never,
    group: GroupNode as never,
    output: OutputNode as never,
  }), []);

  // Local React Flow state — applied immediately for smooth dragging.
  // Server graph (via SSE) is the source of truth; we sync into local state
  // when it changes BUT skip nodes currently being dragged so we don't snap.
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const draggingIdsRef = useRef<Set<string>>(new Set());

  // Sync server graph → local rf state. Re-runs when flashingIds changes so
  // the flash className gets attached/removed on the freshly synced nodes.
  useEffect(() => {
    if (!graph) return;
    // Force group nodes to render BEHIND everything else by giving them
    // negative zIndex; React Flow respects per-node zIndex.
    setRfNodes((current) => {
      const dragging = draggingIdsRef.current;
      const byId = new Map(current.map((n) => [n.id, n]));

      // Pre-compute "blocked" status: a node is blocked iff any direct
      // upstream isn't `done` yet (covers idle / loading / error). For
      // reference uploads (which don't run) "done" = has a `url` set.
      // Renders as a grey, disabled Run button + amber wash on the card.
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      function isUpstreamReady(src: typeof graph.nodes[number]): boolean {
        if (src.type === 'reference-image' || src.type === 'reference-video') {
          return Boolean((src.data as { url?: string }).url);
        }
        return (src.data as { status?: string }).status === 'done';
      }
      const blockedById = new Set<string>();
      for (const e of graph.edges) {
        const src = nodeById.get(e.source);
        if (!src) continue;
        if (!isUpstreamReady(src)) blockedById.add(e.target);
      }

      return graph.nodes.map((n) => {
        let data: Record<string, unknown> = n.data as Record<string, unknown>;
        if (n.type === 'output') {
          const edge = graph.edges.find((e) => e.target === n.id && e.targetHandle === 'video');
          const src = edge && graph.nodes.find((x) => x.id === edge.source);
          const srcData = src?.data as { outputUrl?: string } | undefined;
          data = { ...data, upstreamUrl: srcData?.outputUrl };
        }
        // Inject computed `blocked` so NodeShell can dim + disable Run.
        if (blockedById.has(n.id)) {
          data = { ...data, blocked: true };
        } else if ((data as { blocked?: boolean }).blocked) {
          data = { ...data, blocked: false };
        }

        // Preserve user's resize across SSE re-syncs.
        const local = byId.get(n.id);
        const preserved: Partial<Node> = {};
        if (local) {
          if (local.style) preserved.style = local.style;
          if (local.width != null) preserved.width = local.width;
          if (local.height != null) preserved.height = local.height;
        }
        // Default style ONLY for first-time encounters — re-creating a fresh
        // `{ width: N }` literal every poll caused React Flow to treat the
        // card as a new node and re-layout the whole canvas.
        if (!local && !preserved.style && !preserved.width) {
          const defaultWidth = n.type === 'reference-image' || n.type === 'reference-video' || n.type === 'tts-voice' ? 280 : 320;
          preserved.style = { width: defaultWidth };
        }

        // Group nodes render below everything else.
        const zIndex = n.type === 'group' ? -1 : undefined;

        const flashClass = flashingIds.has(n.id) ? 'node-flash' : undefined;
        if (dragging.has(n.id) && local) {
          return { ...local, data, type: n.type, className: flashClass };
        }
        return { id: n.id, type: n.type, position: n.position, data, ...preserved, ...(zIndex !== undefined ? { zIndex } : {}), className: flashClass };
      }).concat(
        // Ghost nodes — recently removed, kept around for ~1.5s with a fade-out
        // animation so the operator can see what was deleted before it disappears.
        Array.from(ghostNodes.entries()).map(([id, ghost]) => ({
          id: `ghost::${id}`,
          type: ghost.type as never,
          position: ghost.position,
          data: ghost.data,
          className: 'node-ghost',
          selectable: false,
          draggable: false,
          style: { width: 320, pointerEvents: 'none' as const },
        })),
      );
    });
    setRfEdges(
      graph.edges.map((e) => {
        const sourceNode = graph.nodes.find((n) => n.id === e.source);
        const isRunning = sourceNode && (sourceNode.data as { status?: string }).status === 'loading';
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          type: 'default',
          animated: !!isRunning || flashingEdgeIds.has(e.id),
          style: flashingEdgeIds.has(e.id)
            ? { stroke: '#D97757', strokeWidth: 3 }
            : { stroke: '#6B7280', strokeWidth: 2 },
        };
      }).concat(
        // Ghost edges — recently removed, fading out red so deletions are visible.
        Array.from(ghostEdges.entries()).map(([id, e]) => ({
          id: `ghost::${id}`,
          source: e.source,
          sourceHandle: e.sourceHandle,
          target: e.target,
          targetHandle: e.targetHandle,
          type: 'default',
          interactionWidth: 0,
          className: 'edge-ghost',
          animated: false,
          style: { stroke: '#ff5050', strokeWidth: 3 },
          selectable: false,
        })),
      ),
    );
  }, [graph, flashingIds, flashingEdgeIds, ghostNodes, ghostEdges]);

  // React Flow change handlers — apply locally for instant feedback, then commit to server.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((cur) => applyNodeChanges(changes, cur));
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        if (c.dragging) {
          draggingIdsRef.current.add(c.id);
        } else {
          // Drag ended — commit final position to server.
          draggingIdsRef.current.delete(c.id);
          patchNode(c.id, { position: c.position }).catch(() => {});
        }
      } else if (c.type === 'remove') {
        deleteNode(c.id).catch(() => {});
      }
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((cur) => applyEdgeChanges(changes, cur));
    for (const c of changes) {
      if (c.type === 'remove') {
        deleteEdge(c.id).catch(() => {});
      }
    }
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
    createEdge({
      source: conn.source,
      target: conn.target,
      sourceHandle: conn.sourceHandle,
      targetHandle: conn.targetHandle,
    }).catch(() => {});
  }, []);

  async function handleAdd(type: NodeType) {
    setShowAdd(false);
    // Spawn slightly offset so multiple adds are visible.
    const offset = (graph?.nodes.length ?? 0) * 40;
    await createNode({ type, position: { x: 200 + offset, y: 200 + offset } });
  }

  async function handleLoadWorkflow(name: string) {
    setShowLoad(false);
    await loadWorkflow(name);
  }

  async function handleSaveWorkflow() {
    const name = prompt('Workflow name (alphanumeric, _, -):');
    if (!name) return;
    await saveWorkflow(name);
    setWorkflows(await listWorkflows());
  }

  // Apply an influencer preset onto the first flux-image node in the graph
  // (creates one if absent). Loaded prompt+image+settings appear in that node.
  async function handleLoadInfluencer(inf: Influencer) {
    setShowInf(false);
    if (!graphRef.current) return;
    let target = graphRef.current.nodes.find((n) => n.type === 'flux-image');
    if (!target) {
      const created = await createNode({ type: 'flux-image', position: { x: 200, y: 200 } });
      target = created;
    }
    if (!target) return;
    await patchNode(target.id, {
      data: {
        prompt: inf.prompt,
        model: inf.model,
        aspectRatio: inf.aspectRatio,
        quality: inf.quality,
        outputUrl: inf.imageUrl,
        status: 'done',
        cost: 0,
      },
    });
  }

  /**
   * Reset every node back to a blank, idle state — wipes generated videos,
   * transcripts, captions outputs, and prompts/text on the nodes that hold
   * them. Structure (nodes + edges) is preserved so you can immediately
   * write a new prompt and run again. Reference uploads (App Screenshot,
   * Reference Video) are NEVER wiped. Character Image Gen is kept intact
   * if you confirm.
   */
  async function handleReset() {
    const g = graphRef.current;
    if (!g) return;

    if (!confirm('Reset graph? Clears all generated videos, transcripts, captions, and prompts. Node structure stays intact. Reference Image (App Screenshot) is always preserved.')) return;
    const keepModel = confirm('Keep your character / influencer Image Gen image + prompt? (OK to keep, Cancel to clear it too.)');

    type Patch = { id: string; data: Record<string, unknown> };
    const patches: Patch[] = [];

    // Common runtime fields cleared on every node.
    const clearRun: Record<string, unknown> = {
      status: 'idle',
      outputUrl: null,
      error: null,
      progress: null,
      stage: null,
    };

    for (const n of g.nodes) {
      const data = n.data as Record<string, unknown>;
      // Skip reference uploads entirely — those are user-provided files.
      if (n.type === 'reference-image' || n.type === 'reference-video') continue;
      // Group nodes have nothing runtime to clear.
      if (n.type === 'group') continue;
      // Output nodes only need to forget cached upstreamUrl indirectly via SSE.
      if (n.type === 'output') {
        patches.push({ id: n.id, data: { ...clearRun } });
        continue;
      }

      const patch: Record<string, unknown> = { ...clearRun };

      if (n.type === 'flux-image') {
        const isCharacter = (data.usage ?? 'character') === 'character';
        if (keepModel && isCharacter) {
          // preserve prompt + outputUrl + status='done'
          patches.push({ id: n.id, data: {} });
          continue;
        }
        patch.prompt = '';
        patch.cost = null;
      } else if (n.type === 'video-gen') {
        patch.prompt = '';
        patch.shots = [];
        patch.multiShot = false;
        patch.cost = null;
        patch.elapsed = null;
      } else if (n.type === 'tts-voice') {
        patch.text = '';
        patch.cost = null;
      } else if (n.type === 'transcribe') {
        patch.words = null;
        patch.cached = null;
        patch.cost = null;
      } else if (n.type === 'captions') {
        // Keep style preset / fontSize / marginV — those are templates.
        patch.cost = null;
      } else if (n.type === 'image-overlay') {
        // Keep timing + position style — overlays will be re-aligned with new transcript.
      } else if (n.type === 'end-card') {
        // Brand/cta/subtitle remain (template values).
      } else if (n.type === 'stitch' || n.type === 'split-screen' || n.type === 'video-overlay') {
        // No content fields — runtime clear is enough.
      }

      patches.push({ id: n.id, data: patch });
    }

    // Apply locally first for instant feedback, then sync to server.
    setRfNodes((cur) =>
      cur.map((rn) => {
        const p = patches.find((x) => x.id === rn.id);
        if (!p || Object.keys(p.data).length === 0) return rn;
        return { ...rn, data: { ...(rn.data as object), ...p.data } };
      }),
    );
    await Promise.all(patches.map((p) => patchNode(p.id, { data: p.data }).catch(() => {})));
  }

  async function handleDeleteInfluencer(name: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete influencer "${name}"?`)) return;
    await deleteInfluencer(name);
    setInfluencers(await listInfluencers());
  }

  return (
    <div style={{ height: '100vh', width: '100vw', background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif' }}>
      {/* toolbar — wraps to multiple lines when the viewport gets narrow so
          buttons stay reachable instead of overflowing off-screen. */}
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        background: 'rgba(23,23,23,0.92)', padding: '8px 12px', borderRadius: 10, border: '1px solid #2a2a2a',
      }}>
        <BrandSwitcher current="vid" />
        <div style={{ width: 1, height: 22, background: '#2a2a2a' }} />
        <strong style={{ fontSize: 13, opacity: 0.7 }}>graph</strong>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowLoad((v) => !v)} style={tbBtn}>Load Workflow ▼</button>
          {showLoad && (
            <div style={dropdown}>
              {workflows.length === 0 && <div style={{ padding: 8, fontSize: 11, opacity: 0.6 }}>(none)</div>}
              {workflows.map((n) => (
                <div
                  key={n}
                  onClick={() => handleLoadWorkflow(n)}
                  style={{ ...dropdownItem, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <span style={{ flex: 1 }}>{n}</span>
                  <span
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete workflow "${n}"? This cannot be undone.`)) return;
                      await deleteWorkflow(n);
                      setWorkflows(await listWorkflows());
                    }}
                    title="Delete workflow"
                    style={{ opacity: 0.5, fontSize: 12, cursor: 'pointer', padding: '0 4px' }}
                  >×</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={handleSaveWorkflow} style={tbBtn}>Save Workflow</button>
        <div style={{ position: 'relative' }}>
          <button
            onClick={async () => {
              setInfluencers(await listInfluencers());
              setShowInf((v) => !v);
            }}
            style={tbBtn}
          >Influencers ▼</button>
          {showInf && (
            <div style={dropdown}>
              {influencers.length === 0 && <div style={{ padding: 8, fontSize: 11, opacity: 0.6 }}>(none — generate an image and click 💾 Save Influencer)</div>}
              {influencers.map((inf) => (
                <div
                  key={inf.name}
                  onClick={() => handleLoadInfluencer(inf)}
                  style={{ ...dropdownItem, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <img src={inf.imageUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', background: '#000' }} />
                  <span style={{ flex: 1 }}>{inf.name}</span>
                  <span
                    onClick={(e) => handleDeleteInfluencer(inf.name, e)}
                    title="delete"
                    style={{ fontSize: 11, opacity: 0.6, cursor: 'pointer', padding: '0 4px' }}
                  >×</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowAdd((v) => !v)} style={tbBtn}>+ Add Node ▼</button>
          {showAdd && (
            <div style={{ ...dropdown, minWidth: 320, maxHeight: '70vh', overflowY: 'auto' }}>
              {NODE_MENU_SECTIONS.map((section, si) => (
                <div key={section.title}>
                  <div style={{
                    padding: '6px 12px 4px', fontSize: 9, color: '#6B7280',
                    textTransform: 'uppercase', letterSpacing: 1,
                    background: '#0a0a0a', borderTop: si === 0 ? 'none' : '1px solid #222',
                  }}>{section.title}</div>
                  {section.items.map((it) => (
                    <div
                      key={it.type}
                      onClick={() => handleAdd(it.type)}
                      style={{ ...dropdownItem, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                    >
                      <span>{it.label}</span>
                      {it.hint && <span style={{ fontSize: 10, color: '#6B7280', fontWeight: 400 }}>{it.hint}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => runAll()} style={{ ...tbBtn, background: '#3B82F6', color: '#fff' }}>▶ Run All</button>
        <button onClick={handleAutoLayout} title="Auto-arrange nodes by topology — uses each card's actual rendered size so wide/tall cards don't overlap" style={tbBtn}>⫯ Auto-arrange</button>
        <button
          onClick={handleReset}
          title="Reset graph for a new video. Keeps App Screenshot and (optionally) your character Image Gen."
          style={{ ...tbBtn, color: '#FCA5A5' }}
        >🗑 Reset</button>
        {/* TikTok mockup toggle relocated into the Output node itself. */}
        <div style={{ flex: 1 }} />
        {/* Activity dropdown — collapsed by default, right-pinned next to total/price.
            Houses Undo/Redo + force-refresh as a compact header inside the panel
            so they don't eat toolbar space. */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowActivity((v) => !v)}
            title="Canvas history — Undo/Redo + recent actions"
            style={tbBtn}
          >📜 Activity {activityLog.length > 0 ? `(${activityLog.length})` : ''}</button>
          {showActivity && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              width: 380,
              maxHeight: 520,
              display: 'flex',
              flexDirection: 'column',
              background: '#171717',
              border: '1px solid #2a2a2a',
              borderRadius: 10,
              zIndex: 1000,
              boxShadow: '0 12px 32px rgba(0,0,0,0.7)',
            }}>
              {/* Header — Undo / Redo / Refresh as pill row */}
              <div style={{
                display: 'flex', gap: 6, padding: 8,
                borderBottom: '1px solid #232323', alignItems: 'center',
              }}>
                <button
                  onClick={async () => {
                    const prev = historyRef.current.pop();
                    if (!prev) return;
                    if (graphRef.current) redoRef.current.push(graphRef.current);
                    suppressHistoryRef.current = true;
                    await fetch(`${API}/graph?external=1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prev) });
                  }}
                  disabled={historyDepth === 0}
                  title="Undo (Cmd/Ctrl+Z)"
                  style={{ ...tbBtn, flex: 1, opacity: historyDepth === 0 ? 0.4 : 1 }}
                >↶ Undo{historyDepth > 0 ? ` (${historyDepth})` : ''}</button>
                <button
                  onClick={async () => {
                    const next = redoRef.current.pop();
                    if (!next) return;
                    if (graphRef.current) historyRef.current.push(graphRef.current);
                    suppressHistoryRef.current = true;
                    await fetch(`${API}/graph?external=1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
                  }}
                  disabled={redoDepth === 0}
                  title="Redo (Cmd/Ctrl+Shift+Z)"
                  style={{ ...tbBtn, flex: 1, opacity: redoDepth === 0 ? 0.4 : 1 }}
                >↷ Redo{redoDepth > 0 ? ` (${redoDepth})` : ''}</button>
              </div>
              {/* Log */}
              <div style={{ overflowY: 'auto', padding: 4, flex: 1 }}>
                {activityLog.length === 0 ? (
                  <div style={{ padding: 12, color: '#6b7280', fontSize: 12 }}>No actions yet. Move a node, edit a value, or have Claude touch the graph.</div>
                ) : (
                  activityLog.map((a) => (
                    <div key={a.id} style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid #232323',
                      fontSize: 12,
                      color: '#e5e5e5',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: a.type === 'agent' ? '#D97757' : '#9ca3af', fontWeight: 600 }}>{a.summary}</span>
                        <span style={{ color: '#6b7280', fontSize: 10 }}>{new Date(a.ts).toLocaleTimeString()}</span>
                      </div>
                      {a.details.length > 0 && (
                        <ul style={{ margin: '4px 0 0 0', padding: '0 0 0 16px', color: '#a3a3a3' }}>
                          {a.details.slice(0, 6).map((d, i) => (<li key={i} style={{ fontSize: 11 }}>{d}</li>))}
                          {a.details.length > 6 && <li style={{ fontSize: 11, color: '#6b7280' }}>+{a.details.length - 6} more</li>}
                        </ul>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <LiveIndicator
          lastSseAt={lastSseAt}
          onForceSync={async () => {
            try {
              const fresh = await fetchGraph();
              graphRef.current = fresh;
              setGraph(fresh);
              setLastSseAt(Date.now());
            } catch {}
          }}
        />
        <span style={{ fontSize: 12, opacity: 0.85 }}>Total: ${(graph?.meta.totalCost ?? 0).toFixed(3)}</span>
        <button
          onClick={() => setSettingsOpen(true)}
          title="API keys & settings"
          style={tbBtn}
        >⚙</button>
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'default',
          style: { stroke: '#6B7280', strokeWidth: 2 },
          interactionWidth: 20,
        }}
        edgesReconnectable
        edgesFocusable
        nodesDraggable
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.05}
        maxZoom={2.5}
        style={{ background: '#111418' }}
      >
        <Background variant={'dots' as never} color="#3b3f47" gap={24} size={1.4} />
        <Controls style={{ background: '#171717', border: '1px solid #2a2a2a' }} />
        <MiniMap
          nodeColor={(n) => {
            const colors: Record<string, string> = {
              'reference-image': '#7C3AED',
              'reference-video': '#7C3AED',
              'flux-image': '#F97316',
              'video-gen': '#3B82F6',
              'tts-voice': '#10B981',
              captions: '#EC4899',
              'split-screen': '#06B6D4',
              'image-overlay': '#A855F7',
              'end-card': '#B4A0E5',
              stitch: '#14B8A6',
              'video-overlay': '#0EA5E9',
              transcribe: '#38BDF8',
              group: '#A855F7',
              output: '#6B7280',
            };
            return colors[n.type ?? 'output'] ?? '#444';
          }}
          maskColor="rgba(0,0,0,0.6)"
          style={{ background: '#171717', border: '1px solid #2a2a2a' }}
        />
      </ReactFlow>
      <LibrarySidebar />
      <LightboxRoot />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// Toolbar live/stale dot. Green if SSE delivered within 18s (heartbeat is 15s
// + 3s slack), yellow up to 45s, red beyond.
function LiveIndicator({ lastSseAt, onForceSync }: { lastSseAt: number; onForceSync?: () => void }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 2000); return () => clearInterval(t); }, []);
  const ageMs = Date.now() - lastSseAt;
  const color = ageMs < 18_000 ? '#22C55E' : ageMs < 45_000 ? '#FACC15' : '#EF4444';
  const label = ageMs < 18_000 ? 'live' : ageMs < 45_000 ? `stale ${Math.round(ageMs/1000)}s` : `offline ${Math.round(ageMs/1000)}s`;
  // Click-to-resync: when SSE goes stale the dot turns yellow/red — tapping
  // it pulls a fresh graph via REST. Always clickable so the user can also
  // manually re-sync even when the indicator says "live".
  return (
    <button
      onClick={onForceSync}
      title={`Last SSE event ${Math.round(ageMs/1000)}s ago — click to force-sync`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.85,
        background: 'transparent', border: 'none', color: '#e5e5e5', cursor: 'pointer', padding: '4px 6px', borderRadius: 4,
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = '#1f1f1f')}
      onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, boxShadow: ageMs < 18_000 ? `0 0 4px ${color}` : 'none' }} />
      {label}
    </button>
  );
}

const tbBtn: React.CSSProperties = {
  background: '#171717',
  color: '#e5e5e5',
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
};

const dropdown: React.CSSProperties = {
  position: 'absolute',
  top: '110%',
  left: 0,
  background: '#171717',
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  minWidth: 180,
  zIndex: 20,
  boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
  overflow: 'hidden',
};

const dropdownItem: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  borderBottom: '1px solid #222',
};

export function App() {
  return (
    <>
      <style>{`
        @keyframes asov-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .react-flow__attribution { display: none !important; }
        /* React Flow default custom-node wrapper has a white background +
           padding + border that bleeds around our card. Strip it so only
           our NodeShell styling shows. */
        .react-flow__node {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          border-radius: 12px !important;
          /* Smoothly tween position when an external file edit moves a node. */
          transition: transform 380ms cubic-bezier(.2,.8,.2,1);
        }
        /* User-driven drag/resize must NOT animate (snaps weirdly). */
        .react-flow__node.dragging,
        .react-flow__node.selected.dragging {
          transition: none !important;
        }
        /* External-edit highlight: pulsing outline that wraps the whole card. */
        @keyframes asov-flash {
          0%   {
            outline: 4px solid rgba(217, 119, 87, 0.95);
            outline-offset: 6px;
            filter: drop-shadow(0 0 12px rgba(217, 119, 87, 0.85));
          }
          50%  {
            outline: 4px solid rgba(217, 119, 87, 0.6);
            outline-offset: 14px;
            filter: drop-shadow(0 0 24px rgba(217, 119, 87, 0.4));
          }
          100% {
            outline: 4px solid rgba(217, 119, 87, 0);
            outline-offset: 6px;
            filter: drop-shadow(0 0 0 rgba(217, 119, 87, 0));
          }
        }
        .react-flow__node.node-flash {
          animation: asov-flash 1.6s ease-out 1;
          border-radius: 14px !important;
          /* Lift flashing nodes above their neighbours so the outline-offset
             glow doesn't get clipped by adjacent cards. */
          z-index: 100 !important;
        }
        /* Ghost node = recently deleted, fading out red. */
        @keyframes asov-ghost {
          0%   { opacity: 0.95; outline: 4px solid rgba(255, 80, 80, 0.95); outline-offset: 6px; transform: scale(1); filter: drop-shadow(0 0 16px rgba(255, 80, 80, 0.8)); }
          100% { opacity: 0;    outline: 4px solid rgba(255, 80, 80, 0);    outline-offset: 6px; transform: scale(0.92); filter: drop-shadow(0 0 0 rgba(255, 80, 80, 0)); }
        }
        .react-flow__node.node-ghost {
          animation: asov-ghost 1.4s ease-out forwards;
          border-radius: 14px !important;
          z-index: 99 !important;
          pointer-events: none !important;
        }
        /* Ghost edge = recently deleted, dashed red fading out. */
        @keyframes asov-edge-ghost {
          0%   { opacity: 0.95; }
          100% { opacity: 0; }
        }
        .react-flow__edge.edge-ghost path {
          stroke-dasharray: 8 6;
          animation: asov-edge-ghost 1.4s ease-out forwards;
        }
      `}</style>
      <style>{`
        @keyframes asov-mockup-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      <ReactFlowProvider>
        <GraphEditor />
      </ReactFlowProvider>
    </>
  );
}
