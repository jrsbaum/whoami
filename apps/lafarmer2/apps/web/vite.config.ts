import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3338",
      "/healthz": "http://127.0.0.1:3338",
      "/ws": { target: "ws://127.0.0.1:3338", ws: true }
    }
  },
  resolve: {
    alias: {
      "@lafarmer2/content": resolve(__dirname, "../../packages/content/src/index.ts")
    }
  }
});
