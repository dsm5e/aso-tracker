import { useEffect, useRef, useState } from 'react';
import type { Preset, PresetSample } from '../../lib/presets';
import { DEVICE_DIMS, DeviceFrame } from './DeviceFrame';
import { MountainBackground } from './MountainBackground';
import { DotsBackground } from './DotsBackground';
import { ScreenPlaceholder } from './ScreenPlaceholder';
import { paletteFromAccent, deriveDotsBg } from '../../lib/palette';

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

const CANVAS_W = 1290;
const CANVAS_H = 2796;

interface Props {
  preset: Preset;
  /** Sample headline content shown inside the thumb. */
  verb?: string;
  descriptor?: string;
  /** Sample app screenshot inside the device frame (optional URL). */
  sourceUrl?: string | null;
  accentOverride?: string;
  /** Per-sample device override (positionOffset, rotation, scale from .butterkit). */
  device?: PresetSample['device'];
  /** Per-sample text layout (yFraction, sizes). */
  text?: PresetSample['text'];
  /** Sample's index in the strip — used to crop the right slice from a panoramic bg. */
  sampleIndex?: number;
  /** Per-sample bg color override. */
  bgColor?: string;
  /** Pill / badge text rendered above headline (e.g. "FREE · NO SIGNUP"). */
  pill?: string;
  pillBg?: string;
  pillFg?: string;
}

/**
 * Mini version of MockupCanvas for catalog thumbnails.
 * Auto-fills its parent's width while preserving the 1290×2796 aspect ratio.
 * Device positioning comes from preset.device, optionally overridden per sample.
 */
export function PresetThumbnail({
  preset,
  verb = 'YOUR VERB',
  descriptor = 'YOUR DESCRIPTOR',
  sourceUrl,
  accentOverride,
  device,
  text,
  sampleIndex = 0,
  bgColor,
  pill,
  pillBg,
  pillFg,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const scale = width > 0 ? width / CANVAS_W : 0;

  const isUpper = preset.text.uppercase ?? true;
  const verbDisplay = isUpper ? verb.toUpperCase() : verb;
  const descDisplay = isUpper ? descriptor.toUpperCase() : descriptor;

  const isDotsBg = preset.background.parametric === 'dots';
  const baseBg =
    bgColor
      ? bgColor
      : preset.id === 'bold-brand-solid' && accentOverride
        ? accentOverride
        : isDotsBg && accentOverride
          ? deriveDotsBg(accentOverride, sampleIndex)
          : preset.background.css;
  const bgImage = preset.background.imageSrc
    ? `${import.meta.env.BASE_URL}${preset.background.imageSrc}`
    : undefined;
  // Parametric SVG bg overrides image when set — palette derived from accent.
  const parametricKind = preset.background.parametric ?? null;
  const isParametric = parametricKind !== null;
  // Panoramic strip: when the bg PNG is wider than canvas, slot N crops [N*1290..(N+1)*1290].
  // Without panorama metadata, fall back to `cover`.
  const isPanoramic = !!(preset.background.imageW && preset.background.imageW >= CANVAS_W * 2);
  let bg: string = baseBg;
  if (!isParametric && bgImage) {
    if (isPanoramic && preset.background.imageW && preset.background.imageH) {
      const offsetX = -sampleIndex * CANVAS_W;
      bg = `${baseBg} url("${bgImage}") ${offsetX}px 0 / ${preset.background.imageW}px ${preset.background.imageH}px no-repeat`;
    } else {
      bg = `${baseBg} url("${bgImage}") center / cover no-repeat`;
    }
  }
  const palette = parametricKind === 'mountains'
    ? paletteFromAccent(accentOverride ?? preset.suggestedAccent ?? '#A87648')
    : null;
  const dotsBg = baseBg;
  const dotsColor = darken(dotsBg, 0.25);

  // Device transform: COMPOSE preset.device + sample.device the same way MockupCanvas
  // does in the editor — offsets add, scales multiply, rotations add. Spreading would
  // have sample fields REPLACE preset fields, drifting the catalog preview away from
  // what the editor shows for the same data.
  const asset = device?.asset ?? preset.device?.asset ?? 'iphone';
  const D = DEVICE_DIMS[asset];
  const offX = (preset.device?.offsetX ?? 0) + (device?.offsetX ?? 0);
  const offY = (preset.device?.offsetY ?? 0) + (device?.offsetY ?? 0);
  const rotZ = (preset.device?.rotateZ ?? 0) + (device?.rotateZ ?? 0);
  const dscale = (preset.device?.scale ?? 1) * (device?.scale ?? 1);

  // Auto-position device based on where the headline sits. Text at top (yFraction < 0.5)
  // pushes device into the lower zone; text at bottom pulls device into the upper zone.
  // Device may spill past the canvas edge — that's the intended ButterKit-style look.
  const yFrac = text?.yFraction ?? 0.07;
  const titleSize = text?.titlePx ?? 220;
  const subSize = text?.subPx ?? 100;
  const TEXT_GAP = 80;
  const textTop = Math.round(yFrac * CANVAS_H);
  const textHeight = titleSize + 24 + subSize;
  const textBottom = textTop + textHeight;
  const deviceTopAuto =
    yFrac < 0.5
      // Text at top → device below it; allow bottom spill
      ? textBottom + TEXT_GAP
      // Text at bottom → device above; allow top spill
      : textTop - TEXT_GAP - D.height;

  const deviceLeft = (CANVAS_W - D.width) / 2 + offX;
  const deviceTop = deviceTopAuto + offY;

  return (
    <div
      ref={wrapRef}
      style={{
        width: '100%',
        aspectRatio: `${CANVAS_W}/${CANVAS_H}`,
        position: 'relative',
        // Clip everything (device, text) at the canvas frame — like the real App Store
        // screenshot. User-positioning that pushes device past the edge is intentional;
        // the clipped slice is the rendered final asset.
        overflow: 'hidden',
        background: '#000',
      }}
    >
      {scale > 0 && (
        <div
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            background: bg,
            position: 'relative',
          }}
        >
          {palette && (
            <MountainBackground
              palette={palette}
              width={CANVAS_W}
              height={CANVAS_H}
              panoramaOffsetX={sampleIndex * CANVAS_W}
            />
          )}
          {parametricKind === 'dots' && (
            <DotsBackground bgColor={dotsBg} dotColor={dotsColor} width={CANVAS_W} height={CANVAS_H} />
          )}
          {/* Headline — vertical position, title px, subtitle px all per-sample */}
          {(() => {
            const top = textTop;
            return (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top,
                  padding: '0 60px',
                  textAlign: preset.text.align || 'center',
                  fontFamily: `"${preset.text.font}", Inter, sans-serif`,
                  color: preset.text.color,
                  pointerEvents: 'none',
                }}
              >
                {pill && (
                  <div
                    style={{
                      display: 'inline-block',
                      background: pillBg || '#E04A6F',
                      color: pillFg || '#FFFFFF',
                      fontFamily: `"${preset.text.font}", Inter, sans-serif`,
                      fontWeight: 800,
                      fontSize: Math.round(titleSize * 0.22),
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      padding: '18px 48px',
                      borderRadius: 999,
                      marginBottom: 32,
                    }}
                  >
                    {pill}
                  </div>
                )}
                <div
                  style={{
                    fontSize: titleSize,
                    fontWeight: preset.text.weight,
                    lineHeight: 1.02,
                    letterSpacing: '-0.02em',
                    overflowWrap: 'break-word',
                    hyphens: 'auto',
                  }}
                >
                  {verbDisplay}
                </div>
                <div
                  style={{
                    fontSize: subSize,
                    fontWeight: 400,
                    lineHeight: 1.15,
                    marginTop: 24,
                    opacity: 0.95,
                    letterSpacing: '-0.005em',
                    overflowWrap: 'break-word',
                  }}
                >
                  {descDisplay}
                </div>
              </div>
            );
          })()}

          {/* Device with per-sample transform */}
          <div
            style={{
              position: 'absolute',
              left: deviceLeft,
              top: deviceTop,
              width: D.width,
              height: D.height,
              transform: `rotate(${rotZ}deg) scale(${dscale})`,
              transformOrigin: 'center center',
            }}
          >
            <DeviceFrame
              asset={asset}
              emptyScreenColor={preset.suggestedAccent ?? '#FAEFD8'}
              placeholder={<ScreenPlaceholder accent={preset.suggestedAccent ?? '#C2956B'} />}
            >
              {sourceUrl && (
                <img
                  src={sourceUrl}
                  alt=""
                  draggable={false}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              )}
            </DeviceFrame>
          </div>
        </div>
      )}
    </div>
  );
}
