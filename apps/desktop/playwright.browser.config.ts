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
    launchOptions: {
      args: ["--host-resolver-rules=MAP rebound.test 127.0.0.1"],
    },
    viewport: { height: 768, width: 1_024 },
  },
  workers: 1,
});
