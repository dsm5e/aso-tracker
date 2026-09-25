import { useLocation } from "react-router-dom";
import { useCountry } from "../lib/CountryContext.tsx";
import { WORLD, countryFlag, countryNameRu } from "../lib/countries.ts";

/** Screens whose data has no storefront dimension. */
const NOT_APPLIED = ["/actions", "/alerts", "/settings"];
export const NOT_APPLIED_HINT = "На этом экране нет разбивки по странам";

export function countryFilterApplies(pathname: string): boolean {
  return !NOT_APPLIED.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function optionLabel(code: string): string {
  return `${countryFlag(code)} ${code} · ${countryNameRu(code)}`;
}

/** Global storefront filter under the app switcher. Stays visible (disabled)
 *  on screens without a country split so the sidebar never jumps. */
export default function CountrySwitcher() {
  const { country, setCountry, options } = useCountry();
  const { pathname } = useLocation();
  const applies = countryFilterApplies(pathname);
  const known = country === WORLD || options.some((row) => row.code === country);

  return (
    <div className="app-switcher country-switcher" title={applies ? "Фильтр по стране для всех экранов Ads" : NOT_APPLIED_HINT}>
      <div className="app-switcher-label">
        Страна{!applies && <span className="country-switcher-na"> · не применяется</span>}
      </div>
      <select
        className="ds-select"
        aria-label="Страна"
        value={country}
        disabled={!applies}
        onChange={(e) => setCountry(e.target.value)}
      >
        <option value={WORLD}>🌍 Весь мир</option>
        {/* Keep a URL/stored value visible while the list is still loading. */}
        {!known && <option value={country}>{optionLabel(country)}</option>}
        {options.map((row) => (
          <option key={row.code} value={row.code}>{optionLabel(row.code)}</option>
        ))}
      </select>
    </div>
  );
}

/** Scope chip for page headers: «🌍 Весь мир» / «🇧🇷 Бразилия». */
export function ScopeBadge({ note, notApplied }: { note?: string; notApplied?: boolean }) {
  const { label } = useCountry();
  if (notApplied) {
    return <span className="scope-badge muted" title={NOT_APPLIED_HINT}>🌍 все страны</span>;
  }
  return <span className="scope-badge" title={note ?? "Глобальный фильтр «Страна» слева"}>{label}</span>;
}
