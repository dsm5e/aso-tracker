// Reference Video — upload a local mp4/mov (slime, b-roll, satisfying clip)
// to feed the Split Screen node. Same pattern as ReferenceImageNode.
import { useRef, useState } from 'react';
import { NodeShell, patchData } from './common';
import { openLightbox } from '../components/Lightbox';
import { API } from '../store/graphClient';

interface Data {
  url?: string;
  label?: string;
}

export function ReferenceVideoNode({ id, data }: { id: string; data: Data }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`${API}/upload/video`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'upload failed');
      await patchData(id, { url: j.url });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <NodeShell
      id={id}
      type="reference-video"
      title={data.label || 'Reference Video'}
      status={data.url ? 'done' : 'idle'}
      outputs={[{ id: 'video', label: 'video' }]}
    >
      <div className="nodrag">
        <span className="vid-label">Upload mp4/mov (max 200MB)</span>
        <input className="ds-input"
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
          onChange={handleFile}
          disabled={busy}
        />
      </div>
      <div className="nodrag">
        <span className="vid-label">or paste URL / path</span>
        <input className="ds-input"
          type="text"
          value={data.url ?? ''}
          onChange={(e) => patchData(id, { url: e.target.value })}
          placeholder="/output/uploads/upload-…mp4 or https://"
        />
      </div>
      {err && <div className="vid-err">{err}</div>}
      {data.url && (
        <video
          key={data.url}
          src={data.url}
          controls muted
          onClick={() => openLightbox({ kind: 'video', src: data.url! })}
          style={{ width: '100%', maxHeight: 200, borderRadius: 'var(--ds-radius-control)', background: '#000', cursor: 'zoom-in' }}
        />
      )}
    </NodeShell>
  );
}
