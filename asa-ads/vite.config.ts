import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/asa/",
  server: {
    port: 5193,
    proxy: {
      "/api": "http://localhost:5194",
      "/sse": {
        target: "http://localhost:5194",
        changeOrigin: true,
        ws: false,
      },
      // Standalone dev on :5193 with base "/asa/": api.ts resolves BASE_URL to
      // "/asa/" and routes calls to /asa-api/* and /asa-sse (the umbrella-proxy
      // convention). Map them back to the local API so direct :5193/asa works.
      "/asa-api": {
        target: "http://localhost:5194",
        rewrite: (p) => p.replace(/^\/asa-api/, "/api"),
      },
      "/asa-sse": {
        target: "http://localhost:5194",
        changeOrigin: true,
        ws: false,
        rewrite: (p) => p.replace(/^\/asa-sse/, "/sse"),
      },
    },
  },
});
