import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "../../../apps/desktop/src/renderer"),
  build: {
    emptyOutDir: false,
    outDir: path.resolve(import.meta.dirname, ".vite/renderer"),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    // Forge's Vite preset preserves pnpm symlink paths and then misses scheduler
    // beside React. Resolve the real package locations for the renderer bundle.
    preserveSymlinks: false,
    alias: {
      "@": path.resolve(
        import.meta.dirname,
        "../../../apps/desktop/src/renderer/src",
      ),
    },
  },
});
