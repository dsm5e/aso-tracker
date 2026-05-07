/**
 * Build a synthetic Screenshot with locale translations + per-slot adjustments
 * applied. Single source of truth used by both Locales preview and exportRender.
 *
 * iPad slots often share headline text with iPhone counterparts but have
 * different IDs. If a direct translation is missing, fall back to any other
 * slot with the same verb that IS translated — covers the case where iPad was
 * added after the translate run.
 */
import { useStudio, type LocaleEntry, type Screenshot } from '../state/studio';

export function applyLocaleToSlot(ss: Screenshot, loc: LocaleEntry | null): Screenshot {
  if (!loc) return ss;

  let tr = loc.translations?.[ss.id];
  let pill = loc.pillTranslations?.[ss.id];
  let adj = loc.slotAdjustments?.[ss.id];

  // Fallback: look for another slot with the same verb that has a translation.
  if (!tr && loc.translations && ss.headline.verb) {
    const allScreenshots = useStudio.getState().screenshots;
    const match = allScreenshots.find(
      (other) =>
        other.id !== ss.id &&
        other.headline.verb === ss.headline.verb &&
        loc.translations?.[other.id],
    );
    if (match) {
      tr = loc.translations[match.id];
      if (!pill) pill = loc.pillTranslations?.[match.id];
      if (!adj) adj = loc.slotAdjustments?.[match.id];
    }
  }

  return {
    ...ss,
    headline: tr
      ? { verb: tr.verb || ss.headline.verb, descriptor: tr.descriptor || ss.headline.descriptor, subhead: ss.headline.subhead }
      : ss.headline,
    pill: pill ?? ss.pill,
    textX: (ss.textX ?? 0) + (adj?.textX ?? 0),
    textY: (ss.textY ?? 0) + (adj?.textY ?? 0),
    titlePx: adj?.titlePx ?? ss.titlePx,
    subPx: adj?.subPx ?? ss.subPx,
  };
}
