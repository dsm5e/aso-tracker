import { db } from './db.js';

export interface Review {
  id: string;
  rating: number;
  title: string;
  content: string;
  author: string;
  version?: string;
  date?: string;
}

export interface ReviewsPayload {
  iTunesId: string;
  country: string;
  totalCount: number;
  avgRating: number | null;
  reviews: Review[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews_cache (
    itunes_id   TEXT NOT NULL,
    country     TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL,
    payload     TEXT NOT NULL,
    PRIMARY KEY (itunes_id, country)
  );
`);

type RssEntry = {
  id?: { label?: string };
  'im:rating'?: { label?: string };
  'im:version'?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
  author?: { name?: { label?: string } };
  updated?: { label?: string };
};

export async function getCompetitorReviews(
  iTunesId: string,
  country: string
): Promise<ReviewsPayload | null> {
  const cc = country.toLowerCase();
  const now = Date.now();

  const cached = db
    .prepare(`SELECT fetched_at, payload FROM reviews_cache WHERE itunes_id = ? AND country = ?`)
    .get(iTunesId, cc) as { fetched_at: number; payload: string } | undefined;

  if (cached && now - cached.fetched_at < CACHE_TTL_MS) {
    try {
      return JSON.parse(cached.payload) as ReviewsPayload;
    } catch {}
  }

  const url = `https://itunes.apple.com/${cc}/rss/customerreviews/id=${iTunesId}/sortBy=mostRecent/json`;
  let json: any;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }

  let entries: RssEntry[] = json?.feed?.entry ?? [];
  if (!Array.isArray(entries)) entries = [entries];
  // RSS first entry is app meta (has no im:rating), filter those out
  const reviewEntries = entries.filter((e) => e && e['im:rating']);

  const reviews: Review[] = reviewEntries.map((e) => ({
    id: e.id?.label ?? '',
    rating: parseInt(e['im:rating']?.label ?? '0', 10) || 0,
    title: e.title?.label ?? '',
    content: e.content?.label ?? '',
    author: e.author?.name?.label ?? '',
    version: e['im:version']?.label,
    date: e.updated?.label,
  }));

  const avg =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : null;

  const payload: ReviewsPayload = {
    iTunesId,
    country: cc,
    totalCount: reviews.length,
    avgRating: avg,
    reviews,
    fetchedAt: now,
  };

  db.prepare(
    `INSERT OR REPLACE INTO reviews_cache (itunes_id, country, fetched_at, payload) VALUES (?, ?, ?, ?)`
  ).run(iTunesId, cc, now, JSON.stringify(payload));

  return payload;
}
