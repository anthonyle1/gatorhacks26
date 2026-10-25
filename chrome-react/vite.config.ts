
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { copyFileSync, mkdirSync } from "node:fs";

export default defineConfig({
  plugins: [react(), { name: "local-mp3-encoder", closeBundle() {
    mkdirSync(resolve(import.meta.dirname, "dist/vendor"), { recursive: true });
    copyFileSync(resolve(import.meta.dirname, "node_modules/@breezystack/lamejs/dist/lamejs.iife.js"), resolve(import.meta.dirname, "dist/vendor/lamejs.js"));
    copyFileSync(resolve(import.meta.dirname, "node_modules/@breezystack/lamejs/LICENSE"), resolve(import.meta.dirname, "dist/vendor/LAME-LICENSE"));
  } }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html")
      }
    }
  }
});
