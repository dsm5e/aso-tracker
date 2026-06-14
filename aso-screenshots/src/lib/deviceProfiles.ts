export type IPhoneModel =
  | 'iphone-17-pro'
  | 'iphone-17-pro-max'
  | 'iphone-15-pro-max';

export interface CanvasDimensions {
  w: number;
  h: number;
}

export interface DeviceFrameGeometry {
  width: number;
  height: number;
  bezel: number;
  cornerR: number;
  islandW: number;
  islandH: number;
  islandTop: number;
}

export interface IPhoneProfile {
  id: IPhoneModel;
  label: string;
  displaySize: string;
  canvas: CanvasDimensions;
  frame: DeviceFrameGeometry;
}

const makeFrame = (
  canvas: CanvasDimensions,
  screenWidth: number,
  bezel: number,
): DeviceFrameGeometry => {
  const screenHeight = Math.round(screenWidth * canvas.h / canvas.w);
  const scale = screenWidth / 1024;
  return {
    width: screenWidth + bezel * 2,
    height: screenHeight + bezel * 2,
    bezel,
    cornerR: Math.round(168 * scale),
    islandW: Math.round(290 * scale),
    islandH: Math.round(72 * scale),
    islandTop: Math.round(44 * scale),
  };
};

export const DEFAULT_IPHONE_MODEL: IPhoneModel = 'iphone-15-pro-max';

export const IPHONE_PROFILES: readonly IPhoneProfile[] = [
  {
    id: 'iphone-17-pro',
    label: 'iPhone 17 Pro',
    displaySize: '6.3"',
    canvas: { w: 1206, h: 2622 },
    frame: makeFrame({ w: 1206, h: 2622 }, 956, 19),
  },
  {
    id: 'iphone-17-pro-max',
    label: 'iPhone 17 Pro Max',
    displaySize: '6.9"',
    canvas: { w: 1320, h: 2868 },
    frame: makeFrame({ w: 1320, h: 2868 }, 1048, 20),
  },
  {
    id: 'iphone-15-pro-max',
    label: 'iPhone 15 Pro Max',
    displaySize: '6.7"',
    canvas: { w: 1290, h: 2796 },
    frame: makeFrame({ w: 1290, h: 2796 }, 1024, 20),
  },
] as const;

export const IPAD_CANVAS: CanvasDimensions = { w: 2048, h: 2732 };

export const IPAD_FRAME: DeviceFrameGeometry = {
  width: 1620,
  height: 2240,
  bezel: 28,
  cornerR: 80,
  islandW: 0,
  islandH: 0,
  islandTop: 0,
};

export function getIPhoneProfile(model?: IPhoneModel): IPhoneProfile {
  return IPHONE_PROFILES.find((profile) => profile.id === model)
    ?? IPHONE_PROFILES.find((profile) => profile.id === DEFAULT_IPHONE_MODEL)!;
}

export function getCanvasDimensions(
  device: 'iphone' | 'ipad',
  iphoneModel?: IPhoneModel,
): CanvasDimensions {
  return device === 'ipad' ? IPAD_CANVAS : getIPhoneProfile(iphoneModel).canvas;
}

export function formatDimensions({ w, h }: CanvasDimensions, separator = ' × '): string {
  return `${w}${separator}${h}`;
}

export function getCaptureDimensions(
  device: 'iphone' | 'ipad',
  iphoneModel?: IPhoneModel,
): CanvasDimensions & { cw: number; ch: number } {
  const { w, h } = getCanvasDimensions(device, iphoneModel);
  const cw = 1280;
  return { w, h, cw, ch: Math.round(cw * h / w) };
}
