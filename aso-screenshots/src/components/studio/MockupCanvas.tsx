import { Fragment, useRef, useState, useLayoutEffect, type DragEvent, type CSSProperties, type ReactNode } from 'react';
import { ImagePlus } from 'lucide-react';
import { expandU, getPreset } from '../../lib/presets';
import { useStudio, type Screenshot } from '../../state/studio';
import { DeviceFrame, getDeviceFrameGeometry } from './DeviceFrame';
import { MountainBackground } from './MountainBackground';
import { DotsBackground } from './DotsBackground';
import { LagoonBackground, seedFrom } from './LagoonBackground';
import { DecorLayer } from './DecorLayer';
import { paletteFromAccent, deriveDotsBg } from '../../lib/palette';
import { saveScreenshotBlob } from '../../lib/screenshotStore';
import { getCanvasDimensions, type IPhoneModel } from '../../lib/deviceProfiles';

/** Render a headline string, coloring any *asterisk-wrapped* run with the
 *  accent color (amma / HiMommy formula: one emotional word recolored).
 *  `==run==` draws a highlighter plate behind the run — the marker-pen device
 *  the Roomvi arch hero uses on the word "AI". Parsed before the others so a
 *  highlighted run can still be bold. */
/** Letter-spacing is a Latin typography tool. Chromium applies tracking by
 *  splitting the shaping run per cluster, which breaks scripts whose glyphs
 *  reorder or join: Devanagari `दर्जनों` rendered as `दजेनों` (the repha was
 *  dropped) and Arabic letters stop connecting. Return `normal` whenever the
 *  string contains such a script, and the designed tracking otherwise. */
const COMPLEX_SCRIPT = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0900-\u0DFF\u0E00-\u0EFF\u0F00-\u109F\u1780-\u17FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function tracking(text: string | undefined, designed: string): string {
  return text && COMPLEX_SCRIPT.test(text) ? 'normal' : designed;
}

/** The display line-height (1.02) is tuned for Latin caps, whose ink stays
 *  inside the em box. Devanagari hangs a repha above the shirorekha, Thai
 *  stacks a vowel sign plus a tone mark, and Vietnamese stacks two diacritics
 *  on one vowel — at 1.02 the clipped headline box shaved those off, which read
 *  as a mis-shaped word (`दर्जनों` looked like `दजेनों`). Give those scripts the
 *  room their ascenders actually need. */
const TALL_SCRIPT = /[\u0900-\u0DFF\u0E00-\u0EFF\u0F00-\u109F\u1780-\u17FF]/;
const STACKED_LATIN = /[\u1EA0-\u1EF9\u0102\u0103\u01A0\u01A1\u01AF\u01B0]/;

function lineHeight(text: string | undefined, designed: number): number {
  if (!text) return designed;
  // Keep the bump as small as the ink needs: 1.42 cleared the marks but made a
  // three-line headline 40% taller, which no longer fit the safe zone at all.
  if (TALL_SCRIPT.test(text)) return Math.max(designed, 1.26);
  if (STACKED_LATIN.test(text)) return Math.max(designed, 1.18);
  return designed;
}

function renderAccented(text: string, accentColor?: string, highlightColor?: string): ReactNode {
  if (text.includes('==')) {
    return text.split(/==([^=]+)==/g).map((chunk, ci) =>
      ci % 2 === 1 ? (
        <span key={`h${ci}`} style={{
          background: highlightColor ?? '#F5E14B',
          padding: '0 0.10em', borderRadius: 6,
          // nowrap + базовая линия: без них подсветка ломалась на границе строки —
          // «A» уезжала в плашку выше, а «I» оставалась голой на строке.
          display: 'inline-block', transform: 'skewX(-9deg)',
          whiteSpace: 'nowrap', verticalAlign: 'baseline',
        }}>
          <span style={{ display: 'inline-block', transform: 'skewX(9deg)' }}>
            {renderAccented(chunk, accentColor, highlightColor)}
          </span>
        </span>
      ) : (
        <Fragment key={`t${ci}`}>{renderAccented(chunk, accentColor, highlightColor)}</Fragment>
      )
    );
  }
  if (!text.includes('*')) return text;
  // **run** → heavier weight (mixed-weight headlines, Home AI style).
  // *run*   → accent color. Bold is parsed first so the two can be combined.
  return text.split(/\*\*([^*]+)\*\*/g).map((chunk, ci) => {
    if (ci % 2 === 1) {
      return (
        <span key={`b${ci}`} style={{ fontWeight: 900 }}>
          {renderAccented(chunk, accentColor, highlightColor)}
        </span>
      );
    }
    if (!accentColor || !chunk.includes('*')) return chunk;
    return chunk.split(/\*([^*]+)\*/g).map((seg, i) =>
      i % 2 === 1 ? (
        <span key={`${ci}-${i}`} style={{ color: accentColor }}>{seg}</span>
      ) : (
        seg
      )
    );
  });
}

/** One-line conversion copy (trust strips / compact proof cards). It is
 * measured in the real export DOM and shrunk until it fits the safe width. */
function FitSingleLine({
  text,
  initialPx,
  minPx = 24,
  style,
}: {
  text: string;
  initialPx: number;
  minPx?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = initialPx;
    el.style.fontSize = `${size}px`;
    while (size > minPx && el.scrollWidth > el.clientWidth) {
      size = Math.max(size - 2, minPx);
      el.style.fontSize = `${size}px`;
    }
  }, [text, initialPx, minPx]);

  return <div ref={ref} style={{ ...style, fontSize: initialPx, whiteSpace: 'nowrap', overflow: 'hidden' }}>{text}</div>;
}

/** Localized copy constrained to a fixed safe box. It wraps naturally to at
 *  most two lines, then shrinks until both lines fit without clipping. */
function FitUpToTwoLines({
  text,
  initialPx,
  minPx = 22,
  style,
}: {
  text: string;
  initialPx: number;
  minPx?: number;
  style?: CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const textEl = textRef.current;
    if (!box || !textEl) return;
    const fit = () => {
      let size = initialPx;
      textEl.style.fontSize = `${size}px`;
      const overflows = () => {
        const lineHeight = Number.parseFloat(getComputedStyle(textEl).lineHeight) || size * 1.05;
        const twoLineHeight = lineHeight * 2 + 2;
        return (
          textEl.scrollWidth > box.clientWidth ||
          textEl.scrollHeight > Math.min(box.clientHeight, twoLineHeight)
        );
      };
      while (size > minPx && overflows()) {
        size = Math.max(size - 2, minPx);
        textEl.style.fontSize = `${size}px`;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [text, initialPx, minPx]);

  return (
    <div
      ref={boxRef}
      style={{
        ...style,
        overflow: 'hidden',
      }}
    >
      <div
        ref={textRef}
        style={{
          width: '100%',
          fontSize: initialPx,
          lineHeight: 'inherit',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'normal',
          textAlign: 'inherit',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function explicitLineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
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
  /** Device family; iPhone dimensions come from the selected model profile. */
  device?: 'iphone' | 'ipad';
  iphoneModel?: IPhoneModel;
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
  localeMeta?: { rtl?: boolean; fontOverride?: string; lang?: string };
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
 * Model-aware logical canvas. Renders preset background + tilted device frame +
 * screenshot fill + headline. Scales down via outer transform to fit the viewport.
 */
export function MockupCanvas({ screenshot: ss, device = 'iphone', iphoneModel: iphoneModelOverride, fitWidth, fitHeight, showDropZone = true, viewModeOverride, localeMeta, editable, deviceBaseTitlePx, deviceBaseSubPx, showTextBoundary }: Props) {
  const { updateScreenshot, appColor, appIconUrl, iphoneModel: projectIphoneModel, ipadModel, sourceLocale, viewMode: globalViewMode } = useStudio();
  const iphoneModel = iphoneModelOverride ?? projectIphoneModel;
  const { w: CANVAS_W, h: CANVAS_H } = getCanvasDimensions(device, iphoneModel, ipadModel);
  const viewMode = viewModeOverride ?? globalViewMode;
  const isFullBleedSource = ss.sourceLayout === 'full-bleed';
  const isArch = ss.sourceLayout === 'arch';
  const isBeforeAfter = ss.sourceLayout === 'before-after';
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
  // Frame style: slot override > preset default > clay. Resolved here so the
  // layout maths (anchoring, safe zones) use the same box the frame draws.
  const frameStyle = ss.deviceFrameStyle ?? dt.frameStyle;
  const bezelColor = ss.deviceBezelColor ?? dt.bezelColor?.[asset];
  const D = getDeviceFrameGeometry(asset, iphoneModel, ipadModel, frameStyle, bezelColor);
  const presetOffX = dt.offsetX ?? 0;
  const presetOffY = (device === 'ipad' ? dt.ipad?.offsetY : undefined) ?? dt.offsetY ?? 0;
  const presetRotZ = dt.rotateZ ?? 0;
  const presetScale = (device === 'ipad' ? dt.ipad?.scale : undefined) ?? dt.scale ?? 1;
  const u = CANVAS_W / 100;
  const pt = preset?.text;
  // `below-headline`: the device hangs under the MEASURED headline block.
  const deviceAnchor = ss.deviceAnchor === 'free' ? undefined : (ss.deviceAnchor ?? preset?.layout?.deviceAnchor);
  const isAnchored = deviceAnchor === 'below-headline';
  const [measuredHeadlineH, setMeasuredHeadlineH] = useState<number | null>(null);

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
  const layoutTitleLines = explicitLineCount(ss.headline.verb || '');
  const layoutSubLines = explicitLineCount(ss.headline.descriptor || '');
  const titleBlockHeight = layoutTitleLines > 0 ? layoutTitlePx * 1.02 * layoutTitleLines : 0;
  const subBlockHeight = layoutSubLines > 0 ? layoutSubPx * 1.15 * layoutSubLines : 0;
  const headlineGap = titleBlockHeight > 0 && subBlockHeight > 0 ? 24 : 0;
  const headlineHeight = titleBlockHeight + headlineGap + subBlockHeight;
  const textZoneBottom = headlineTop + headlineHeight; // boundary: text must stay above this
  const deviceX = (CANVAS_W - D.width) / 2 + presetOffX;
  const anchorScale = presetScale * (ss.deviceScale ?? 1);
  const deviceY = isAnchored
    // Top edge of the (scaled) frame sits `deviceGapU` below the headline.
    // Scaling happens around the centre, hence the (1 - scale) correction.
    ? headlineTop + (ss.textY || 0) + (measuredHeadlineH ?? headlineHeight)
      + (preset?.layout?.deviceGapU ?? 4.5) * u
      - (D.height / 2) * (1 - anchorScale)
      + presetOffY
    : (yFrac < 0.5
      ? textZoneBottom + TEXT_GAP
      : headlineTop - TEXT_GAP - D.height)
    + presetOffY;

  // Font: locale override > user pick > preset default. Same precedence for color/weight.
  const textFont = localeMeta?.fontOverride || ss.font || preset?.text.font || 'Inter';
  const textDir = localeMeta?.rtl ? 'rtl' : undefined;
  const textColor = ss.textColorOverride || preset?.text.color || '#FFFFFF';
  const titleColor = ss.titleColorOverride || textColor;
  const subtitleColor = ss.subtitleColorOverride || (ss.textColorOverride ? textColor : pt?.subtitleColor ?? textColor);
  const titleShadow = expandU(pt?.titleShadow, CANVAS_W);
  const subtitleShadow = expandU(pt?.subtitleShadow, CANVAS_W);
  const fitLines = pt?.fitLines ?? false;
  const isElaraHeroText = ss.heroTextLayout === 'elara';
  const isElaraSoftPhoneOverlay = ss.heroPhoneOverlayLayout === 'elara-soft-v4';
  const isFatherEditorialText = ss.heroTextLayout === 'father-editorial';
  const isFatherProductText = ss.heroTextLayout === 'father-product-localized';
  const isCppCenteredText = ss.heroTextLayout === 'cpp-centered';
  const isCppEditorialText = ss.heroTextLayout === 'cpp-editorial';
  const textWeight = isCppEditorialText
    ? 700
    : isElaraHeroText
      ? 900
      : isFatherEditorialText || isFatherProductText || isCppCenteredText
        ? 850
        : (preset?.text.weight || 800);
  const isUpper = preset?.text.uppercase ?? true;
  const baseAlign = ss.textAlignOverride ? ss.textAlignOverride : isArch || isElaraHeroText || isFatherEditorialText || isFatherProductText || isCppCenteredText || isCppEditorialText ? 'center' : (preset?.text.align || 'center');
  // RTL locales (Arabic, Hebrew) mirror the horizontal alignment so the
  // headline hugs the RIGHT edge, matching the right-to-left reading order.
  const textAlign = localeMeta?.rtl
    ? (baseAlign === 'left' ? 'right' : baseAlign === 'right' ? 'left' : 'center')
    : baseAlign;

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
  // Locale-aware casing: Turkish/Azeri dotted İ, Lithuanian accents, etc.
  const textLang = localeMeta?.lang ?? sourceLocale;
  const upper = (t: string) => {
    try { return t.toLocaleUpperCase(textLang || undefined); } catch { return t.toUpperCase(); }
  };
  const verbDisplay = isUpper ? upper(ss.headline.verb || '') : ss.headline.verb;
  const descDisplay = (pt?.subtitleUppercase ?? isUpper) ? upper(ss.headline.descriptor || '') : ss.headline.descriptor;

  // Localized headline copy must fit as ONE block. Previously the title was
  // shrunk independently while the descriptor kept its original size. Long
  // Spanish/French/German strings could therefore flow into the descriptor or
  // the device. Measure pill + title + descriptor together and reduce all
  // three proportionally until the complete block fits its real safe zone.
  const headlineBoxRef = useRef<HTMLDivElement>(null);
  const headlineContentRef = useRef<HTMLDivElement>(null);
  const headlineTitleRef = useRef<HTMLDivElement>(null);
  const headlineDescRef = useRef<HTMLDivElement>(null);
  const headlinePillRef = useRef<HTMLDivElement>(null);
  const fullBleedSafeBottom = Math.round(
    CANVAS_H * (ss.headlineSafeBottomFraction ?? 0.4),
  );
  // В арке устройство не рисуется, но его фантомная позиция всё равно
  // считалась — и именно она обрезала заголовок посреди третьей строки.
  // Реальная граница здесь — верх полосы со снимками.
  const archStripTop = Math.round((ss.archStripTopFrac ?? 0.52) * CANVAS_H);
  // Explicit per-slot override wins on EVERY layout, not just full-bleed:
  // AI-baked device positions drift from the scaffold math, so the derived
  // visualDeviceTop line can land inside the rendered device. A manual
  // headlineSafeBottomFraction draws the line exactly where the user put it.
  const headlineSafeBottom = ss.headlineSafeBottomFraction != null
    ? Math.round(CANVAS_H * ss.headlineSafeBottomFraction)
    : isAnchored
      ? Math.round(CANVAS_H * (preset?.layout?.headlineMaxFraction ?? 0.34))
      : isFullBleedSource
      ? fullBleedSafeBottom
      : isArch
        ? archStripTop - 30
        : Math.floor(visualDeviceTop - 38);
  const headlineSafeHeight = Math.max(
    220,
    headlineSafeBottom - headlineTop - (ss.textY || 0),
  );

  useLayoutEffect(() => {
    const box = headlineBoxRef.current;
    const content = headlineContentRef.current;
    const title = headlineTitleRef.current;
    if (!box || !content || !title) return;

    let cancelled = false;
    const descriptor = headlineDescRef.current;
    const pill = headlinePillRef.current;
    const initialPillPx = isElaraHeroText
      ? 34
      : isFatherEditorialText
        ? 34
        : isFatherProductText
          ? 32
          : Math.round(titlePx * (pt?.pill?.sizeFrac ?? 0.22));
    const minTitlePx = Math.max(46, Math.round(titlePx * 0.46));
    const minSubPx = Math.max(25, Math.round(subPx * 0.5));
    const minPillPx = Math.max(22, Math.round(initialPillPx * 0.64));

    const applySizes = (nextTitle: number, nextSub: number, nextPill: number) => {
      title.style.fontSize = `${nextTitle}px`;
      if (descriptor) descriptor.style.fontSize = `${nextSub}px`;
      if (pill) pill.style.fontSize = `${nextPill}px`;
    };

    const overflows = () => (
      content.scrollHeight > box.clientHeight + 1
      // The headline box includes horizontal padding; the content width is
      // the actual text budget. Long unbreakable translated words must shrink.
      || content.scrollWidth > content.clientWidth + 1
      || title.scrollWidth > title.clientWidth + 1
      || (descriptor != null && descriptor.scrollWidth > descriptor.clientWidth + 1)
    );

    const fit = () => {
      if (cancelled) return;
      let nextTitle = titlePx;
      let nextSub = subPx;
      let nextPill = initialPillPx;
      applySizes(nextTitle, nextSub, nextPill);

      // Keep the design's title/subtitle ratio instead of crushing only one
      // element. The explicit minimums prevent translated text becoming tiny.
      const shrinkTo = (floorTitle: number, floorSub: number, floorPill: number) => {
        while (
          overflows()
          && (nextTitle > floorTitle || nextSub > floorSub || nextPill > floorPill)
        ) {
          nextTitle = Math.max(floorTitle, nextTitle - 3);
          nextSub = Math.max(floorSub, nextSub - 1.5);
          nextPill = Math.max(floorPill, nextPill - 1);
          applySizes(nextTitle, nextSub, nextPill);
        }
      };
      if (fitLines) {
        // Each line is nowrap: shrink title and subtitle independently until
        // their widest line fits the column, before the joint height pass.
        const floorT = Math.max(24, Math.round(titlePx * 0.3));
        while (title.scrollWidth > title.clientWidth + 1 && nextTitle > floorT) {
          nextTitle = Math.max(floorT, nextTitle - 2);
          title.style.fontSize = `${nextTitle}px`;
        }
        if (descriptor) {
          const floorS = Math.max(18, Math.round(subPx * 0.3));
          while (descriptor.scrollWidth > descriptor.clientWidth + 1 && nextSub > floorS) {
            nextSub = Math.max(floorS, nextSub - 1);
            descriptor.style.fontSize = `${nextSub}px`;
          }
        }
      }
      shrinkTo(minTitlePx, minSubPx, minPillPx);
      // Reserve floor. A handful of locales (Arabic slot 2) still wrap one line
      // too many at the designed minimum, and the export rejects an overflowing
      // headline outright. A slightly smaller headline beats a missing
      // screenshot, so give those a second pass with a lower bound.
      if (overflows()) {
        shrinkTo(
          Math.max(34, Math.round(titlePx * 0.34)),
          Math.max(20, Math.round(subPx * 0.38)),
          Math.max(18, Math.round(initialPillPx * 0.5)),
        );
      }
      if (isAnchored) {
        const h = Math.ceil(content.offsetHeight);
        setMeasuredHeadlineH((prev) => (prev === h ? prev : h));
      }
    };

    fit();
    // `fonts.ready` can resolve BEFORE a locale's script font is even requested
    // (the Devanagari face is only fetched once the localized text is in the
    // DOM). Slot 1 then kept the fallback-metric size and overflowed by 176px.
    // Watching the content box catches the reflow the font swap causes, and
    // `loadingdone` catches faces that arrive after the observer settles.
    void document.fonts?.ready.then(fit);
    const onFontsDone = () => fit();
    document.fonts?.addEventListener?.('loadingdone', onFontsDone);
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(content);
    return () => {
      cancelled = true;
      document.fonts?.removeEventListener?.('loadingdone', onFontsDone);
      observer.disconnect();
    };
  }, [
    verbDisplay,
    descDisplay,
    ss.pill,
    titlePx,
    subPx,
    headlineSafeHeight,
    isElaraHeroText,
    isFatherEditorialText,
    isFatherProductText,
    fitLines,
    isAnchored,
    textFont,
  ]);

  // compute scale to fit
  let scale = 1;
  if (fitWidth) scale = Math.min(scale, fitWidth / CANVAS_W);
  if (fitHeight) scale = Math.min(scale, fitHeight / CANVAS_H);

  const onPickFile = () => fileRef.current?.click();
  const adoptFile = (file: File) => {
    const url = URL.createObjectURL(file);
    updateScreenshot(ss.id, { sourceUrl: url, filename: file.name });
    const image = new Image();
    image.onload = () => {
      updateScreenshot(ss.id, {
        sourcePixelWidth: image.naturalWidth,
        sourcePixelHeight: image.naturalHeight,
      });
    };
    image.src = url;
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
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    adoptFile(file);
  };

  // AI hero shows whenever there's a generated image AND the user toggled to Enhanced —
  // independent of `kind`, so Enhance works for any slot, not only action/hero ones.
  const aiHero = viewMode === 'enhanced' ? ss.action?.aiImageUrl ?? null : null;

  // One phone (frame + screenshot) at an absolute canvas position with its own
  // rotate/scale. Shared by the single-device path and the dual "V" mockup.
  const renderPhone = (opts: {
    keyName: string;
    url: string | null;
    left: number;
    top: number;
    rotate: number;
    scale: number;
    z?: number;
    interactive?: boolean;
    label?: string;
  }) => (
    <div
      key={opts.keyName}
      style={{
        position: 'absolute',
        left: opts.left,
        top: opts.top,
        width: D.width,
        height: D.height,
        perspective: '2200px',
        transformStyle: 'preserve-3d',
        zIndex: opts.z ?? 1,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotate(${opts.rotate}deg) scale(${opts.scale})`,
          transformOrigin: 'center center',
          transformStyle: 'preserve-3d',
          position: 'relative',
        }}
      >
        {/* V-caption ("for mom"/"for dad") is NOT drawn here — it lives in a
            separate overlay layer (renderVLabel) so it stays a live, translatable
            text element that survives the AI enhance (data-capture-omit) instead
            of being baked into the device image. */}
        <DeviceFrame
          asset={asset}
          iphoneModel={iphoneModel}
          ipadModel={ipadModel}
          bodyColor={dt.bodyColor}
          rimColor={dt.rimColor}
          shadow={expandU(dt.shadow, CANVAS_W)}
          frameStyle={frameStyle}
          bezelColor={bezelColor}
          cropBottomFrac={ss.screenCropBottom}
          showIsland={!opts.url}
          emptyScreenColor={opts.interactive && dragOver ? 'var(--accent-soft)' : '#000'}
          onClickScreen={opts.interactive && showDropZone ? onPickFile : undefined}
          onDragOverScreen={opts.interactive && showDropZone ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
          onDragLeaveScreen={opts.interactive ? () => setDragOver(false) : undefined}
          onDropScreen={opts.interactive && showDropZone ? onDrop : undefined}
          placeholder={opts.interactive ? (
            <div style={{ color: '#aaa', display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', fontSize: 48 }}>
              <ImagePlus size={120} />
              Drop screenshot here
            </div>
          ) : undefined}
        >
          {opts.url && (
            <img src={opts.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          )}
        </DeviceFrame>
      </div>
    </div>
  );

  /** V-caption pill ("for mom" / "for dad") as a STANDALONE overlay, positioned
   *  with the same wrapper geometry as its phone so it centers on the device and
   *  tilts with it — but drawn independently of the device so it:
   *   • stays out of the AI scaffold capture (data-capture-omit) → never baked,
   *   • survives in the enhanced/export view (on top of the AI render),
   *   • remains a live, localizable text node.  */
  const renderVLabel = (opts: {
    keyName: string;
    left: number;
    top: number;
    rotate: number;
    scale: number;
    label?: string;
    z?: number;
  }) => {
    if (!opts.label) return null;
    return (
      <div
        key={`${opts.keyName}-label`}
        data-capture-omit="v-label"
        style={{
          position: 'absolute',
          left: opts.left,
          top: opts.top,
          width: D.width,
          height: D.height,
          perspective: '2200px',
          transformStyle: 'preserve-3d',
          pointerEvents: 'none',
          zIndex: (opts.z ?? 1) + 10,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: `rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotate(${opts.rotate}deg) scale(${opts.scale})`,
            transformOrigin: 'center center',
            transformStyle: 'preserve-3d',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: 56,
              textAlign: 'center',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                fontFamily: `"${textFont}", Inter, sans-serif`,
                fontWeight: 700,
                fontSize: 56,
                letterSpacing: '0.01em',
                color: ss.headlineAccent ?? preset?.suggestedAccent ?? '#2C2C2C',
                background: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(255,255,255,0.6)',
                borderRadius: 999,
                padding: '16px 40px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                whiteSpace: 'nowrap',
              }}
            >
              {opts.label}
            </span>
          </div>
        </div>
      </div>
    );
  };

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
        {/* --- Roomvi `arch`: фото + белая арка с акцентной каёмкой + диагональные
            полосы. Заголовок сюда НЕ входит: его рисует штатный оверлей ниже,
            чтобы шрифт и выравнивание слушались инспектора. --- */}
        {isArch && (() => {
          const pad    = ss.archPad ?? 42;
          const rim    = ss.archRim ?? 28;
          const archY  = Math.round((ss.archTopFrac ?? 0.275) * CANVAS_H);
          const stripY = Math.round((ss.archStripTopFrac ?? 0.52) * CANVAS_H);
          const skew   = ss.archSkew ?? 7;
          const zoom   = ss.archZoom ?? 1.12;
          const accent = ss.archAccent ?? appColor ?? '#2F6FA8';
          const cardW  = CANVAS_W - 2 * pad;
          const radius = Math.round(cardW * 0.62);
          const bands  = ss.archBands ?? [];
          const n      = bands.length || 1;
          return (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              <div style={{ position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom,#E9E8E4 0%,#DFDEDA 40%,#C8C8C8 100%)' }} />
              {ss.archHeroUrl && (
                <img src={ss.archHeroUrl} alt="" draggable={false}
                  style={{ position: 'absolute', top: 0, left: 0, width: CANVAS_W,
                    height: archY + 150, objectFit: 'cover', objectPosition: '50% 42%',
                    WebkitMaskImage: 'linear-gradient(to bottom,#000 0%,#000 78%,rgba(0,0,0,.6) 88%,rgba(0,0,0,.22) 95%,transparent 100%)',
                    maskImage: 'linear-gradient(to bottom,#000 0%,#000 78%,rgba(0,0,0,.6) 88%,rgba(0,0,0,.22) 95%,transparent 100%)' }} />
              )}
              <div style={{ position: 'absolute', left: pad, right: pad, top: archY,
                bottom: pad, background: '#fff', borderRadius: `${radius}px ${radius}px 0 0` }} />
              <div style={{ position: 'absolute', left: pad, right: pad, top: archY,
                height: Math.round(CANVAS_H * 0.34), border: `${rim}px solid ${accent}`,
                borderBottom: 'none', borderRadius: `${radius}px ${radius}px 0 0`,
                // Полпикселя размытия: CSS-бордюр на радиусе в ~800px растеризуется
                // ступеньками, и на экспорте дуга читается «гребёнкой». Сглаживание
                // убирает лесенку, не съедая толщину обводки.
                filter: 'blur(1.1px)',
                WebkitMaskImage: 'linear-gradient(to bottom,#000 0%,rgba(0,0,0,.92) 10%,rgba(0,0,0,.55) 26%,rgba(0,0,0,.22) 42%,transparent 62%)',
                maskImage: 'linear-gradient(to bottom,#000 0%,rgba(0,0,0,.92) 10%,rgba(0,0,0,.55) 26%,rgba(0,0,0,.22) 42%,transparent 62%)' }} />
              <div style={{ position: 'absolute', left: pad + rim, right: pad + rim, top: stripY,
                bottom: pad + rim, overflow: 'hidden' }}>
                {bands.map((b, i) => {
                  const l = (i * 100) / n, r = ((i + 1) * 100) / n;
                  const L  = i === 0     ? l - skew - 6 : l + skew;
                  const R  = i === n - 1 ? r + skew + 6 : r + skew;
                  const LB = i === 0     ? l - skew - 6 : l - skew;
                  const RB = i === n - 1 ? r + skew + 6 : r - skew;
                  const poly = `polygon(${L}% -2%, ${R}% -2%, ${RB}% 102%, ${LB}% 102%)`;
                  const cx = (l + r) / 2 - skew * 0.5;
                  return (
                    <div key={i} style={{ position: 'absolute', inset: 0, overflow: 'hidden',
                      clipPath: poly, WebkitClipPath: poly }}>
                      <img src={b.url} alt="" draggable={false}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                          objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: '50% 50%' }} />
                      {b.label && (
                        <div style={{ position: 'absolute', bottom: 46, left: `${cx - 14}%`,
                          right: `${100 - cx - 14}%`, textAlign: 'center', color: '#fff',
                          font: '600 40px/1 system-ui', textShadow: '0 3px 18px rgba(0,0,0,.85)' }}>
                          {b.label}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {isBeforeAfter && (() => {
          const split  = ss.baSplit ?? 0.42;
          const handle = ss.baHandleFrac ?? 0.52;
          const x      = Math.round(split * CANVAS_W);
          const bTop   = Math.round((ss.badgeTopFrac ?? 0.175) * CANVAS_H);
          const bLeft  = Math.round((ss.badgeLeftFrac ?? 0.055) * CANVAS_W);
          return (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#000' }}>
              {ss.baAfterUrl && (
                <img src={ss.baAfterUrl} alt="" draggable={false}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {ss.baBeforeUrl && (
                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: x, overflow: 'hidden' }}>
                  <img src={ss.baBeforeUrl} alt="" draggable={false}
                    style={{ position: 'absolute', top: 0, left: 0, width: CANVAS_W, height: CANVAS_H, objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0,
                height: Math.round(CANVAS_H * (ss.baScrimFrac ?? 0.34)), pointerEvents: 'none',
                background: 'linear-gradient(to bottom, rgba(0,0,0,.52) 0%, rgba(0,0,0,.38) 34%, rgba(0,0,0,.18) 66%, rgba(0,0,0,0) 100%)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: x - 3, width: 6,
                background: '#fff', boxShadow: '0 0 22px rgba(0,0,0,.45)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.25) 12%, rgba(0,0,0,.7) 24%, #000 34%, #000 100%)',
                maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.25) 12%, rgba(0,0,0,.7) 24%, #000 34%, #000 100%)' }} />
              <div style={{ position: 'absolute', left: x - 58, top: Math.round(handle * CANVAS_H),
                width: 116, height: 116, borderRadius: '50%', background: 'rgba(255,255,255,.30)',
                border: '4px solid rgba(255,255,255,.92)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', font: '400 40px/1 system-ui', letterSpacing: 4 }}>&#9668;&#9658;</div>
              {(ss.badgeLine1 || ss.badgeLaurelLeftUrl) && (
                <div style={{ position: 'absolute', left: bLeft, top: bTop,
                  display: 'flex', alignItems: 'center', gap: 14, color: '#fff' }}>
                  {ss.badgeLaurelLeftUrl && <img src={ss.badgeLaurelLeftUrl} alt="" style={{ height: ss.badgeLaurelHeight ?? 250 }} />}
                  <div style={{ textAlign: 'center', textShadow: '0 3px 16px rgba(0,0,0,.6)' }}>
                    {ss.badgeLine1 && <div style={{ font: '700 84px/1 system-ui' }}>{ss.badgeLine1}</div>}
                    {ss.badgeLine2 && <div style={{ font: '500 58px/1.1 system-ui', opacity: .95 }}>{ss.badgeLine2}</div>}
                    {ss.badgeStars && <div style={{ fontSize: 56, color: '#F5C518', letterSpacing: 3, marginTop: 8 }}>&#9733;&#9733;&#9733;&#9733;&#9733;</div>}
                  </div>
                  {ss.badgeLaurelRightUrl && <img src={ss.badgeLaurelRightUrl} alt="" style={{ height: ss.badgeLaurelHeight ?? 250 }} />}
                </div>
              )}
            </div>
          );
        })()}
        {/* Стикеры рисуются ПОВЕРХ устройства (zIndex выше рамки), но ниже
            заголовка: они часть сцены, а не текста. */}
        {(ss.stickers?.length ?? 0) > 0 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none' }}>
            {ss.stickers!.map((st, i) => {
              const accent = st.tone === 'accent';
              const isRow = Boolean(st.imageUrls?.length);
              const isImage = Boolean(st.imageUrl) || isRow;
              return (
                <div key={i} style={{
                  position: 'absolute',
                  left: `${st.xFrac * 100}%`,
                  top: `${st.yFrac * 100}%`,
                  width: st.widthFrac ? `${st.widthFrac * 100}%` : undefined,
                  transform: `translate(-50%,-50%) rotate(${st.rotate ?? 0}deg)`,
                  background: accent ? (ss.archAccent ?? appColor ?? '#2F6FA8') : '#fff',
                  color: accent ? '#fff' : '#141414',
                  padding: isImage ? 18 : '26px 40px',
                  borderRadius: isImage ? 28 : 22,
                  font: `700 ${st.fontPx ?? 54}px/1.15 ${ss.font ?? 'Inter'}, system-ui`,
                  whiteSpace: st.widthFrac ? 'normal' : 'pre',
                  textAlign: st.align ?? 'center',
                  boxShadow: '0 26px 60px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.12)',
                }}>
                  {isRow ? (
                    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start',
                      position: 'relative' }}>
                      {st.rowArrow && st.imageUrls!.length === 2 && (
                        <div style={{ position: 'absolute', left: '50%', top: '42%',
                          transform: 'translate(-50%,-50%)', zIndex: 2,
                          width: 84, height: 84, borderRadius: 42, background: '#141414',
                          color: '#fff', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', font: '600 44px/1 system-ui',
                          boxShadow: '0 10px 24px rgba(0,0,0,.28)' }}>
                          →
                        </div>
                      )}
                      {st.imageUrls!.map((u, j) => (
                        <div key={j} style={{ flex: 1, minWidth: 0 }}>
                          {/* Кадр подрезан по высоте (object-fit), чтобы подпись
                              поместилась внутрь той же подложки, а не увеличила её. */}
                          <img src={u} alt="" style={{ display: 'block', width: '100%',
                            aspectRatio: '0.95', objectFit: 'cover', borderRadius: 16 }} />
                          {st.imageCaptions?.[j] && (
                            <div style={{ marginTop: 14, textAlign: 'center', color: '#141414',
                              font: `600 34px/1.1 ${ss.font ?? 'Inter'}, system-ui` }}>
                              {st.imageCaptions[j]}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : isImage
                    ? <img src={st.imageUrl} alt="" style={{ display: 'block', width: '100%',
                        borderRadius: 16 }} />
                    : st.text}
                </div>
              );
            })}
          </div>
        )}
        {/* Full-bleed background image — bottom-most layer (under parametric bg,
            AI hero, device and text). Used for photographic cover frames
            (e.g. first/last App Store screenshots). Set via the agent bridge. */}
        {ss.bgImageUrl && (!isFatherProductText || ss.sourceLayout === 'device') && (
          <img
            key={ss.bgImageUrl}
            src={ss.bgImageUrl}
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
            }}
          />
        )}
        {isFullBleedSource && ss.sourceUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              pointerEvents: 'none',
              transform: `translate3d(${ss.sourceOffsetX ?? 0}px, ${ss.sourceOffsetY ?? 0}px, 0) scale(${ss.sourceScale ?? 1})`,
              transformOrigin: 'center center',
            }}
          >
            <img
              key={ss.sourceUrl}
              src={ss.sourceUrl}
              alt=""
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
        )}
        {isFatherProductText && ss.bgImageUrl && ss.sourceLayout === 'full-bleed' && (
          <img
            key={`${ss.bgImageUrl}-localized-top-mask`}
            src={ss.bgImageUrl}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              inset: '0 0 auto 0',
              width: '100%',
              // Stay fully opaque until every baked English title is covered,
              // then feather into the original artwork before the phone begins.
              // This avoids both ghost copy and a visible horizontal seam.
              height: 520,
              objectFit: 'cover',
              objectPosition: 'center top',
              display: 'block',
              zIndex: 1,
              pointerEvents: 'none',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 84%, transparent 100%)',
              maskImage: 'linear-gradient(to bottom, #000 0%, #000 84%, transparent 100%)',
            }}
          />
        )}
        {isFullBleedSource && ss.sourceUrl && showDropZone && (
          <div
            role="button"
            aria-label="Replace finished preview"
            title="Перетащи новый файл для замены · двойной клик — выбрать файл"
            onDoubleClick={onPickFile}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 4,
              cursor: 'default',
              border: dragOver ? '8px dashed #3B82F6' : '8px solid transparent',
              background: dragOver ? 'rgba(59,130,246,0.16)' : 'transparent',
              boxSizing: 'border-box',
            }}
          >
            {dragOver && (
              <div style={{
                position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                color: '#1D4ED8', fontFamily: 'Inter, sans-serif', fontSize: 52,
                fontWeight: 800, textShadow: '0 2px 12px white',
              }}>
                Отпусти, чтобы заменить превью
              </div>
            )}
          </div>
        )}
        {isFullBleedSource && !ss.sourceUrl && showDropZone && (
          <button
            type="button"
            onClick={onPickFile}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              position: 'absolute',
              inset: 40,
              zIndex: 2,
              border: '4px dashed rgba(59,130,246,0.55)',
              borderRadius: 32,
              background: dragOver ? 'rgba(59,130,246,0.16)' : 'rgba(255,255,255,0.82)',
              color: '#2563EB',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 28,
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              fontSize: 54,
              fontWeight: 700,
            }}
          >
            <ImagePlus size={128} />
            Добавить готовое превью
            <span style={{ fontSize: 34, fontWeight: 500, color: '#64748B' }}>
              PNG, JPG или WebP · можно перетащить сюда
            </span>
          </button>
        )}
        {!isFullBleedSource && !isArch && !isBeforeAfter && parametricPalette && (
          <MountainBackground palette={parametricPalette} width={CANVAS_W} height={CANVAS_H} />
        )}
        {!isFullBleedSource && !isArch && !isBeforeAfter && parametricKind === 'dots' && (
          <DotsBackground bgColor={dotsBgColor} dotColor={dotsColor} width={CANVAS_W} height={CANVAS_H} />
        )}
        {!isFullBleedSource && !isArch && !isBeforeAfter && parametricKind === 'lagoon' && (
          <LagoonBackground part="back" width={CANVAS_W} seed={seedFrom(ss.filename || ss.id)} opts={preset?.background.lagoon} />
        )}
        <DecorLayer items={ss.decor} layer="back" width={CANVAS_W} height={CANVAS_H} fontFamily={textFont} rtl={localeMeta?.rtl} lang={textLang} />
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
          ref={headlineBoxRef}
          data-capture-omit="text-overlay"
          data-headline-box
          lang={textLang || undefined}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: headlineTop,
            padding: isElaraHeroText ? '0 190px' : isFatherEditorialText ? '0 108px' : isFatherProductText ? '0 88px' : isCppCenteredText || isCppEditorialText ? '0 96px' : `0 ${pt?.sidePaddingU != null ? pt.sidePaddingU * u : 60}px`,
            textAlign,
            fontFamily: `"${textFont}", Inter, sans-serif`,
            color: textColor,
            zIndex: 3,
            transform: `translate(${ss.textX || 0}px, ${ss.textY || 0}px)`,
            // Editable mode lifts pointer-events lock + adds dashed border so
            // the user can drag the headline block to reposition for a locale.
            pointerEvents: editable ? 'auto' : 'none',
            direction: textDir,
            height: headlineSafeHeight,
            overflow: 'hidden',
            display: ss.headlineVerticalAlign === 'center' ? 'flex' : undefined,
            alignItems: ss.headlineVerticalAlign === 'center' ? 'center' : undefined,
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
          <div ref={headlineContentRef} style={{ width: '100%' }}>
          {ss.pill && (
            <div
              ref={headlinePillRef}
              style={{
                display: 'inline-block',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'clip',
                // Pill bg is template-driven (sample.pillBg seeded into ss).
                // For Pastel Dots the accent re-tints the dotted background,
                // not the pill — pill stays the template's branded pop colour.
                background: isElaraHeroText || isFatherProductText ? 'transparent' : (ss.pillBg || pt?.pill?.bg || '#E04A6F'),
                color: ss.pillFg || pt?.pill?.fg || '#FFFFFF',
                fontFamily: `"${textFont}", Inter, sans-serif`,
                fontWeight: pt?.pill?.weight ?? 800,
                fontSize: isElaraHeroText ? 34 : isFatherEditorialText ? 34 : isFatherProductText ? 32 : Math.round(titlePx * (pt?.pill?.sizeFrac ?? 0.22)),
                letterSpacing: tracking(ss.pill, pt?.pill?.letterSpacing ?? '0.08em'),
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                padding: isElaraHeroText || isFatherProductText ? 0 : isFatherEditorialText ? '16px 38px' : '18px 48px',
                borderRadius: isElaraHeroText || isFatherProductText ? 0 : 999,
                marginBottom: isElaraHeroText ? 38 : isFatherEditorialText ? 30 : isFatherProductText ? 18 : 32,
                border: isFatherEditorialText ? '1px solid rgba(255,255,255,0.52)' : undefined,
                boxShadow: isFatherEditorialText ? '0 12px 36px rgba(61,36,50,0.10)' : expandU(pt?.pill?.shadow, CANVAS_W),
                // Keep the Father CPP pill translucent but do not use a CSS
                // backdrop blur: Chromium expands that filter into a visible
                // rectangular capture layer during the 1320×2868 export.
              }}
            >
              {ss.pill}
            </div>
          )}
          <div
            ref={headlineTitleRef}
            data-headline-title
            style={{
              color: titleColor,
              fontSize: titlePx,
              fontWeight: textWeight,
              lineHeight: lineHeight(verbDisplay, pt?.titleLineHeight ?? 1.02),
              letterSpacing: tracking(verbDisplay, pt?.titleLetterSpacing ?? '-0.02em'),
              textShadow: titleShadow,
              whiteSpace: fitLines ? 'pre' : 'pre-wrap',
              textWrapStyle: pt?.textWrap,
              overflowWrap: 'normal',
              wordBreak: 'normal',
              hyphens: 'none',
            }}
          >
            {renderAccented(verbDisplay, ss.headlineAccent ?? preset?.suggestedAccent)}
          </div>
          {descDisplay && (
            <div
              ref={headlineDescRef}
              data-headline-descriptor
              style={{
                color: subtitleColor,
                fontFamily: pt?.subtitleFont ? `"${pt.subtitleFont}", "${textFont}", Inter, sans-serif` : undefined,
                fontSize: subPx,
                fontWeight: pt?.subtitleWeight ?? 500,
                lineHeight: lineHeight(descDisplay, 1.15),
                marginTop: pt?.subtitleGapU != null ? pt.subtitleGapU * u : 24,
                opacity: pt?.subtitleColor ? 1 : 0.95,
                letterSpacing: tracking(descDisplay, '-0.005em'),
                textShadow: subtitleShadow,
                whiteSpace: fitLines ? 'pre' : 'pre-wrap',
                textWrapStyle: pt?.textWrap,
                overflowWrap: 'break-word',
                wordBreak: 'normal',
              }}
            >
              {renderAccented(descDisplay, ss.headlineAccent ?? preset?.suggestedAccent)}
            </div>
          )}
          {ss.showAppIcon && appIconUrl && (
            <img
              src={appIconUrl}
              alt=""
              style={{
                display: 'block',
                width: Math.round(titlePx * 2.3),
                height: Math.round(titlePx * 2.3),
                borderRadius: Math.round(titlePx * 2.3 * 0.225),
                marginTop: Math.round(titlePx * 0.5),
                // Honor headline alignment: left-aligned headline → icon on the left.
                marginLeft: textAlign === 'center' ? 'auto' : 0,
                marginRight: textAlign === 'center' ? 'auto' : (textAlign === 'right' ? 0 : 'auto'),
                boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
              }}
            />
          )}
          </div>
        </div>

        {/* Footer microcopy — small line pinned to the bottom of the canvas.
            Drawn as its own overlay so it survives AI enhance (text layered on
            top) and stays out of the headline block. Competitor formula. */}
        {ss.footer && (
          <div
            data-capture-omit="text-overlay"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: Math.round(CANVAS_H * 0.035),
              padding: '0 60px',
              textAlign,
              fontFamily: `"${textFont}", Inter, sans-serif`,
              // On the glass pill use the brand accent (coral) for a warmer,
              // more legible footer; plain footers keep the preset text color.
              color: ss.textBacking ? (ss.headlineAccent ?? preset?.suggestedAccent ?? textColor) : textColor,
              fontWeight: 600,
              fontSize: Math.round((subPx || 100) * 0.62),
              opacity: ss.textBacking ? 1 : 0.72,
              letterSpacing: '-0.005em',
              direction: textDir,
              pointerEvents: 'none',
            }}
          >
            {ss.textBacking ? (
              <span
                style={{
                  // Frosted "liquid glass" pill behind the footer microcopy
                  // (placeholder for the glass baked by AI re-enhance).
                  display: 'inline-block',
                  // Keep the microcopy on ONE line so the pill expands
                  // horizontally to fit the (often longer) localized text
                  // instead of wrapping and "collapsing" vertically.
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                  background: 'rgba(255,255,255,0.22)',
                  backdropFilter: 'blur(28px)',
                  WebkitBackdropFilter: 'blur(28px)',
                  border: '1px solid rgba(255,255,255,0.45)',
                  borderRadius: 999,
                  padding: '18px 40px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.55)',
                }}
              >
                {renderAccented(ss.footer, ss.headlineAccent ?? preset?.suggestedAccent)}
              </span>
            ) : (
              renderAccented(ss.footer, ss.headlineAccent ?? preset?.suggestedAccent)
            )}
          </div>
        )}

        {/* Social proof больше не рендерится HTML-ом на scaffold — теперь это
            ингредиент в Inspector → AI запекает его в финальный enhance render. */}

        {/* Phone geometry — one source of truth, shared by the device layer and
            the V-caption overlay so the labels always line up with their phone
            whether the device is HTML (scaffold) or baked into the AI render. */}
        {(() => {
          const phones = ss.secondaryUrl
            ? [
                // Dual "V" mockup (The Bump style): back phone tilted behind +
                // primary in front, overlapping. Offsets fold in the user's
                // deviceX/Y/scale/tilt so the pair stays tweakable.
                {
                  keyName: 'v-back',
                  url: ss.secondaryUrl,
                  left: deviceX + dx - 210,
                  top: deviceY + dy - 130,
                  rotate: presetRotZ + tiltDeg - 9,
                  scale: presetScale * dscale * 0.82,
                  z: 1,
                  label: ss.backLabel,
                },
                {
                  keyName: 'v-front',
                  url: ss.sourceUrl,
                  left: deviceX + dx + 185,
                  top: deviceY + dy + 130,
                  rotate: presetRotZ + tiltDeg + 6,
                  scale: presetScale * dscale * 0.88,
                  z: 2,
                  interactive: true,
                  label: ss.frontLabel,
                },
              ]
            : [
                {
                  keyName: 'single',
                  url: ss.sourceUrl,
                  left: deviceX + dx,
                  top: deviceY + dy,
                  rotate: presetRotZ + tiltDeg,
                  scale: presetScale * dscale,
                  z: 1,
                  interactive: true,
                  label: ss.frontLabel,
                },
              ];
          const showDevice = !isFullBleedSource && !isArch && !isBeforeAfter && !aiHero && !(ss.kind === 'action' && (ss.action?.hideDevice ?? false));
          return (
            <>
              {/* Device layer — hidden once the AI render already contains the
                  photoreal phone, or on hideDevice action slots. */}
              {showDevice && phones.map((p) => renderPhone(p))}
              {/* V-caption overlay — ALWAYS drawn (scaffold + enhanced), kept out
                  of the AI scaffold capture so "for mom"/"for dad" stay live,
                  translatable text instead of being baked into the device. */}
              {phones.map((p) => renderVLabel(p))}
            </>
          );
        })()}
        {!isFullBleedSource && !isArch && !isBeforeAfter && parametricKind === 'lagoon' && (
          <LagoonBackground part="front" width={CANVAS_W} seed={seedFrom(ss.filename || ss.id)} opts={preset?.background.lagoon} />
        )}
        <DecorLayer items={ss.decor} layer="front" width={CANVAS_W} height={CANVAS_H} fontFamily={textFont} rtl={localeMeta?.rtl} lang={textLang} />
        <DecorLayer items={ss.decor} layer="top" width={CANVAS_W} height={CANVAS_H} fontFamily={textFont} rtl={localeMeta?.rtl} lang={textLang} />

        {/* Reserved live-copy regions inside the generated Elara hero phone.
            The artwork contains only blank surfaces; every word below is
            translated by the same locale pipeline as the outer overlays. */}
        {isElaraHeroText && (
          <div
            data-capture-omit="text-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 41,
              pointerEvents: 'none',
              color: '#3E2340',
              fontFamily: `"${textFont}", Inter, sans-serif`,
              textAlign: 'center',
              direction: textDir,
            }}
          >
            {ss.phoneBrand && (
              <div style={{
                position: 'absolute',
                left: isElaraSoftPhoneOverlay ? 455 : 380,
                right: isElaraSoftPhoneOverlay ? 355 : 250,
                top: isElaraSoftPhoneOverlay ? 1445 : 962,
                color: '#F05F52',
                fontSize: isElaraSoftPhoneOverlay ? 26 : 34,
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}>
                {ss.phoneBrand}
              </div>
            )}
            {ss.phoneTitle && (
              <FitUpToTwoLines
                text={ss.phoneTitle}
                initialPx={isElaraSoftPhoneOverlay ? 45 : 60}
                minPx={isElaraSoftPhoneOverlay ? 28 : 34}
                style={{
                  position: 'absolute',
                  left: isElaraSoftPhoneOverlay ? 500 : 365,
                  right: isElaraSoftPhoneOverlay ? undefined : 300,
                  width: isElaraSoftPhoneOverlay ? 340 : undefined,
                  top: isElaraSoftPhoneOverlay ? 1510 : 1038,
                  height: isElaraSoftPhoneOverlay ? 160 : 170,
                  boxSizing: 'border-box',
                  padding: isElaraSoftPhoneOverlay ? '0 8px' : undefined,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 0.98,
                  fontWeight: 900,
                  letterSpacing: '-0.025em',
                  textAlign: 'center',
                }}
              />
            )}
            {ss.phoneSubtitle && (
              <FitUpToTwoLines
                text={ss.phoneSubtitle}
                initialPx={isElaraSoftPhoneOverlay ? 21 : 25}
                minPx={isElaraSoftPhoneOverlay ? 16 : 18}
                style={{
                  position: 'absolute',
                  left: isElaraSoftPhoneOverlay ? 510 : 370,
                  right: isElaraSoftPhoneOverlay ? undefined : 235,
                  width: isElaraSoftPhoneOverlay ? 345 : undefined,
                  top: isElaraSoftPhoneOverlay ? 1680 : 1260,
                  height: isElaraSoftPhoneOverlay ? 100 : 58,
                  boxSizing: 'border-box',
                  padding: isElaraSoftPhoneOverlay ? '0 8px' : undefined,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1.1,
                  fontWeight: 500,
                  color: '#3E3140',
                  textAlign: 'center',
                }}
              />
            )}
            {(ss.phoneToggleLeft || ss.phoneToggleRight) && (
              <FitUpToTwoLines
                text={`${ss.phoneToggleLeft ?? ''}  +  ${ss.phoneToggleRight ?? ''}`.trim()}
                initialPx={isElaraSoftPhoneOverlay ? 26 : 31}
                minPx={20}
                style={{
                  position: 'absolute',
                  left: isElaraSoftPhoneOverlay ? 565 : 535,
                  width: isElaraSoftPhoneOverlay ? 340 : 500,
                  top: isElaraSoftPhoneOverlay ? 2170 : 2036,
                  height: isElaraSoftPhoneOverlay ? 120 : 142,
                  boxSizing: 'border-box',
                  padding: '12px 32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1.02,
                  fontWeight: 750,
                  letterSpacing: '0.005em',
                  textAlign: 'center',
                  transform: 'rotate(-2.2deg)',
                  transformOrigin: 'center center',
                }}
              />
            )}
          </div>
        )}

        {/* MedScan-style conversion overlays. They are deliberately omitted
            from the AI scaffold and rendered above the generated art, keeping
            every word crisp, editable and independently localizable. */}
        {ss.annotation && (
          <div
            data-capture-omit="text-overlay"
            style={{
              position: 'absolute',
              left: isElaraHeroText ? 92 : 54,
              bottom: isElaraHeroText ? 420 : (ss.trustStrip ? 350 : 220),
              width: isElaraHeroText ? 300 : 360,
              zIndex: 40,
              color: isElaraHeroText ? '#38223E' : (ss.headlineAccent ?? preset?.suggestedAccent ?? '#D96F71'),
              fontFamily: '"Bradley Hand", "Comic Sans MS", cursive',
              fontSize: isElaraHeroText ? 54 : 58,
              fontWeight: 700,
              lineHeight: 0.98,
              transform: isElaraHeroText ? 'rotate(-4deg)' : 'rotate(-5deg)',
              textAlign: 'left',
              pointerEvents: 'none',
              textShadow: '0 2px 12px rgba(255,255,255,0.75)',
            }}
          >
            {!isElaraHeroText && <>↗<br /></>}{ss.annotation}
          </div>
        )}

        {ss.proofText && (
          <div
            data-capture-omit="text-overlay"
            style={{
              position: 'absolute',
              left: isElaraHeroText ? 350 : undefined,
              right: isElaraHeroText ? 120 : 52,
              bottom: isElaraHeroText ? 124 : (ss.trustStrip ? 154 : 40),
              width: isElaraHeroText ? 'auto' : (ss.proofAttribution ? 560 : 650),
              height: isElaraHeroText ? 162 : undefined,
              minHeight: isElaraHeroText ? 104 : (ss.proofAttribution ? 210 : 116),
              boxSizing: 'border-box',
              padding: isElaraHeroText ? '16px 24px' : (ss.proofAttribution ? '34px 42px' : '24px 38px'),
              borderRadius: isElaraHeroText ? 0 : 34,
              zIndex: 42,
              color: titleColor,
              background: isElaraHeroText ? 'transparent' : '#FFFDFC',
              border: isElaraHeroText ? 'none' : '2px solid rgba(217,111,113,0.22)',
              boxShadow: isElaraHeroText ? 'none' : '0 16px 38px rgba(77,48,64,0.14)',
              fontFamily: `"${textFont}", Inter, sans-serif`,
              pointerEvents: 'none',
              direction: textDir,
              transform: isElaraHeroText ? 'translateY(-40px)' : undefined,
            }}
          >
            {ss.proofAttribution && (
              <div
                style={{
                  position: 'absolute',
                  left: 28,
                  top: 18,
                  color: ss.headlineAccent ?? preset?.suggestedAccent ?? '#D96F71',
                  fontFamily: 'Georgia, serif',
                  fontSize: 82,
                  lineHeight: 1,
                  opacity: 0.9,
                }}
              >
                “
              </div>
            )}
            {ss.proofAttribution ? (
              <div
                style={{
                  paddingLeft: 56,
                  fontSize: 43,
                  lineHeight: 1.15,
                  fontWeight: 650,
                  overflowWrap: 'break-word',
                }}
              >
                {ss.proofText}
              </div>
            ) : isElaraHeroText ? (
              <FitUpToTwoLines
                text={ss.proofText}
                initialPx={43}
                minPx={25}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1.04,
                  fontWeight: 750,
                  textAlign: 'center',
                }}
              />
            ) : (
              <FitSingleLine
                text={ss.proofText}
                initialPx={40}
                minPx={24}
                style={{ width: '100%', lineHeight: 1.15, fontWeight: 650 }}
              />
            )}
            {ss.proofAttribution && (
              <FitSingleLine
                text={ss.proofAttribution}
                initialPx={30}
                minPx={22}
                style={{
                  marginTop: 18,
                  paddingLeft: 56,
                  color: ss.headlineAccent ?? preset?.suggestedAccent ?? '#D96F71',
                  fontWeight: 750,
                  letterSpacing: '0.01em',
                }}
              />
            )}
          </div>
        )}

        {ss.trustStrip && (
          <div
            data-capture-omit="text-overlay"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: isElaraHeroText ? 104 : 120,
              boxSizing: 'border-box',
              padding: '0 42px',
              zIndex: 45,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF8F4',
              background: titleColor,
              fontFamily: `"${textFont}", Inter, sans-serif`,
              letterSpacing: '0.08em',
              fontWeight: 750,
              textAlign: 'center',
              pointerEvents: 'none',
              direction: textDir,
            }}
          >
            <FitSingleLine text={ss.trustStrip} initialPx={isElaraHeroText ? 31 : 34} minPx={22} style={{ width: '100%' }} />
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
