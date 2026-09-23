import type { ReactNode } from 'react';
import {
  getIPhoneProfile,
  IPAD_FRAME,
  IPAD_13_FRAME,
  type DeviceFrameGeometry,
  type IPadModel,
  type IPhoneModel,
} from '../../lib/deviceProfiles';

/**
 * Clay-style mockup of a selected iPhone profile or iPad Pro 13".
 * Matte body, soft drop shadow, zero glossy highlights — matches ButterKit's
 * "deviceStyle: clay" finish. Children fill the screen area.
 *
 * Each iPhone frame uses the selected profile's exact screen aspect ratio.
 */

interface Props {
  asset?: 'iphone' | 'ipad';
  iphoneModel?: IPhoneModel;
  ipadModel?: IPadModel;
  /** Clay body colour override (default graphite gradient). */
  bodyColor?: string;
  /** Thin outer rim drawn around the clay body. */
  rimColor?: string;
  /** Replaces the default soft drop shadow. */
  shadow?: string;
  frameStyle?: 'clay' | 'titanium' | 'frameless';
  showIsland?: boolean;
  children?: ReactNode;
  /** When the screen is empty / placeholder, render this label inside it. */
  placeholder?: ReactNode;
  /** Click handler on the screen area (for upload UX). */
  onClickScreen?: () => void;
  onDragOverScreen?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDropScreen?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeaveScreen?: () => void;
  /** Tinted screen background (when no content). */
  emptyScreenColor?: string;
  /** Доля высоты, срезаемая снизу (0…0.5). Нужна, когда нижняя часть снимка —
   *  пустое поле интерфейса: карточка укорачивается вместе с ним, а не висит
   *  белым хвостом под контентом. Работает только в `frameless`. */
  cropBottomFrac?: number;
}

export function DeviceFrame({
  asset = 'iphone',
  iphoneModel,
  ipadModel,
  bodyColor,
  rimColor,
  shadow,
  frameStyle = 'clay',
  showIsland = true,
  children,
  placeholder,
  onClickScreen,
  onDragOverScreen,
  onDropScreen,
  onDragLeaveScreen,
  emptyScreenColor = '#000',
  cropBottomFrac = 0,
}: Props) {
  const D = getDeviceFrameGeometry(asset, iphoneModel, ipadModel);
  const useTitaniumFrame = asset === 'iphone' && frameStyle === 'titanium';

  // `frameless` — без корпуса и рамки: сам скриншот, скруглённый, с мягкой
  // тенью. Так делает DecAI на мокап-слотах: устройство не изображается, а
  // подразумевается, и всё внимание достаётся содержимому экрана.
  if (frameStyle === 'frameless') {
    // Apple-скругление — это НЕ дуга окружности: у border-radius кривизна в
    // точке стыка с прямой меняется скачком, и на большом радиусе угол читается
    // как срез. Настоящий контур iPhone — «continuous corner»: суперэллипс,
    // где кривизна нарастает плавно. Стороны при этом остаются прямыми, гнутся
    // ТОЛЬКО углы — поэтому суперэллипс на всю карточку не годится, он бы
    // выгнул и рёбра.
    const crop = Math.min(Math.max(cropBottomFrac, 0), 0.5);
    const frameH = D.height * (1 - crop);
    const cw = D.width - D.bezel * 2;
    const ch = frameH - D.bezel * 2;
    const r = D.cornerR;
    const squircle = (() => {
      const n = 5;      // 4 — мягче, 8 — ближе к дуге; 5 совпадает с iOS
      const seg = 16;   // точек на угол
      // Обходим контур ПО ПОРЯДКУ, по часовой: каждый угол выдаётся в
      // направлении движения, иначе между дугами протягиваются прямые через
      // всю карточку и она срезается по диагонали.
      const corners: Array<[number, number, number, number]> = [
        [cw - r, r,      -Math.PI / 2, 0],            // правый верх
        [cw - r, ch - r,  0,           Math.PI / 2],  // правый низ
        [r,      ch - r,  Math.PI / 2, Math.PI],      // левый низ
        [r,      r,       Math.PI,     Math.PI * 1.5],// левый верх
      ];
      const pts: string[] = [];
      for (const [cx, cy, t0, t1] of corners) {
        for (let i = 0; i <= seg; i += 1) {
          const t = t0 + ((t1 - t0) * i) / seg;
          const c = Math.cos(t), s2 = Math.sin(t);
          const x = Math.sign(c) * Math.abs(c) ** (2 / n);
          const y = Math.sign(s2) * Math.abs(s2) ** (2 / n);
          pts.push(`${(cx + r * x).toFixed(1)}px ${(cy + r * y).toFixed(1)}px`);
        }
      }
      return `polygon(${pts.join(',')})`;
    })();

    return (
      <div style={{ position: 'relative', width: D.width, height: frameH }}>
        <div
          onClick={onClickScreen}
          onDragOver={onDragOverScreen}
          onDrop={onDropScreen}
          onDragLeave={onDragLeaveScreen}
          style={{
            position: 'absolute', left: D.bezel, right: D.bezel, top: D.bezel,
            height: ch, overflow: 'hidden',
            clipPath: squircle, WebkitClipPath: squircle,
            background: children ? 'transparent' : emptyScreenColor,
            // Тонкая серая обводка — тот же приём, что у каёмки арки: очерчивает
            // край карточки на светлом фоне, где одной тени не хватает.
            // `inset` в boxShadow, чтобы не съедать площадь снимка бордюром.
            boxShadow: '0 46px 110px rgba(0,0,0,.20), 0 12px 34px rgba(0,0,0,.10), inset 0 0 0 2px rgba(0,0,0,.10)',
            cursor: onClickScreen ? 'pointer' : undefined,
          }}
        >
          {/* Содержимое остаётся в НЕОБРЕЗАННОЙ высоте экрана: иначе снимок
              пересчитывается под укороченный бокс и меняет масштаб, а нам
              нужно ровно то же изображение, просто без нижнего края. */}
          <div style={{ width: '100%', height: D.height - D.bezel * 2 }}>
            {children ?? placeholder}
          </div>
        </div>
      </div>
    );
  }

  if (useTitaniumFrame) {
    // The generated frame's transparent screen aperture is 754 × 1640 at
    // x=33, y=24 inside an 821 × 1689 asset. Scale from that aperture so the
    // simulator bitmap still occupies the profile's exact screen geometry.
    const aperture = { x: 33, y: 24, width: 754, height: 1640 };
    const frameAsset = { width: 821, height: 1689 };
    const screenWidth = D.width - D.bezel * 2;
    const screenHeight = D.height - D.bezel * 2;
    const frameScale = Math.min(
      screenWidth / aperture.width,
      screenHeight / aperture.height,
    );
    const frameWidth = frameAsset.width * frameScale;
    const frameHeight = frameAsset.height * frameScale;
    const frameLeft = D.bezel - aperture.x * frameScale;
    const frameTop = D.bezel - aperture.y * frameScale;
    // Measured from the transparent aperture, not from the older clay profile:
    // its quarter-circle reaches the straight edge at about 96 source pixels.
    const screenCornerRadius = 96 * frameScale;

    return (
      <div style={{ position: 'relative', width: D.width, height: D.height }}>
        <div
          onClick={onClickScreen}
          onDragOver={onDragOverScreen}
          onDrop={onDropScreen}
          onDragLeave={onDragLeaveScreen}
          style={{
            position: 'absolute',
            inset: D.bezel,
            borderRadius: screenCornerRadius,
            overflow: 'hidden',
            background: emptyScreenColor,
            display: 'grid',
            placeItems: 'center',
            cursor: onClickScreen ? 'pointer' : 'default',
            zIndex: 1,
          }}
        >
          {children ?? placeholder}
        </div>

        <img
          aria-hidden
          src={`${import.meta.env.BASE_URL}uploads/device-frames/iphone-pro-titanium-frame-fitted-v1.png`}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: frameLeft,
            top: frameTop,
            width: frameWidth,
            height: frameHeight,
            maxWidth: 'none',
            pointerEvents: 'none',
            filter:
              'drop-shadow(0 42px 34px rgba(0,0,0,0.18)) drop-shadow(0 18px 18px rgba(0,0,0,0.14))',
            zIndex: 2,
          }}
        />

        {showIsland && D.islandW > 0 && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: D.islandTop,
              left: '50%',
              transform: 'translateX(-50%)',
              width: D.islandW,
              height: D.islandH,
              borderRadius: D.islandH / 2,
              background: '#000',
              zIndex: 3,
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: D.width, height: D.height }}>
      {/* Soft drop shadow layer — drawn separately so we can multiply for depth without crispening edges */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: D.cornerR + D.bezel,
          boxShadow: [
            shadow ?? '0 60px 120px -30px rgba(0,0,0,0.35), 0 25px 50px -15px rgba(0,0,0,0.20)',
            rimColor ? `0 0 0 ${Math.max(4, Math.round(D.bezel * 0.35))}px ${rimColor}` : null,
          ].filter(Boolean).join(', '),
          pointerEvents: 'none',
        }}
      />
      {/* Body — matte clay material */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: D.cornerR + D.bezel,
          background: bodyColor ?? 'linear-gradient(180deg, #2A2A2C 0%, #1A1A1C 100%)',
          // Inner edge highlight + subtle outer rim
          boxShadow:
            'inset 0 0 0 1.5px rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06)',
          padding: D.bezel,
        }}
      >
        {/* Screen area */}
        <div
          onClick={onClickScreen}
          onDragOver={onDragOverScreen}
          onDrop={onDropScreen}
          onDragLeave={onDragLeaveScreen}
          style={{
            position: 'absolute',
            inset: D.bezel,
            borderRadius: D.cornerR,
            overflow: 'hidden',
            background: emptyScreenColor,
            display: 'grid',
            placeItems: 'center',
            cursor: onClickScreen ? 'pointer' : 'default',
          }}
        >
          {children ?? placeholder}
        </div>

        {/* Dynamic island (iPhone only) */}
        {showIsland && D.islandW > 0 && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: D.islandTop,
              left: '50%',
              transform: 'translateX(-50%)',
              width: D.islandW,
              height: D.islandH,
              borderRadius: D.islandH / 2,
              background: '#000',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          />
        )}
      </div>
    </div>
  );
}

export function getDeviceFrameGeometry(
  asset: 'iphone' | 'ipad',
  iphoneModel?: IPhoneModel,
  ipadModel?: IPadModel,
): DeviceFrameGeometry {
  if (asset === 'ipad') return ipadModel === 'ipad-pro-13' ? IPAD_13_FRAME : IPAD_FRAME;
  return getIPhoneProfile(iphoneModel).frame;
}

// Legacy layout consumers render catalog thumbnails before project state exists.
// Keep their geometry on the historical default profile.
export const DEVICE_DIMS = {
  iphone: getIPhoneProfile().frame,
  ipad: IPAD_FRAME,
};
