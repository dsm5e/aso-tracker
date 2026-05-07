import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';

export const VC_FPS = 30;
export const VC_WIDTH = 1080;
export const VC_HEIGHT = 1920;
export const VC_SEGMENT_SECONDS = 5;
export const VC_SEGMENT_FRAMES = VC_SEGMENT_SECONDS * VC_FPS; // 150
export const VC_DEFAULT_VOICE_COUNT = 6;

export type VoiceEntry = {
  id: string;
  name: string;
  gradient: string;
};

export type VoicesCompareProps = {
  audioUrl?: string;
  voices?: VoiceEntry[];
};

const DEFAULT_VOICES: VoiceEntry[] = [
  { id: 'en_us_001', name: 'Standard Female', gradient: 'linear-gradient(180deg, #0f0f23 0%, #2a1a5e 100%)' },
  { id: 'en_female_emotional', name: 'Emotional', gradient: 'linear-gradient(180deg, #1a0033 0%, #4d1f7a 100%)' },
  { id: 'en_female_samc', name: 'Samantha', gradient: 'linear-gradient(180deg, #001a33 0%, #1a4d7a 100%)' },
  { id: 'en_female_ht_f08_warmy_breeze', name: 'Warm Breeze', gradient: 'linear-gradient(180deg, #2a1500 0%, #7a4a1a 100%)' },
  { id: 'en_us_007', name: 'Husky Female', gradient: 'linear-gradient(180deg, #1a1a1a 0%, #4d4d4d 100%)' },
  { id: 'en_female_betty', name: 'Betty', gradient: 'linear-gradient(180deg, #2a0a1f 0%, #7a1a4e 100%)' },
];

const ProgressBar: React.FC<{ count: number; currentIndex: number }> = ({ count, currentIndex }) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 80,
        left: 60,
        right: 60,
        display: 'flex',
        gap: 8,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 8,
            borderRadius: 4,
            background:
              i < currentIndex
                ? 'rgba(255,255,255,0.7)'
                : i === currentIndex
                ? '#fff'
                : 'rgba(255,255,255,0.18)',
            transition: 'background 0.2s',
          }}
        />
      ))}
    </div>
  );
};

const VoiceFrame: React.FC<{ voice: VoiceEntry; index: number; total: number }> = ({
  voice,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  // Subtle fade-in on each segment
  const fade = Math.min(1, frame / 10);
  return (
    <AbsoluteFill style={{ background: voice.gradient }}>
      <ProgressBar count={total} currentIndex={index} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          opacity: fade,
        }}
      >
        <div
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: 4,
            textTransform: 'uppercase',
            fontFamily:
              'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
            marginBottom: 36,
          }}
        >
          TikTok TTS voice {index + 1} / {total}
        </div>
        <div
          style={{
            color: '#fff',
            fontSize: 100,
            fontWeight: 900,
            letterSpacing: -2,
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily:
              'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
            WebkitTextStroke: '2px rgba(0,0,0,0.35)',
            textShadow: '0 8px 32px rgba(0,0,0,0.5)',
            lineHeight: 1.05,
            padding: '0 60px',
          }}
        >
          {voice.name}
        </div>
        <div
          style={{
            marginTop: 40,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 32,
            fontFamily:
              '"SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
            background: 'rgba(0,0,0,0.35)',
            padding: '12px 24px',
            borderRadius: 12,
          }}
        >
          ID: {voice.id}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const VoicesCompare: React.FC<VoicesCompareProps> = ({ audioUrl, voices }) => {
  const list = voices && voices.length ? voices : DEFAULT_VOICES;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {list.map((v, i) => (
        <Sequence key={v.id + i} from={i * VC_SEGMENT_FRAMES} durationInFrames={VC_SEGMENT_FRAMES}>
          <VoiceFrame voice={v} index={i} total={list.length} />
        </Sequence>
      ))}
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
    </AbsoluteFill>
  );
};

export const VC_DEFAULT_VOICES = DEFAULT_VOICES;
