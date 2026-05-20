import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Accept-Encoding', 'identity');
          });
          proxy.on('proxyRes', (proxyRes) => {
            // Prevent gzip/deflate buffering for SSE
            delete proxyRes.headers['content-encoding'];
          });
        },
      },
      // Screenshots app reverse-proxied so both apps live under one origin (5173).
      // /studio        → screenshots vite dev server  (HTML, JS, CSS, HMR over WS)
      // /studio-api    → screenshots express server   (rewritten to /api/* upstream)
      '/studio-api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/studio-api/, '/api'),
      },
      '/studio': {
        target: 'http://localhost:5180',
        changeOrigin: true,
        ws: true, // HMR socket
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
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Accept-Encoding', 'identity');
          });
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['content-encoding'];
          });
        },
      },
      '/video-output': {
        target: 'http://localhost:5191',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/video-output/, '/output'),
      },
      // Output files referenced by absolute /output/... URLs (returned by graph
      // run results, library list, etc) — pass straight through to video backend.
      // Safe because keywords/screenshots don't serve /output themselves.
      '/output': {
        target: 'http://localhost:5191',
        changeOrigin: true,
      },
      // Repo-shipped influencer preview images (aso-video/influencer/<name>.jpg).
      '/influencer': {
        target: 'http://localhost:5191',
        changeOrigin: true,
      },
      '/video': {
        target: 'http://localhost:5190',
        changeOrigin: true,
        ws: true, // HMR socket
      },
      // ASA Ads app reverse-proxied so all 4 tools live under one origin (5173).
      // /asa          → asa-ads vite dev server  (HTML, JS, CSS, HMR over WS)
      // /asa-api      → asa-ads express server   (rewritten to /api/* upstream)
      // /asa-sse      → asa-ads SSE stream
      '/asa-api': {
        target: 'http://localhost:5194',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/asa-api/, '/api'),
      },
      '/asa-sse': {
        target: 'http://localhost:5194',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/asa-sse/, '/sse'),
        selfHandleResponse: false,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('Accept-Encoding', 'identity'));
          proxy.on('proxyRes', (proxyRes) => { delete proxyRes.headers['content-encoding']; });
        },
      },
      '/asa': {
        target: 'http://localhost:5193',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
