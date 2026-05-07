import type { ReactNode } from 'react';

/**
 * Clay-style mockup of an iPhone 17 Pro Max or iPad Pro 13".
 * Matte body, soft drop shadow, zero glossy highlights — matches ButterKit's
 * "deviceStyle: clay" finish. Children fill the screen area.
 *
 * Sizes are calibrated against canvas (1290×2796) so the device fills naturally.
 */

// Sized so the phone occupies ~78% of canvas height — leaves room for headline above
// or below without filling the whole frame. Real iPhone 17 Pro Max ratio is ~0.483.
const IPHONE = {
  width: 1064,
  height: 2200,
  bezel: 20,
  cornerR: 168,
  islandW: 290,
  islandH: 72,
  islandTop: 44,
};

const IPAD = {
  width: 1620,
  height: 2240,
  bezel: 28,
  cornerR: 80,
  islandW: 0,
  islandH: 0,
  islandTop: 0,
};

interface Props {
  asset?: 'iphone' | 'ipad';
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
}

export function DeviceFrame({
  asset = 'iphone',
  children,
  placeholder,
  onClickScreen,
  onDragOverScreen,
  onDropScreen,
  onDragLeaveScreen,
  emptyScreenColor = '#000',
}: Props) {
  const D = asset === 'ipad' ? IPAD : IPHONE;
  return (
    <div style={{ position: 'relative', width: D.width, height: D.height }}>
      {/* Soft drop shadow layer — drawn separately so we can multiply for depth without crispening edges */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: D.cornerR + D.bezel,
          boxShadow:
            '0 60px 120px -30px rgba(0,0,0,0.35), 0 25px 50px -15px rgba(0,0,0,0.20)',
          pointerEvents: 'none',
        }}
      />
      {/* Body — matte clay material */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: D.cornerR + D.bezel,
          background: 'linear-gradient(180deg, #2A2A2C 0%, #1A1A1C 100%)',
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
        {D.islandW > 0 && (
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

export const DEVICE_DIMS = { iphone: IPHONE, ipad: IPAD };
