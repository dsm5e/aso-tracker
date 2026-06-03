import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudio } from '../state/studio';
import type { IconVariant } from '../state/studio';
import { Button, Card } from '../components/shared';
import { Plus, Trash2, X, UploadCloud, Wand2, Download, Loader2, ArrowLeft } from 'lucide-react';
import { generateIcon } from '../lib/ppoGenerate';
import { downloadIcon, exportAllIcons, type ExportProgress } from '../lib/ppoExport';

const MAX_BASE_DIM = 1024; // px — base image is scaled to fit this before upload

/** Read a File and return a JPEG data URL scaled to fit MAX_BASE_DIM. Keeps
 *  state size sane (data URLs live in state.json + localStorage). */
async function readScaledBase(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const ratio = Math.min(MAX_BASE_DIM / img.width, MAX_BASE_DIM / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.9);
}

export function IconGeneratorScreen() {
  const nav = useNavigate();
  const iconLab = useStudio((s) => s.iconLab);
  const iconLabInit = useStudio((s) => s.iconLabInit);
  const iconLabAddVariant = useStudio((s) => s.iconLabAddVariant);
  const [exportAllProg, setExportAllProg] = useState<ExportProgress | null>(null);

  // Lazy-init on first visit so all selectors see the subtree.
  useEffect(() => {
    if (!iconLab) iconLabInit();
  }, [iconLab, iconLabInit]);

  const variants = iconLab?.variants ?? [];
  const anyDone = variants.some((v) => v.generation.generateState === 'done');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--s-9) var(--s-7)' }}>
      <div style={{ width: '100%', maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <button
              type="button"
              onClick={() => nav('/ppo')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10,
                background: 'transparent', border: 'none', color: 'var(--fg-2)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
              }}
            >
              <ArrowLeft size={14} /> Back to PPO
            </button>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Icon Generator
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--fg-2)', fontSize: 13, maxWidth: 720 }}>
              Generate 1024×1024 app-icon variants for A/B testing. Upload a base image per variant,
              describe the styling, and render a square iOS icon. Drop the PNG into Xcode as an
              alternate app icon to test it in an App Store Connect PPO icon experiment.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                exportAllProg && exportAllProg.phase !== 'done' ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Download size={14} />
                )
              }
              disabled={!anyDone || (exportAllProg !== null && exportAllProg.phase !== 'done')}
              onClick={() => {
                void exportAllIcons((p) => setExportAllProg(p)).finally(() => {
                  setTimeout(() => setExportAllProg(null), 1200);
                });
              }}
              title="Download every rendered icon as one ZIP (1024×1024 PNGs)"
            >
              {!exportAllProg || exportAllProg.phase === 'done'
                ? 'Export all'
                : exportAllProg.phase === 'fetching'
                ? `Fetching ${exportAllProg.done}/${exportAllProg.total}…`
                : 'Zipping…'}
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => iconLabAddVariant()}>
              Add variant
            </Button>
          </div>
        </header>

        {/* ASC constraint reminder — icons can't be uploaded ad-hoc like screenshots. */}
        <div
          style={{
            padding: 12,
            borderRadius: 'var(--r-2)',
            background: 'var(--accent-soft)',
            border: '1px solid var(--line-1)',
            fontSize: 12,
            color: 'var(--fg-1)',
            lineHeight: 1.6,
          }}
        >
          <strong>How icon A/B tests work in ASC:</strong> unlike screenshots, an icon variant must
          be <strong>shipped inside the app binary</strong> (declared as an alternate app icon in the
          asset catalog). Generate here → add the 1024 PNG to Xcode → submit a build → then select it
          as a treatment in a Product Page Optimization icon test.
        </div>

        {variants.length === 0 ? (
          <Card>
            <Card.Section title="Variants · 0">
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)', fontSize: 13 }}>
                No variants yet. Click <strong>Add variant</strong> to create your first icon treatment.
              </div>
            </Card.Section>
          </Card>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            {variants.map((v) => (
              <IconVariantCard key={v.id} variant={v} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IconVariantCard({ variant }: { variant: IconVariant }) {
  const iconLabSetBase = useStudio((s) => s.iconLabSetBase);
  const iconLabSetPrompt = useStudio((s) => s.iconLabSetPrompt);
  const iconLabUpdateVariant = useStudio((s) => s.iconLabUpdateVariant);
  const iconLabRemoveVariant = useStudio((s) => s.iconLabRemoveVariant);

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [exportProg, setExportProg] = useState<ExportProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const state = variant.generation?.generateState ?? 'idle';
  const isGenerating = state === 'generating';
  const isError = state === 'error';
  const hasResult = state === 'done' && variant.generation?.aiImageUrl;

  // gpt-image-2 takes ~25-35s — show an elapsed counter so it doesn't look frozen.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isGenerating) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [isGenerating]);

  // AI render is a 1024 PNG (~2-4MB). Proxy it down for the tile; export uses full res.
  const apiBase = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';
  const rawAi = variant.generation?.aiImageUrl;
  const previewSrc = rawAi
    ? `${apiBase}/ppo/proxy-image?url=${encodeURIComponent(rawAi)}&w=512`
    : variant.baseUrl;

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setUploadError('Not an image file.');
        return;
      }
      setUploadError(null);
      try {
        const dataUrl = await readScaledBase(file);
        iconLabSetBase(variant.id, dataUrl);
      } catch (e) {
        setUploadError(`Failed to read: ${(e as Error).message ?? 'unknown'}`);
      }
    },
    [iconLabSetBase, variant.id],
  );

  return (
    <div
      style={{
        flex: '0 0 calc((100% - 32px) / 3)',
        minWidth: 280,
        border: '1px solid var(--line-1)',
        borderRadius: 'var(--r-3)',
        background: 'var(--bg-2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Title + remove */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 0' }}>
        <input
          value={variant.title}
          onChange={(e) => iconLabUpdateVariant(variant.id, { title: e.target.value })}
          style={{
            flex: 1, fontSize: 14, fontWeight: 600, background: 'transparent', border: 'none',
            outline: 'none', color: 'var(--fg-0)', padding: '2px 0',
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete variant "${variant.title}"?`)) iconLabRemoveVariant(variant.id);
          }}
          title="Delete variant"
          style={{ background: 'transparent', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', padding: 4, display: 'flex' }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Result OR base preview — square. */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          onClick={() => { if (!hasResult && !isGenerating) fileInputRef.current?.click(); }}
          style={{
            aspectRatio: '1 / 1',
            borderRadius: 'var(--r-3)',
            border: previewSrc ? '1px solid var(--line-1)' : `1.5px dashed ${isDragOver ? 'var(--accent)' : 'var(--line-2)'}`,
            background: isDragOver ? 'var(--accent-soft)' : 'var(--bg-1)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: hasResult || isGenerating ? 'default' : 'pointer',
            textAlign: 'center',
            color: 'var(--fg-2)',
            fontSize: 12,
          }}
        >
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={variant.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isGenerating ? 0.4 : 1, transition: 'opacity .2s' }}
            />
          ) : (
            <div style={{ padding: 20 }}>
              <UploadCloud size={26} style={{ marginBottom: 8, color: isDragOver ? 'var(--accent)' : 'var(--fg-3)' }} />
              <div style={{ fontWeight: 500, color: 'var(--fg-1)', marginBottom: 2 }}>Drop base image</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>or click to pick · square works best</div>
            </div>
          )}

          {/* Badge: base vs AI. */}
          {previewSrc && (
            <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
              {hasResult ? 'AI · 1024' : 'base'}
            </div>
          )}
          {/* Replace base (only when showing the base, not a result). */}
          {variant.baseUrl && !hasResult && !isGenerating && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); iconLabSetBase(variant.id, undefined); }}
              title="Remove base image"
              style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, background: 'rgba(239,68,68,0.92)', border: '1px solid rgba(255,255,255,0.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={12} />
            </button>
          )}

          {isGenerating && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#fff', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}>
              <Loader2 size={30} style={{ animation: 'spin 1s linear infinite', color: 'var(--ai, #a78bfa)' }} />
              <div style={{ fontSize: 12, fontWeight: 600 }}>Generating…</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{elapsed}s · ~25–35s typical</div>
            </div>
          )}
          {isError && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(239,68,68,0.92)', color: '#fff', fontSize: 10, padding: '6px 8px', lineHeight: 1.3 }} title={variant.generation?.errorMessage ?? 'failed'}>
              <div style={{ fontWeight: 600 }}>Failed — click Generate to retry</div>
              <div style={{ opacity: 0.9 }}>{variant.generation?.errorMessage ?? 'unknown error'}</div>
            </div>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }} />
        {uploadError && <div style={{ color: 'var(--danger, #ef4444)', fontSize: 11 }}>{uploadError}</div>}

        {/* Prompt */}
        <textarea
          value={variant.prompt}
          onChange={(e) => iconLabSetPrompt(variant.id, e.target.value)}
          placeholder="Describe the icon styling — e.g. 'flat minimal, deep teal gradient, white cross glyph, subtle depth'…"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--bg-1)', color: 'var(--fg-0)',
            border: '1px solid var(--line-1)', borderRadius: 'var(--r-2)', padding: 8, fontSize: 12,
            lineHeight: 1.4, fontFamily: 'inherit', resize: 'vertical', minHeight: 76, outline: 'none',
          }}
        />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="primary"
            size="sm"
            leftIcon={isGenerating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={14} />}
            disabled={!variant.baseUrl || variant.prompt.trim().length === 0 || isGenerating}
            onClick={() => void generateIcon(variant.id)}
            title={!variant.baseUrl ? 'Upload a base image first' : variant.prompt.trim().length === 0 ? 'Write a prompt first' : 'Generate the icon variant'}
            style={{ flex: 1 }}
          >
            {isGenerating ? `${elapsed}s` : hasResult ? 'Regenerate' : 'Generate'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={exportProg && exportProg.phase !== 'done' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
            disabled={!hasResult || (exportProg !== null && exportProg.phase !== 'done')}
            onClick={() => {
              void downloadIcon(variant.id, (p) => setExportProg(p)).finally(() => {
                setTimeout(() => setExportProg(null), 1200);
              });
            }}
            title="Download this icon as a 1024×1024 PNG"
          >
            PNG
          </Button>
        </div>
      </div>
    </div>
  );
}
