import { describe, expect, it } from "vitest";

import { planFefoAllocation, type BatchFact } from "./inventory-fefo.js";

const PRODUCT = "0198e7ce-7685-7000-8000-000000000001";
const OTHER = "0198e7ce-7685-7000-8000-000000000002";

function batch(
  input: Partial<BatchFact> & Pick<BatchFact, "batchId">,
): BatchFact {
  return {
    balance: 10n,
    effectiveExpiryDate: "2026-09-20",
    latestStatusKind: null,
    lotNumber: null,
    originalExpiryDate: "2026-09-20",
    productId: PRODUCT,
    receivedAt: "2026-09-01T10:00:00.000Z",
    ...input,
  };
}

describe("FEFO allocation", () => {
  it("is deterministic and uses expiry, receipt time, then id", () => {
    const facts = [
      batch({
        batchId: "0198e7ce-7685-7000-8000-000000000003",
        effectiveExpiryDate: "2026-10-01",
        receivedAt: "2026-09-02T10:00:00.000Z",
      }),
      batch({
        batchId: "0198e7ce-7685-7000-8000-000000000004",
        effectiveExpiryDate: "2026-09-20",
        receivedAt: "2026-09-02T10:00:00.000Z",
      }),
      batch({
        batchId: "0198e7ce-7685-7000-8000-000000000005",
        effectiveExpiryDate: "2026-09-20",
        receivedAt: "2026-09-01T10:00:00.000Z",
      }),
      batch({
        batchId: "0198e7ce-7685-7000-8000-000000000006",
        effectiveExpiryDate: null,
      }),
      batch({
        batchId: "0198e7ce-7685-7000-8000-000000000007",
        effectiveExpiryDate: "2026-09-01",
        status: "expired",
      }),
    ];
    const lines = [{ productId: PRODUCT, quantity: 25n }];
    const first = planFefoAllocation(facts, lines);
    const second = planFefoAllocation([...facts].reverse(), lines);
    expect(JSON.stringify(first, bigintReplacer)).toBe(
      JSON.stringify(second, bigintReplacer),
    );
    expect(first.allocations.map((item) => item.batchId)).toEqual([
      "0198e7ce-7685-7000-8000-000000000005",
      "0198e7ce-7685-7000-8000-000000000004",
      "0198e7ce-7685-7000-8000-000000000003",
    ]);
    expect(first.blocked.map((item) => item.batchId)).toEqual([
      "0198e7ce-7685-7000-8000-000000000007",
    ]);
    expect(first.shortfalls).toEqual([]);
  });

  it("honours a named batch and reports shortfall without selecting blocked stock", () => {
    const onlyBlocked = batch({
      batchId: "0198e7ce-7685-7000-8000-000000000008",
      balance: 3n,
      status: "recalled",
    });
    const plan = planFefoAllocation(
      [
        onlyBlocked,
        batch({ batchId: "0198e7ce-7685-7000-8000-000000000009", balance: 0n }),
      ],
      [{ batchId: onlyBlocked.batchId, productId: PRODUCT, quantity: 2n }],
    );
    expect(plan.allocations).toEqual([]);
    expect(plan.shortfalls).toEqual([
      { allocatable: 0n, productId: PRODUCT, requested: 2n },
    ]);
    expect(plan.blocked[0]).toMatchObject({ status: "recalled" });
  });

  it("keeps products independent", () => {
    const plan = planFefoAllocation(
      [
        batch({
          batchId: "0198e7ce-7685-7000-8000-000000000010",
          productId: OTHER,
        }),
      ],
      [{ productId: PRODUCT, quantity: 1n }],
    );
    expect(plan.allocations).toEqual([]);
    expect(plan.shortfalls[0]?.allocatable).toBe(0n);
  });

  it("keeps the allocation boundary pure and narrow", () => {
    expect(planFefoAllocation).toHaveLength(2);
    expect(planFefoAllocation.toString()).toMatch(
      /function planFefoAllocation\(batches, lines\)/u,
    );
  });
});

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${String(value)}n` : value;
}
