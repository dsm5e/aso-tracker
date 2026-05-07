import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS app_genres (
    bundle_id   TEXT PRIMARY KEY,
    genre       TEXT NOT NULL,
    name        TEXT,
    fetched_at  INTEGER NOT NULL
  );
`);

const GENRE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchGenre(bundleId: string): Promise<{ genre: string; name: string } | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ primaryGenreName?: string; trackName?: string }>;
    };
    const r = data.results?.[0];
    if (!r?.primaryGenreName) return null;
    return { genre: r.primaryGenreName, name: r.trackName ?? '' };
  } catch {
    return null;
  }
}

export async function getGenreById(iTunesId: string): Promise<{ genre: string; name: string } | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(iTunesId)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ primaryGenreName?: string; trackName?: string; bundleId?: string }>;
    };
    const r = data.results?.[0];
    if (!r?.primaryGenreName) return null;
    // Cache under real bundleId
    if (r.bundleId) {
      db.prepare(
        `INSERT OR REPLACE INTO app_genres (bundle_id, genre, name, fetched_at) VALUES (?, ?, ?, ?)`
      ).run(r.bundleId, r.primaryGenreName, r.trackName ?? '', Date.now());
    }
    return { genre: r.primaryGenreName, name: r.trackName ?? '' };
  } catch {
    return null;
  }
}

export async function getGenre(bundleId: string): Promise<{ genre: string; name: string } | null> {
  const now = Date.now();
  const cached = db
    .prepare(`SELECT genre, name, fetched_at FROM app_genres WHERE bundle_id = ?`)
    .get(bundleId) as { genre: string; name: string; fetched_at: number } | undefined;

  if (cached && now - cached.fetched_at < GENRE_TTL_MS) {
    return { genre: cached.genre, name: cached.name ?? '' };
  }

  const fresh = await fetchGenre(bundleId);
  if (!fresh) return cached ? { genre: cached.genre, name: cached.name ?? '' } : null;

  db.prepare(
    `INSERT OR REPLACE INTO app_genres (bundle_id, genre, name, fetched_at) VALUES (?, ?, ?, ?)`
  ).run(bundleId, fresh.genre, fresh.name, now);

  return fresh;
}

/**
 * Batch enrich: resolve genres for many bundle ids, respecting cache + rate limit.
 * Returns a map bundleId -> { genre, name }.
 */
export async function getGenresBatch(
  bundleIds: string[]
): Promise<Map<string, { genre: string; name: string }>> {
  const uniq = Array.from(new Set(bundleIds.filter(Boolean)));
  const out = new Map<string, { genre: string; name: string }>();
  if (uniq.length === 0) return out;

  const now = Date.now();
  const placeholders = uniq.map(() => '?').join(',');
  const cached = db
    .prepare(
      `SELECT bundle_id, genre, name, fetched_at FROM app_genres
        WHERE bundle_id IN (${placeholders})`
    )
    .all(...uniq) as Array<{ bundle_id: string; genre: string; name: string; fetched_at: number }>;

  const fresh: string[] = [];
  const cacheMap = new Map(cached.map((r) => [r.bundle_id, r]));
  for (const id of uniq) {
    const c = cacheMap.get(id);
    if (c && now - c.fetched_at < GENRE_TTL_MS) {
      out.set(id, { genre: c.genre, name: c.name ?? '' });
    } else {
      fresh.push(id);
    }
  }

  // Rate-limited parallel fetch (4 concurrent, well under Apple's ~500/min limit)
  const CONCURRENCY = 4;
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < fresh.length) {
      const id = fresh[idx++];
      if (!id) break;
      const r = await getGenre(id);
      if (r) out.set(id, r);
      else {
        const stale = cacheMap.get(id);
        if (stale) out.set(id, { genre: stale.genre, name: stale.name ?? '' });
      }
    }
  });
  await Promise.all(workers);

  return out;
}
