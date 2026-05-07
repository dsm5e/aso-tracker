import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { KaraokeCaptions, type Word } from './KaraokeCaptions';

export const DREAM_AD_FPS = 30;
export const DREAM_AD_WIDTH = 1080;
export const DREAM_AD_HEIGHT = 1920;
// 15s @ 30fps — TikTok 2026 sweet spot (9-15s)
export const DREAM_AD_DURATION_FRAMES = 15 * 30; // 450 frames

const SCENE_SECONDS = 3;
const SCENE_FRAMES = SCENE_SECONDS * DREAM_AD_FPS; // 90

export type DreamAdProps = {
  audioUrl?: string;
  words?: Word[];
};

const SCENE_GRADIENTS: string[] = [
  'linear-gradient(180deg, #1a0033 0%, #4d1f7a 100%)', // HOOK
  'linear-gradient(180deg, #2a0008 0%, #6b1818 100%)', // PROBLEM
  'linear-gradient(180deg, #001a33 0%, #1a4d7a 100%)', // REVEAL
  'linear-gradient(180deg, #2a0a3a 0%, #7a1a5e 100%)', // BENEFIT
  '#7C3AED', // CTA
];

const EndFrame: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          width: 280,
          height: 280,
          borderRadius: 64,
          background: 'linear-gradient(135deg, #FF8C42, #F25C1F)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow:
            '0 30px 80px rgba(0,0,0,0.45), 0 0 0 6px rgba(255,255,255,0.08)',
          marginBottom: 60,
          marginTop: -120,
        }}
      >
        <span
          style={{
            fontSize: 180,
            fontWeight: 900,
            color: '#fff',
            fontFamily:
              'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
            textShadow: '0 6px 16px rgba(0,0,0,0.35)',
            lineHeight: 1,
          }}
        >
          🌙
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 110,
          color: 'rgba(255,255,255,0.85)',
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: 1,
          fontFamily:
            'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
        }}
      >
        Available on iOS
      </div>
    </AbsoluteFill>
  );
};

export const DreamAd: React.FC<DreamAdProps> = ({ audioUrl, words }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Background gradient scenes — 5 × 3s, untouched */}
      {SCENE_GRADIENTS.map((g, i) => (
        <Sequence
          key={i}
          from={i * SCENE_FRAMES}
          durationInFrames={SCENE_FRAMES}
        >
          <AbsoluteFill style={{ background: g }} />
          {i === 4 && <EndFrame />}
        </Sequence>
      ))}

      {/* Voiceover audio — full duration, Remotion clips automatically */}
      {audioUrl ? (
        <Audio
          src={
            audioUrl.startsWith('http://') ||
            audioUrl.startsWith('https://') ||
            audioUrl.startsWith('file://')
              ? audioUrl
              : staticFile(audioUrl)
          }
        />
      ) : null}

      {/* Karaoke captions driven by Whisper word timings */}
      {words && words.length ? <KaraokeCaptions words={words} /> : null}
    </AbsoluteFill>
  );
};
