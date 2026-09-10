import { describe, expect, it, vi } from "vitest";

import {
  requestInventoryItems,
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
});
