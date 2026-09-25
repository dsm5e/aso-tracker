import { useState } from 'react';
import { NodeShell, patchData, triggerRun, stopProp } from './common';
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
        <div key={i} className="vid-subcard" style={{ flex: 1, minHeight: 120 }}>
          <div className="vid-row">
            <span className="vid-label" style={{ flex: 1, margin: 0 }}>Shot {i + 1}</span>
            <input className="ds-input"
              type="number" min={1} max={15} step={1}
              value={s.duration}
              onChange={(e) => update(i, { duration: Number(e.target.value) })}
              style={{ width: 64 }}
            />
            <span className="vid-meta">s</span>
            {shots.length > 1 && (
              <button
                type="button"
                className="ds-icon-btn"
                onClick={() => remove(i)}
                title="Remove shot"
                style={{ width: 28, height: 28, fontSize: 16 }}
              >×</button>
            )}
          </div>
          <textarea className="ds-textarea"
            value={s.prompt}
            onChange={(e) => update(i, { prompt: e.target.value })}
            placeholder={`shot ${i + 1} prompt — what happens here…`}
            style={{ minHeight: 50, flex: 1, resize: 'none' }}
          />
        </div>
      ))}
      <div className="vid-row">
        <button
          type="button"
          className="ds-btn ds-btn-sm"
          onClick={add}
          disabled={total >= 15}
        >+ Shot</button>
        <span className="vid-meta" style={{ color: total > 15 ? 'var(--ds-bad)' : undefined }}>
          total {total}s {total > 15 && '(over Kling 15s cap)'}
        </span>
      </div>
    </div>
  );
}

// Four lifecycle stages we can derive from fal's queue state. The exact
// per-stage timings (warm-start / execute) come from the final result, but
// while a job is in flight we can map status to a step.
const FAL_STAGES: Array<{ key: string; label: string; matches: (s?: string) => boolean }> = [
  { key: 'submitted', label: 'Submitted', matches: () => true }, // always true once we have a request_id
  { key: 'queued', label: 'Queued', matches: (s) => !!s && /queue/i.test(s) },
  { key: 'generating', label: 'Generating', matches: (s) => !!s && /generat|progress|warm|execut/i.test(s) },
  { key: 'done', label: 'Done', matches: (s) => s === 'done' },
];

function StageTimeline({ stage, progress }: { stage?: string; progress?: number }) {
  // Determine the highest-index stage that "matches" — once we hit that,
  // all earlier stages are also "passed".
  let activeIdx = 0;
  for (let i = FAL_STAGES.length - 1; i >= 0; i--) {
    if (FAL_STAGES[i].matches(stage)) { activeIdx = i; break; }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ds-muted)' }}>
      {FAL_STAGES.map((s, i) => {
        const past = i < activeIdx;
        const active = i === activeIdx;
        const dotColor = past ? 'var(--ds-good)' : (active ? 'var(--ds-warn)' : 'var(--ds-dim)');
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: active ? `0 0 4px ${dotColor}` : 'none', animation: active ? 'asov-pulse 1.2s ease-in-out infinite' : undefined, flex: '0 0 auto' }} />
            <span style={{ color: active ? 'var(--ds-warn)' : (past ? 'var(--ds-good)' : 'var(--ds-subtle)'), fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{s.label}</span>
            {i < FAL_STAGES.length - 1 && <span style={{ flex: 1, height: 1, background: past ? 'var(--ds-good)' : 'var(--ds-dim)', minWidth: 6 }} />}
          </div>
        );
      })}
      {typeof progress === 'number' && <span style={{ color: 'var(--ds-warn)', fontSize: 11, fontWeight: 600, marginLeft: 4 }}>{Math.round(progress * 100)}%</span>}
    </div>
  );
}

function InflightControls({ nodeId, stage, progress }: { nodeId: string; stage?: string; progress?: number }) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${API}/video/kling/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      });
    } finally { setBusy(false); }
  };
  const regenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${API}/video/kling/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      });
      // Tiny delay to let cancel propagate to graph state, then re-trigger run.
      await new Promise((r) => setTimeout(r, 400));
      triggerRun(nodeId);
    } finally { setBusy(false); }
  };
  return (
    <div className="nodrag vid-subcard" style={{ background: 'var(--ds-warn-soft)' }}>
      <StageTimeline stage={stage} progress={progress} />
      <div className="vid-row">
        <button onClick={cancel} disabled={busy} title="Cancel the fal job — stops compute, no cost for unfinished work" className="ds-btn ds-btn-sm ds-btn-danger" style={{ flex: 1 }}>⏹ Stop</button>
        <button onClick={regenerate} disabled={busy} title="Cancel and immediately resubmit with current settings" className="ds-btn ds-btn-sm vid-run" style={{ flex: 1 }}>↻ Regenerate</button>
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
        className="ds-btn ds-btn-sm ds-btn-ghost nodrag"
        onClick={() => setOpen(true)}
        title="Attach to a fal.ai request_id from the dashboard and pull the result"
        style={{ justifyContent: 'flex-start', color: 'var(--ds-muted)' }}
      >🔌 Recover existing fal job…</button>
    );
  }
  return (
    <div className="nodrag vid-subcard">
      <span className="vid-meta">Paste fal.ai request_id to pull the existing result:</span>
      <input
        type="text"
        value={reqId}
        onChange={(e) => setReqId(e.target.value)}
        placeholder="00000000-0000-0000-0000-000000000000"
        className="ds-input"
        style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 12 }}
      />
      <div className="vid-row">
        <button onClick={recover} disabled={busy} className="ds-btn ds-btn-sm vid-run" style={{ flex: 1 }}>{busy ? '…' : 'Recover'}</button>
        <button onClick={() => setOpen(false)} className="ds-btn ds-btn-sm" title="Close">×</button>
      </div>
      {msg && <span style={{ color: msg.startsWith('✓') ? 'var(--ds-good)' : 'var(--ds-bad)', fontSize: 12 }}>{msg}</span>}
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
          color: data.model === 'kling' ? 'var(--vid-cat-source)' : undefined,
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
      <div className="nodrag">
        <span className="vid-label">Mode</span>
        <select className="nodrag ds-select" onMouseDown={stopProp} value={data.mode} onChange={(e) => patchData(id, { mode: e.target.value })}>
          <option value="image">image</option>
          <option value="text">text</option>
        </select>
      </div>
      <div className="nodrag vid-grid2">
        <div>
          <span className="vid-label">Model</span>
          <select
            className="nodrag ds-select"
            onMouseDown={stopProp}
            value={data.model}
            onChange={(e) => {
              const m = e.target.value as Model;
              const res = SUPPORTED[m].includes(data.resolution) ? data.resolution : SUPPORTED[m][0];
              patchData(id, { model: m, resolution: res });
            }}
          >
            <option value="kling">Kling v3 Pro</option>
            <option value="seedance">Seedance 2.0</option>
            <option value="happy-horse">Happy Horse</option>
          </select>
        </div>
        <div>
          <span className="vid-label">Resolution</span>
          <select className="nodrag ds-select" onMouseDown={stopProp} value={data.resolution} onChange={(e) => patchData(id, { resolution: e.target.value })}>
            {supported.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {/* Top-level duration is meaningless in multi-shot mode — backend uses sum of shot durations.
            Hide it to stop misleading the user. */}
        {!data.multiShot && (
          <div>
            <span className="vid-label">Duration</span>
            <select className="nodrag ds-select" onMouseDown={stopProp} value={data.duration} onChange={(e) => patchData(id, { duration: Number(e.target.value) })}>
              {[3, 5, 10, 15].map((d) => <option key={d} value={d}>{d}s</option>)}
            </select>
          </div>
        )}
        {data.multiShot && (
          <div>
            <span className="vid-label">Total (computed)</span>
            <div className="ds-input" style={{ color: 'var(--ds-muted)', display: 'flex', alignItems: 'center' }}>
              {totalDuration(data)}s
            </div>
          </div>
        )}
      </div>
      <label className="nodrag vid-check">
        <input type="checkbox" checked={data.audio} onChange={(e) => patchData(id, { audio: e.target.checked })} />
        audio
      </label>
      {data.model === 'kling' && (
        <>
          <label className="nodrag vid-check">
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
              <span className="vid-label">Shot type</span>
              <select
                className="nodrag ds-select"
                onMouseDown={stopProp}
                value={data.shotType ?? 'customize'}
                onChange={(e) => patchData(id, { shotType: e.target.value as 'customize' | 'intelligent' })}
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
          <span className="vid-label">Prompt</span>
          <textarea className="ds-textarea"
            value={data.prompt ?? ''}
            onChange={(e) => patchData(id, { prompt: e.target.value })}
            placeholder="describe the motion…"
            style={{ minHeight: 50, flex: 1, resize: 'none' }}
          />
        </div>
      )}
      {data.error && <div className="vid-err">{data.error}</div>}
      {/* In-flight controls — Stop / Regenerate when a fal job is running.
          Without this the Generate button would just submit a second parallel
          job and we'd pay for both. */}
      {data.status === 'loading' && (
        <InflightControls nodeId={id} stage={data.stage} progress={data.progress} />
      )}
      {/* Surface the fal request_id so the operator can cross-reference in
          the fal dashboard and recover the result if state was lost. */}
      {data.falRequestId && (
        <div className="nodrag vid-row vid-meta" style={{ wordBreak: 'break-all' }}>
          <span style={{ opacity: 0.7 }}>fal:</span>
          <code style={{ background: 'var(--ds-panel-2)', padding: '4px 6px', borderRadius: 'var(--ds-radius-inner)', fontSize: 11, fontFamily: 'var(--ds-font-mono)', flex: 1 }}>{data.falRequestId}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(data.falRequestId!)}
            title="copy"
            className="ds-icon-btn"
            style={{ width: 28, height: 28 }}
          >📋</button>
        </div>
      )}
      {(data.status === 'error' || (data.status === 'idle' && data.falRequestId)) && (
        <RecoverFalJob nodeId={id} mode={data.mode} suggestedRequestId={data.falRequestId} />
      )}
      {data.status === 'done' && data.outputUrl && (
        <>
          <video key={data.outputUrl} src={data.outputUrl} controls style={{ width: '100%', borderRadius: 'var(--ds-radius-control)', background: '#000' }} />
          <div className="nodrag vid-row vid-meta">
            <span>cost ${data.cost?.toFixed(3)} · {data.elapsed?.toFixed(1)}s</span>
            <div style={{ flex: 1 }} />
            <button className="ds-btn ds-btn-sm"
              onClick={() => openLightbox({ kind: 'video', src: data.outputUrl! })}
              title="open fullscreen"
            >⛶ fullscreen</button>
          </div>
        </>
      )}
    </NodeShell>
  );
}
