import { useState } from 'react';
import { NodeShell, inputStyle, labelStyle, patchData, triggerRun, stopProp } from './common';
import { openLightbox } from '../components/Lightbox';
import { API } from '../store/graphClient';

type Model = 'gpt-image-2' | 'flux-1.1-pro';
type Quality = 'low' | 'medium' | 'high' | 'auto';
type Usage = 'character' | 'asset';

interface Data {
  label?: string;
  model?: Model;
  prompt?: string;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  quality?: Quality; // gpt-image-2 only
  /**
   * Distinguishes influencer/character portraits (Kling start frame, can be
   * saved as a reusable Influencer preset) from generic asset images
   * (overlays, B-roll). Hides the "Save Influencer" button when 'asset'.
   */
  usage?: Usage;
  status?: 'idle' | 'loading' | 'done' | 'error';
  outputUrl?: string;
  cost?: number;
  error?: string;
  progress?: number;
  stage?: string;
}

const MODEL_LABELS: Record<Model, string> = {
  'gpt-image-2': 'GPT-Image-2',
  'flux-1.1-pro': 'Flux 1.1 Pro',
};

function estimateCost(model: Model, quality: Quality): string {
  if (model === 'flux-1.1-pro') return '~$0.04';
  // gpt-image-2 quality cost approx (1024×1024 with output tokens)
  if (quality === 'low') return '~$0.011';
  if (quality === 'medium') return '~$0.04';
  if (quality === 'high') return '~$0.17';
  return '~$0.04–0.17 (auto)';
}

async function saveAsInfluencer(name: string, payload: Record<string, unknown>) {
  const r = await fetch(`${API}/influencers/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, ...payload }),
  });
  if (!r.ok) throw new Error(`save failed: ${r.status}`);
  return r.json();
}

export function FluxImageNode({ id, data }: { id: string; data: Data }) {
  const model: Model = data.model ?? 'gpt-image-2';
  const quality: Quality = data.quality ?? 'medium';
  const usage: Usage = data.usage ?? 'character';
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!data.outputUrl || !data.prompt) return;
    const name = window.prompt('Influencer name (alphanumeric, _, -):');
    if (!name) return;
    setSaving(true);
    try {
      await saveAsInfluencer(name, {
        prompt: data.prompt,
        model,
        aspectRatio: data.aspectRatio ?? '9:16',
        quality,
        imageUrl: data.outputUrl,
      });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <NodeShell
      id={id}
      type="flux-image"
      title={data.label || (usage === 'asset' ? 'Image Gen — Asset' : 'Image Gen — Character')}
      status={data.status}
      progress={data.progress}
      stage={data.stage}
      wide={(data.prompt?.length ?? 0) > 120}
      // Visually separate: character = orange, asset = amber.
      accentColor={usage === 'asset' ? '#EAB308' : '#F97316'}
      outputs={[{ id: 'image', label: 'image' }]}
      onRun={() => triggerRun(id)}
      runLabel={`Generate (${estimateCost(model, quality)})`}
    >
      <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <span style={labelStyle}>Type</span>
          <select
            className="nodrag"
            onMouseDown={stopProp}
            value={usage}
            onChange={(e) => patchData(id, { usage: e.target.value as Usage })}
            style={inputStyle}
            title="Character = saveable influencer/model portrait. Asset = generic image (overlays, B-roll)."
          >
            <option value="character">👤 Character</option>
            <option value="asset">🖼 Asset</option>
          </select>
        </div>
        <div>
          <span style={labelStyle}>Model</span>
          <select
            className="nodrag"
            onMouseDown={stopProp}
            value={model}
            onChange={(e) => patchData(id, { model: e.target.value as Model })}
            style={inputStyle}
          >
            <option value="gpt-image-2">{MODEL_LABELS['gpt-image-2']}</option>
            <option value="flux-1.1-pro">{MODEL_LABELS['flux-1.1-pro']}</option>
          </select>
        </div>
      </div>
      <div className="nodrag">
        <span style={labelStyle}>Prompt</span>
        <textarea
          value={data.prompt ?? ''}
          onChange={(e) => patchData(id, { prompt: e.target.value })}
          placeholder="describe the image…"
          style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
        />
      </div>
      <div className="nodrag">
        <span style={labelStyle}>Aspect</span>
        <select
          className="nodrag"
          onMouseDown={stopProp}
          value={data.aspectRatio ?? '9:16'}
          onChange={(e) => patchData(id, { aspectRatio: e.target.value as Data['aspectRatio'] })}
          style={inputStyle}
        >
          <option value="9:16">9:16 (vertical)</option>
          <option value="16:9">16:9 (landscape)</option>
          <option value="1:1">1:1 (square)</option>
        </select>
      </div>
      {model === 'gpt-image-2' && (
        <div className="nodrag">
          <span style={labelStyle}>Quality</span>
          <select
            className="nodrag"
            onMouseDown={stopProp}
            value={quality}
            onChange={(e) => patchData(id, { quality: e.target.value as Quality })}
            style={inputStyle}
          >
            <option value="low">low ($0.011)</option>
            <option value="medium">medium ($0.04)</option>
            <option value="high">high ($0.17)</option>
            <option value="auto">auto</option>
          </select>
        </div>
      )}
      {data.error && <div style={{ color: '#EF4444', fontSize: 11 }}>{data.error}</div>}
      {data.status === 'done' && data.outputUrl && (
        <>
          <img
            src={data.outputUrl}
            alt="output"
            onClick={() => openLightbox({ kind: 'image', src: data.outputUrl! })}
            style={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 6, background: '#0a0a0a', cursor: 'zoom-in' }}
          />
          <div className="nodrag" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {typeof data.cost === 'number' && (
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>cost ${data.cost.toFixed(3)}</span>
            )}
            <div style={{ flex: 1 }} />
            {usage === 'character' && (
              <button
                onClick={handleSave}
                disabled={saving}
                title="Save prompt + image as a reusable influencer preset"
                style={{ background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}
              >{saving ? '…saving' : '💾 Save Influencer'}</button>
            )}
          </div>
        </>
      )}
    </NodeShell>
  );
}
