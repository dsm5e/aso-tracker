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
    },
  },
});
