// Split Screen compositor — top video (talking head) over bottom video
// (b-roll / slime). Output is a 9:16 1080×1920 mp4. Bottom auto-loops to
// match top duration.
import { NodeShell, inputStyle, labelStyle, patchData, triggerRun, stopProp } from './common';
import { openLightbox } from '../components/Lightbox';

type Ratio = '50/50' | '60/40' | '65/35' | '70/30';
type AudioSource = 'top' | 'bottom' | 'mute';

interface Data {
  label?: string;
  ratio?: Ratio;
  audioSource?: AudioSource;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  error?: string;
  progress?: number;
  stage?: string;
}

const RATIO_LABEL: Record<Ratio, string> = {
  '50/50': '50 / 50',
  '60/40': '60 / 40',
  '65/35': '65 / 35 (TikTok classic)',
  '70/30': '70 / 30',
};

export function SplitScreenNode({ id, data }: { id: string; data: Data }) {
  const ratio: Ratio = data.ratio ?? '65/35';
  const audioSource: AudioSource = data.audioSource ?? 'top';

  return (
    <NodeShell
      id={id}
      type="split-screen"
      title={data.label || 'Split Screen'}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      inputs={[
        { id: 'top', label: 'top (talking head)' },
        { id: 'bottom', label: 'bottom (b-roll)' },
      ]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel="Compose (free)"
    >
      <div className="nodrag">
        <span style={labelStyle}>Ratio (top / bottom)</span>
        <select
          className="nodrag"
          onMouseDown={stopProp}
          value={ratio}
          onChange={(e) => patchData(id, { ratio: e.target.value as Ratio })}
          style={inputStyle}
        >
          {(Object.keys(RATIO_LABEL) as Ratio[]).map((r) => (
            <option key={r} value={r}>{RATIO_LABEL[r]}</option>
          ))}
        </select>
      </div>
      <div className="nodrag">
        <span style={labelStyle}>Audio source</span>
        <select
          className="nodrag"
          onMouseDown={stopProp}
          value={audioSource}
          onChange={(e) => patchData(id, { audioSource: e.target.value as AudioSource })}
          style={inputStyle}
        >
          <option value="top">top (keep talking head audio)</option>
          <option value="bottom">bottom (keep b-roll audio)</option>
          <option value="mute">mute (no audio)</option>
        </select>
      </div>
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <>
          <video key={data.outputUrl} src={data.outputUrl} controls style={{ width: '100%', borderRadius: 6, background: '#000' }} />
          <button
            className="nodrag"
            onClick={() => openLightbox({ kind: 'video', src: data.outputUrl! })}
            title="open fullscreen"
            style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', cursor: 'zoom-in', fontSize: 11, alignSelf: 'flex-start' }}
          >⛶ fullscreen</button>
        </>
      )}
    </NodeShell>
  );
}
