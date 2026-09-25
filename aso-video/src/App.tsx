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
import { ImageEditNode } from './nodes/ImageEditNode';
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
import { StudioSwitcher } from '../../shared/shell/StudioSwitcher';
// MockupProvider/useMockupToggle now live inside OutputNode itself.
import SettingsModal from './components/SettingsModal';
import { TimelineEditor } from './components/TimelineEditor';
// Adapty-style polish layer — imported after React Flow's and the shared
// switcher's styles so it is the last stylesheet in the bundle.
import './polish.css';

// Categories for the + Add Node menu. Order matters — sources first, then
// processors, then sink.
interface NodeMenuItem { type: NodeType; label: string; hint?: string }
const NODE_MENU_SECTIONS: { title: string; items: NodeMenuItem[] }[] = [
  {
    title: 'Sources',
    items: [
      { type: 'image-gen', label: '🎨 Image Gen (AI)', hint: 'GPT Image 2 / Flux 1.1 — character or asset' },
      { type: 'image-edit', label: '💇 Hairstyle Edit', hint: 'change only hair; preserve master identity, clothes and framing' },
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
function GraphEditor() {
  // The toolbar floats over the canvas and may wrap on narrow windows; publish
  // where it ends so the library rail and the timeline start right below it.
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty('--vid-chrome-top', `${Math.round(el.getBoundingClientRect().bottom) + 8}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--vid-chrome-top'); };
  }, []);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'nodes' | 'timeline'>('nodes');
  const [lastChangedIds, setLastChangedIds] = useState<Set<string>>(new Set());
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
        const runtimeChanged: string[] = [];
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
          const beforeRuntime = before.data as { status?: string; outputUrl?: string };
          const afterRuntime = n.data as { status?: string; outputUrl?: string };
          const rChanged = beforeRuntime.outputUrl !== afterRuntime.outputUrl
            || (beforeRuntime.status !== afterRuntime.status && afterRuntime.status === 'done');
          if (posChanged) moved.push(n.id);
          if (dChanged) dataChanged.push(n.id);
          if (rChanged) runtimeChanged.push(n.id);
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

        // Agent edits flash as before. Runtime media changes also flash in
        // both Nodes and Timeline so a completed generation is never silent.
        if (isExternal || runtimeChanged.length > 0) {
          const changedSet = new Set([
            ...(isExternal ? [...moved, ...dataChanged, ...added] : []),
            ...runtimeChanged,
          ]);
          if (changedSet.size > 0) {
            setFlashingIds(changedSet);
            setLastChangedIds(changedSet);
            setTimeout(() => mounted && setFlashingIds(new Set()), 1700);
            setTimeout(() => mounted && setLastChangedIds(new Set()), 3200);
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
    'image-gen': FluxImageNode as never,
    'image-edit': ImageEditNode as never,
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

  useEffect(() => {
    if (editorMode !== 'nodes' || lastChangedIds.size === 0) return;
    const changedNodes = rfNodes.filter((node) => lastChangedIds.has(node.id));
    if (changedNodes.length === 0) return;
    const timer = window.setTimeout(() => {
      rf.fitView({ nodes: changedNodes, padding: 0.28, duration: 420 });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [editorMode, lastChangedIds, rf, rfNodes]);

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
      function isUpstreamReady(src: GraphPayload['nodes'][number]): boolean {
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
            ? { stroke: 'var(--ds-c2)', strokeWidth: 3 }
            : { stroke: 'var(--ds-axis)', strokeWidth: 2 },
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
          style: { stroke: 'var(--ds-bad)', strokeWidth: 3 },
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
    let target = graphRef.current.nodes.find((n) => n.type === 'image-gen' || n.type === 'flux-image');
    if (!target) {
      const created = await createNode({ type: 'image-gen', position: { x: 200, y: 200 } });
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

      if (n.type === 'image-gen' || n.type === 'flux-image') {
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
    <div style={{ height: '100vh', width: '100vw', background: 'var(--ds-bg)', color: 'var(--ds-text)', fontFamily: 'var(--ds-font)' }}>
      {/* toolbar — wraps to multiple lines when the viewport gets narrow so
          buttons stay reachable instead of overflowing off-screen. */}
      <div className="vid-toolbar" ref={toolbarRef}>
        <StudioSwitcher current="video" />
        <div className="ds-seg" role="tablist" aria-label="Editor mode">
          <button role="tab" aria-selected={editorMode === 'nodes'} onClick={() => setEditorMode('nodes')}>Nodes</button>
          <button role="tab" aria-selected={editorMode === 'timeline'} onClick={() => setEditorMode('timeline')}>Timeline</button>
        </div>
        <div className="vid-toolbar-gap" />
        <div style={{ position: 'relative' }}>
          <button className={`ds-btn ds-btn-ghost${showLoad ? ' on' : ''}`} onClick={() => setShowLoad((v) => !v)}>
            Workflows <span className="vid-caret">▾</span>
          </button>
          {showLoad && (
            <div className="ds-pop vid-pop" style={{ minWidth: 260, maxHeight: '70vh', overflowY: 'auto' }}>
              <button className="ds-pop-row" onClick={() => { setShowLoad(false); void handleSaveWorkflow(); }}>
                Save current as…
              </button>
              <div className="vid-pop-sep" />
              <div className="ds-nav-label" style={{ padding: '4px 10px' }}>Load</div>
              {workflows.length === 0 && <div className="vid-pop-empty">No saved workflows</div>}
              {workflows.map((n) => (
                <div key={n} className="ds-pop-row" role="button" onClick={() => handleLoadWorkflow(n)}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                  <button
                    className="ds-icon-btn"
                    style={{ width: 24, height: 24, fontSize: 15 }}
                    title="Delete workflow"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete workflow "${n}"? This cannot be undone.`)) return;
                      await deleteWorkflow(n);
                      setWorkflows(await listWorkflows());
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button
            className={`ds-btn ds-btn-ghost${showInf ? ' on' : ''}`}
            onClick={async () => {
              setInfluencers(await listInfluencers());
              setShowInf((v) => !v);
            }}
          >Influencers <span className="vid-caret">▾</span></button>
          {showInf && (
            <div className="ds-pop vid-pop" style={{ minWidth: 260, maxHeight: '70vh', overflowY: 'auto' }}>
              {influencers.length === 0 && <div className="vid-pop-empty">None yet — generate an image and click Save Influencer</div>}
              {influencers.map((inf) => (
                <div key={inf.name} className="ds-pop-row" role="button" onClick={() => handleLoadInfluencer(inf)}>
                  <img src={inf.imageUrl} alt="" style={{ width: 28, height: 28, borderRadius: 'var(--ds-radius-inner)', objectFit: 'cover', background: 'var(--ds-panel-2)', flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.name}</span>
                  <button
                    className="ds-icon-btn"
                    style={{ width: 24, height: 24, fontSize: 15 }}
                    title="Delete influencer"
                    onClick={(e) => handleDeleteInfluencer(inf.name, e)}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="vid-toolbar-gap" />
        <div style={{ position: 'relative' }}>
          <button className={`ds-btn ds-btn-ghost${showAdd ? ' on' : ''}`} onClick={() => setShowAdd((v) => !v)}>
            + Add node <span className="vid-caret">▾</span>
          </button>
          {showAdd && (
            <div className="ds-pop vid-pop" style={{ minWidth: 340, maxHeight: '70vh', overflowY: 'auto' }}>
              {NODE_MENU_SECTIONS.map((section, si) => (
                <div key={section.title}>
                  {si > 0 && <div className="vid-pop-sep" />}
                  <div className="ds-nav-label" style={{ padding: '4px 10px' }}>{section.title}</div>
                  {section.items.map((it) => (
                    <button
                      key={it.type}
                      className="ds-pop-row"
                      onClick={() => handleAdd(it.type)}
                      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                    >
                      <span>{it.label}</span>
                      {it.hint && <span className="vid-pop-hint">{it.hint}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="ds-btn ds-btn-ghost" onClick={handleAutoLayout} title="Auto-arrange nodes by topology — uses each card's actual rendered size so wide/tall cards don't overlap">Arrange</button>
        <button
          className="ds-btn ds-btn-ghost ds-btn-danger"
          onClick={handleReset}
          title="Reset graph for a new video. Keeps App Screenshot and (optionally) your character Image Gen."
        >Reset</button>
        {/* TikTok mockup toggle relocated into the Output node itself. */}
        <div style={{ flex: 1 }} />
        {/* Activity dropdown — collapsed by default, right-pinned next to total/price.
            Houses Undo/Redo as a compact header inside the panel so they don't
            eat toolbar space. */}
        <div style={{ position: 'relative' }}>
          <button
            className={`ds-btn ds-btn-ghost${showActivity ? ' on' : ''}`}
            onClick={() => setShowActivity((v) => !v)}
            title="Canvas history — Undo/Redo + recent actions"
          >
            Activity
            {activityLog.length > 0 && <span className="ds-badge ds-badge-muted">{activityLog.length}</span>}
          </button>
          {showActivity && (
            <div className="ds-pop vid-pop vid-pop-right" style={{ width: 380, maxHeight: 520, display: 'flex', flexDirection: 'column', padding: 0 }}>
              <div style={{ display: 'flex', gap: 8, padding: 10, background: 'var(--ds-panel-2)' }}>
                <button
                  className="ds-btn ds-btn-sm"
                  onClick={async () => {
                    const prev = historyRef.current.pop();
                    if (!prev) return;
                    if (graphRef.current) redoRef.current.push(graphRef.current);
                    suppressHistoryRef.current = true;
                    await fetch(`${API}/graph?external=1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prev) });
                  }}
                  disabled={historyDepth === 0}
                  title="Undo (Cmd/Ctrl+Z)"
                  style={{ flex: 1 }}
                >↶ Undo{historyDepth > 0 ? ` (${historyDepth})` : ''}</button>
                <button
                  className="ds-btn ds-btn-sm"
                  onClick={async () => {
                    const next = redoRef.current.pop();
                    if (!next) return;
                    if (graphRef.current) historyRef.current.push(graphRef.current);
                    suppressHistoryRef.current = true;
                    await fetch(`${API}/graph?external=1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
                  }}
                  disabled={redoDepth === 0}
                  title="Redo (Cmd/Ctrl+Shift+Z)"
                  style={{ flex: 1 }}
                >↷ Redo{redoDepth > 0 ? ` (${redoDepth})` : ''}</button>
              </div>
              <div style={{ overflowY: 'auto', padding: 6, flex: 1 }}>
                {activityLog.length === 0 ? (
                  <div className="vid-pop-empty">No actions yet. Move a node, edit a value, or have Claude touch the graph.</div>
                ) : (
                  activityLog.map((a) => (
                    <div key={a.id} style={{ padding: '8px 10px', borderRadius: 'var(--ds-radius-inner)', fontSize: 13, color: 'var(--ds-text)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: a.type === 'agent' ? 'var(--ds-accent)' : 'var(--ds-text)', fontWeight: 600 }}>{a.summary}</span>
                        <span className="vid-meta">{new Date(a.ts).toLocaleTimeString()}</span>
                      </div>
                      {a.details.length > 0 && (
                        <ul style={{ margin: '4px 0 0 0', padding: '0 0 0 16px', color: 'var(--ds-muted)', fontSize: 12, lineHeight: '17px' }}>
                          {a.details.slice(0, 6).map((d, i) => (<li key={i}>{d}</li>))}
                          {a.details.length > 6 && <li style={{ color: 'var(--ds-subtle)' }}>+{a.details.length - 6} more</li>}
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
        <span className="vid-meta vid-total" title="Total spend on this graph">Total ${(graph?.meta.totalCost ?? 0).toFixed(3)}</span>
        <button
          className="ds-btn ds-btn-ghost vid-toolbar-icon"
          onClick={() => setSettingsOpen(true)}
          title="API keys & settings"
          aria-label="Settings"
        >⚙</button>
        {/* The one solid primary action sits at the end of the row, away from Reset. */}
        <button className="ds-btn ds-btn-primary" onClick={() => runAll()}>▶ Run All</button>
      </div>

      {editorMode === 'nodes' ? <ReactFlow
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
          style: { stroke: 'var(--ds-axis)', strokeWidth: 2 },
          interactionWidth: 20,
        }}
        edgesReconnectable
        edgesFocusable
        nodesDraggable
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.05}
        maxZoom={2.5}
        style={{ background: 'var(--vid-canvas)' }}
      >
        <Background variant={'dots' as never} color="var(--vid-canvas-dots)" gap={24} size={1.4} />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const colors: Record<string, string> = {
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
              'end-card': 'var(--vid-cat-compose)',
              stitch: 'var(--vid-cat-compose)',
              'video-overlay': 'var(--vid-cat-compose)',
              transcribe: 'var(--vid-cat-compose)',
              group: 'var(--ds-dim)',
              output: 'var(--vid-cat-output)',
            };
            return colors[n.type ?? 'output'] ?? 'var(--ds-dim)';
          }}
          maskColor="color-mix(in srgb, var(--ds-bg) 70%, transparent)"
          bgColor="var(--ds-panel)"
        />
      </ReactFlow> : graph ? (
        <TimelineEditor graph={graph} changedIds={lastChangedIds} onPatch={(id, data) => patchNode(id, { data })} />
      ) : null}
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
  const color = ageMs < 18_000 ? 'var(--ds-good)' : ageMs < 45_000 ? 'var(--ds-warn)' : 'var(--ds-bad)';
  const label = ageMs < 18_000 ? 'live' : ageMs < 45_000 ? `stale ${Math.round(ageMs/1000)}s` : `offline ${Math.round(ageMs/1000)}s`;
  // Click-to-resync: when SSE goes stale the dot turns yellow/red — tapping
  // it pulls a fresh graph via REST. Always clickable so the user can also
  // manually re-sync even when the indicator says "live".
  return (
    <button
      className="ds-btn ds-btn-ghost vid-live"
      onClick={onForceSync}
      title={`Last SSE event ${Math.round(ageMs/1000)}s ago — click to force-sync`}
    >
      <span className="vid-dot" style={{ background: color }} />
      {label}
    </button>
  );
}

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
          border-radius: var(--ds-radius-card) !important;
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
            outline: 4px solid color-mix(in srgb, var(--ds-c2) 95%, transparent);
            outline-offset: 6px;
            filter: drop-shadow(0 0 12px color-mix(in srgb, var(--ds-c2) 85%, transparent));
          }
          50%  {
            outline: 4px solid color-mix(in srgb, var(--ds-c2) 60%, transparent);
            outline-offset: 14px;
            filter: drop-shadow(0 0 24px color-mix(in srgb, var(--ds-c2) 40%, transparent));
          }
          100% {
            outline: 4px solid transparent;
            outline-offset: 6px;
            filter: drop-shadow(0 0 0 transparent);
          }
        }
        .react-flow__node.node-flash {
          animation: asov-flash 1.6s ease-out 1;
          border-radius: var(--ds-radius-card) !important;
          /* Lift flashing nodes above their neighbours so the outline-offset
             glow doesn't get clipped by adjacent cards. */
          z-index: 100 !important;
        }
        /* Ghost node = recently deleted, fading out red. */
        @keyframes asov-ghost {
          0%   { opacity: 0.95; outline: 4px solid color-mix(in srgb, var(--ds-bad) 95%, transparent); outline-offset: 6px; transform: scale(1); filter: drop-shadow(0 0 16px color-mix(in srgb, var(--ds-bad) 80%, transparent)); }
          100% { opacity: 0;    outline: 4px solid transparent;    outline-offset: 6px; transform: scale(0.92); filter: drop-shadow(0 0 0 transparent); }
        }
        .react-flow__node.node-ghost {
          animation: asov-ghost 1.4s ease-out forwards;
          border-radius: var(--ds-radius-card) !important;
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
        .timeline-editor {
          grid-template-rows: minmax(220px, 1fr) clamp(240px, 39vh, 330px);
          transition: left 160ms ease;
        }
        .timeline-preview-row {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) minmax(230px, 280px);
        }
        .timeline-stage {
          height: calc(100% - 8px);
          max-height: 570px;
          max-width: calc(100% - 8px);
        }
        @media (max-height: 720px) {
          .timeline-editor {
            grid-template-rows: minmax(180px, 1fr) 250px;
          }
          .timeline-stage {
            max-height: 100%;
          }
        }
        @media (max-width: 900px) {
          .timeline-preview-row {
            grid-template-columns: minmax(220px, 1fr) 220px;
          }
          .timeline-inspector {
            padding: 10px !important;
          }
        }
        @media (max-width: 680px) {
          .timeline-editor {
            grid-template-rows: minmax(190px, 42vh) minmax(250px, 1fr);
          }
          .timeline-preview-row {
            grid-template-columns: 1fr;
          }
          .timeline-inspector {
            display: none;
          }
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
