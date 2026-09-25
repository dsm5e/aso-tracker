import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AppRow } from "../api.ts";
import { useApp } from "./AppContext.tsx";
import { useCountry } from "./CountryContext.tsx";
import { WORLD } from "./countries.ts";
import { appStoreCountry } from "./appStoreLocales.ts";
import { keywordsApi, type KeywordsApp, type RankingRow } from "./keywordsApi.ts";

// The keyword screens (matrix, traffic) came from the Keywords product and still
// read its data: the tracked app (by keywords id), a storefront locale, organic
// rankings and a shared top-5 / artwork cache. This hook maps the app selected in
// Ads (Apple adamId) onto the keywords app with the same iTunes id (or name) and
// owns that shared state for the screens.

type TopFiveCandidate = { id: string; tid?: number };
export type SharedTopFiveStatus = "loading" | "ready" | "empty" | "error";

const ARTWORK_SESSION_KEY = "asa-ads.keyword-artworks.v1";

function topFiveKey(appId: string, country: string, keyword: string) {
  return `${appId}:${country.toLocaleLowerCase()}:${keyword.toLocaleLowerCase()}`;
}

function initialArtworks(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem(ARTWORK_SESSION_KEY) || "{}") as Record<string, string>; } catch { return {}; }
}

function shortName(name: string | null | undefined): string {
  return (name ?? "").split(":")[0].split(" — ")[0].trim().toLocaleLowerCase();
}

export interface KeywordsBridge {
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Keywords apps that have an Ads counterpart (by iTunes id or name). */
  candidates: KeywordsApp[];
  app: KeywordsApp | null;
  selectApp: (keywordsAppId: string) => void;
  locales: string[];
  /** Storefront of the organic context (top-5, positions): the global country
   *  when Keywords tracks it, otherwise the app's default storefront. */
  locale: string;
  /** True when `locale` is the storefront chosen in the global country filter. */
  countryTracked: boolean;
  rankings: RankingRow[];
  artworks: Record<string, string>;
  sharedTopFive: Record<string, RankingRow>;
  sharedTopFiveStatus: Record<string, SharedTopFiveStatus>;
  resolveTopFive: (appId: string, iTunesId: string, country: string, keyword: string) => void;
  ensureArtworks: (candidates: TopFiveCandidate[], country: string) => void;
}

/** Name fallback when the ids differ: match any store name the Ads app carried. */
function sameApp(ads: AppRow, keywordsName: string): boolean {
  const target = shortName(keywordsName);
  const names = ads.aliases?.length ? ads.aliases : [ads.app_name];
  return names.some((n) => shortName(n) === target);
}

export function useKeywordsBridge(): KeywordsBridge {
  const { apps: adsApps, selected, setSelected } = useApp();
  const { country } = useCountry();
  const [kwApps, setKwApps] = useState<KeywordsApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locales, setLocales] = useState<string[]>([]);
  const [rankings, setRankings] = useState<RankingRow[]>([]);

  useEffect(() => {
    keywordsApi.apps().then(setKwApps).catch((e: Error) => setError(`Keywords API: ${e.message}`));
  }, []);

  // Keywords apps that match any Ads app; order follows the keywords list.
  const candidates = useMemo(() => {
    if (!kwApps) return [];
    return kwApps.filter((k) => adsApps.some((a) => String(a.app_id) === k.iTunesId || sameApp(a, k.name)));
  }, [adsApps, kwApps]);

  const app = useMemo(() => {
    if (!kwApps) return null;
    if (selected !== "all") {
      const ads = adsApps.find((a) => a.app_id === selected);
      const byId = kwApps.find((k) => k.iTunesId === String(selected));
      if (byId) return byId;
      const byName = ads && kwApps.find((k) => sameApp(ads, k.name));
      if (byName) return byName;
      return null;
    }
    // "All apps" in Ads: the keyword screens are per-app, show the first match.
    return candidates[0] ?? null;
  }, [adsApps, candidates, kwApps, selected]);

  const selectApp = useCallback((keywordsAppId: string) => {
    const k = kwApps?.find((x) => x.id === keywordsAppId);
    if (!k) return;
    const ads = adsApps.find((a) => String(a.app_id) === k.iTunesId) ?? adsApps.find((a) => sameApp(a, k.name));
    if (ads) setSelected(ads.app_id);
  }, [adsApps, kwApps, setSelected]);

  // Tracked storefronts of the app.
  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    setRankings([]);
    keywordsApi.keywords(app.id)
      .then((map) => {
        if (cancelled) return;
        const tracked = Object.keys(map).filter((code) => map[code]?.length).sort();
        setLocales(tracked.length ? tracked : [...app.locales].sort());
      })
      .catch(() => {
        if (!cancelled) setLocales([...app.locales].sort());
      });
    return () => { cancelled = true; };
  }, [app]);

  // The global country picks the storefront when Keywords tracks it; World or
  // an untracked country use the default one (US when tracked, else the app's
  // first tracked locale).
  const { locale, countryTracked } = useMemo(() => {
    if (!app || !locales.length) return { locale: "", countryTracked: false };
    if (country !== WORLD) {
      const cc = country.toLocaleLowerCase();
      const match = locales.find((l) => l === cc) ?? locales.find((l) => appStoreCountry(l) === cc);
      if (match) return { locale: match, countryTracked: true };
    }
    const primary = locales.includes("us") ? "us" : app.locales.find((l) => locales.includes(l)) ?? locales[0] ?? "";
    return { locale: primary, countryTracked: false };
  }, [app, country, locales]);

  useEffect(() => {
    if (!app || !locale || !locales.includes(locale)) return;
    const controller = new AbortController();
    keywordsApi.rankings(app.id, locale, controller.signal)
      .then(setRankings)
      .catch(() => { if (!controller.signal.aborted) setRankings([]); });
    return () => controller.abort();
  }, [app, locale, locales]);

  // ── shared artwork cache ──────────────────────────────────────────
  const [artworks, setArtworks] = useState<Record<string, string>>(initialArtworks);
  const artworksRef = useRef(artworks);
  const artworkWorkRef = useRef<Promise<void>>(Promise.resolve());
  const artworkInFlightRef = useRef(new Set<string>());
  const artworkNegativeRef = useRef(new Map<string, number>());

  const ensureArtworks = useCallback((items: TopFiveCandidate[], country: string) => {
    const ids = [...new Set(items.map((c) => c.tid).filter((id): id is number => id != null))];
    const bundles = [...new Set(items.filter((c) => c.tid == null).map((c) => c.id).filter(Boolean))];
    const now = Date.now();
    const missing = [...ids.map(String), ...bundles].filter((key) => {
      const scoped = `${country}:${key}`;
      return !artworksRef.current[key] && (artworkNegativeRef.current.get(scoped) ?? 0) <= now && !artworkInFlightRef.current.has(scoped);
    });
    if (!missing.length) return;
    missing.forEach((key) => artworkInFlightRef.current.add(`${country}:${key}`));
    const requestedIds = ids.filter((id) => missing.includes(String(id)));
    const requestedBundles = bundles.filter((b) => missing.includes(b));
    artworkWorkRef.current = artworkWorkRef.current.catch(() => undefined).then(async () => {
      try {
        const incoming = await keywordsApi.artworks(requestedIds, requestedBundles, country);
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        missing.filter((key) => !incoming[key]).forEach((key) => artworkNegativeRef.current.set(`${country}:${key}`, expiresAt));
        setArtworks((current) => {
          const next = { ...current, ...incoming };
          artworksRef.current = next;
          try { sessionStorage.setItem(ARTWORK_SESSION_KEY, JSON.stringify(next)); } catch { /* non-critical cache */ }
          return next;
        });
      } catch { /* An empty slot is preferable to an invented icon. */ }
      finally { missing.forEach((key) => artworkInFlightRef.current.delete(`${country}:${key}`)); }
    });
  }, []);

  // ── shared top-5 cache ────────────────────────────────────────────
  const [sharedTopFive, setSharedTopFive] = useState<Record<string, RankingRow>>({});
  const sharedTopFiveRef = useRef(sharedTopFive);
  const [sharedTopFiveStatus, setSharedTopFiveStatus] = useState<Record<string, SharedTopFiveStatus>>({});
  const topFiveWorkRef = useRef<Promise<void>>(Promise.resolve());
  const topFiveInFlightRef = useRef(new Set<string>());

  useEffect(() => {
    if (!app) return;
    setSharedTopFive((current) => {
      const next = { ...current };
      for (const row of rankings) next[topFiveKey(app.id, row.locale, row.keyword)] = row;
      sharedTopFiveRef.current = next;
      return next;
    });
  }, [app, rankings]);

  const resolveTopFive = useCallback((appId: string, iTunesId: string, country: string, keyword: string) => {
    const key = topFiveKey(appId, country, keyword);
    if (sharedTopFiveRef.current[key] || topFiveInFlightRef.current.has(key)) return;
    topFiveInFlightRef.current.add(key);
    setSharedTopFiveStatus((current) => ({ ...current, [key]: "loading" }));
    const lc = country.toLocaleLowerCase();
    const store = (ranking: RankingRow) => {
      setSharedTopFive((current) => {
        const next = { ...current, [key]: ranking };
        sharedTopFiveRef.current = next;
        return next;
      });
      setSharedTopFiveStatus((current) => ({ ...current, [key]: ranking.top5.length ? "ready" : "empty" }));
      if (ranking.top5.length) ensureArtworks(ranking.top5, lc);
    };
    const fallback = async (): Promise<RankingRow> => {
      const results = await keywordsApi.itunesSearch(keyword, lc);
      return {
        locale: lc, keyword, today: null, yesterday: null, w1: null, w4: null, trend: [], lastUpdated: Date.now(),
        top5: results.slice(0, 5).map((r, i) => ({ id: r.bundleId ?? String(r.trackId), name: r.trackName ?? r.bundleId ?? `Приложение ${i + 1}`, dev: r.artistName ?? "", tid: r.trackId, pos: i + 1 })),
      };
    };
    topFiveWorkRef.current = topFiveWorkRef.current.catch(() => undefined).then(async () => {
      try {
        const cached = await api.cachedTopFiveBatch({ appId: Number(iTunesId), locales: [lc], terms: [keyword], limit: 1 });
        const item = cached.items[0];
        store(item ? {
          locale: item.locale, keyword: item.term, today: item.yourRank, yesterday: null, w1: null, w4: null, trend: [],
          lastUpdated: item.observedAt ? new Date(item.observedAt).getTime() : null,
          top5: item.apps.map((c) => {
            const tid = Number(c.iTunesId);
            return { id: c.bundleId ?? String(c.iTunesId ?? c.name), name: c.name, dev: c.developer ?? "", tid: Number.isSafeInteger(tid) && tid > 0 ? tid : undefined, pos: c.rank };
          }),
        } : await fallback());
      } catch {
        try { store(await fallback()); } catch { setSharedTopFiveStatus((current) => ({ ...current, [key]: "error" })); }
      } finally { topFiveInFlightRef.current.delete(key); }
    });
  }, [ensureArtworks]);

  return {
    status: error ? "error" : kwApps ? "ready" : "loading",
    error,
    candidates,
    app,
    selectApp,
    locales,
    locale: app && locales.includes(locale) ? locale : "",
    countryTracked,
    rankings,
    artworks,
    sharedTopFive,
    sharedTopFiveStatus,
    resolveTopFive,
    ensureArtworks,
  };
}
