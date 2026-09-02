import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import { PLATFORM_CRYPTO_PROVIDER, selectKeyStorageProvider } from "./cng-addon.js";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

beforeEach(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "win32",
  });
  childProcess.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    setTimeout(() => callback(null, "AVAILABLE\n", ""), 150);
    return undefined;
  });
  childProcess.execFileSync.mockImplementation(() => {
    const deadline = performance.now() + 150;
    while (performance.now() < deadline) {
      // Reproduce the event-loop stall caused by a synchronous provider probe.
    }
    return "AVAILABLE\n";
  });
});

afterEach(() => {
  if (originalPlatform !== undefined) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
  vi.clearAllMocks();
});

it("keeps the event loop free while probing Windows key storage", async () => {
  const startedAt = performance.now();
  const nextTimer = new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - startedAt), 0);
  });

  const selection = selectKeyStorageProvider();

  await expect(nextTimer).resolves.toBeLessThan(75);
  await expect(selection).resolves.toEqual({
    assuranceLevel: "platform-tpm",
    providerName: PLATFORM_CRYPTO_PROVIDER,
  });
  expect(childProcess.execFileSync).not.toHaveBeenCalled();
});
