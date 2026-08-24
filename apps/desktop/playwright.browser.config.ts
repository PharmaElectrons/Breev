import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  outputDir: "../../test-results/desktop-browser",
  reporter: "line",
  testDir: "test/browser",
  timeout: 120_000,
  use: {
    viewport: { height: 768, width: 1_024 },
  },
  workers: 1,
});
