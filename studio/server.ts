// ASO Studio gateway — one process, one port for every product.
//
//   npm run dev            → http://localhost:5173
//
// Products are activated lazily, on the first request to one of their prefixes:
//   • API   — the product's server/index.ts is imported and its Express `app`
//             mounted in-process under the same prefixes the old dev proxy used.
//   • UI    — a Vite dev server in middleware mode is created from the product's
//             own vite.config.ts (its `base` kept), HMR over this same HTTP server.
//             Starting the UI also calls the product's `start()` (background jobs:
//             Ads traffic sync + alerts, Screenshots PPO resume).
// A product nobody opens costs nothing. A UI with no requests and no connected
// HMR client for STUDIO_IDLE_MIN minutes (default 15, 0 = never) has its Vite
// closed; the next visit starts it again. APIs stay loaded once imported (other
// products call them, e.g. Keywords → /asa-api/integrations).
//
// Env: STUDIO_PORT (5173), STUDIO_HOST (127.0.0.1), STUDIO_IDLE_MIN (15),
//      STUDIO_VITE_CACHE_DIR (per-product Vite cacheDir root; default = each
//      product's node_modules/.vite, same as standalone).
// The old multi-process setup is still available as `npm run dev:legacy`.

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { createServer as createVite, loadConfigFromFile, type ViteDevServer } from 'vite';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.STUDIO_PORT) || 5173;
const HOST = process.env.STUDIO_HOST || '127.0.0.1';
const IDLE_MS = Number(process.env.STUDIO_IDLE_MIN ?? 15) * 60_000;

// ─── One log stream with product prefixes ──────────────────────────────────────
// Everything a product does (module init, request handlers, timers it creates)
// runs inside `logScope.run(id)`, so its console output is tagged automatically.
const logScope = new AsyncLocalStorage<string>();
const COLORS: Record<string, number> = { studio: 90, keywords: 35, ads: 33, screenshots: 36, video: 32, inapp: 34 };
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    const tag = logScope.getStore() ?? 'studio';
    const prefix = `\x1b[${COLORS[tag] ?? 90}m[${tag}]\x1b[0m`;
    if (typeof args[0] === 'string') args[0] = `${prefix} ${args[0]}`;
    else args.unshift(prefix);
    original(...args);
  };
}

// ─── Product table ─────────────────────────────────────────────────────────────
type Handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

interface ApiRoute { prefix: string; to: string }
interface Product {
  id: string;
  label: string;
  dir: string;
  /** UI base path ('/' for Keywords — matched last). */
  base: string;
  /** API prefixes → upstream path (the rewrites the old Vite proxy did). */
  api: ApiRoute[];
}

const PRODUCTS: Product[] = [
  {
    id: 'ads', label: 'Ads', dir: 'asa-ads', base: '/asa/',
    api: [{ prefix: '/asa-api', to: '/api' }, { prefix: '/asa-sse', to: '/sse' }],
  },
  {
    id: 'screenshots', label: 'Screenshots', dir: 'aso-screenshots', base: '/studio/',
    api: [{ prefix: '/studio-api', to: '/api' }],
  },
  {
    id: 'video', label: 'Video', dir: 'aso-video', base: '/video/',
    api: [
      { prefix: '/video-api', to: '/api' },
      { prefix: '/video-output', to: '/output' },
      { prefix: '/output', to: '/output' },
      { prefix: '/influencer', to: '/influencer' },
    ],
  },
  // Keywords last: its UI owns '/' and its API owns the bare '/api'.
  {
    id: 'keywords', label: 'Keywords', dir: 'aso-keywords', base: '/',
    api: [{ prefix: '/keywords-api', to: '/api' }, { prefix: '/api', to: '/api' }],
  },
];

interface ProductModule { app: Handler; start?: () => void }
interface State {
  api?: Promise<ProductModule>;
  started: boolean;
  vite?: Promise<ViteDevServer>;
  viteReady?: ViteDevServer;
  hmrClients: number;
  lastHit: number;
}
const state = new Map<string, State>(PRODUCTS.map((p) => [p.id, { started: false, hmrClients: 0, lastHit: 0 }]));

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

// ─── Activation ────────────────────────────────────────────────────────────────
function loadApi(p: Product): Promise<ProductModule> {
  const s = state.get(p.id)!;
  if (!s.api) {
    s.api = logScope.run(p.id, async () => {
      const t0 = Date.now();
      const mod = (await import(pathToFileURL(join(REPO, p.dir, 'server', 'index.ts')).href)) as ProductModule;
      console.log(`API loaded in ${Date.now() - t0} ms`);
      return mod;
    });
    s.api.catch(() => { s.api = undefined; }); // retry on the next request
  }
  return s.api;
}

let httpServer: http.Server;

async function createProductVite(p: Product): Promise<ViteDevServer> {
  const root = join(REPO, p.dir);
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, join(root, 'vite.config.ts'), root);
  const user = loaded?.config ?? {};
  // The product's proxy table points at the legacy per-product ports — the gateway
  // serves those prefixes itself, so drop it (and the standalone port settings).
  const { proxy: _proxy, port: _port, strictPort: _strict, hmr: _hmr, ...serverRest } = user.server ?? {};
  const cacheRoot = process.env.STUDIO_VITE_CACHE_DIR;
  const vite = await createVite({
    ...user,
    configFile: false,
    root,
    base: p.base,
    appType: 'spa',
    ...(cacheRoot ? { cacheDir: join(resolve(cacheRoot), p.id) } : {}),
    server: {
      ...serverRest,
      middlewareMode: true,
      // HMR socket on the shared server at <base>__hmr (/__hmr, /asa/__hmr, …).
      hmr: { server: httpServer, path: '__hmr' },
    },
  });
  const s = state.get(p.id)!;
  vite.ws.on('vite:client:connect', () => { s.hmrClients++; });
  vite.ws.on('vite:client:disconnect', () => { s.hmrClients = Math.max(0, s.hmrClients - 1); });
  return vite;
}

function startUi(p: Product, trigger: string): Promise<ViteDevServer> {
  const s = state.get(p.id)!;
  if (!s.vite) {
    s.vite = logScope.run(p.id, async () => {
      const t0 = Date.now();
      // Background jobs belong to the product being opened, not to its API being
      // called by a sibling (Keywords reads /asa-api/integrations on every load).
      if (!s.started) {
        const mod = await loadApi(p).catch(() => null);
        if (mod?.start) { mod.start(); s.started = true; console.log('started (start() hook ran)'); }
      }
      const vite = await createProductVite(p);
      s.viteReady = vite;
      s.hmrClients = 0;
      console.log(`UI ready at ${p.base} in ${Date.now() - t0} ms (first request: ${trigger})`);
      return vite;
    });
    s.vite.catch(() => { s.vite = undefined; s.viteReady = undefined; });
  }
  return s.vite;
}

async function stopUi(p: Product, reason: string): Promise<void> {
  const s = state.get(p.id)!;
  const vite = s.viteReady;
  if (!vite) return;
  s.vite = undefined;
  s.viteReady = undefined;
  s.hmrClients = 0;
  await logScope.run(p.id, async () => {
    await vite.close().catch((e) => console.warn('vite close failed', e));
    console.log(`UI stopped (${reason})`);
  });
}

if (IDLE_MS > 0) {
  setInterval(() => {
    const now = Date.now();
    for (const p of PRODUCTS) {
      const s = state.get(p.id)!;
      if (s.viteReady && s.hmrClients === 0 && now - s.lastHit > IDLE_MS) void stopUi(p, `idle ${+(IDLE_MS / 60_000).toFixed(2)} min`);
    }
  }, 60_000).unref();
}

// ─── Friendly pages (same look as the old "not running" page) ──────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function errorPage(label: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label} — failed to start</title>
<style>
  :root { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; color: #25252a; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f8; }
  .card { max-width: 520px; padding: 40px 44px; border-radius: 22px; background: #fff; border: 1px solid #e8e8eb; box-shadow: 0 24px 60px rgba(18,18,24,.10); text-align: center; }
  .mark { width: 52px; height: 52px; margin: 0 auto 18px; border-radius: 15px; display: grid; place-items: center; color: #fff; font-size: 24px; font-weight: 600; background: linear-gradient(145deg, #675cff, #493ed8); box-shadow: 0 8px 20px rgba(81,70,235,.28); }
  h1 { margin: 0 0 8px; font-size: 19px; font-weight: 600; letter-spacing: -.02em; }
  p { margin: 0 0 6px; color: #85858c; font-size: 13.5px; line-height: 1.55; }
  pre { text-align: left; white-space: pre-wrap; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; background: #f4f4f5; border: 1px solid #e8e8eb; border-radius: 9px; padding: 10px 12px; color: #4e4e54; margin: 14px 0 20px; max-height: 240px; overflow: auto; }
  a { display: inline-block; height: 40px; line-height: 40px; padding: 0 20px; border-radius: 12px; background: #5146eb; color: #fff; text-decoration: none; font-weight: 600; font-size: 13px; }
  a:hover { filter: brightness(1.06); }
  small { display: block; margin-top: 16px; color: #b0b0b6; font-size: 11px; }
</style>
</head>
<body>
  <main class="card">
    <div class="mark">zZ</div>
    <h1>${label} didn't start</h1>
    <p>The studio gateway couldn't activate this product. Reload to retry; details are in the <code>npm run dev</code> log.</p>
    <pre>${escapeHtml(detail)}</pre>
    <a href="/">← Back to Keywords</a>
    <small>Studio · gateway</small>
  </main>
</body>
</html>`;
}

function fail(req: IncomingMessage, res: ServerResponse, label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${label} request failed:`, err);
  if (res.headersSent) { res.destroy(); return; }
  if (String(req.headers.accept ?? '').includes('text/html')) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage(label, message));
  } else {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `${label}: ${message}` }));
  }
}

function notFound(res: ServerResponse): void {
  if (res.headersSent) return;
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

// ─── Request routing ───────────────────────────────────────────────────────────
const inappStatic = express.static(join(REPO, 'aso-inapp'), { index: 'index.html' });

function statusJson() {
  return PRODUCTS.map((p) => {
    const s = state.get(p.id)!;
    return {
      id: p.id,
      api: Boolean(s.api),
      backgroundJobs: s.started,
      ui: Boolean(s.viteReady),
      hmrClients: s.hmrClients,
      lastHitSecAgo: s.lastHit ? Math.round((Date.now() - s.lastHit) / 1000) : null,
    };
  });
}

/** GET a JSON endpoint of this gateway in-process via loopback (short timeout). */
async function selfJson(path: string): Promise<unknown> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : { error: `HTTP ${r.status}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Keywords request budgets + nightly schedule; Ads popularity queue only when
 * the Ads API is already loaded (the status page never activates Ads). */
async function jobsJson() {
  const ads = state.get('ads')!;
  const [gates, schedule, popularity] = await Promise.all([
    selfJson('/api/gate/status'),
    selfJson('/api/schedule?brief=1'),
    ads.api ? selfJson('/asa-api/keyword-popularity/status') : Promise.resolve(null),
  ]);
  return {
    keywords: { gates: (gates as { gates?: unknown })?.gates ?? gates, schedule },
    ads: { popularity: popularity ?? { inactive: true, note: 'Ads API not loaded — open /asa/ to activate' } },
  };
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const search = q === -1 ? '' : url.slice(q);

  if (path === '/__studio/status') {
    void jobsJson().then((jobs) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ port: PORT, idleMin: IDLE_MS / 60_000, products: statusJson(), jobs }, null, 2));
    });
    return;
  }

  // /asa → /asa/ etc. (Vite would otherwise answer "did you mean /asa/").
  if (path === '/asa' || path === '/studio' || path === '/video' || path === '/inapp') {
    res.writeHead(302, { Location: `${path}/${search}` });
    res.end();
    return;
  }

  // In-App: static preview (index.html + events.json + media/).
  if (matchesPrefix(path, '/inapp')) {
    req.url = url.slice('/inapp'.length) || '/';
    logScope.run('inapp', () => inappStatic(req as never, res as never, () => notFound(res)));
    return;
  }

  // APIs.
  for (const p of PRODUCTS) {
    const route = p.api.find((r) => matchesPrefix(path, r.prefix));
    if (!route) continue;
    loadApi(p).then(
      (mod) => {
        req.url = route.to + path.slice(route.prefix.length) + search;
        logScope.run(p.id, () => mod.app(req, res, (err?: unknown) => (err ? fail(req, res, `${p.label} API`, err) : notFound(res))));
      },
      (err) => fail(req, res, `${p.label} API`, err),
    );
    return;
  }

  // UIs (Keywords '/' matches everything left).
  const ui = PRODUCTS.find((p) => p.base === '/' || path.startsWith(p.base))!;
  const s = state.get(ui.id)!;
  // Browsers probe /favicon.ico from every product page — don't boot Keywords for it.
  if (path === '/favicon.ico' && !s.viteReady) {
    res.writeHead(204);
    res.end();
    return;
  }
  s.lastHit = Date.now();
  startUi(ui, path).then(
    (vite) => logScope.run(ui.id, () => vite.middlewares(req, res, (err?: unknown) => (err ? fail(req, res, ui.label, err) : notFound(res)))),
    (err) => fail(req, res, ui.label, err),
  );
}

// An HMR socket for a UI that isn't running (fresh gateway, or idle-stopped):
// start it and drop the socket — the Vite client pings, reconnects and reloads.
function onUpgrade(req: IncomingMessage, socket: Duplex): void {
  const path = (req.url ?? '/').split('?')[0];
  const ui = PRODUCTS.find((p) => path === `${p.base}__hmr`);
  if (!ui) { socket.destroy(); return; }
  const s = state.get(ui.id)!;
  s.lastHit = Date.now();
  if (!s.viteReady) {
    void startUi(ui, path).catch(() => {});
    socket.destroy();
  }
  // Otherwise that product's Vite upgrade listener takes it.
}

httpServer = http.createServer(handle);
httpServer.on('upgrade', onUpgrade);
httpServer.listen(PORT, HOST, () => {
  console.log(`ASO Studio on http://localhost:${PORT}  (Keywords /, Ads /asa/, Screenshots /studio/, Video /video/, In-App /inapp/) — products start on first visit`);
});

function shutdown(): void {
  console.log('shutting down');
  const closing = PRODUCTS.map((p) => state.get(p.id)!.viteReady?.close().catch(() => {}));
  void Promise.all(closing).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep one product's crash from taking the whole studio down.
process.on('unhandledRejection', (reason) => console.error('unhandled rejection:', reason));
