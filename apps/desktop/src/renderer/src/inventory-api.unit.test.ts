import { describe, expect, it, vi } from "vitest";

import {
  countCommandAttempt,
  listBatches,
  previewAllocation,
  readBatchSafetyReview,
  readBatchSafetyStatus,
  requestInventoryItems,
  triggerBatchSafetyRun,
  updateInventoryReviewPreferences,
} from "./inventory-api";

describe("inventory API client", () => {
  it("validates the inventory response at the REST seam", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ fields: { valuation: "denied" }, items: [] }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      requestInventoryItems("http://127.0.0.1:4311"),
    ).resolves.toEqual({
      fields: { valuation: "denied" },
      items: [],
    });
    vi.unstubAllGlobals();
  });

  it("reuses a count command key for the same body and rotates it when the body changes", () => {
    const createKey = vi
      .fn<() => string>()
      .mockReturnValueOnce("count-first")
      .mockReturnValueOnce("count-second");
    const first = countCommandAttempt(null, "same-count", createKey);
    const retry = countCommandAttempt(first, "same-count", createKey);
    const changed = countCommandAttempt(first, "changed-count", createKey);

    expect(retry).toBe(first);
    expect(changed).toEqual({
      fingerprint: "changed-count",
      idempotencyKey: "count-second",
    });
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("sends CSRF-protected preference commands", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            columns: [
              { field: "item", visible: true },
              { field: "balance", visible: true },
              { field: "value", visible: true },
              { field: "averageCost", visible: true },
              { field: "batches", visible: true },
              { field: "expiry", visible: true },
              { field: "levels", visible: true },
              { field: "reorderPoint", visible: true },
              { field: "consumptionRate", visible: true },
              { field: "risk", visible: true },
            ],
            revision: "2",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await updateInventoryReviewPreferences("http://127.0.0.1:4311", {
      columns: [
        { field: "item", visible: true },
        { field: "balance", visible: true },
        { field: "value", visible: true },
        { field: "averageCost", visible: true },
        { field: "batches", visible: true },
        { field: "expiry", visible: true },
        { field: "levels", visible: true },
        { field: "reorderPoint", visible: true },
        { field: "consumptionRate", visible: true },
        { field: "risk", visible: true },
      ],
      expectedRevision: "1",
      idempotencyKey: "0198e7ce-7685-7000-8000-000000000001",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: "PUT" }),
    );
    vi.unstubAllGlobals();
  });

  it("consumes the batch safety routes with their distinct success statuses", async () => {
    const status = {
      businessTimeZone: "Asia/Baghdad",
      jobRuntime: "available" as const,
      lastCompletedBusinessDate: null,
      missedBusinessDates: [],
      scheduled: true,
      state: "never-run" as const,
      thresholds: { classes: [], pendingGate: "G-02" as const },
      todayBusinessDate: "2026-09-11",
    };
    const fetchMock = vi.fn(async (input: URL, init?: RequestInit) => {
      const path = input.pathname;
      if (path.endsWith("/batches")) {
        return new Response(
          JSON.stringify({ batches: [], businessDate: "2026-09-11" }),
          { status: 200 },
        );
      }
      if (path.endsWith("/allocation-previews")) {
        return new Response(
          JSON.stringify({
            allocations: [],
            blocked: [],
            businessDate: "2026-09-11",
            shortfalls: [],
          }),
          { status: 200 },
        );
      }
      if (path.endsWith("/runs")) {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify(status), { status: 202 });
      }
      if (path.endsWith("/review")) {
        return new Response(
          JSON.stringify({
            businessDate: "2026-09-11",
            fields: { valuation: "denied" },
            month: "2026-09",
            rows: [],
            runs: { completedBusinessDates: [], missedBusinessDates: [] },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(status), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listBatches(
        "http://127.0.0.1:4311",
        "0198e7ce-7685-7000-8000-000000000001",
      ),
    ).resolves.toEqual({ batches: [], businessDate: "2026-09-11" });
    await expect(
      previewAllocation("http://127.0.0.1:4311", {
        lines: [
          {
            productId: "0198e7ce-7685-7000-8000-000000000001",
            quantity: "2",
          },
        ],
      }),
    ).resolves.toMatchObject({ allocations: [], blocked: [] });
    await expect(
      triggerBatchSafetyRun("http://127.0.0.1:4311"),
    ).resolves.toEqual(status);
    await expect(
      readBatchSafetyStatus("http://127.0.0.1:4311"),
    ).resolves.toEqual(status);
    await expect(
      readBatchSafetyReview("http://127.0.0.1:4311", "2026-09"),
    ).resolves.toMatchObject({ month: "2026-09", rows: [] });
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
