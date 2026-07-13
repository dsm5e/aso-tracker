import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Sub-apps mount under a base path (/asa/, /studio/, /video/). Visiting without the
// trailing slash trips Vite's "did you mean /asa/" error. Redirect once so users
// who click /asa land on /asa/ cleanly.
const subpathRedirect = {
  name: 'subpath-trailing-slash-redirect',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: () => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/asa' || req.url === '/studio' || req.url === '/video') {
        res.statusCode = 302;
        res.setHeader('Location', `${req.url}/`);
        res.end();
        return;
      }
      next();
    });
  },
};

interface StudioTarget {
  label: string;
  port: number;
}

// When a sibling studio's dev server isn't running, the proxy would otherwise
// surface a bare 502. Serve a friendly page (or JSON for XHR) instead.
function offlinePage({ label, port }: StudioTarget) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label} — not running</title>
<style>
  :root { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; color: #25252a; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f8; }
  .card { max-width: 460px; padding: 40px 44px; border-radius: 22px; background: #fff; border: 1px solid #e8e8eb; box-shadow: 0 24px 60px rgba(18,18,24,.10); text-align: center; }
  .mark { width: 52px; height: 52px; margin: 0 auto 18px; border-radius: 15px; display: grid; place-items: center; color: #fff; font-size: 24px; font-weight: 600; background: linear-gradient(145deg, #675cff, #493ed8); box-shadow: 0 8px 20px rgba(81,70,235,.28); }
  h1 { margin: 0 0 8px; font-size: 19px; font-weight: 600; letter-spacing: -.02em; }
  p { margin: 0 0 6px; color: #85858c; font-size: 13.5px; line-height: 1.55; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; background: #f4f4f5; border: 1px solid #e8e8eb; border-radius: 7px; padding: 3px 7px; color: #4e4e54; }
  .cmd { display: inline-block; margin: 14px 0 20px; }
  a { display: inline-block; height: 40px; line-height: 40px; padding: 0 20px; border-radius: 12px; background: #5146eb; color: #fff; text-decoration: none; font-weight: 600; font-size: 13px; }
  a:hover { filter: brightness(1.06); }
  small { display: block; margin-top: 16px; color: #b0b0b6; font-size: 11px; }
</style>
</head>
<body>
  <main class="card">
    <div class="mark">zZ</div>
    <h1>${label} is not running</h1>
    <p>This studio's dev server (port ${port}) didn't answer. Start the whole workspace to enable all tools:</p>
    <code class="cmd">cd ~/Developer/MYPROJECT/aso-studio &amp;&amp; npm run dev</code>
    <br>
    <a href="/">← Back to Keywords</a>
    <small>ASO Studio · dev proxy</small>
  </main>
</body>
</html>`;
}

type ProxyLike = {
  on(event: 'error', cb: (err: Error, req: IncomingMessage, res: ServerResponse | import('node:net').Socket) => void): void;
  on(event: string, cb: (...args: never[]) => void): void;
};

function offlineHandler(target: StudioTarget) {
  return (_err: Error, req: IncomingMessage, res: ServerResponse | import('node:net').Socket) => {
    // WebSocket upgrade errors hand us a raw socket — nothing to render into.
    if (!('writeHead' in res) || res.headersSent || res.writableEnded) return;
    const wantsHtml = String(req.headers?.accept ?? '').includes('text/html');
    if (wantsHtml) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(offlinePage(target));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `${target.label} dev server is not running on port ${target.port}` }));
    }
  };
}

/** configure() hook: friendly offline responses, optionally with SSE pass-through headers. */
function withOffline(target: StudioTarget, { sse = false } = {}) {
  return (proxy: ProxyLike) => {
    proxy.on('error', offlineHandler(target));
    if (sse) {
      proxy.on('proxyReq', ((proxyReq: import('node:http').ClientRequest) => {
        proxyReq.setHeader('Accept-Encoding', 'identity');
      }) as never);
      proxy.on('proxyRes', ((proxyRes: IncomingMessage) => {
        // Prevent gzip/deflate buffering for SSE
        delete proxyRes.headers['content-encoding'];
      }) as never);
    }
  };
}

const KEYWORDS_API: StudioTarget = { label: 'Keywords API', port: 5174 };
const SCREENSHOTS: StudioTarget = { label: 'Screenshots studio', port: 5180 };
const SCREENSHOTS_API: StudioTarget = { label: 'Screenshots API', port: 5181 };
const VIDEO: StudioTarget = { label: 'Video studio', port: 5190 };
const VIDEO_API: StudioTarget = { label: 'Video API', port: 5191 };
const ASA: StudioTarget = { label: 'ASA Ads studio', port: 5193 };
const ASA_API: StudioTarget = { label: 'ASA Ads API', port: 5194 };

export default defineConfig({
  plugins: [react(), subpathRedirect],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        // SSE support — don't buffer or time out long-lived streams
        selfHandleResponse: false,
        timeout: 0,
        proxyTimeout: 0,
        ws: true,
        configure: withOffline(KEYWORDS_API, { sse: true }),
      },
      // Screenshots app reverse-proxied so both apps live under one origin (5173).
      // /studio        → screenshots vite dev server  (HTML, JS, CSS, HMR over WS)
      // /studio-api    → screenshots express server   (rewritten to /api/* upstream)
      '/studio-api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/studio-api/, '/api'),
        configure: withOffline(SCREENSHOTS_API),
      },
      '/studio': {
        target: 'http://localhost:5180',
        changeOrigin: true,
        ws: true, // HMR socket
        configure: withOffline(SCREENSHOTS),
      },
      // Video app reverse-proxied so all 3 apps live under one origin (5173).
      // /video         → video vite dev server   (HTML, JS, CSS, HMR over WS)
      // /video-api     → video express server    (rewritten to /api/* upstream)
      // /video-output  → video express static    (generated mp4/jpg files)
      '/video-api': {
        target: 'http://localhost:5191',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/video-api/, '/api'),
        // SSE channel /api/graph/stream — don't buffer
        selfHandleResponse: false,
        timeout: 0,
        proxyTimeout: 0,
        ws: true,
        configure: withOffline(VIDEO_API, { sse: true }),
      },
      '/video-output': {
        target: 'http://localhost:5191',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/video-output/, '/output'),
        configure: withOffline(VIDEO_API),
      },
      // Output files referenced by absolute /output/... URLs (returned by graph
      // run results, library list, etc) — pass straight through to video backend.
      // Safe because keywords/screenshots don't serve /output themselves.
      '/output': {
        target: 'http://localhost:5191',
        changeOrigin: true,
        configure: withOffline(VIDEO_API),
      },
      // Repo-shipped influencer preview images (aso-video/influencer/<name>.jpg).
      '/influencer': {
        target: 'http://localhost:5191',
        changeOrigin: true,
        configure: withOffline(VIDEO_API),
      },
      '/video': {
        target: 'http://localhost:5190',
        changeOrigin: true,
        ws: true, // HMR socket
        configure: withOffline(VIDEO),
      },
      // ASA Ads app reverse-proxied so all 4 tools live under one origin (5173).
      // /asa          → asa-ads vite dev server  (HTML, JS, CSS, HMR over WS)
      // /asa-api      → asa-ads express server   (rewritten to /api/* upstream)
      // /asa-sse      → asa-ads SSE stream
      '/asa-api': {
        target: 'http://localhost:5194',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/asa-api/, '/api'),
        configure: withOffline(ASA_API),
      },
      '/asa-sse': {
        target: 'http://localhost:5194',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/asa-sse/, '/sse'),
        selfHandleResponse: false,
        timeout: 0,
        proxyTimeout: 0,
        configure: withOffline(ASA_API, { sse: true }),
      },
      '/asa': {
        target: 'http://localhost:5193',
        changeOrigin: true,
        ws: true,
        configure: withOffline(ASA),
      },
    },
  },
});
