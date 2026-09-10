import { describe, expect, it, vi } from "vitest";

import {
  INVENTORY_COLUMN_FIELDS,
  type InventoryReviewPreferencesUpdateRequest,
} from "@breev/contracts/local-rest";

import { createInventoryPreferenceSaveQueue } from "./inventory-preferences-save";

const columns = INVENTORY_COLUMN_FIELDS.map((field) => ({
  field,
  visible: true,
}));

describe("inventory preference save queue", () => {
  it("serializes saves and uses each successful revision for the next save", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSaveStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const requests: Array<{
      readonly expectedRevision: string;
      readonly visible: boolean;
    }> = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    const save = vi.fn(
      async (request: InventoryReviewPreferencesUpdateRequest) => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        const callNumber = requests.length + 1;
        requests.push({
          expectedRevision: request.expectedRevision,
          visible:
            request.columns.find((column) => column.field === "value")
              ?.visible ?? true,
        });
        if (callNumber === 1) await firstSaveStarted;
        inFlight -= 1;
        return {
          columns: request.columns,
          revision: String(callNumber + 1),
        };
      },
    );
    const revision = { current: "1" };
    const queue = createInventoryPreferenceSaveQueue(
      revision,
      save,
      async () => ({ columns, revision: "5" }),
      vi.fn(),
      () => "0198e7ce-7685-7000-8000-000000000001",
    );

    const hiddenColumns = columns.map((column) =>
      column.field === "value" ? { ...column, visible: false } : column,
    );
    const first = queue.enqueue(hiddenColumns);
    const shownColumns = hiddenColumns.map((column) =>
      column.field === "value" ? { ...column, visible: true } : column,
    );
    const second = queue.enqueue(shownColumns);

    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(maximumInFlight).toBe(1);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(requests).toEqual([
      { expectedRevision: "1", visible: false },
      { expectedRevision: "2", visible: true },
    ]);
    expect(revision.current).toBe("3");
  });

  it("reconciles a failed save before the next queued request", async () => {
    const requests: string[] = [];
    const reconciled = vi.fn();
    const save = vi.fn(
      async (request: InventoryReviewPreferencesUpdateRequest) => {
        requests.push(request.expectedRevision);
        if (requests.length === 1) throw new Error("offline");
        return { columns: request.columns, revision: "2" };
      },
    );
    const queue = createInventoryPreferenceSaveQueue(
      { current: "1" },
      save,
      async () => ({ columns, revision: "5" }),
      reconciled,
      () => "0198e7ce-7685-7000-8000-000000000001",
    );

    const first = queue.enqueue(columns);
    const second = queue.enqueue(columns);
    await expect(first).rejects.toThrow("offline");
    await expect(second).resolves.toMatchObject({ revision: "2" });
    expect(requests).toEqual(["1", "5"]);
    expect(reconciled).toHaveBeenCalledWith({ columns, revision: "5" });
  });
});
