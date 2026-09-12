import { describe, expect, it } from "vitest";

import {
  REORDER_ADD_OUTCOMES,
  REORDER_ITEM_STATUSES,
  REORDER_PROPOSAL_BASES,
  REORDER_WARNINGS,
  reorderBasketPath,
  reorderBasketQuerySchema,
  reorderBasketReadContract,
  reorderItemAddContract,
  reorderItemConfirmContract,
  reorderItemConfirmationsPath,
  reorderItemPath,
  reorderItemRemoveContract,
  reorderItemRemovalsPath,
  reorderItemReturnContract,
  reorderItemReturnsPath,
  reorderItemUpdateContract,
  reorderItemsPath,
  reorderItemTransitionRequestSchema,
  reorderItemUpdateRequestSchema,
} from "./index.js";

const ITEM_ID = "0198e7ce-7685-7000-8000-000000000001";
const PRODUCT_ID = "0198e7ce-7685-7000-8000-000000000002";
const USER_ID = "0198e7ce-7685-7000-8000-000000000003";

const transition = {
  expectedVersion: "1",
  idempotencyKey: USER_ID,
};

const item = {
  addedAt: "2026-09-12T10:00:00.000Z",
  addedBy: { displayName: "Owner", id: USER_ID },
  id: ITEM_ID,
  inventory: {
    balance: "8",
    batches: { count: "1", earliestExpiry: "2027-01-01", expiredCount: "0" },
    consumptionRatePer30Days: "4",
    riskIndicators: ["below-minimum"],
    stateColour: { automatic: "orange", effective: "orange", manual: null },
    stockLevels: { maximumLevel: "60", minimumLevel: "10", reorderPoint: "5" },
  },
  orderedAt: null,
  orderedBy: null,
  product: {
    displayName: "Panadol",
    inventoryUnitName: "Strip",
    mergedIntoDisplayName: null,
    mergedIntoProductId: null,
    packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
    status: "active",
  },
  productId: PRODUCT_ID,
  projection: { projectedLevel: "60", warning: null },
  proposal: {
    balance: "8",
    basis: "maximum-minus-balance",
    maximumLevel: "60",
    proposedAt: "2026-09-12T10:00:00.000Z",
    quantity: "52",
  },
  quantity: "52",
  quantityEditedAt: null,
  status: "basket",
  version: "1",
};

describe("inventory reorder contracts", () => {
  it("accepts and rejects the add, update, and transition requests exactly", () => {
    expect(
      reorderItemAddContract.request.body.parse({
        idempotencyKey: USER_ID,
        productId: PRODUCT_ID,
      }),
    ).toEqual({ idempotencyKey: USER_ID, productId: PRODUCT_ID });
    expect(
      reorderItemUpdateContract.request.body.parse({
        ...transition,
        quantity: "60",
      }).quantity,
    ).toBe("60");
    expect(reorderItemTransitionRequestSchema.parse(transition)).toEqual(
      transition,
    );

    for (const request of [
      { idempotencyKey: USER_ID, productId: PRODUCT_ID, extra: true },
      { idempotencyKey: USER_ID, productId: "not-a-uuid" },
    ]) {
      expect(
        reorderItemAddContract.request.body.safeParse(request).success,
      ).toBe(false);
    }
    for (const quantity of ["1.5", "-1", "01", "1e2"]) {
      expect(
        reorderItemUpdateRequestSchema.safeParse({
          ...transition,
          quantity,
        }).success,
      ).toBe(false);
    }
    expect(
      reorderItemUpdateRequestSchema.safeParse({
        idempotencyKey: USER_ID,
        quantity: "1",
      }).success,
    ).toBe(false);
    expect(
      reorderItemTransitionRequestSchema.safeParse({
        ...transition,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts the basket query only for its two wire statuses", () => {
    expect(reorderBasketQuerySchema.parse({})).toEqual({});
    expect(reorderBasketQuerySchema.parse({ status: "basket" })).toEqual({
      status: "basket",
    });
    expect(reorderBasketQuerySchema.parse({ status: "ordered" })).toEqual({
      status: "ordered",
    });
    expect(
      reorderBasketQuerySchema.safeParse({ status: "removed" }).success,
    ).toBe(false);
    expect(reorderBasketQuerySchema.safeParse({ extra: true }).success).toBe(
      false,
    );
  });

  it("validates a complete item and excludes valuation fields", () => {
    expect(
      reorderBasketReadContract.responses[200].parse({ items: [item] }),
    ).toEqual({ items: [item] });
    expect(
      reorderBasketReadContract.responses[200].safeParse({
        items: [{ ...item, inventory: { ...item.inventory, valueFils: "1" } }],
      }).success,
    ).toBe(false);
  });

  it("keeps reorder enums exhaustive and paths stable", () => {
    expect([...REORDER_ITEM_STATUSES]).toEqual(["basket", "ordered"]);
    expect([...REORDER_PROPOSAL_BASES]).toEqual([
      "maximum-minus-balance",
      "no-maximum-level",
      "balance-at-or-above-maximum",
    ]);
    expect([...REORDER_WARNINGS]).toEqual(["surplus"]);
    expect([...REORDER_ADD_OUTCOMES]).toEqual([
      "added",
      "updated",
      "already-ordered",
    ]);

    expect(reorderBasketPath()).toBe("/inventory/reorder-basket");
    expect(reorderItemsPath()).toBe("/inventory/reorder-basket/items");
    expect(reorderItemPath(ITEM_ID)).toBe(
      `/inventory/reorder-basket/items/${ITEM_ID}`,
    );
    expect(reorderItemRemovalsPath(ITEM_ID)).toBe(
      `/inventory/reorder-basket/items/${ITEM_ID}/removals`,
    );
    expect(reorderItemConfirmationsPath(ITEM_ID)).toBe(
      `/inventory/reorder-basket/items/${ITEM_ID}/confirmations`,
    );
    expect(reorderItemReturnsPath(ITEM_ID)).toBe(
      `/inventory/reorder-basket/items/${ITEM_ID}/returns`,
    );
    expect(reorderBasketReadContract.method).toBe("GET");
    expect(reorderBasketReadContract.path).toBe("/inventory/reorder-basket");
    expect(reorderItemAddContract.method).toBe("POST");
    expect(reorderItemUpdateContract.path).toBe(
      "/inventory/reorder-basket/items/:itemId",
    );
    expect(reorderItemConfirmContract.method).toBe("POST");
    expect(reorderItemConfirmContract.path).toBe(
      "/inventory/reorder-basket/items/:itemId/confirmations",
    );
    expect(reorderItemRemoveContract.method).toBe("POST");
    expect(reorderItemReturnContract.method).toBe("POST");
    expect(reorderItemUpdateContract.method).toBe("PUT");
  });
});
