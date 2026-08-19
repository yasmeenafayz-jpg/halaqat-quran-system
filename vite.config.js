import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: false
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
