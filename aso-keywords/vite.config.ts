import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    },
  },
});
