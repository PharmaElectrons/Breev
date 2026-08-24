import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  outputDir: "../../test-results/desktop",
  reporter: "line",
  testDir: "test",
  timeout: 120_000,
  workers: 1,
});
