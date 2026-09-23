import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/renderer/src"),
    },
  },
  test: {
    include: [
      "*.unit.test.ts",
      "src/**/*.unit.test.ts",
      "windows/**/*.unit.test.ts",
    ],
  },
});
