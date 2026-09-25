import type { Express } from 'express';
import { loadApps, loadKeywordLayers, loadKeywords, saveKeywords, updateGlobalKeywords } from './config.js';
import { db } from './db.js';
import { keywordDifficulty, opportunity, SPY_FORMULA } from './competitor-spy.js';
import { asaPopularity } from './suggestions.js';
import { clearMatrixCache } from './matrix.js';
import {
  applyPairs,
  applyTagChange,
  keywordHistory,
  loadTags,
  saveTags,
  setNote,
  tagKey,
  tagPalette,
  type KeywordPair,
} from './keyword-table.js';

/**
 * Positions table (one storefront) + tags/notes + bulk keyword × storefront
 * edits. Registered from index.ts; `:id` is validated there by app.param('id').
 */

const STOREFRONT = /^[a-z]{2}$/;
const strings = (value: unknown, max = 2000) => (Array.isArray(value) ? value : []).map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, max);

function pairs(value: unknown): KeywordPair[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({ keyword: String((item as KeywordPair)?.keyword ?? '').trim(), storefront: String((item as KeywordPair)?.storefront ?? '').trim().toLowerCase() }))
    .filter((pair) => pair.keyword && pair.keyword.length <= 200 && STOREFRONT.test(pair.storefront))
    .slice(0, 20_000);
}

export const POPULARITY_NOTE = 'Популярность Apple Ads 5–100 из рекомендаций ключей (Apple Ads Platform API), одно значение на ключ × витрину в сутки. 5 — минимум шкалы Apple: «≤5, низкий объём», а не ноль.';

export function registerKeywordTableRoutes(app: Express) {
  app.get('/api/apps/:id/keyword-table', async (req, res) => {
    const storefront = String(req.query.storefront ?? '').trim().toLowerCase();
    if (!STOREFRONT.test(storefront)) { res.status(400).json({ error: 'storefront required' }); return; }
    const appConfig = loadApps().find((item) => item.id === req.params.id);
    if (!appConfig) { res.status(404).json({ error: 'app not found' }); return; }
    const keywords = loadKeywords(appConfig.id)[storefront] ?? [];
    const globalSet = new Set(loadKeywordLayers(appConfig.id).global.map((k) => k.trim().toLocaleLowerCase()));
    const waitMs = Math.max(0, Math.min(8_000, Number(req.query.wait_ms ?? 2_500) || 0));
    try {
      const started = Date.now();
      const [popularity, difficulty] = await Promise.all([
        asaPopularity(appConfig, storefront, keywords, waitMs),
        keywordDifficulty(appConfig.id, storefront, keywords).catch(() => null),
      ]);
      const history = keywordHistory(db, appConfig.id, storefront, keywords);
      const tags = loadTags(appConfig.id);
      const notes = tags.notes[storefront] ?? {};
      const rows = keywords.map((keyword) => {
        const key = tagKey(keyword);
        const h = history.rows.get(key);
        const pop = popularity?.values.get(key);
        const d = difficulty?.rows.get(key);
        const ourRank = h?.current && h.current > 0 ? h.current : null;
        const popularityValue = pop?.popularity ?? null;
        return {
          keyword,
          current: h?.current ?? null,
          prev1: h?.prev1 ?? null,
          prev7: h?.prev7 ?? null,
          entered7: h?.entered7 ?? false,
          dropped7: h?.dropped7 ?? false,
          total: h?.total ?? null,
          trend: h?.trend ?? [],
          popularity: popularityValue,
          popularityLabel: pop?.label ?? null,
          popularityStatus: pop?.status ?? (popularity ? 'pending' : 'unavailable'),
          popularityDay: pop?.day ?? null,
          difficulty: d?.difficulty ?? null,
          chance: d?.chance ?? null,
          opportunity: opportunity(popularityValue, d?.chance ?? null, ourRank),
          serpDepth: d?.depth ?? 0,
          serpSource: d?.source ?? null,
          tags: tags.tags[key] ?? [],
          note: notes[key] ?? '',
          /** Tracked through the app's global list (every storefront), not this storefront's own list. */
          global: globalSet.has(keyword.trim().toLocaleLowerCase()),
        };
      });
      res.set('Cache-Control', 'no-store');
      res.json({
        storefront,
        generatedAt: new Date().toISOString(),
        ms: Date.now() - started,
        latestDate: history.latestDate,
        trendDates: history.trendDates,
        ourStrength: difficulty?.ourStrength ?? null,
        popularity: popularity
          ? { status: 'ok', source: popularity.source, sourceLabel: popularity.sourceLabel, day: popularity.day, pending: popularity.pending, note: POPULARITY_NOTE }
          : { status: 'unavailable', source: null, sourceLabel: 'Apple Ads недоступен', day: null, pending: 0, note: POPULARITY_NOTE },
        formula: SPY_FORMULA,
        palette: tagPalette(tags),
        rows,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/apps/:id/tags', (req, res) => {
    const tags = loadTags(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json({ ...tags, palette: tagPalette(tags) });
  });

  /** { keywords: string[], add?: string[], remove?: string[] } — tags are app-wide per keyword. */
  app.post('/api/apps/:id/tags', (req, res) => {
    const keywords = strings(req.body?.keywords);
    if (!keywords.length) { res.status(400).json({ error: 'keywords required' }); return; }
    const next = applyTagChange(loadTags(req.params.id), keywords, strings(req.body?.add, 20), strings(req.body?.remove, 20));
    saveTags(req.params.id, next);
    res.json({ ...next, palette: tagPalette(next) });
  });

  /** { storefront, keyword, note } — empty note deletes it. */
  app.put('/api/apps/:id/notes', (req, res) => {
    const storefront = String(req.body?.storefront ?? '').toLowerCase();
    const keyword = String(req.body?.keyword ?? '').trim();
    if (!STOREFRONT.test(storefront) || !keyword) { res.status(400).json({ error: 'storefront and keyword required' }); return; }
    const next = setNote(loadTags(req.params.id), storefront, keyword, String(req.body?.note ?? ''));
    saveTags(req.params.id, next);
    res.json({ note: next.notes[storefront]?.[tagKey(keyword)] ?? '' });
  });

  /** { add?: {keyword, storefront}[], remove?: {keyword, storefront}[] } — server-side merge,
   * so a stale client map can never drop keywords added elsewhere. */
  app.post('/api/apps/:id/keywords/bulk', (req, res) => {
    const add = pairs(req.body?.add);
    const remove = pairs(req.body?.remove);
    if (!add.length && !remove.length) { res.status(400).json({ error: 'add or remove pairs required' }); return; }
    const result = applyPairs(loadKeywords(req.params.id), add, remove);
    saveKeywords(req.params.id, result.map);
    clearMatrixCache(db);
    res.json({ added: result.added, removed: result.removed, existing: result.existing, keywords: loadKeywords(req.params.id), global: loadKeywordLayers(req.params.id).global });
  });

  /** Global keywords — tracked in every storefront of the app, including future ones. */
  app.get('/api/apps/:id/keywords/global', (req, res) => {
    const { global, local } = loadKeywordLayers(req.params.id);
    res.json({ global, storefronts: Object.keys(local).length });
  });

  /** { add?: string[], remove?: string[] }. Adding moves the keyword out of storefront
   * lists into the global one; removing drops it from every storefront. */
  app.put('/api/apps/:id/keywords/global', (req, res) => {
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []);
    const add = list(req.body?.add), remove = list(req.body?.remove);
    if (!add.length && !remove.length) { res.status(400).json({ error: 'add or remove required' }); return; }
    if (!loadApps().some((item) => item.id === req.params.id)) { res.status(404).json({ error: 'app not found' }); return; }
    const layers = updateGlobalKeywords(req.params.id, add, remove);
    clearMatrixCache(db);
    res.json({ global: layers.global, keywords: loadKeywords(req.params.id) });
  });
}
