import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["src/**/*.integration.test.ts", "test/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
