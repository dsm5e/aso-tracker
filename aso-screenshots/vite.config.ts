import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served under /studio/ when reached through the unified Keywords origin (5173).
  // Direct access to localhost:5180/studio/ also works for dev.
  base: '/studio/',
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      // Direct (port 5180) usage still hits its own /api locally.
      '/api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
      },
      // BASE_URL='/studio/' makes API_BASE = '/studio-api' on the client.
      // Mirror the prefix-strip the Keywords-origin proxy does so direct dev works too.
      '/studio-api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/studio-api/, '/api'),
      },
    },
  },
});
