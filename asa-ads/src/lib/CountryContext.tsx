import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type AppCountry } from "../api.ts";
import { useApp } from "./AppContext.tsx";
import { WORLD, normalizeCountry, scopeLabel } from "./countries.ts";

// One storefront filter for the whole Ads product. The value lives here, is
// mirrored into `?country=XX` (shareable, survives reloads) and localStorage
// (survives navigation that drops the query), and falls back to World when the
// selected app has no Apple Ads delivery in that storefront.

interface CountryCtx {
  /** "ALL" (world) or an ISO alpha-2 storefront code. */
  country: string;
  isWorld: boolean;
  setCountry: (country: string) => void;
  /** Storefronts with Apple Ads delivery for the selected app, spend desc. */
  options: AppCountry[];
  /** «🌍 Весь мир» / «🇧🇷 Бразилия». */
  label: string;
  reload: () => void;
}

const STORAGE_KEY = "asa-ads.country";
const Ctx = createContext<CountryCtx | null>(null);

function initialCountry(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("country");
  if (fromUrl) return normalizeCountry(fromUrl);
  try { return normalizeCountry(localStorage.getItem(STORAGE_KEY)); } catch { return WORLD; }
}

export function CountryProvider({ children }: { children: ReactNode }) {
  const { selected } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [country, setCountryRaw] = useState<string>(initialCountry);
  const [options, setOptions] = useState<{ key: string; rows: AppCountry[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const appKey = String(selected);

  const setCountry = useCallback((next: string) => setCountryRaw(normalizeCountry(next)), []);

  // Persist every value, including one that arrived via a shared URL.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, country); } catch { /* per-viewer convenience only */ }
  }, [country]);

  useEffect(() => {
    let cancelled = false;
    api.countries(selected)
      .then((rows) => { if (!cancelled) setOptions({ key: appKey, rows }); })
      // Without the list the current value is kept: never reset on an outage.
      .catch(() => { if (!cancelled) setOptions(null); });
    return () => { cancelled = true; };
  }, [appKey, reloadKey, selected]);

  // Switching app keeps the storefront when the new app has it, else World.
  useEffect(() => {
    if (!options || options.key !== appKey || country === WORLD) return;
    if (!options.rows.some((row) => row.code === country)) setCountry(WORLD);
  }, [appKey, country, options, setCountry]);

  // Mirror into the URL; NavLinks drop the query, so re-apply it after moves.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const want = country === WORLD ? null : country;
    if (params.get("country") === want) return;
    if (want) params.set("country", want); else params.delete("country");
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
  }, [country, location.hash, location.pathname, location.search, navigate]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <Ctx.Provider value={{
      country,
      isWorld: country === WORLD,
      setCountry,
      options: options?.key === appKey ? options.rows : [],
      label: scopeLabel(country),
      reload,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCountry(): CountryCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCountry must be used within CountryProvider");
  return ctx;
}
