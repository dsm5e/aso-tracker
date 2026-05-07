// Captions node — takes a video upstream, runs whisper STT to get word
// timings, then burns CapCut-style ASS subtitles via ffmpeg. Output is a new
// video with subs baked in. Style preset + font size + bottom margin are tweakable.
//
// To peek word timings before burning (e.g. to align Image Overlays), use
// the dedicated `Transcribe` node upstream — same whisper, pass-through video.
import { NodeShell, inputStyle, labelStyle, patchData, triggerRun, stopProp } from './common';
import { openLightbox } from '../components/Lightbox';

type Preset =
  | 'capcut-classic'
  | 'minimal'
  | 'bold-yellow'
  | 'hormozi'
  | 'subway-surfer'
  | 'tiktok-native'
  | 'neon-glow'
  | 'karaoke-pop';

interface Data {
  label?: string;
  preset?: Preset;
  fontSize?: number;
  marginV?: number;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  cost?: number;
  error?: string;
  progress?: number;
  stage?: string;
}

const PRESET_LABEL: Record<Preset, string> = {
  'capcut-classic': 'CapCut Classic (white + outline)',
  'minimal': 'Minimal (small white, no outline)',
  'bold-yellow': 'Bold Yellow (Impact, basic)',
  'hormozi': 'Hormozi (yellow + thick outline, viral)',
  'subway-surfer': 'Subway Surfer (white, bouncy pop)',
  'tiktok-native': 'TikTok Native (black pill background)',
  'neon-glow': 'Neon Glow (pink + cyan glow)',
  'karaoke-pop': 'Karaoke Pop (green highlight)',
};

export function CaptionsNode({ id, data }: { id: string; data: Data }) {
  const preset: Preset = data.preset ?? 'capcut-classic';
  const fontSize = data.fontSize ?? 140;
  const marginV = data.marginV ?? 400;

  return (
    <NodeShell
      id={id}
      type="captions"
      title={data.label || 'Captions'}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      inputs={[{ id: 'video', label: 'video' }]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel="Burn Captions (~$0.01)"
    >
      <div className="nodrag">
        <span style={labelStyle}>Style</span>
        <select
          className="nodrag"
          onMouseDown={stopProp}
          value={preset}
          onChange={(e) => patchData(id, { preset: e.target.value as Preset })}
          style={inputStyle}
        >
          {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
            <option key={p} value={p}>{PRESET_LABEL[p]}</option>
          ))}
        </select>
      </div>
      <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <span style={labelStyle}>Font Size</span>
          <input
            type="number"
            min={24}
            max={140}
            step={4}
            value={fontSize}
            onChange={(e) => patchData(id, { fontSize: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>
        <div>
          <span style={labelStyle}>Bottom Margin (px)</span>
          <input
            type="number"
            min={0}
            max={1500}
            step={20}
            value={marginV}
            onChange={(e) => patchData(id, { marginV: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>
      </div>
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <>
          <video key={data.outputUrl} src={data.outputUrl} controls style={{ width: '100%', borderRadius: 6, background: '#000' }} />
          <div className="nodrag" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: '#9CA3AF' }}>
            <span>burned</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => openLightbox({ kind: 'video', src: data.outputUrl! })}
              title="open fullscreen"
              style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', cursor: 'zoom-in', fontSize: 11 }}
            >⛶ fullscreen</button>
          </div>
        </>
      )}
    </NodeShell>
  );
}
