import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(
        import.meta.dirname,
        "../../../apps/desktop/src/main/index.ts",
      ),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: ".vite/main",
  },
});
