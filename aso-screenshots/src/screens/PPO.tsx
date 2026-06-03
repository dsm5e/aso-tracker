import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudio } from '../state/studio';
import { useHighlight } from '../state/highlight';
import { useGenSelect, isGenSelected } from '../state/genSelect';
import type { PPOSourceScreen, PPOGeneration } from '../state/studio';
import { Button, Card } from '../components/shared';
import { Plus, Layers, Trash2, X, UploadCloud, ChevronDown, ChevronRight, Wand2, Download, Loader2, Save, Shapes, ArrowRight } from 'lucide-react';
import { generateOne, generateStrategy } from '../lib/ppoGenerate';
import { exportStrategy, exportAllStrategies, type ExportProgress } from '../lib/ppoExport';

const MAX_PREVIEW_DIM = 800; // px — max width or height of the persisted preview

/** Recursively walks a dropped DataTransfer entry (file or directory) and pushes
 *  every File found into the provided accumulator. Lets users drag whole folders
 *  (e.g. ~/Downloads/New Folder With Items) instead of selecting files inside. */
function walkEntry(entry: FileSystemEntry, acc: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (file) => {
          acc.push(file);
          resolve();
        },
        () => resolve(),
      );
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readBatch = () => {
        reader.readEntries(async (children) => {
          if (children.length === 0) {
            resolve();
            return;
          }
          await Promise.all(children.map((c) => walkEntry(c, acc)));
          readBatch(); // readEntries pages — keep reading until empty.
        }, () => resolve());
      };
      readBatch();
      return;
    }
    resolve();
  });
}

/** Read a File and return a JPEG data URL scaled to fit MAX_PREVIEW_DIM.
 *  Keeps state size sane — full-resolution PNGs would blow past localStorage's
 *  ~5MB quota with just a handful of screens. */
async function readScaledPreview(file: File): Promise<{ previewUrl: string; byteSize: number }> {
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

  const ratio = Math.min(MAX_PREVIEW_DIM / img.width, MAX_PREVIEW_DIM / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const previewUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { previewUrl, byteSize: file.size };
}

export function PPOScreen() {
  const ppo = useStudio((s) => s.ppo);
  const ppoInit = useStudio((s) => s.ppoInit);
  const ppoAddSourceScreens = useStudio((s) => s.ppoAddSourceScreens);
  const ppoRemoveSourceScreen = useStudio((s) => s.ppoRemoveSourceScreen);
  const ppoAddStrategy = useStudio((s) => s.ppoAddStrategy);
  const ppoRemoveStrategy = useStudio((s) => s.ppoRemoveStrategy);
  const ppoUpdateStrategy = useStudio((s) => s.ppoUpdateStrategy);
  const ppoSetActiveStrategy = useStudio((s) => s.ppoSetActiveStrategy);
  const ppoToggleStrategyCollapsed = useStudio((s) => s.ppoToggleStrategyCollapsed);
  const ppoSetDevice = useStudio((s) => s.ppoSetDevice);
  const ppoSaveSession = useStudio((s) => s.ppoSaveSession);
  const loadedFromPPOSessionId = useStudio((s) => s.loadedFromPPOSessionId);
  const nav = useNavigate();
  const iconVariantCount = useStudio((s) => s.iconLab?.variants.length ?? 0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Device target for the whole experiment. Affects gen size, tile aspect,
  // and export upscale. Defaults to iphone for legacy sessions without it.
  const device = ppo?.device ?? 'iphone';
  // Tile aspect ratio matches the device — iPhone 9:19.5, iPad ~3:4.
  const tileAspect = device === 'ipad' ? '3 / 4' : '9 / 19.5';

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [exportAllProg, setExportAllProg] = useState<ExportProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lazy-init the experiment subtree on first visit so all selectors see it.
  // Must run in effect — setState during render triggers React error / blank screen.
  useEffect(() => {
    if (!ppo) ppoInit();
  }, [ppo, ppoInit]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        setUploadError('No image files in selection.');
        return;
      }
      setUploadError(null);
      try {
        const previews = await Promise.all(list.map(readScaledPreview));
        ppoAddSourceScreens(
          previews.map((p, i) => ({
            previewUrl: p.previewUrl,
            byteSize: p.byteSize,
            filename: list[i].name,
          })),
        );
      } catch (e) {
        setUploadError(`Failed to read files: ${(e as Error).message ?? 'unknown error'}`);
      }
    },
    [ppoAddSourceScreens],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);

      // Use webkitGetAsEntry when available — lets us walk dropped FOLDERS
      // recursively and pull out image files. Plain dataTransfer.files only
      // returns the folder entry itself with no type, which we'd silently drop.
      const items = Array.from(e.dataTransfer.items);
      const entries = items
        .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
        .filter((e): e is FileSystemEntry => Boolean(e));

      if (entries.length > 0) {
        const collected: File[] = [];
        await Promise.all(entries.map((entry) => walkEntry(entry, collected)));
        if (collected.length > 0) {
          void handleFiles(collected);
          return;
        }
      }

      // Fallback (some browsers, older drag types).
      if (e.dataTransfer.files.length > 0) {
        void handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const onPickClick = () => fileInputRef.current?.click();
  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void handleFiles(e.target.files);
    e.target.value = ''; // reset so same file can be re-picked
  };

  // Device toggle is a FILTER: pool + strategy tiles show only the selected
  // device's screens, so one project holds both iPhone + iPad without dupes.
  const allSourceScreens = ppo?.sourceScreens ?? [];
  const sourceScreens = allSourceScreens.filter((s) => (s.device ?? 'iphone') === device);
  const strategies = ppo?.strategies ?? [];
  const collapsedIds = ppo?.collapsedStrategyIds ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--s-9) var(--s-7)' }}>
      <div style={{ width: '100%', maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Product Page Optimization
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--fg-2)', fontSize: 13 }}>
              Run multi-strategy A/B experiments. Upload source screens once, generate per-strategy
              renders with different AI prompts. Export N treatments ready for App Store Connect.
            </p>
          </div>
          {/* Device selector — drives generation input size (768×1664 vs 768×1024),
              tile aspect ratio, and export upscale dims (1290×2796 vs 2064×2752). */}
          <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--r-2)', border: '1px solid var(--line-1)', background: 'var(--bg-1)' }}>
            {(['iphone', 'ipad'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => ppoSetDevice(d)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--r-1)',
                  border: 'none',
                  background: device === d ? 'var(--accent)' : 'transparent',
                  color: device === d ? '#fff' : 'var(--fg-2)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
                title={d === 'iphone' ? 'iPhone 6.9" (1290×2796 export)' : 'iPad 13" (2064×2752 export)'}
              >
                {d === 'iphone' ? '📱 iPhone' : '🟦 iPad'}
              </button>
            ))}
          </div>
        </header>

        {/* Source screens pool */}
        <Card>
          <Card.Section
            title={`Source screens · ${sourceScreens.length}`}
            rightSlot={
              sourceScreens.length > 0 ? (
                <Button variant="ghost" size="sm" leftIcon={<Plus size={14} />} onClick={onPickClick}>
                  Add more
                </Button>
              ) : undefined
            }
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onFileInputChange}
              style={{ display: 'none' }}
            />
            {sourceScreens.length === 0 ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
                onClick={onPickClick}
                style={{
                  border: `1.5px dashed ${isDragOver ? 'var(--accent)' : 'var(--line-2)'}`,
                  background: isDragOver ? 'var(--accent-soft)' : 'transparent',
                  borderRadius: 'var(--r-3)',
                  padding: 32,
                  textAlign: 'center',
                  color: 'var(--fg-2)',
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all .15s',
                }}
              >
                <UploadCloud size={28} style={{ marginBottom: 12, color: isDragOver ? 'var(--accent)' : 'var(--fg-3)' }} />
                <div style={{ fontWeight: 500, color: 'var(--fg-1)', marginBottom: 4 }}>
                  Drop source screens here, or click to pick
                </div>
                <div>
                  Upload simulator screenshots once — they're shared across every strategy below.
                </div>
                <div style={{ marginTop: 12, fontSize: 11, opacity: 0.7 }}>
                  PNG / JPG · Multi-select OK · Resized to {MAX_PREVIEW_DIM}px max for state storage
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  border: isDragOver ? '1.5px dashed var(--accent)' : '1.5px dashed transparent',
                  borderRadius: 'var(--r-3)',
                  padding: 4,
                  transition: 'border-color .15s',
                }}
              >
                {sourceScreens.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      // Up to 10 items per row — fit-content to (10 columns with 9 gaps of 12px between).
                      // Items beyond #10 wrap to next line at the same width, no stretching.
                      flex: '0 0 calc((100% - 108px) / 10)',
                      border: '1px solid var(--line-1)',
                      borderRadius: 'var(--r-2)',
                      overflow: 'hidden',
                      background: 'var(--bg-2)',
                      aspectRatio: tileAspect,
                      position: 'relative',
                    }}
                  >
                    <img
                      src={s.previewUrl}
                      alt={s.filename}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 4,
                        left: 4,
                        background: 'rgba(0,0,0,0.55)',
                        color: '#fff',
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {s.filename}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Remove ${s.filename}? Any prompts/renders for this screen will be discarded.`)) {
                          ppoRemoveSourceScreen(s.id);
                        }
                      }}
                      title="Remove screen"
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        background: 'rgba(239,68,68,0.92)',
                        border: '1px solid rgba(255,255,255,0.6)',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {uploadError && (
              <div style={{ marginTop: 10, color: 'var(--danger, #ef4444)', fontSize: 12 }}>
                {uploadError}
              </div>
            )}
          </Card.Section>
        </Card>

        {/* Strategies */}
        <Card>
          <Card.Section
            title={`Strategies · ${strategies.length}`}
            rightSlot={
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
                  disabled={
                    (exportAllProg !== null && exportAllProg.phase !== 'done') ||
                    !strategies.some((s) =>
                      Object.values(s.generations).some((g) => g.generateState === 'done'),
                    )
                  }
                  onClick={() => {
                    void exportAllStrategies((p) => setExportAllProg(p))
                      .finally(() => {
                        setTimeout(() => setExportAllProg(null), 1200);
                      });
                  }}
                  title="Download a master ZIP with one folder per strategy — drop each into its ASC PPO treatment."
                >
                  {!exportAllProg || exportAllProg.phase === 'done'
                    ? 'Export all'
                    : exportAllProg.phase === 'fetching'
                    ? `Fetching ${exportAllProg.done}/${exportAllProg.total}…`
                    : 'Zipping…'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => ppoAddStrategy()}
                >
                  Add strategy
                </Button>
              </div>
            }
          >
            {strategies.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--fg-2)',
                  fontSize: 13,
                }}
              >
                No strategies yet. Click <strong>Add strategy</strong> to create your first treatment,
                or ask the assistant to generate strategies after uploading source screens.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {strategies.map((str) => (
                  <StrategyCard
                    key={str.id}
                    strategyId={str.id}
                    isExpanded={!collapsedIds.includes(str.id)}
                    onToggle={() => {
                      ppoToggleStrategyCollapsed(str.id);
                      ppoSetActiveStrategy(str.id);
                    }}
                  />
                ))}
              </div>
            )}
          </Card.Section>
        </Card>

        {/* App icon A/B testing — a separate, dedicated tool. Screenshots and
            icons are different ASC surfaces (icons must ship in the binary), so
            the icon flow gets its own full screen rather than crowding the
            per-strategy grid above. */}
        <Card>
          <Card.Section title="App Icon A/B Testing">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  flex: 'none',
                  background: 'linear-gradient(135deg, #7C3AED, #A78BFA)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  boxShadow: '0 8px 24px -8px rgba(124,58,237,0.6)',
                }}
              >
                <Shapes size={34} />
              </div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-0)', marginBottom: 4 }}>
                  Generate icon variants for an icon experiment
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                  Render 1024×1024 app-icon variants from a base image and a prompt. Icons can't be
                  uploaded ad-hoc like screenshots — they ship inside the app binary as alternate
                  icons, then get selected as PPO treatments. This opens a dedicated screen.
                  {iconVariantCount > 0 && (
                    <> · <strong>{iconVariantCount}</strong> variant{iconVariantCount === 1 ? '' : 's'} so far.</>
                  )}
                </p>
              </div>
              <Button
                variant="primary"
                size="lg"
                leftIcon={<Shapes size={16} />}
                rightIcon={<ArrowRight size={16} />}
                onClick={() => nav('/icon-generator')}
              >
                Icon Generator
              </Button>
            </div>
          </Card.Section>
        </Card>
      </div>
      {/* Floating Save — only show once a session has source screens. The button
          updates the existing entry if a session was loaded, otherwise creates
          a new one. The Setup → Recent PPO grid lists every saved session. */}
      {sourceScreens.length > 0 && (
        <button
          type="button"
          onClick={() => {
            ppoSaveSession();
            setSavedAt(Date.now());
            window.setTimeout(() => setSavedAt((prev) => (prev && Date.now() - prev >= 1500 ? null : prev)), 1700);
          }}
          title={loadedFromPPOSessionId ? 'Update saved session' : 'Save session — find it later in Setup → Recent PPO'}
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: savedAt ? 'var(--accent-2, #10b981)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 999,
            padding: '12px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            transition: 'background .15s, transform .12s',
          }}
        >
          <Save size={16} />
          {savedAt ? 'Saved' : loadedFromPPOSessionId ? 'Save' : 'Save session'}
        </button>
      )}
    </div>
  );
}

/** One row in the strategy list. Collapsed = title + counters. Expanded =
 *  per-screen grid with thumbnail + prompt textarea + generate-result preview. */
function StrategyCard({
  strategyId,
  isExpanded,
  onToggle,
}: {
  strategyId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const ppo = useStudio((s) => s.ppo);
  const ppoUpdateStrategy = useStudio((s) => s.ppoUpdateStrategy);
  const ppoRemoveStrategy = useStudio((s) => s.ppoRemoveStrategy);
  const ppoSetPrompt = useStudio((s) => s.ppoSetPrompt);
  const ppoRemoveScreenFromStrategy = useStudio((s) => s.ppoRemoveScreenFromStrategy);
  const ppoSetDevice = useStudio((s) => s.ppoSetDevice);
  const genSelExplicit = useGenSelect((s) => s.explicit);

  const [showAddPicker, setShowAddPicker] = useState(false);

  const strategy = ppo?.strategies.find((s) => s.id === strategyId);
  const device = ppo?.device ?? 'iphone';
  // Only this device's screens are shown / generated in the strategy grid.
  const sourceScreens = (ppo?.sourceScreens ?? []).filter((s) => (s.device ?? 'iphone') === device);
  if (!strategy) return null;

  // Only screens that are EXPLICITLY part of this strategy (i.e. have a key in
  // strategy.prompts). The display order follows the strategy's own insertion
  // order via Object.keys — NOT the global source pool order — so different
  // strategies can lead with different screens.
  const sourceById = new Map(sourceScreens.map((s) => [s.id, s]));
  const screensInStrategy = Object.keys(strategy.prompts)
    .map((id) => sourceById.get(id))
    .filter((s): s is PPOSourceScreen => Boolean(s));
  const screensNotInStrategy = sourceScreens.filter((src) => !(src.id in strategy.prompts));
  // Scope counts to the VISIBLE device (screensInStrategy is device-filtered) so
  // the badges + the Generate label match what's shown and what Generate runs.
  const promptCount = screensInStrategy.filter((s) => (strategy.prompts[s.id] ?? '').trim().length > 0).length;
  const renderedCount = screensInStrategy.filter((s) => strategy.generations[s.id]?.generateState === 'done').length;
  const generatingCount = screensInStrategy.filter((s) => strategy.generations[s.id]?.generateState === 'generating').length;
  // Screens checked to (re)generate — default to the not-yet-done ones so a
  // freshly rendered tile auto-deselects and bulk-generate skips it.
  const selectedIds = screensInStrategy
    .filter((s) => (strategy.prompts[s.id] ?? '').trim().length > 0
      && isGenSelected(genSelExplicit, `${strategy.id}:${s.id}`, strategy.generations[s.id]?.generateState !== 'done'))
    .map((s) => s.id);
  // All-device selection — feeds the "Both" button (iPhone + iPad in one pass,
  // each generated at its own size since generateOne reads source.device).
  const bothSelectedIds = (ppo?.sourceScreens ?? [])
    .filter((s) => s.id in strategy.prompts
      && (strategy.prompts[s.id] ?? '').trim().length > 0
      && isGenSelected(genSelExplicit, `${strategy.id}:${s.id}`, strategy.generations[s.id]?.generateState !== 'done'))
    .map((s) => s.id);
  // Rendered across BOTH devices — count for the per-strategy "Both ZIP" export.
  const renderedBothCount = (ppo?.sourceScreens ?? [])
    .filter((s) => s.id in strategy.prompts && strategy.generations[s.id]?.generateState === 'done').length;
  const isBatchInFlight = generatingCount > 0;
  const [exportProg, setExportProg] = useState<ExportProgress | null>(null);
  const isExporting = exportProg !== null && exportProg.phase !== 'done';
  const exportLabel = !exportProg || exportProg.phase === 'done'
    ? `Export ${device === 'ipad' ? 'iPad' : 'iPhone'} ZIP${renderedCount > 0 ? ` (${renderedCount})` : ''}`
    : exportProg.phase === 'fetching'
    ? `Fetching ${exportProg.done}/${exportProg.total}…`
    : 'Zipping…';

  return (
    <div
      style={{
        border: `1px solid ${isExpanded ? 'var(--accent)' : 'var(--line-1)'}`,
        borderRadius: 'var(--r-3)',
        background: isExpanded ? 'var(--accent-soft)' : 'var(--bg-2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header row — always visible. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 14,
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        {isExpanded ? <ChevronDown size={16} color="var(--fg-2)" /> : <ChevronRight size={16} color="var(--fg-2)" />}
        <input
          value={strategy.title}
          onChange={(e) => ppoUpdateStrategy(strategy.id, { title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--fg-0)',
            padding: '4px 0',
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
          {screensInStrategy.length} screens · {promptCount} prompts · {renderedCount} rendered
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete strategy "${strategy.title}"?`)) {
              ppoRemoveStrategy(strategy.id);
            }
          }}
          title="Delete strategy"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--fg-3)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Expanded grid — one tile per source screen with prompt + result. */}
      {isExpanded && (
        <div
          style={{
            borderTop: '1px solid var(--line-1)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {sourceScreens.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'center', padding: 16 }}>
              Upload source screens above first — each strategy needs them to generate per-screen prompts.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                  {screensInStrategy.length} screen{screensInStrategy.length === 1 ? '' : 's'} in this strategy.
                  Drop one with the X — or add another from the source pool below.
                </div>
                {/* Per-strategy device switch — drives the global PPO filter so the
                    grid + Generate target iPhone or iPad without scrolling to the top. */}
                <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--r-1)', border: '1px solid var(--line-1)', background: 'var(--bg-1)' }}>
                  {(['iphone', 'ipad'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => ppoSetDevice(d)}
                      style={{
                        padding: '4px 10px', borderRadius: 'var(--r-1)', border: 'none',
                        background: device === d ? 'var(--accent)' : 'transparent',
                        color: device === d ? '#fff' : 'var(--fg-2)',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {d === 'iphone' ? '📱 iPhone' : '🟦 iPad'}
                    </button>
                  ))}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={
                    isBatchInFlight ? (
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Wand2 size={14} />
                    )
                  }
                  disabled={selectedIds.length === 0 || isBatchInFlight}
                  onClick={() => {
                    void generateStrategy(strategy.id, 2, device, new Set(selectedIds));
                  }}
                  title={
                    isBatchInFlight ? `Generating ${generatingCount} screen(s)…` :
                    promptCount === 0 ? 'Add at least one prompt first' :
                    'Generate AI renders for every screen with a prompt'
                  }
                >
                  {isBatchInFlight ? `Generating ${generatingCount}…` : `Generate ${device === 'ipad' ? 'iPad' : 'iPhone'}${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}`}
                </Button>
                <Button
                  variant="ai"
                  size="sm"
                  leftIcon={<Wand2 size={14} />}
                  disabled={bothSelectedIds.length === 0 || isBatchInFlight}
                  onClick={() => {
                    void generateStrategy(strategy.id, 2, undefined, new Set(bothSelectedIds));
                  }}
                  title="Generate the selected screens for BOTH iPhone and iPad in one pass — each at its own size"
                >
                  Both ({bothSelectedIds.length})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={
                    isExporting ? (
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Download size={14} />
                    )
                  }
                  disabled={renderedCount === 0 || isExporting}
                  onClick={() => {
                    void exportStrategy(strategy.id, (p) => setExportProg(p), device)
                      .finally(() => {
                        // Clear after a short pause so the user sees "Done"
                        setTimeout(() => setExportProg(null), 1200);
                      });
                  }}
                  title={renderedCount === 0 ? 'Generate at least one screen first' : `Download ${renderedCount} rendered screens as a ZIP — drop into ASC PPO treatment`}
                >
                  {exportLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Download size={14} />}
                  disabled={renderedBothCount === 0 || isExporting}
                  onClick={() => {
                    void exportStrategy(strategy.id, (p) => setExportProg(p))
                      .finally(() => {
                        setTimeout(() => setExportProg(null), 1200);
                      });
                  }}
                  title="Export BOTH iPhone + iPad of THIS strategy in one ZIP — files split into iphone-… / ipad-…"
                >
                  Both ZIP{renderedBothCount > 0 ? ` (${renderedBothCount})` : ''}
                </Button>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                {screensInStrategy.map((src) => (
                  <div
                    key={`tile-wrap-${src.id}`}
                    style={{
                      // Strategy tiles need real width for the textarea — cap at 5 per
                      // row (source pool stays 10/row for compactness). 6+ wrap.
                      flex: '0 0 calc((100% - 48px) / 5)',
                      minWidth: 0,
                      position: 'relative',
                    }}
                  >
                    <PPOTile
                      strategyId={strategy.id}
                      source={src}
                      prompt={strategy.prompts[src.id] ?? ''}
                      generation={strategy.generations[src.id]}
                      onPromptChange={(value) => ppoSetPrompt(strategy.id, src.id, value)}
                      onRegenerate={() => {
                        void generateOne(strategy.id, src, strategy.prompts[src.id] ?? '');
                      }}
                      onRemove={() => {
                        if (window.confirm(`Drop ${src.filename} from "${strategy.title}"? Source screen stays in the pool — this only removes its slot in this strategy.`)) {
                          ppoRemoveScreenFromStrategy(strategy.id, src.id);
                        }
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* "+ Add screen" picker — shows source screens not yet in this strategy. */}
              {screensNotInStrategy.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAddPicker((v) => !v);
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      background: 'transparent',
                      border: '1px dashed var(--line-2)',
                      color: 'var(--fg-1)',
                      borderRadius: 'var(--r-2)',
                      padding: '6px 12px',
                      fontSize: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Plus size={12} />
                    Add screen ({screensNotInStrategy.length} available)
                  </button>
                  {showAddPicker && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        padding: 8,
                        background: 'var(--bg-1)',
                        border: '1px solid var(--line-1)',
                        borderRadius: 'var(--r-2)',
                      }}
                    >
                      {screensNotInStrategy.map((src) => (
                        <button
                          key={src.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            ppoSetPrompt(strategy.id, src.id, '');
                            setShowAddPicker(false);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 8px 4px 4px',
                            background: 'var(--bg-2)',
                            border: '1px solid var(--line-1)',
                            borderRadius: 'var(--r-2)',
                            cursor: 'pointer',
                            fontSize: 12,
                            color: 'var(--fg-0)',
                          }}
                          title={`Add ${src.filename} to this strategy`}
                        >
                          <img
                            src={src.previewUrl}
                            alt=""
                            style={{ width: 24, height: 52, objectFit: 'cover', borderRadius: 3 }}
                          />
                          {src.filename}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {screensInStrategy.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'center', padding: 16, border: '1px dashed var(--line-2)', borderRadius: 'var(--r-2)' }}>
                  No screens in this strategy yet. Use <strong>Add screen</strong> above to pick from the source pool.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PPOTile({
  strategyId,
  source,
  prompt,
  generation,
  onPromptChange,
  onRegenerate,
  onRemove,
}: {
  strategyId: string;
  source: PPOSourceScreen;
  prompt: string;
  generation: PPOGeneration | undefined;
  onPromptChange: (value: string) => void;
  onRegenerate: () => void;
  onRemove?: () => void;
}) {
  // Device is experiment-level — read from store so the tile matches whatever
  // the parent screen has selected (iPhone 9:19.5 vs iPad ~3:4 aspect).
  const device = useStudio((s) => s.ppo?.device ?? 'iphone');
  const flashing = useHighlight((s) => s.ids.has(`${strategyId}:${source.id}`));
  const genSelExplicit = useGenSelect((s) => s.explicit);
  const toggleSel = useGenSelect((s) => s.toggle);
  const tileAspect = (source.device ?? device) === 'ipad' ? '3 / 4' : '9 / 19.5';
  const state = generation?.generateState ?? 'idle';
  // AI renders are 1290×2796 PNGs (~2-4MB each). Loading 20 of them raw kills
  // perf — funnel through our proxy at w=400 JPEG so tiles paint fast. Export
  // still uses the original URL (collected from generation.aiImageUrl).
  const apiBase = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';
  const rawAi = generation?.aiImageUrl;
  const previewSrc = rawAi
    ? `${apiBase}/ppo/proxy-image?url=${encodeURIComponent(rawAi)}&w=400`
    : source.previewUrl;
  const isGenerating = state === 'generating';
  const isError = state === 'error';
  const hasResult = state === 'done' && generation?.aiImageUrl;
  const selKey = `${strategyId}:${source.id}`;
  const selDefault = (generation?.generateState ?? 'idle') !== 'done';
  const selected = isGenSelected(genSelExplicit, selKey, selDefault);

  // Elapsed-second counter while generating — gpt-image-2 takes ~25-35s and
  // a static "Generating…" text feels frozen. Reset whenever state changes.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isGenerating) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [isGenerating]);

  return (
    <div
      className={flashing ? 'aso-flash' : ''}
      style={{
        border: '1px solid var(--line-1)',
        borderRadius: 'var(--r-2)',
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Preview — original or AI render. */}
      <div
        style={{
          aspectRatio: tileAspect,
          background: 'var(--bg-2)',
          position: 'relative',
        }}
      >
        <img
          src={previewSrc}
          alt={source.filename}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: isGenerating ? 0.4 : 1,
            transition: 'opacity .2s',
          }}
        />
        {/* Status badge — top-left. */}
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {source.filename}
          {hasResult && <span style={{ color: 'var(--accent)' }}>· AI</span>}
        </div>
        {isGenerating && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: '#fff',
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(2px)',
            }}
          >
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--ai, #a78bfa)' }} />
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3 }}>Generating…</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>{elapsed}s · ~25–35s typical</div>
          </div>
        )}
        {isError && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'rgba(239,68,68,0.92)',
              color: '#fff',
              fontSize: 10,
              padding: '6px 8px',
              maxHeight: '40%',
              overflow: 'auto',
              lineHeight: 1.3,
            }}
            title={generation?.errorMessage ?? 'Generation failed'}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Failed — click Generate to retry</div>
            <div style={{ opacity: 0.9 }}>{generation?.errorMessage ?? 'unknown error'}</div>
          </div>
        )}
        {/* Remove from strategy — top-right; source screen itself stays in pool. */}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove this screen from the strategy"
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 22,
              height: 22,
              borderRadius: 11,
              background: 'rgba(239,68,68,0.92)',
              border: '1px solid rgba(255,255,255,0.6)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Prompt textarea + per-tile regenerate. */}
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Describe the styling for this screen in this strategy…"
          rows={6}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--bg-2)',
            color: 'var(--fg-0)',
            border: '1px solid var(--line-1)',
            borderRadius: 'var(--r-2)',
            padding: 8,
            fontSize: 12,
            lineHeight: 1.4,
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: 140,
            maxHeight: 320,
            overflowY: 'auto',
            outline: 'none',
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: selected ? 'var(--fg-1)' : 'var(--fg-3)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={selected} onChange={() => toggleSel(selKey, selDefault)} style={{ accentColor: 'var(--accent)' }} />
          {selected ? 'Will generate in batch' : hasResult ? 'Done — skipped in batch' : 'Skipped in batch'}
        </label>
        <button
          type="button"
          disabled={prompt.trim().length === 0 || isGenerating}
          onClick={onRegenerate}
          style={{
            background: prompt.trim().length === 0 || isGenerating ? 'var(--bg-2)' : 'var(--accent)',
            color: prompt.trim().length === 0 || isGenerating ? 'var(--fg-3)' : '#fff',
            border: 'none',
            borderRadius: 'var(--r-2)',
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            cursor: prompt.trim().length === 0 || isGenerating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          {isGenerating ? (
            <>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              {elapsed}s
            </>
          ) : (
            <>
              <Wand2 size={12} />
              {hasResult ? 'Regenerate' : 'Generate'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
