import { useState } from 'react';
import { NodeShell, inputStyle, labelStyle, patchData, triggerRun, stopProp } from './common';
import { openLightbox } from '../components/Lightbox';
import { HistoryPicker } from '../components/HistoryPicker';
import { API } from '../store/graphClient';

type Model = 'kling' | 'seedance' | 'happy-horse';
// 'auto' = resolution determined by input (Kling has no resolution param).
type Resolution = 'auto' | '480p' | '720p' | '1080p';

interface Data {
  model: Model;
  mode: 'image' | 'text';
  resolution: Resolution;
  prompt?: string;
  duration: 3 | 5 | 10 | 15;
  audio: boolean;
  // Multi-shot mode (Kling V3 Pro only). When enabled, Kling generates a
  // single 15s clip composed of N consecutive shots with their own prompts.
  multiShot?: boolean;
  shots?: { prompt: string; duration: number }[];
  shotType?: 'customize' | 'intelligent';
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  cost?: number;
  elapsed?: number;
  error?: string;
  progress?: number;
  stage?: string;
  label?: string;
  // Set by the fal-jobs tracker when a request is in flight or completed.
  // Surfaced in the UI for "I see this in fal dashboard" recovery flows.
  falRequestId?: string;
  falModelPath?: string;
}

// Per fal.ai (verified 2026-05-06):
//   - Kling v3 Pro: resolution determined by input image (no param) → single 'auto' option.
//   - Seedance 2.0: 480p / 720p / 1080p — token-based pricing.
//   - Happy Horse: 720p / 1080p — flat per-second.
const SUPPORTED: Record<Model, Resolution[]> = {
  kling: ['auto'],
  seedance: ['480p', '720p', '1080p'],
  'happy-horse': ['720p', '1080p'],
};

// Pricing per fal.ai docs (2026-05-06).
function totalDuration(d: Data): number {
  if (d.multiShot && Array.isArray(d.shots) && d.shots.length) {
    return d.shots.reduce((s, x) => s + (Number(x.duration) || 0), 0);
  }
  return d.duration;
}

function estimateCost(d: Data): number {
  if (d.model === 'kling') {
    // Kling v3 Pro: $0.112/s audio off, $0.168/s audio on (voice control $0.196 not exposed).
    return totalDuration(d) * (d.audio ? 0.168 : 0.112);
  }
  if (d.model === 'happy-horse') {
    // Happy Horse: $0.14/s @ 720p, $0.28/s @ 1080p. Audio included, no surcharge.
    return d.duration * (d.resolution === '1080p' ? 0.28 : 0.14);
  }
  // Seedance 2.0 — token formula:
  //   tokens = (h × w × (input_duration + output_duration) × 24) / 1024
  //   cost   = tokens / 1000 × $0.014
  // For our pipeline input_duration=0 (no video_urls). With video_urls the cost is multiplied by 0.6.
  // image_urls do NOT trigger the discount.
  const dims =
    d.resolution === '480p' ? { w: 854, h: 480 } :
    d.resolution === '720p' ? { w: 1280, h: 720 } :
    { w: 1920, h: 1080 };
  const tokens = (dims.w * dims.h * d.duration * 24) / 1024;
  return (tokens / 1000) * 0.014;
}

function MultiShotEditor({ id, shots }: { id: string; shots: { prompt: string; duration: number }[] }) {
  const total = shots.reduce((s, x) => s + (Number(x.duration) || 0), 0);
  const update = (i: number, patch: Partial<{ prompt: string; duration: number }>) => {
    const next = shots.map((s, j) => (j === i ? { ...s, ...patch } : s));
    patchData(id, { shots: next });
  };
  const add = () => patchData(id, { shots: [...shots, { prompt: '', duration: 5 }] });
  const remove = (i: number) => patchData(id, { shots: shots.filter((_, j) => j !== i) });
  return (
    <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
      {shots.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 6, flex: 1, minHeight: 120 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...labelStyle, flex: 1 }}>Shot {i + 1}</span>
            <input
              type="number" min={1} max={15} step={1}
              value={s.duration}
              onChange={(e) => update(i, { duration: Number(e.target.value) })}
              style={{ ...inputStyle, width: 60 }}
            />
            <span style={{ fontSize: 10, color: '#9CA3AF' }}>s</span>
            {shots.length > 1 && (
              <span
                onClick={() => remove(i)}
                title="remove shot"
                style={{ cursor: 'pointer', color: '#EF4444', fontSize: 14, padding: '0 4px' }}
              >×</span>
            )}
          </div>
          <textarea
            value={s.prompt}
            onChange={(e) => update(i, { prompt: e.target.value })}
            placeholder={`shot ${i + 1} prompt — what happens here…`}
            style={{ ...inputStyle, minHeight: 50, flex: 1, resize: 'none' }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={add}
          disabled={total >= 15}
          style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 10px', cursor: total >= 15 ? 'not-allowed' : 'pointer', fontSize: 11, opacity: total >= 15 ? 0.4 : 1 }}
        >+ shot</button>
        <span style={{ fontSize: 10, color: total > 15 ? '#EF4444' : '#9CA3AF' }}>
          total {total}s {total > 15 && '(over Kling 15s cap)'}
        </span>
      </div>
    </div>
  );
}

function RecoverFalJob({ nodeId, mode, suggestedRequestId }: { nodeId: string; mode: 'image' | 'text'; suggestedRequestId?: string }) {
  const [open, setOpen] = useState(false);
  const [reqId, setReqId] = useState(suggestedRequestId ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const recover = async () => {
    if (!reqId.trim()) return;
    setBusy(true); setMsg('attaching to fal job…');
    try {
      const r = await fetch(`${API}/video/kling/recover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, request_id: reqId.trim(), mode }),
      });
      const j = await r.json();
      if (j.ok) setMsg(`✓ recovered (cost ~$${(j.cost ?? 0).toFixed(3)})`);
      else setMsg(`error: ${j.error}`);
    } catch (e) {
      setMsg(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <button
        className="nodrag"
        onClick={() => setOpen(true)}
        title="Attach to a fal.ai request_id from the dashboard and pull the result"
        style={{ background: '#171717', color: '#9CA3AF', border: '1px dashed #2a2a2a', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
      >🔌 Recover existing fal job…</button>
    );
  }
  return (
    <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, padding: 6, background: '#0e0e0e', border: '1px dashed #2a2a2a', borderRadius: 6 }}>
      <span style={{ color: '#9CA3AF', fontSize: 10 }}>Paste fal.ai request_id to pull the existing result:</span>
      <input
        type="text"
        value={reqId}
        onChange={(e) => setReqId(e.target.value)}
        placeholder="00000000-0000-0000-0000-000000000000"
        style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 6px', fontSize: 11, fontFamily: 'monospace' }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={recover} disabled={busy} style={{ flex: 1, background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : 'Recover'}</button>
        <button onClick={() => setOpen(false)} style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>×</button>
      </div>
      {msg && <span style={{ color: msg.startsWith('✓') ? '#22C55E' : '#EF4444', fontSize: 10 }}>{msg}</span>}
    </div>
  );
}

export function VideoGenNode({ id, data }: { id: string; data: Data }) {
  const supported = SUPPORTED[data.model] ?? ['720p'];
  const est = estimateCost(data);

  return (
    <NodeShell
      id={id}
      type="video-gen"
      title={data.label || `Video Gen — ${data.model}`}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      wide={(data.prompt?.length ?? 0) > 120}
      inputs={[
        { id: 'image_url', label: 'image' },
        // For Kling, image_url_2+ are mapped to `elements[]` and referenced
        // as @Element1 in the prompt (different from a regular ref image),
        // so we colour them yellow to make the binding visible.
        {
          id: 'image_url_2',
          label: data.model === 'kling' ? 'image @Element1' : 'image 2',
          // Match the Reference Image node header colour so the binding reads
          // as "drop a reference image here" at a glance.
          color: data.model === 'kling' ? '#7C3AED' : undefined,
        },
        { id: 'prompt', label: 'prompt' },
      ]}
      outputs={[{ id: 'video', label: 'video' }]}
      onRun={() => triggerRun(id)}
      runLabel={`Generate (~$${est.toFixed(2)})`}
    >
      <HistoryPicker
        kind="video"
        onPick={(url) => patchData(id, { status: 'done', outputUrl: url, error: undefined })}
      />
      <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <span style={labelStyle}>Model</span>
          <select
            className="nodrag"
            onMouseDown={stopProp}
            value={data.model}
            onChange={(e) => {
              const m = e.target.value as Model;
              const res = SUPPORTED[m].includes(data.resolution) ? data.resolution : SUPPORTED[m][0];
              patchData(id, { model: m, resolution: res });
            }}
            style={inputStyle}
          >
            <option value="kling">Kling v3 Pro</option>
            <option value="seedance">Seedance 2.0</option>
            <option value="happy-horse">Happy Horse</option>
          </select>
        </div>
        <div>
          <span style={labelStyle}>Mode</span>
          <select className="nodrag" onMouseDown={stopProp} value={data.mode} onChange={(e) => patchData(id, { mode: e.target.value })} style={inputStyle}>
            <option value="image">image</option>
            <option value="text">text</option>
          </select>
        </div>
        <div>
          <span style={labelStyle}>Resolution</span>
          <select className="nodrag" onMouseDown={stopProp} value={data.resolution} onChange={(e) => patchData(id, { resolution: e.target.value })} style={inputStyle}>
            {supported.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <span style={labelStyle}>Duration</span>
          <select className="nodrag" onMouseDown={stopProp} value={data.duration} onChange={(e) => patchData(id, { duration: Number(e.target.value) })} style={inputStyle}>
            {[3, 5, 10, 15].map((d) => <option key={d} value={d}>{d}s</option>)}
          </select>
        </div>
      </div>
      <label className="nodrag" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={data.audio} onChange={(e) => patchData(id, { audio: e.target.checked })} />
        audio
      </label>
      {data.model === 'kling' && (
        <>
          <label className="nodrag" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={!!data.multiShot}
              onChange={(e) => {
                const enabling = e.target.checked;
                const seed = data.shots?.length ? data.shots : [
                  { prompt: '', duration: 5 },
                  { prompt: '', duration: 5 },
                  { prompt: '', duration: 5 },
                ];
                patchData(id, { multiShot: enabling, shots: enabling ? seed : data.shots });
              }}
            />
            multi-shot mode (Kling, up to 15s total)
          </label>
          {data.multiShot && (
            <div className="nodrag">
              <span style={labelStyle}>Shot type</span>
              <select
                className="nodrag"
                onMouseDown={stopProp}
                value={data.shotType ?? 'customize'}
                onChange={(e) => patchData(id, { shotType: e.target.value as 'customize' | 'intelligent' })}
                style={inputStyle}
              >
                <option value="customize">customize (follow durations literally)</option>
                <option value="intelligent">intelligent (Kling decides cuts)</option>
              </select>
            </div>
          )}
        </>
      )}

      {data.multiShot ? (
        <MultiShotEditor id={id} shots={data.shots ?? []} />
      ) : (
        <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <span style={labelStyle}>Prompt</span>
          <textarea
            value={data.prompt ?? ''}
            onChange={(e) => patchData(id, { prompt: e.target.value })}
            placeholder="describe the motion…"
            style={{ ...inputStyle, minHeight: 50, flex: 1, resize: 'none' }}
          />
        </div>
      )}
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {/* Surface the fal request_id so the operator can cross-reference in
          the fal dashboard and recover the result if state was lost. */}
      {data.falRequestId && (
        <div className="nodrag" style={{ fontSize: 10, color: '#9CA3AF', wordBreak: 'break-all', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ opacity: 0.7 }}>fal:</span>
          <code style={{ background: '#0e0e0e', padding: '2px 4px', borderRadius: 3, fontSize: 10, flex: 1 }}>{data.falRequestId}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(data.falRequestId!)}
            title="copy"
            style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 3, padding: '1px 6px', fontSize: 10, cursor: 'pointer' }}
          >📋</button>
        </div>
      )}
      {(data.status === 'error' || (data.status === 'idle' && data.falRequestId)) && (
        <RecoverFalJob nodeId={id} mode={data.mode} suggestedRequestId={data.falRequestId} />
      )}
      {data.status === 'done' && data.outputUrl && (
        <>
          <video key={data.outputUrl} src={data.outputUrl} controls style={{ width: '100%', borderRadius: 6, background: '#000' }} />
          <div className="nodrag" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: '#9CA3AF' }}>
            <span>cost ${data.cost?.toFixed(3)} · {data.elapsed?.toFixed(1)}s</span>
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
