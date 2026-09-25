// Keeps our own apps' icon, name and subtitle in apps.json in sync with the App Store.
// They used to be written once when the app was added, so a new icon or title never
// showed up. Source: the US storefront (default metadata), else the app's first
// tracked storefront. Best-effort: a failed lookup keeps the previous values.
import { loadApps, loadKeywords, saveApps, type AppConfig } from './config.js';
import { productPageSubtitle } from './competitor-spy.js';
import { appleJson } from './itunes.js';

const DAY_MS = 24 * 60 * 60_000;

interface LookupItem {
  trackId?: number; trackName?: string; artistName?: string; version?: string;
  artworkUrl512?: string; artworkUrl100?: string; primaryGenreName?: string;
}

async function lookup(iTunesId: string, country: string): Promise<LookupItem | null> {
  try {
    // Runs at server start and before every snapshot: 'top', not interactive.
    const data = await appleJson<{ results?: LookupItem[] }>(`https://itunes.apple.com/lookup?id=${encodeURIComponent(iTunesId)}&country=${country}`, { priority: 'top' });
    return data.results?.[0]?.trackId ? data.results[0] : null;
  } catch { return null; }
}

/** Short brand from a store title: «MedScan: DICOM Viewer CT & MRI» → «MedScan». */
export function brandFromTitle(title: string): string {
  return title.split(/\s*[:\-–—|]\s+|\s*:\s*/)[0].trim() || title.trim();
}

async function refreshOne(app: AppConfig): Promise<{ changed: string[] }> {
  if (!app.iTunesId) return { changed: [] };
  const tracked = Object.keys(loadKeywords(app.id) ?? {});
  const countries = ['us', ...tracked.filter((c) => c !== 'us').slice(0, 1)];
  let item: LookupItem | null = null; let country = 'us';
  for (const c of countries) { item = await lookup(app.iTunesId, c); if (item) { country = c; break; } }
  if (!item) return { changed: [] };
  const subtitle = item.trackId ? await productPageSubtitle(item.trackId, country, item.primaryGenreName, 'top') : null;
  const next: Partial<AppConfig> = {
    iconUrl: item.artworkUrl512 || item.artworkUrl100?.replace('100x100bb', '512x512bb') || app.iconUrl,
    storeName: item.trackName ?? app.storeName,
    name: item.trackName ? brandFromTitle(item.trackName) : app.name,
    tagline: subtitle ?? app.tagline,
    developer: item.artistName ?? app.developer,
    version: item.version ?? app.version,
    metaCountry: country,
  };
  const changed = (Object.keys(next) as (keyof AppConfig)[]).filter((k) => next[k] !== undefined && next[k] !== app[k]);
  Object.assign(app, next, { metaUpdatedAt: new Date().toISOString() });
  return { changed: changed as string[] };
}

/** Refresh metadata for the given apps (all by default). `maxAgeMs` skips fresh ones. */
export async function refreshOwnAppMeta(appIds?: string[], maxAgeMs = 0): Promise<Record<string, string[]>> {
  const apps = loadApps();
  const out: Record<string, string[]> = {};
  for (const app of apps) {
    if (appIds && !appIds.includes(app.id)) continue;
    const age = app.metaUpdatedAt ? Date.now() - Date.parse(app.metaUpdatedAt) : Infinity;
    if (age < maxAgeMs) continue;
    out[app.id] = (await refreshOne(app)).changed;
  }
  // Re-read before saving so a concurrent add/delete of an app is not lost.
  const latest = loadApps();
  for (const app of apps) {
    const i = latest.findIndex((a) => a.id === app.id);
    if (i >= 0) latest[i] = { ...latest[i], ...app };
  }
  saveApps(latest);
  return out;
}

/** Called at server start: refresh anything older than a day, in the background. */
export function refreshStaleOwnAppMeta(): void {
  void refreshOwnAppMeta(undefined, DAY_MS).catch(() => {});
}
