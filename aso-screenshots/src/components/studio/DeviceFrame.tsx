import type { ReactNode } from 'react';
import {
  getIPhoneProfile,
  IPAD_FRAME,
  type DeviceFrameGeometry,
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
}

export function DeviceFrame({
  asset = 'iphone',
  iphoneModel,
  showIsland = true,
  children,
  placeholder,
  onClickScreen,
  onDragOverScreen,
  onDropScreen,
  onDragLeaveScreen,
  emptyScreenColor = '#000',
}: Props) {
  const D = asset === 'ipad' ? IPAD_FRAME : getIPhoneProfile(iphoneModel).frame;
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
): DeviceFrameGeometry {
  return asset === 'ipad' ? IPAD_FRAME : getIPhoneProfile(iphoneModel).frame;
}

// Legacy layout consumers render catalog thumbnails before project state exists.
// Keep their geometry on the historical default profile.
export const DEVICE_DIMS = {
  iphone: getIPhoneProfile().frame,
  ipad: IPAD_FRAME,
};
