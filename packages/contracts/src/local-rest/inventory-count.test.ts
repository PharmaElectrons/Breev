import { describe, expect, it } from "vitest";

import {
  COUNT_LINE_STATUSES,
  INVENTORY_MOVEMENT_KINDS,
  countEntriesSchema,
  countLineRecordContract,
  countLineSchema,
  countSessionCompleteContract,
  countSessionCompletionPath,
  countSessionLinesPath,
  countSessionListContract,
  countSessionPath,
  countSessionReadContract,
  countSessionStartContract,
  countVarianceApplicationPath,
  countVarianceApplyContract,
} from "./index.js";

const SESSION_ID = "0198e7ce-7685-7000-8000-000000000001";
const LINE_ID = "0198e7ce-7685-7000-8000-000000000002";
const PRODUCT_ID = "0198e7ce-7685-7000-8000-000000000003";

describe("inventory count contracts", () => {
  it("accepts exact mixed-unit entries and rejects malformed commands", () => {
    expect(
      countEntriesSchema.parse([
        { unit: { kind: "package-unit", packageUnitName: "Pack" }, count: "2" },
        { unit: { kind: "inventory-unit" }, count: "1" },
      ]),
    ).toHaveLength(2);
    expect(
      countLineRecordContract.request.body.parse({
        expectedVersion: "1",
        idempotencyKey: SESSION_ID,
        productId: PRODUCT_ID,
        entries: [{ unit: { kind: "inventory-unit" }, count: "0" }],
      }).productId,
    ).toBe(PRODUCT_ID);

    expect(
      countEntriesSchema.safeParse([
        { unit: { kind: "inventory-unit" }, count: "1" },
        { unit: { kind: "inventory-unit" }, count: "2" },
      ]).success,
    ).toBe(false);
    expect(
      countEntriesSchema.safeParse([
        { unit: { kind: "inventory-unit" }, count: "1.5" },
      ]).success,
    ).toBe(false);
    expect(countEntriesSchema.safeParse([]).success).toBe(false);

    expect(
      countVarianceApplyContract.request.body.safeParse({
        expectedBalanceBefore: "8",
        expectedVersion: "1",
        idempotencyKey: SESSION_ID,
        reason: "   ",
        evidence: "receipt",
      }).success,
    ).toBe(false);
    expect(
      countVarianceApplyContract.request.body.safeParse({
        expectedBalanceBefore: "8",
        expectedVersion: "1",
        idempotencyKey: SESSION_ID,
        reason: "counted on shelf",
        evidence: "   ",
      }).success,
    ).toBe(false);
  });

  it("keeps count line statuses and movement kinds closed and exhaustive", () => {
    expect([...COUNT_LINE_STATUSES]).toEqual([
      "matched",
      "pending",
      "stale",
      "applied",
    ]);
    expect(countLineSchema.shape.status.parse("pending")).toBe("pending");
    expect([...INVENTORY_MOVEMENT_KINDS]).toEqual([
      "purchase-adjustment",
      "purchase-receipt",
      "purchase-return",
      "count-variance",
    ]);
  });

  it("builds the durable session paths and exposes only GET/POST count routes", () => {
    expect(countSessionPath(SESSION_ID)).toBe(
      `/inventory/count-sessions/${SESSION_ID}`,
    );
    expect(countSessionLinesPath(SESSION_ID)).toBe(
      `/inventory/count-sessions/${SESSION_ID}/lines`,
    );
    expect(countVarianceApplicationPath(SESSION_ID, LINE_ID)).toBe(
      `/inventory/count-sessions/${SESSION_ID}/lines/${LINE_ID}/variance-applications`,
    );
    expect(countSessionCompletionPath(SESSION_ID)).toBe(
      `/inventory/count-sessions/${SESSION_ID}/completions`,
    );

    const countContracts = [
      countSessionStartContract,
      countSessionListContract,
      countSessionReadContract,
      countLineRecordContract,
      countVarianceApplyContract,
      countSessionCompleteContract,
    ];
    expect(countContracts.map((contract) => contract.method)).toEqual([
      "POST",
      "GET",
      "GET",
      "POST",
      "POST",
      "POST",
    ]);
  });
});
