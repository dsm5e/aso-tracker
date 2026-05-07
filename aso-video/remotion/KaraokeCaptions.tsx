import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export type Word = { text: string; start: number; end: number };

type Chunk = { words: Word[]; start: number; end: number };

const CHUNK_SIZE = 4; // 3-5 words per chunk

function buildChunks(words: Word[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const slice = words.slice(i, i + CHUNK_SIZE);
    if (!slice.length) continue;
    chunks.push({
      words: slice,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
    });
  }
  return chunks;
}

export const KaraokeCaptions: React.FC<{ words: Word[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  if (!words || !words.length) return null;

  const chunks = React.useMemo(() => buildChunks(words), [words]);
  const active = chunks.find((c) => t >= c.start && t <= c.end + 0.1);
  if (!active) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 220,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0 22px',
          padding: '0 60px',
        }}
      >
        {active.words.map((w, i) => {
          const isCurrent = t >= w.start && t <= w.end + 0.05;
          const hasPassed = t > w.end;
          return (
            <span
              key={i}
              style={{
                color: isCurrent ? '#FFD700' : hasPassed ? '#ffffff' : '#ffffff',
                fontSize: 80,
                fontWeight: 900,
                fontFamily:
                  'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif',
                lineHeight: 1.05,
                letterSpacing: -1,
                WebkitTextStroke: '6px #000',
                paintOrder: 'stroke fill',
                textShadow:
                  '0 6px 18px rgba(0,0,0,0.85), 0 2px 4px rgba(0,0,0,0.9)',
                textTransform: 'uppercase',
                transform: isCurrent ? 'scale(1.06)' : 'scale(1)',
                transition: 'transform 80ms ease-out',
                display: 'inline-block',
              }}
            >
              {w.text.replace(/[.,!?]+$/, '')}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
