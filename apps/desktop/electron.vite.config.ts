import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import path from "node:path";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ["zod"],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ["zod"],
      },
      rollupOptions: {
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src/renderer/src"),
      },
    },
  },
});
