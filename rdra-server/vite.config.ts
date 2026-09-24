import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = `http://127.0.0.1:${process.env.RDRA_PORT ?? "4178"}`;

export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    proxy: {
      "/api": target,
      "/ws": { target: target.replace("http", "ws"), ws: true },
    },
  },
});
