import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Caption } from './Caption';

export type SceneSpec = {
  startFrame: number;
  durationFrames: number;
  gradient: string; // CSS background value
  captions: string[]; // 1.5s each, sequential within the scene
  captionFrames?: number; // override per-chunk duration
  children?: React.ReactNode; // extra content (e.g. CTA end-frame)
};

const DEFAULT_CHUNK_FRAMES = Math.round(1.5 * 30); // 45 frames @ 30fps

export const Scene: React.FC<SceneSpec> = ({
  startFrame,
  durationFrames,
  gradient,
  captions,
  captionFrames = DEFAULT_CHUNK_FRAMES,
  children,
}) => {
  return (
    <Sequence from={startFrame} durationInFrames={durationFrames}>
      <AbsoluteFill style={{ background: gradient }}>
        {children}
        {captions.map((text, i) => (
          <Sequence
            key={i}
            from={i * captionFrames}
            durationInFrames={captionFrames}
          >
            <Caption text={text} />
          </Sequence>
        ))}
      </AbsoluteFill>
    </Sequence>
  );
};
