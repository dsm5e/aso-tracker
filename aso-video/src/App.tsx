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
import { TranscribeNode } from './nodes/TranscribeNode';
import { GroupNode } from './nodes/GroupNode';
import { OutputNode } from './nodes/OutputNode';
import { installBridge } from './lib/claudeBridge';
import { LightboxRoot } from './components/Lightbox';
import { LibrarySidebar } from './components/LibrarySidebar';
import { BrandSwitcher } from './components/BrandSwitcher';
import { MockupProvider, useMockupToggle } from './components/TikTokMockup';
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
  const [mockup, setMockup] = useMockupToggle();
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
  useEffect(() => {
    let mounted = true;
    fetchGraph().then((g) => { if (mounted) { setGraph(g); graphRef.current = g; } });
    listWorkflows().then((w) => mounted && setWorkflows(w));
    listInfluencers().then((i) => mounted && setInfluencers(i));
    // Only apply graph updates when content actually changed — suppresses
    // no-op re-renders triggered by SSE heartbeats / fal.ai progress pings
    // that don't affect any visible field. Stops the canvas from flickering.
    const applyGraph = (g: GraphPayload) => {
      setLastSseAt(Date.now());
      const prev = graphRef.current ? JSON.stringify(graphRef.current) : '';
      const next = JSON.stringify(g);
      if (prev === next) return;
      graphRef.current = g;
      setGraph(g);
    };
    const dispose = subscribe(applyGraph);
    const uninstall = installBridge(() => graphRef.current);
    return () => { mounted = false; dispose(); uninstall(); };
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

  // Sync server graph → local rf state.
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

        if (dragging.has(n.id) && local) {
          return { ...local, data, type: n.type };
        }
        return { id: n.id, type: n.type, position: n.position, data, ...preserved, ...(zIndex !== undefined ? { zIndex } : {}) };
      });
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
          animated: !!isRunning,
          style: { stroke: '#6B7280', strokeWidth: 2 },
        };
      }),
    );
  }, [graph]);

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
      } else if (n.type === 'stitch' || n.type === 'split-screen') {
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
    <MockupProvider enabled={mockup}>
    <div style={{ height: '100vh', width: '100vw', background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif' }}>
      {/* toolbar */}
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10,
        display: 'flex', gap: 8, alignItems: 'center',
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
        <label
          title="Overlay TikTok UI chrome on the Output preview — visual only, not baked into mp4"
          style={{ ...tbBtn, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={mockup}
            onChange={(e) => setMockup(e.target.checked)}
            style={{ margin: 0 }}
          />
          📱 TikTok mockup
        </label>
        <button
          onClick={async () => {
            const fresh = await fetchGraph();
            graphRef.current = fresh;
            setGraph(fresh);
            setLastSseAt(Date.now());
          }}
          title="force-refresh from server"
          style={tbBtn}
        >↻</button>
        <div style={{ flex: 1 }} />
        <LiveIndicator lastSseAt={lastSseAt} />
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
        style={{ background: '#0a0a0a' }}
      >
        <Background color="#1f1f1f" gap={20} />
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
    </MockupProvider>
  );
}

// Toolbar live/stale dot. Green if SSE delivered within 18s (heartbeat is 15s
// + 3s slack), yellow up to 45s, red beyond.
function LiveIndicator({ lastSseAt }: { lastSseAt: number }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 2000); return () => clearInterval(t); }, []);
  const ageMs = Date.now() - lastSseAt;
  const color = ageMs < 18_000 ? '#22C55E' : ageMs < 45_000 ? '#FACC15' : '#EF4444';
  const label = ageMs < 18_000 ? 'live' : ageMs < 45_000 ? `stale ${Math.round(ageMs/1000)}s` : `offline ${Math.round(ageMs/1000)}s`;
  return (
    <span title={`Last SSE event ${Math.round(ageMs/1000)}s ago`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.85 }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, boxShadow: ageMs < 18_000 ? `0 0 4px ${color}` : 'none' }} />
      {label}
    </span>
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
