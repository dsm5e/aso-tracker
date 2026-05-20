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
    },
  },
});
