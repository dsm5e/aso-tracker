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
  let extra = loc.extraTranslations?.[ss.id];
  let stickerTr = loc.stickerTranslations?.[ss.id];
  let badgeTr = loc.badgeTranslations?.[ss.id];
  let bandTr = loc.archBandTranslations?.[ss.id];
  let decorTr = loc.decorTranslations?.[ss.id];

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
      if (!extra) extra = loc.extraTranslations?.[match.id];
      if (!stickerTr) stickerTr = loc.stickerTranslations?.[match.id];
      if (!badgeTr) badgeTr = loc.badgeTranslations?.[match.id];
      if (!bandTr) bandTr = loc.archBandTranslations?.[match.id];
      if (!decorTr) decorTr = loc.decorTranslations?.[match.id];
    }
  }

  return {
    ...ss,
    sourceUrl: loc.sourceOverrides?.[ss.id] ?? ss.sourceUrl,
    secondaryUrl: loc.secondaryOverrides?.[ss.id] ?? ss.secondaryUrl,
    headline: tr
      ? { verb: tr.verb || ss.headline.verb, descriptor: tr.descriptor || ss.headline.descriptor, subhead: ss.headline.subhead }
      : ss.headline,
    pill: pill ?? ss.pill,
    badgeLine1: badgeTr?.line1 ?? ss.badgeLine1,
    badgeLine2: badgeTr?.line2 ?? ss.badgeLine2,
    // Названия стилей под полосами арки: пропуск (null) оставляет исходное —
    // часть терминов намеренно живёт по-английски и в других языках.
    archBands: ss.archBands && bandTr
      ? ss.archBands.map((band, i) => (bandTr?.[i] ? { ...band, label: bandTr[i] as string } : band))
      : ss.archBands,
    // Наклейки переводятся по индексу: пропуск (null) оставляет исходный текст.
    stickers: ss.stickers && stickerTr
      ? ss.stickers.map((sticker, i) => {
          const tr = stickerTr?.[i];
          if (!tr) return sticker;
          return {
            ...sticker,
            text: tr.text ?? sticker.text,
            imageCaptions: tr.imageCaptions ?? sticker.imageCaptions,
          };
        })
      : ss.stickers,
    // Decor copy (speech bubbles) is translated by index; null keeps the source.
    decor: ss.decor && decorTr
      ? ss.decor.map((d, i) => (decorTr?.[i] ? { ...d, text: decorTr[i] as string } : d))
      : ss.decor,
    // Localized footer capsule + V captions (fall back to source when absent).
    footer: extra?.footer ?? ss.footer,
    frontLabel: extra?.frontLabel ?? ss.frontLabel,
    backLabel: extra?.backLabel ?? ss.backLabel,
    annotation: extra?.annotation ?? ss.annotation,
    proofText: extra?.proofText ?? ss.proofText,
    proofAttribution: extra?.proofAttribution ?? ss.proofAttribution,
    trustStrip: extra?.trustStrip ?? ss.trustStrip,
    phoneBrand: extra?.phoneBrand ?? ss.phoneBrand,
    phoneTitle: extra?.phoneTitle ?? ss.phoneTitle,
    phoneSubtitle: extra?.phoneSubtitle ?? ss.phoneSubtitle,
    phoneToggleLeft: extra?.phoneToggleLeft ?? ss.phoneToggleLeft,
    phoneToggleRight: extra?.phoneToggleRight ?? ss.phoneToggleRight,
    textX: (ss.textX ?? 0) + (adj?.textX ?? 0),
    textY: (ss.textY ?? 0) + (adj?.textY ?? 0),
    titlePx: adj?.titlePx ?? ss.titlePx,
    subPx: adj?.subPx ?? ss.subPx,
  };
}
