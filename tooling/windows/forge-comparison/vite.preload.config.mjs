import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: ".vite/preload",
    rollupOptions: {
      output: {
        entryFileNames: "index.cjs",
      },
    },
  },
});
