// Transcribe — runs whisper STT on the upstream video and exposes the
// word-level timings inline. Pass-through node: video output = video input,
// downstream nodes (overlays, captions) keep working unchanged. Used to peek
// exact word times so the user can align Image Overlay start/end to specific
// spoken words ("teeth", "falling", etc.) before burning anything.
import { NodeShell, labelStyle, triggerRun } from './common';

interface Word { text: string; start: number; end: number }

interface Data {
  label?: string;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  words?: Word[];
  cached?: boolean;
  cost?: number;
  error?: string;
  progress?: number;
  stage?: string;
}

export function TranscribeNode({ id, data }: { id: string; data: Data }) {
  const words = data.words ?? [];
  return (
    <NodeShell
      id={id}
      type="transcribe"
      title={data.label || 'Transcribe (STT, peek timings)'}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      inputs={[{ id: 'video', label: 'video' }]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel={`Transcribe (~$0.02${data.cached ? ' cached' : ''})`}
    >
      <div style={{ ...labelStyle, padding: '4px 4px 0', lineHeight: 1.4 }}>
        Pass-through node. Runs whisper on upstream audio, caches word
        timings — copy the start/end of any word into Image Overlay's
        Start/End fields for precise alignment.
      </div>
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {data.status === 'done' && words.length > 0 && (
        <div className="nodrag" style={{
          maxHeight: 260, overflowY: 'auto',
          background: '#0a0a0a', border: '1px solid #2a2a2a',
          borderRadius: 6, padding: 6, fontSize: 11,
          fontFamily: 'ui-monospace, monospace',
        }}>
          {words.map((w, i) => (
            <div
              key={i}
              onClick={() => navigator.clipboard?.writeText(`${w.start.toFixed(2)},${w.end.toFixed(2)}`).catch(() => {})}
              title="Click to copy 'start,end' to clipboard"
              style={{
                display: 'flex', gap: 8,
                padding: '2px 4px',
                borderBottom: i < words.length - 1 ? '1px solid #1a1a1a' : 'none',
                cursor: 'pointer',
              }}
            >
              <span style={{ color: '#6B7280', minWidth: 96 }}>{w.start.toFixed(2)}–{w.end.toFixed(2)}s</span>
              <span style={{ color: '#e5e5e5' }}>{w.text}</span>
            </div>
          ))}
        </div>
      )}
      {data.status === 'done' && words.length === 0 && (
        <div style={{ color: '#9CA3AF', fontSize: 11 }}>(no words found in audio)</div>
      )}
    </NodeShell>
  );
}
