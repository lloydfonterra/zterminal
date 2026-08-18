import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws/public": { target: "ws://localhost:8787", ws: true },
      "/health": { target: "http://localhost:8787" },
      "/icon": { target: "http://localhost:8787" },
      "/coin": { target: "http://localhost:8787" },
    },
  },
});
