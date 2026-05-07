import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { CapCutClassic } from './caption-styles/CapCutClassic';
import { MrBeast } from './caption-styles/MrBeast';
import { KaraokeYellow } from './caption-styles/KaraokeYellow';
import { WordPop } from './caption-styles/WordPop';
import { Hormozi } from './caption-styles/Hormozi';
import { NeonGlow } from './caption-styles/NeonGlow';
import { SubtleMinimal } from './caption-styles/SubtleMinimal';
import { BubblePop } from './caption-styles/BubblePop';

export const CC_FPS = 30;
export const CC_WIDTH = 1080;
export const CC_HEIGHT = 1920;
export const CC_SEGMENT_SECONDS = 4;
export const CC_SEGMENT_FRAMES = CC_SEGMENT_SECONDS * CC_FPS; // 120
export const CC_STYLE_COUNT = 8;
export const CC_DURATION_FRAMES = CC_SEGMENT_FRAMES * CC_STYLE_COUNT; // 960

export type CaptionsCompareProps = {
  audioUrl?: string;
};

type StyleEntry = { name: string; component: React.FC };

const STYLES: StyleEntry[] = [
  { name: 'CapCut Classic', component: CapCutClassic },
  { name: 'MrBeast', component: MrBeast },
  { name: 'Karaoke Yellow', component: KaraokeYellow },
  { name: 'Word Pop', component: WordPop },
  { name: 'Hormozi', component: Hormozi },
  { name: 'Neon Glow', component: NeonGlow },
  { name: 'Subtle Minimal', component: SubtleMinimal },
  { name: 'Bubble Pop', component: BubblePop },
];

const StyleLabel: React.FC<{ name: string }> = ({ name }) => (
  <div
    style={{
      position: 'absolute',
      top: 80,
      left: 0,
      right: 0,
      textAlign: 'center',
      color: '#fff',
      fontSize: 32,
      fontFamily:
        '"SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
      letterSpacing: 2,
      textShadow: '0 2px 8px rgba(0,0,0,0.6)',
    }}
  >
    Style: {name}
  </div>
);

const StyleFrame: React.FC<{ entry: StyleEntry }> = ({ entry }) => {
  const Component = entry.component;
  return (
    <AbsoluteFill>
      <StyleLabel name={entry.name} />
      <Component />
    </AbsoluteFill>
  );
};

export const CaptionsCompare: React.FC<CaptionsCompareProps> = ({ audioUrl }) => {
  const resolvedAudio = audioUrl
    ? audioUrl.startsWith('http://') ||
      audioUrl.startsWith('https://') ||
      audioUrl.startsWith('file://')
      ? audioUrl
      : staticFile(audioUrl)
    : staticFile('audio/dream-ad-v1.mp3');

  return (
    <AbsoluteFill
      style={{ background: 'linear-gradient(180deg, #1a0033 0%, #4d1f7a 100%)' }}
    >
      {STYLES.map((s, i) => (
        <Sequence
          key={s.name}
          from={i * CC_SEGMENT_FRAMES}
          durationInFrames={CC_SEGMENT_FRAMES}
        >
          <StyleFrame entry={s} />
        </Sequence>
      ))}
      <Audio src={resolvedAudio} />
    </AbsoluteFill>
  );
};
