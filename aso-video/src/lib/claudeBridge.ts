// window.asoVideo — agent surface area for the node graph.
import {
  fetchGraph,
  createNode,
  patchNode,
  deleteNode,
  createEdge,
  deleteEdge,
  runNode,
  runAll,
  saveWorkflow,
  loadWorkflow,
  listWorkflows,
} from '../store/graphClient';
import type { GraphPayload } from '../store/types';

export function installBridge(getLocalGraph: () => GraphPayload | null) {
  const bridge = {
    getGraph: () => getLocalGraph(),
    fetchGraph,
    addNode: (input: { type: string; position?: { x: number; y: number }; data?: Record<string, unknown> }) =>
      createNode({ type: input.type, position: input.position ?? { x: 100, y: 100 }, data: input.data }),
    updateNode: (id: string, patch: Record<string, unknown>) =>
      patchNode(id, { data: patch }),
    moveNode: (id: string, position: { x: number; y: number }) =>
      patchNode(id, { position }),
    removeNode: deleteNode,
    addEdge: createEdge,
    removeEdge: deleteEdge,
    runNode,
    runAll,
    saveWorkflow,
    loadWorkflow,
    listWorkflows,
    getTotalCost: () => getLocalGraph()?.meta.totalCost ?? 0,
  };
  (window as unknown as { asoVideo: typeof bridge }).asoVideo = bridge;
  return () => {
    if ((window as unknown as { asoVideo?: unknown }).asoVideo === bridge) {
      delete (window as unknown as { asoVideo?: unknown }).asoVideo;
    }
  };
}
