import { NodeShell, patchData, triggerRun, stopProp } from './common';

interface Data {
  label?: string;
  text?: string;
  voice?: string;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  cost?: number;
  error?: string;
}

const VOICES = [
  'en_female_emotional',
  'en_female_ht_f08_warmy_breeze',
  'en_us_001',
  'en_female_samc',
  'en_us_007',
  'en_female_betty',
];

export function TtsVoiceNode({ id, data }: { id: string; data: Data }) {
  return (
    <NodeShell
      id={id}
      type="tts-voice"
      title={data.label || 'TTS Voice'}
      status={data.status}
      outputs={[{ id: 'audio', label: 'audio' }]}
      onRun={() => triggerRun(id)}
      runLabel="Generate"
    >
      <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <span className="vid-label">Text</span>
        <textarea className="ds-textarea"
          value={data.text ?? ''}
          onChange={(e) => patchData(id, { text: e.target.value })}
          placeholder="say something…"
          style={{ minHeight: 60, flex: 1, resize: 'none' }}
        />
      </div>
      <div className="nodrag">
        <span className="vid-label">Voice</span>
        <select className="nodrag ds-select" onMouseDown={stopProp} value={data.voice ?? VOICES[0]} onChange={(e) => patchData(id, { voice: e.target.value })}>
          {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      {data.error && <div className="vid-err">{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <audio src={data.outputUrl} controls style={{ width: '100%' }} />
      )}
    </NodeShell>
  );
}
