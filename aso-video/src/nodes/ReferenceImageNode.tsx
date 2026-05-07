import { useRef, useState } from 'react';
import { NodeShell, inputStyle, labelStyle, patchData } from './common';
import { openLightbox } from '../components/Lightbox';
import { API } from '../store/graphClient';

interface Data {
  url?: string;
  label?: string;
}

export function ReferenceImageNode({ id, data }: { id: string; data: Data }) {
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
      const r = await fetch(`${API}/upload/image`, { method: 'POST', body: fd });
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
      type="reference-image"
      title={data.label || 'Reference Image'}
      status={data.url ? 'done' : 'idle'}
      outputs={[{ id: 'image', label: 'image' }]}
    >
      <div className="nodrag">
        <span style={labelStyle}>Upload</span>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} style={{ ...inputStyle, padding: 4 }} disabled={busy} />
      </div>
      <div className="nodrag">
        <span style={labelStyle}>or URL</span>
        <input
          type="text"
          value={data.url ?? ''}
          onChange={(e) => patchData(id, { url: e.target.value })}
          placeholder="https://…"
          style={inputStyle}
        />
      </div>
      {err && <div style={{ color: '#EF4444', fontSize: 11 }}>{err}</div>}
      {data.url && (
        <img
          src={data.url}
          alt="ref"
          onClick={() => openLightbox({ kind: 'image', src: data.url! })}
          style={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 6, background: '#0a0a0a', cursor: 'zoom-in' }}
        />
      )}
    </NodeShell>
  );
}
