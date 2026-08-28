import { describe, expect, it } from "vitest";

import {
  isTransientPostingFailure,
  runWholeCommandWithRetry,
} from "./command-retry.js";

function databaseError(code: string): Error & { code: string } {
  return Object.assign(new Error(`database error ${code}`), { code });
}

function recordingOptions() {
  const delays: number[] = [];
  return {
    delays,
    options: {
      baseDelayMs: 10,
      maxDelayMs: 40,
      random: () => 1,
      sleep: async (milliseconds: number) => {
        delays.push(milliseconds);
        await Promise.resolve();
      },
    },
  };
}

describe("whole-command retry classification", () => {
  it.each([
    { label: "a serialization failure", code: "40001" },
    { label: "a detected deadlock", code: "40P01" },
  ])("treats $label as transient", ({ code }) => {
    expect(isTransientPostingFailure(databaseError(code))).toBe(true);
  });

  it.each([
    {
      label: "a committed business denial",
      error: new Error("version-conflict"),
    },
    {
      label: "an idempotency conflict",
      error: new Error("idempotency-conflict"),
    },
    { label: "a unique violation", error: databaseError("23505") },
    { label: "an immutability trigger", error: databaseError("55000") },
    { label: "a permission denial", error: databaseError("42501") },
    { label: "a lock timeout", error: databaseError("55P03") },
    { label: "a non-error value", error: "40001" },
    { label: "a null", error: null },
    {
      label: "a numeric code",
      error: Object.assign(new Error("x"), { code: 40001 }),
    },
  ])("treats $label as permanent", ({ error }) => {
    expect(isTransientPostingFailure(error)).toBe(false);
  });
});

describe("running a whole posting command with retry", () => {
  it("runs the command once when it succeeds", async () => {
    let attempts = 0;

    await expect(
      runWholeCommandWithRetry(async () => {
        attempts += 1;
        return await Promise.resolve("posted");
      }),
    ).resolves.toBe("posted");
    expect(attempts).toBe(1);
  });

  it("reruns the whole command after a deadlock and returns the later result", async () => {
    const { delays, options } = recordingOptions();
    let attempts = 0;

    const result = await runWholeCommandWithRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw databaseError("40P01");
      }
      return await Promise.resolve(attempts);
    }, options);

    expect(result).toBe(2);
    expect(attempts).toBe(2);
    expect(delays).toEqual([10]);
  });

  it("gives up after three attempts and rethrows the last abort", async () => {
    const { delays, options } = recordingOptions();
    let attempts = 0;

    await expect(
      runWholeCommandWithRetry(async () => {
        attempts += 1;
        await Promise.resolve();
        throw databaseError("40001");
      }, options),
    ).rejects.toMatchObject({ code: "40001" });
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  it.each([
    { label: "a committed denial", error: new Error("version-conflict") },
    { label: "an arbitrary database error", error: databaseError("23505") },
  ])("never reruns the command after $label", async ({ error }) => {
    const { delays, options } = recordingOptions();
    let attempts = 0;

    await expect(
      runWholeCommandWithRetry(async () => {
        attempts += 1;
        await Promise.resolve();
        throw error;
      }, options),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("bounds the backoff window and jitters inside its upper half", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await expect(
      runWholeCommandWithRetry(
        async () => {
          attempts += 1;
          await Promise.resolve();
          throw databaseError("40P01");
        },
        {
          attempts: 6,
          baseDelayMs: 10,
          maxDelayMs: 40,
          random: () => 0,
          sleep: async (milliseconds: number) => {
            delays.push(milliseconds);
            await Promise.resolve();
          },
        },
      ),
    ).rejects.toMatchObject({ code: "40P01" });
    expect(attempts).toBe(6);
    expect(delays).toEqual([5, 10, 20, 20, 20]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(40);
  });

  it("refuses a retry budget below one attempt", async () => {
    await expect(
      runWholeCommandWithRetry(() => Promise.resolve(1), { attempts: 0 }),
    ).rejects.toThrow("at least one attempt");
  });

  it("runs the command exactly once when only one attempt is allowed", async () => {
    let attempts = 0;

    await expect(
      runWholeCommandWithRetry(
        async () => {
          attempts += 1;
          await Promise.resolve();
          throw databaseError("40001");
        },
        { attempts: 1 },
      ),
    ).rejects.toMatchObject({ code: "40001" });
    expect(attempts).toBe(1);
  });
});
