import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on IPv4 (127.0.0.1) too — some browsers resolve `localhost` to
    // IPv4 first, and binding IPv6-only makes the site "unreachable".
    host: true,
    // Proxy API calls to the backend (bound on IPv4 0.0.0.0:4000).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
