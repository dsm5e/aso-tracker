import { NodeShell, inputStyle, labelStyle, patchData, triggerRun, stopProp } from './common';

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
      <div className="nodrag">
        <span style={labelStyle}>Text</span>
        <textarea
          value={data.text ?? ''}
          onChange={(e) => patchData(id, { text: e.target.value })}
          placeholder="say something…"
          style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
        />
      </div>
      <div className="nodrag">
        <span style={labelStyle}>Voice</span>
        <select className="nodrag" onMouseDown={stopProp} value={data.voice ?? VOICES[0]} onChange={(e) => patchData(id, { voice: e.target.value })} style={inputStyle}>
          {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <audio src={data.outputUrl} controls style={{ width: '100%' }} />
      )}
    </NodeShell>
  );
}
