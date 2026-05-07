import { useRef, useState, useLayoutEffect, type DragEvent, type CSSProperties } from 'react';
import { ImagePlus } from 'lucide-react';
import { getPreset } from '../../lib/presets';
import { useStudio, type Screenshot } from '../../state/studio';
import { DeviceFrame, DEVICE_DIMS } from './DeviceFrame';
import { MountainBackground } from './MountainBackground';
import { DotsBackground } from './DotsBackground';
import { paletteFromAccent, deriveDotsBg } from '../../lib/palette';
import { saveScreenshotBlob } from '../../lib/screenshotStore';

const CANVAS_DIMS = {
  iphone: { w: 1290, h: 2796 },
  ipad:   { w: 2048, h: 2732 },
};

/** Renders text at `initialPx`, then shrinks the font until the block fits
 *  within ~3 lines (maxH = initialPx × 3.2). Words wrap naturally first;
 *  font reduction kicks in only when wrapping alone isn't enough. */
function FitTitle({ text, initialPx, style }: { text: string; initialPx: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(initialPx);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const maxH = initialPx * 3.2;
    const minSize = Math.round(initialPx * 0.45);
    let size = initialPx;
    el.style.fontSize = `${size}px`;
    // Shrink until: no word overflows horizontally AND block fits vertically.
    while (size > minSize && (el.scrollHeight > maxH || el.scrollWidth > el.clientWidth)) {
      size = Math.max(size - 6, minSize);
      el.style.fontSize = `${size}px`;
    }
    sizeRef.current = size;
  }, [text, initialPx]);

  return (
    <div ref={ref} style={{ ...style, fontSize: sizeRef.current }}>
      {text}
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '');
  if (m.length !== 6 && m.length !== 3) return null;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function darken(color: string, amount: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return 'rgba(0,0,0,0.25)';
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.round(c * (1 - amount))));
  return `rgb(${r}, ${g}, ${b})`;
}

interface Props {
  screenshot: Screenshot;
  /** 'iphone' (default, 1290×2796) or 'ipad' (2048×2732). */
  device?: 'iphone' | 'ipad';
  /** Available width to fit canvas (canvas auto-scales preserving aspect ratio) */
  fitWidth?: number;
  fitHeight?: number;
  showDropZone?: boolean;
  /** Optional per-instance viewMode override. When unset, falls back to the
   *  global store viewMode (used by Editor). PolishScreen sets this per card
   *  so multiple canvases on one page can show different states. */
  viewModeOverride?: 'scaffold' | 'enhanced';
  /** Optional locale metadata applied to the headline overlay only — RTL flips
   *  text direction; fontOverride swaps the font family for the headline +
   *  pill. Used by Locales screen to preview localised text without
   *  duplicating the canvas component. */
  localeMeta?: { rtl?: boolean; fontOverride?: string };
  /** When set, the headline overlay shows a dashed border + grab cursor and
   *  reports drag deltas in CANVAS pixels (factoring in fitWidth scale).
   *  onResize fires when the user drags the bottom-left corner handle —
   *  ratio is the proportional scale to apply to titlePx / subPx.
   *  Used by Locales screen for per-locale text adjustments. */
  editable?: {
    onMove: (deltaCanvasX: number, deltaCanvasY: number) => void;
    onResize?: (ratio: number) => void;
  };
  /** When provided, device Y is computed from these sizes (base/source layout)
   *  rather than the screenshot's current titlePx/subPx. Keeps the device
   *  pinned at the English layout while locale font sizes shrink. */
  deviceBaseTitlePx?: number;
  deviceBaseSubPx?: number;
  /** Render a red debug boundary showing the text-safe zone. Never captured
   *  in Polish (only passed by Locales screen). */
  showTextBoundary?: boolean;
}

/**
 * 1290×2796 logical canvas. Renders preset background + tilted iPhone frame +
 * screenshot fill + headline. Scales down via outer transform to fit the viewport.
 */
export function MockupCanvas({ screenshot: ss, device = 'iphone', fitWidth, fitHeight, showDropZone = true, viewModeOverride, localeMeta, editable, deviceBaseTitlePx, deviceBaseSubPx, showTextBoundary }: Props) {
  const CANVAS_W = CANVAS_DIMS[device].w;
  const CANVAS_H = CANVAS_DIMS[device].h;
  const { updateScreenshot, appColor, viewMode: globalViewMode } = useStudio();
  const viewMode = viewModeOverride ?? globalViewMode;
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const preset = getPreset(ss.presetId);
  const presetBg = preset
    ? preset.background.css
    : appColor || 'linear-gradient(135deg, #1E1B4B 0%, #5B21B6 100%)';

  // 1) explicit user override wins
  // 2) Bold Brand Solid → user's accent color
  // 3) preset default
  const baseBackground = ss.backgroundOverride
    ? ss.backgroundOverride
    : preset?.id === 'bold-brand-solid'
      ? appColor || preset.background.css
      : presetBg;

  // Layer optional preset bg image on top of the base color/gradient.
  const parametricKind = preset?.background.parametric ?? null;
  const isParametric = parametricKind !== null;
  const presetBgImage = preset?.background.imageSrc
    ? `${import.meta.env.BASE_URL}${preset.background.imageSrc}`
    : undefined;
  const finalBackground =
    !isParametric && presetBgImage && !ss.backgroundOverride
      ? `${baseBackground} url("${presetBgImage}") center / cover no-repeat`
      : baseBackground;
  const parametricPalette = parametricKind === 'mountains'
    ? paletteFromAccent(ss.backgroundOverride ?? appColor ?? preset?.suggestedAccent ?? '#A87648')
    : null;
  // Dots bg: user override wins, else derive from project accent + this slot's
  // sampleIndex so the 4-slot Pastel Dots series feels like one family that
  // re-tints together when the user changes accent. preset.background.css is
  // a final fallback for hero/orphan slots without an index.
  const dotsBgColor = ss.backgroundOverride
    ?? (parametricKind === 'dots' && appColor
      ? deriveDotsBg(appColor, ss.sampleIndex ?? 0)
      : preset?.background.css ?? '#EEE9FB');
  const dotsColor = darken(dotsBgColor, 0.25);

  // device positioning — preset.device sets defaults (asset, offset, scale, rotate)
  const dt = preset?.device ?? { asset: 'iphone' as const };
  // iPad canvas always uses the iPad frame, regardless of preset default.
  const asset: 'iphone' | 'ipad' = device === 'ipad' ? 'ipad' : (dt.asset ?? 'iphone');
  const D = DEVICE_DIMS[asset];
  const presetOffX = dt.offsetX ?? 0;
  const presetOffY = dt.offsetY ?? 0;
  const presetRotZ = dt.rotateZ ?? 0;
  const presetScale = dt.scale ?? 1;

  // Headline layout copied from the sample at preset-pick time, falling back to defaults.
  const yFrac = ss.textYFraction ?? 0.07;
  const titlePx = ss.titlePx ?? 220;
  const subPx = ss.subPx ?? 100;
  const TEXT_GAP = 80;
  const headlineTop = Math.round(yFrac * CANVAS_H);

  // Auto-position device based on text yFraction — text at top → device in lower zone,
  // text at bottom → device in upper zone. preset.offsetY is a fine-tune on top.
  // Same simple formula as PresetThumbnail (catalog) so position matches 1:1 —
  // the template author tunes sample.device.offsetY to clear wrapped headlines.
  // Device position uses base (source/English) sizes when provided so that
  // locale-adjusted smaller fonts don't move the device up, leaving empty space.
  const layoutTitlePx = deviceBaseTitlePx ?? titlePx;
  const layoutSubPx = deviceBaseSubPx ?? subPx;
  const headlineHeight = layoutTitlePx + 24 + layoutSubPx;
  const textZoneBottom = headlineTop + headlineHeight; // boundary: text must stay above this
  const deviceX = (CANVAS_W - D.width) / 2 + presetOffX;
  const deviceY =
    (yFrac < 0.5
      ? textZoneBottom + TEXT_GAP
      : headlineTop - TEXT_GAP - D.height)
    + presetOffY;

  // Font: locale override > user pick > preset default. Same precedence for color/weight.
  const textFont = localeMeta?.fontOverride || ss.font || preset?.text.font || 'Inter';
  const textDir = localeMeta?.rtl ? 'rtl' : undefined;
  const textColor = preset?.text.color || '#FFFFFF';
  const textWeight = preset?.text.weight || 800;
  const isUpper = preset?.text.uppercase ?? true;
  const textAlign = preset?.text.align || 'center';

  const tiltDeg = ss.tiltDeg || 0;
  const tiltX = ss.tiltX ?? 0;
  const tiltY = ss.tiltY ?? 0;
  const dx = ss.deviceX ?? 0;
  const dy = ss.deviceY ?? 0;
  const dscale = ss.deviceScale ?? 1;

  // Visual top of device accounting for rotation + scale (for the debug boundary).
  // Rotating a rect around its center: topmost y = centerY - (w/2*|sinθ| + h/2*|cosθ|)*scale
  const _rotRad = ((presetRotZ + tiltDeg) * Math.PI) / 180;
  const _effScale = presetScale * dscale;
  const _centerY = deviceY + dy + D.height / 2;
  const visualDeviceTop = _centerY - _effScale * (D.width / 2 * Math.abs(Math.sin(_rotRad)) + D.height / 2 * Math.abs(Math.cos(_rotRad)));

  // compute scale to fit
  let scale = 1;
  if (fitWidth) scale = Math.min(scale, fitWidth / CANVAS_W);
  if (fitHeight) scale = Math.min(scale, fitHeight / CANVAS_H);

  const onPickFile = () => fileRef.current?.click();
  const adoptFile = (file: File) => {
    const url = URL.createObjectURL(file);
    updateScreenshot(ss.id, { sourceUrl: url, filename: file.name });
    // Persist the blob to IDB so the upload survives reload — Zustand only keeps
    // the metadata (filename, positions); the actual file bytes live here.
    void saveScreenshotBlob(ss.id, file, file.name);
  };
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    adoptFile(file);
    e.target.value = '';
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    adoptFile(file);
  };

  const verbDisplay = isUpper ? (ss.headline.verb || '').toUpperCase() : ss.headline.verb;
  const descDisplay = isUpper ? (ss.headline.descriptor || '').toUpperCase() : ss.headline.descriptor;

  // AI hero shows whenever there's a generated image AND the user toggled to Enhanced —
  // independent of `kind`, so Enhance works for any slot, not only action/hero ones.
  const aiHero = viewMode === 'enhanced' ? ss.action?.aiImageUrl ?? null : null;

  return (
    <div
      style={{
        width: CANVAS_W * scale,
        height: CANVAS_H * scale,
        position: 'relative',
        boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Inner canvas at native resolution, scaled down */}
      <div
        data-mockup-canvas-inner
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transformOrigin: 'top left',
          transform: `scale(${scale})`,
          background: finalBackground,
          position: 'relative',
        }}
      >
        {parametricPalette && (
          <MountainBackground palette={parametricPalette} width={CANVAS_W} height={CANVAS_H} />
        )}
        {parametricKind === 'dots' && (
          <DotsBackground bgColor={dotsBgColor} dotColor={dotsColor} width={CANVAS_W} height={CANVAS_H} />
        )}
        {/* AI-polished hero — background layer.
            Drawn UNDER text overlays so headline / social proof remain editable / translatable.
            fal.ai gpt-image-2 returns 1280×2784 (~99.2% match for 1290×2796) so cover with
            no letterbox is fine. */}
        {aiHero && (() => {
          const aiX = ss.action?.aiOffsetX ?? 0;
          const aiY = ss.action?.aiOffsetY ?? 0;
          const aiZ = ss.action?.aiScale ?? 1;
          return (
            <img
              // key on the URL forces React to unmount the old <img> and mount a fresh
              // one whenever the AI URL changes — guarantees the new render shows up
              // even if the browser had cached a sibling resource at the same path.
              key={aiHero}
              src={aiHero}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                zIndex: 0,
                pointerEvents: 'none',
                transform: `translate(${aiX}px, ${aiY}px) scale(${aiZ})`,
                transformOrigin: 'center center',
              }}
            />
          );
        })()}
        {showTextBoundary && (
          <div
            data-capture-omit="debug-boundary"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: visualDeviceTop - 2,
              height: 4,
              borderRadius: 2,
              background: 'rgba(239,68,68,0.85)',
              pointerEvents: 'none',
              zIndex: 100,
            }}
          />
        )}

        {/* Headline — top + sizes inherited from sample (set by pickPreset).
            data-capture-omit: useEnhance.captureScaffold filters out this whole
            block, so the AI sees a clean background where the headline sits.
            The same HTML headline is then layered on top of the AI render via
            the normal flow — gives crisp localised text on a clean canvas
            instead of gpt-image-2 baking a solid block in place of "removed" text. */}
        <div
          data-capture-omit="text-overlay"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: headlineTop,
            padding: '0 60px',
            textAlign,
            fontFamily: `"${textFont}", Inter, sans-serif`,
            color: textColor,
            transform: `translate(${ss.textX || 0}px, ${ss.textY || 0}px)`,
            // Editable mode lifts pointer-events lock + adds dashed border so
            // the user can drag the headline block to reposition for a locale.
            pointerEvents: editable ? 'auto' : 'none',
            direction: textDir,
            outline: editable ? '2px dashed rgba(59,130,246,0.6)' : undefined,
            outlineOffset: editable ? 8 : undefined,
            cursor: editable ? 'move' : undefined,
            userSelect: editable ? 'none' : undefined,
          }}
          onMouseDown={editable ? (e) => {
            // Translate visual-pixel deltas into canvas-pixel deltas using the
            // outer scale factor, so a 10px drag moves textX by exactly 10px
            // in logical canvas space regardless of preview fitWidth.
            e.preventDefault();
            const startX = e.clientX;
            const startY = e.clientY;
            const onMove = (ev: MouseEvent) => {
              const dxVisual = ev.clientX - startX;
              const dyVisual = ev.clientY - startY;
              editable.onMove(dxVisual / scale, dyVisual / scale);
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          } : undefined}
        >
          {ss.pill && (
            <div
              style={{
                display: 'inline-block',
                // Pill bg is template-driven (sample.pillBg seeded into ss).
                // For Pastel Dots the accent re-tints the dotted background,
                // not the pill — pill stays the template's branded pop colour.
                background: ss.pillBg || '#E04A6F',
                color: ss.pillFg || '#FFFFFF',
                fontFamily: `"${textFont}", Inter, sans-serif`,
                fontWeight: 800,
                fontSize: Math.round(titlePx * 0.22),
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                padding: '18px 48px',
                borderRadius: 999,
                marginBottom: 32,
              }}
            >
              {ss.pill}
            </div>
          )}
          <FitTitle
            text={verbDisplay}
            initialPx={titlePx}
            style={{
              fontWeight: textWeight,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              overflowWrap: 'normal',
              wordBreak: 'normal',
              hyphens: 'none',
            }}
          />
          {descDisplay && (
            <div
              style={{
                fontSize: subPx,
                fontWeight: 400,
                lineHeight: 1.15,
                marginTop: 24,
                opacity: 0.95,
                letterSpacing: '-0.005em',
                overflowWrap: 'break-word',
                wordBreak: 'normal',
              }}
            >
              {descDisplay}
            </div>
          )}
        </div>

        {/* Social proof больше не рендерится HTML-ом на scaffold — теперь это
            ингредиент в Inspector → AI запекает его в финальный enhance render. */}

        {/* Device — hide the HTML phone overlay whenever the AI render already
            contains the photoreal phone. Also hide on action slots when the
            user explicitly toggled hideDevice. */}
        {!aiHero && !(ss.kind === 'action' && (ss.action?.hideDevice ?? false)) && (
          <div
            style={{
              position: 'absolute',
              left: deviceX + dx,
              top: deviceY + dy,
              width: D.width,
              height: D.height,
              perspective: '2200px',
              transformStyle: 'preserve-3d',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                transform: `rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotate(${presetRotZ + tiltDeg}deg) scale(${presetScale * dscale})`,
                transformOrigin: 'center center',
                transformStyle: 'preserve-3d',
                position: 'relative',
              }}
            >
              <DeviceFrame
                asset={asset}
                emptyScreenColor={dragOver ? 'var(--accent-soft)' : '#000'}
                onClickScreen={showDropZone ? onPickFile : undefined}
                onDragOverScreen={
                  showDropZone
                    ? (e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }
                    : undefined
                }
                onDragLeaveScreen={() => setDragOver(false)}
                onDropScreen={showDropZone ? onDrop : undefined}
                placeholder={
                  <div
                    style={{
                      color: '#aaa',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 24,
                      alignItems: 'center',
                      fontSize: 48,
                    }}
                  >
                    <ImagePlus size={120} />
                    Drop screenshot here
                  </div>
                }
              >
                {ss.sourceUrl && (
                  <img
                    src={ss.sourceUrl}
                    alt={ss.filename}
                    draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
              </DeviceFrame>
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFileChosen}
        hidden
      />
    </div>
  );
}
