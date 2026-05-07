export type NodeType = 'reference-image' | 'reference-video' | 'flux-image' | 'video-gen' | 'tts-voice' | 'captions' | 'split-screen' | 'image-overlay' | 'end-card' | 'stitch' | 'transcribe' | 'group' | 'output';

export interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface GraphPayload {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: { updatedAt: number; totalCost: number };
}
