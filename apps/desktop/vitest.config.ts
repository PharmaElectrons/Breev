import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "*.unit.test.ts",
      "src/**/*.unit.test.ts",
      "windows/**/*.unit.test.ts",
    ],
  },
});
