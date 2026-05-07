import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/video/',
  server: {
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5191',
        changeOrigin: true,
      },
      '/output': {
        target: 'http://localhost:5191',
        changeOrigin: true,
      },
      // Repo-shipped influencer preview images.
      '/influencer': {
        target: 'http://localhost:5191',
        changeOrigin: true,
      },
      // Settings modal calls /studio-api/settings/keys — proxied to the
      // screenshots backend (single key vault at ~/.aso-studio/keys.json).
      '/studio-api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/studio-api/, '/api'),
      },
      '/video-api': {
        target: 'http://localhost:5191',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/video-api/, '/api'),
      },
    },
  },
});
