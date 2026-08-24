import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/renderer/src/**/*.unit.test.ts"],
  },
});
