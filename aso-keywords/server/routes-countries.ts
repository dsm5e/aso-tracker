import type { Express } from 'express';
import { loadKeywords } from './config.js';
import { db } from './db.js';
import { computeMatrix } from './matrix.js';
import { LOCALE_NAMES, STOREFRONTS, builtInPresets } from './storefronts.js';
import { loadCountrySets, sanitizeCountrySets, saveCountrySets, type CountrySets, type CountrySetsResponse, COUNTRY_CODE } from './country-sets.js';

/**
 * Country navigation for Keywords: the storefront table, the keyword × storefront
 * matrix and per-app country sets. Registered from index.ts; the `:id` param is
 * validated there by app.param('id').
 */

function withPresets(appId: string, sets: CountrySets): CountrySetsResponse {
  return { ...sets, presets: builtInPresets(Object.keys(loadKeywords(appId))) };
}

export function registerCountryRoutes(app: Express) {
  app.get('/api/storefronts', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ storefronts: STOREFRONTS, localeNames: LOCALE_NAMES });
  });

  app.get('/api/apps/:id/matrix', (req, res) => {
    const raw = typeof req.query.locales === 'string' ? req.query.locales : '';
    const locales = raw ? raw.split(',').map((code) => code.trim().toLowerCase()).filter((code) => COUNTRY_CODE.test(code)) : undefined;
    try {
      res.set('Cache-Control', 'no-store');
      res.json(computeMatrix(db, req.params.id, loadKeywords(req.params.id), locales));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/apps/:id/country-sets', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(withPresets(req.params.id, loadCountrySets(req.params.id)));
  });

  app.put('/api/apps/:id/country-sets', (req, res) => {
    const next = sanitizeCountrySets(req.body);
    saveCountrySets(req.params.id, next);
    res.json(withPresets(req.params.id, next));
  });
}
