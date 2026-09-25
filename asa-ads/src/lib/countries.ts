// Storefront labels shared by the global country filter and the screens.

/** "ALL" = every storefront (world). Anything else is an ISO alpha-2 code. */
export const WORLD = "ALL";

let ruNames: Intl.DisplayNames | null = null;

/** Regional-indicator flag for an ISO-3166 alpha-2 code; 🌐 otherwise. */
export function countryFlag(code: string): string {
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || cc === "WW") return "🌐";
  return String.fromCodePoint(...[...cc].map((c) => c.charCodeAt(0) + 127397));
}

/** Russian storefront name ("BR" → "Бразилия"). */
export function countryNameRu(code: string): string {
  const cc = code.trim().toUpperCase();
  try {
    ruNames ??= new Intl.DisplayNames(["ru"], { type: "region" });
    return ruNames.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Header scope label: «🌍 Весь мир» or «🇧🇷 Бразилия». */
export function scopeLabel(country: string): string {
  return country === WORLD ? "🌍 Весь мир" : `${countryFlag(country)} ${countryNameRu(country)}`;
}

/** Normalizes a raw value (URL, storage) to "ALL" or an alpha-2 code. */
export function normalizeCountry(value: string | null | undefined): string {
  const cc = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : WORLD;
}

/** Why bid / negative actions are locked while a storefront is selected. */
export const BIDS_GLOBAL_HINT = "Ставка ключа одна на все страны кампании — чтобы её менять, выберите «Весь мир»";
export const NEGATIVES_GLOBAL_HINT = "Минус-слово действует во всех странах кампании — добавляйте его в режиме «Весь мир»";
