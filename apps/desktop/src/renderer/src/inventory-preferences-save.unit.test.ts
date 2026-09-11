import { describe, expect, it, vi } from "vitest";

import {
  INVENTORY_COLUMN_FIELDS,
  type InventoryReviewPreferences,
  type InventoryReviewPreferencesUpdateRequest,
} from "@breev/contracts/local-rest";

import { createInventoryPreferenceSaveQueue } from "./inventory-preferences-save";

const columns = INVENTORY_COLUMN_FIELDS.map((field) => ({
  field,
  visible: true,
}));

describe("inventory preference save queue", () => {
  it("serializes intents and ignores a superseded opposite response", async () => {
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
    const latestColumns = { current: columns };
    const screenPreferences = {
      current: { columns, revision: "1" } satisfies InventoryReviewPreferences,
    };
    const onPreferencesChanged = vi.fn((next: InventoryReviewPreferences) => {
      screenPreferences.current = next;
    });
    const queue = createInventoryPreferenceSaveQueue(
      revision,
      latestColumns,
      save,
      async () => ({ columns, revision: "5" }),
      onPreferencesChanged,
      () => "0198e7ce-7685-7000-8000-000000000001",
    );

    const first = queue.enqueue("value", false);
    const second = queue.enqueue("value", true);

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
    expect(latestColumns.current).toEqual(columns);
    expect(screenPreferences.current).toEqual({
      columns,
      revision: "3",
    });
    expect(onPreferencesChanged).toHaveBeenCalledTimes(1);
  });

  it("applies rapid intents for different columns to the freshest saved state", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSaveStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const requests: InventoryReviewPreferencesUpdateRequest[] = [];
    const save = vi.fn(
      async (request: InventoryReviewPreferencesUpdateRequest) => {
        requests.push(request);
        if (requests.length === 1) await firstSaveStarted;
        return {
          columns: request.columns,
          revision: String(requests.length + 1),
        };
      },
    );
    const revision = { current: "1" };
    const latestColumns = { current: columns };
    const screenPreferences = {
      current: { columns, revision: "1" } satisfies InventoryReviewPreferences,
    };
    const onPreferencesChanged = vi.fn((next: InventoryReviewPreferences) => {
      screenPreferences.current = next;
    });
    const queue = createInventoryPreferenceSaveQueue(
      revision,
      latestColumns,
      save,
      async () => ({ columns, revision: "5" }),
      onPreferencesChanged,
      () => "0198e7ce-7685-7000-8000-000000000001",
    );

    const first = queue.enqueue("value", false);
    const second = queue.enqueue("balance", false);

    await Promise.resolve();
    expect(requests).toHaveLength(1);
    releaseFirst?.();
    await Promise.all([first, second]);

    const valueHidden = columns.map((column) =>
      column.field === "value" ? { ...column, visible: false } : column,
    );
    const valueAndBalanceHidden = valueHidden.map((column) =>
      column.field === "balance" ? { ...column, visible: false } : column,
    );
    expect(
      requests.map(({ columns: requestedColumns }) => requestedColumns),
    ).toEqual([valueHidden, valueAndBalanceHidden]);
    expect(latestColumns.current).toEqual(valueAndBalanceHidden);
    expect(screenPreferences.current).toEqual({
      columns: valueAndBalanceHidden,
      revision: "3",
    });
    expect(onPreferencesChanged).toHaveBeenCalledTimes(1);
  });

  it("reconciles a failed save before the next queued request", async () => {
    const requests: InventoryReviewPreferencesUpdateRequest[] = [];
    const reconciledColumns = columns.map((column) =>
      column.field === "value" ? { ...column, visible: false } : column,
    );
    const save = vi.fn(
      async (request: InventoryReviewPreferencesUpdateRequest) => {
        requests.push(request);
        if (requests.length === 1) throw new Error("offline");
        return { columns: request.columns, revision: "2" };
      },
    );
    const latestColumns = { current: columns };
    const queue = createInventoryPreferenceSaveQueue(
      { current: "1" },
      latestColumns,
      save,
      async () => ({ columns: reconciledColumns, revision: "5" }),
      vi.fn(),
      () => "0198e7ce-7685-7000-8000-000000000001",
    );

    const first = queue.enqueue("value", true);
    const second = queue.enqueue("balance", false);
    await expect(first).rejects.toThrow("offline");
    await expect(second).resolves.toMatchObject({ revision: "2" });

    const reconciledWithBalanceHidden = reconciledColumns.map((column) =>
      column.field === "balance" ? { ...column, visible: false } : column,
    );
    expect(requests.map(({ expectedRevision }) => expectedRevision)).toEqual([
      "1",
      "5",
    ]);
    expect(requests[1]?.columns).toEqual(reconciledWithBalanceHidden);
    expect(latestColumns.current).toEqual(reconciledWithBalanceHidden);
  });

  it("reconciles a failed current save", async () => {
    const reconciledColumns = columns.map((column) =>
      column.field === "value" ? { ...column, visible: false } : column,
    );
    const latestColumns = { current: columns };
    const screenPreferences = {
      current: { columns, revision: "1" } satisfies InventoryReviewPreferences,
    };
    const onPreferencesChanged = vi.fn((next: InventoryReviewPreferences) => {
      screenPreferences.current = next;
    });
    const queue = createInventoryPreferenceSaveQueue(
      { current: "1" },
      latestColumns,
      async () => {
        throw new Error("offline");
      },
      async () => ({ columns: reconciledColumns, revision: "5" }),
      onPreferencesChanged,
      () => "0198e7ce-7685-7000-8000-000000000001",
    );

    await expect(queue.enqueue("value", true)).rejects.toThrow("offline");

    expect(screenPreferences.current).toEqual({
      columns: reconciledColumns,
      revision: "5",
    });
    expect(latestColumns.current).toEqual(reconciledColumns);
    expect(onPreferencesChanged).toHaveBeenCalledTimes(1);
  });
});
