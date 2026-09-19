import { defineConfig } from "@playwright/test";

/**
 * The milestone 2 acceptance harness.
 *
 * It drives the packaged `Breev.exe` over CDP against a real `local-api`
 * process and a real PostgreSQL container, so one locale/theme pass is a long
 * sequence of real work: the per-test timeout is sized for that. The assertion
 * timeout stays at the 10 s the browser and smoke suites use, and there are no
 * retries — an acceptance verdict that needed a second attempt is not a
 * verdict.
 */
export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  // Gives every worker of one run the same run identifier, so a run that
  // contains a failure — and therefore spans several workers — still writes one
  // complete transcript. See test/acceptance/global-setup.ts.
  globalSetup: "./test/acceptance/global-setup.ts",
  outputDir: "../../test-results/desktop-acceptance",
  reporter: "line",
  retries: 0,
  testDir: "test/acceptance",
  testMatch: "**/*.acceptance.test.ts",
  timeout: 900_000,
  workers: 1,
});
