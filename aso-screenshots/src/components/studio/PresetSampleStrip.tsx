import { Link2 } from 'lucide-react';
import type { Preset, PresetSample } from '../../lib/presets';
import { PresetThumbnail } from './PresetThumbnail';

interface Props {
  preset: Preset;
  /** Override BG accent for the bold-brand-solid preset. */
  accentOverride?: string;
  /** Optional source URL of an uploaded screenshot to inject in the FIRST mock only. */
  primarySourceUrl?: string | null;
  /** Override sample list (e.g. inject the user's own headline plan). Falls back to preset.samples. */
  samples?: PresetSample[];
  /** How many mocks to show — caps the samples array. Default = all sample entries. */
  count?: number;
}

/**
 * Horizontal row of N preset mockups — gives a "what would my final App Store row look like"
 * preview so the user can pick a style based on rhythm + variety, not a single screenshot.
 *
 * Each item is rendered with its own headline text (and optional uploaded screenshot in the
 * first slot) so the row looks like a real 5-shot listing rather than five identical clones.
 */
export function PresetSampleStrip({ preset, accentOverride, primarySourceUrl, samples, count }: Props) {
  const all = samples ?? preset.samples ?? [];
  const list = count ? all.slice(0, count) : all;

  // If preset has no samples defined, fall back to a single placeholder mock so we still
  // render something rather than an empty row.
  const items: PresetSample[] = list.length > 0 ? list : [{ verb: 'YOUR VERB', descriptor: 'YOUR DESCRIPTOR' }];

  // Pre-compute, for every sample, whether it shares a group with neighbours so we can
  // overlay a chain badge ABOVE the run + a continuous accent line ALONG it.
  const groupRanges: Array<{ groupId: string; start: number; end: number }> = [];
  {
    let i = 0;
    while (i < items.length) {
      const g = items[i].groupId;
      if (g) {
        let j = i;
        while (j + 1 < items.length && items[j + 1].groupId === g) j++;
        if (j > i) groupRanges.push({ groupId: g, start: i, end: j });
        i = j + 1;
      } else {
        i++;
      }
    }
  }

  // Fixed thumbnail width — compact horizontal preview row.
  const THUMB_W = 96;
  const GAP = 6;

  return (
    <div style={{ position: 'relative' }}>
      {/* Chain overlay: one badge + bracket per run of paired thumbnails */}
      {groupRanges.map((r) => {
        const startPx = r.start * (THUMB_W + GAP);
        const widthPx = (r.end - r.start + 1) * THUMB_W + (r.end - r.start) * GAP;
        return (
          <div
            key={r.groupId}
            style={{
              position: 'absolute',
              top: -10,
              left: startPx + 4,
              width: widthPx - 8,
              height: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              pointerEvents: 'none',
              zIndex: 2,
            }}
            title={`Paired (${r.end - r.start + 1} slots = one shared phone)`}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              }}
            >
              <Link2 size={9} />
            </span>
            <span style={{ flex: 1, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
          </div>
        );
      })}

      <div
        className="preset-strip-scroll"
        style={{
          display: 'flex',
          gap: GAP,
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingBottom: 4,
          // Allow horizontal scroll when many samples don't fit the card width.
          // Visible scrollbar styled tiny via global CSS or browser default.
        }}
      >
        {items.map((s, i) => {
          const groupCanonicalIdx = s.groupId ? items.findIndex((x) => x.groupId === s.groupId) : -1;
          const sourceUrl =
            groupCanonicalIdx === 0 || (groupCanonicalIdx === -1 && i === 0)
              ? (primarySourceUrl ?? s.screenSrc ?? null)
              : groupCanonicalIdx > -1
                ? (items[groupCanonicalIdx]!.screenSrc ?? primarySourceUrl ?? null)
                : (s.screenSrc ?? null);
          return (
            <div key={i} style={{ width: THUMB_W, flex: 'none' }}>
              <PresetThumbnail
                preset={preset}
                verb={s.verb}
                descriptor={s.descriptor}
                sourceUrl={sourceUrl}
                accentOverride={accentOverride}
                device={s.device}
                text={s.text}
                sampleIndex={i}
                bgColor={s.bgColor}
                pill={s.pill}
                pillBg={s.pillBg}
                pillFg={s.pillFg}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
