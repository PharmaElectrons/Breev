import { describe, expect, it } from "vitest";

import {
  SALE_DRAFT_STATUSES,
  saleDraftCreateContract,
  saleDraftListContract,
  saleDraftListQuerySchema,
  saleDraftPath,
  saleDraftReadContract,
  saleDraftResumptionsPath,
  saleDraftResumeContract,
  saleDraftsPath,
  saleProductSearchContract,
  saleProductContextContract,
  saleProductContextPath,
  saleProductSearchPath,
  saleQuickAccessPath,
  saleQuickAccessReadContract,
  saleQuickAccessReplaceContract,
  saleDraftLineAddRequestSchema,
  saleDraftLinePriceOverrideContract,
  saleDraftLinePriceOverridePath,
} from "./index.js";

const DRAFT_ID = "0198e7ce-7685-7000-8000-000000000001";
const USER_ID = "0198e7ce-7685-7000-8000-000000000002";

const draft = {
  createdAt: "2026-09-12T10:00:00.000Z",
  createdBy: { displayName: "Owner", id: USER_ID },
  id: DRAFT_ID,
  invoiceDiscountFils: "0",
  lines: [],
  status: "active",
  totals: {
    grossFils: "0",
    lineDiscountFils: "0",
    invoiceDiscountFils: "0",
    totalFils: "0",
  },
  updatedAt: "2026-09-12T10:00:00.000Z",
  updatedBy: { displayName: "Owner", id: USER_ID },
  version: "1",
};

describe("sales contracts", () => {
  it("exposes only POS-safe inventory context and requires a complete projection", () => {
    const response = {
      id: DRAFT_ID,
      displayName: "Amoxicillin",
      scientificName: null,
      currentRetailPriceFils: "45000",
      inventoryUnitName: "Strip",
      packageUnits: [],
      eligibleUnits: [],
      stockLevels: { minimumLevel: "10", maximumLevel: "60" },
      inventory: {
        onHandBaseUnits: "72",
        estimatedSurplusBaseUnits: "12",
        batches: [
          {
            batchId: USER_ID,
            balanceBaseUnits: "72",
            effectiveExpiryDate: "2026-10-02",
            daysRemaining: 7,
            lotNumber: "A12",
            status: "near-expiry",
          },
        ],
      },
    };
    expect(saleProductContextContract.responses[200].parse(response)).toEqual(
      response,
    );
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        inventory: undefined,
      }).success,
    ).toBe(false);
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        inventory: { ...response.inventory, averageUnitCostFils: "10" },
      }).success,
    ).toBe(false);
  });

  it("requires a reason and exact unit price for manual override", () => {
    expect(saleDraftLinePriceOverridePath(DRAFT_ID, USER_ID)).toBe(
      `/sales/drafts/${DRAFT_ID}/lines/${USER_ID}/price-override`,
    );
    expect(
      saleDraftLinePriceOverrideContract.request.body.parse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
        unitPriceFils: "45000",
        reason: "Approved by manager",
      }).reason,
    ).toBe("Approved by manager");
    expect(
      saleDraftLinePriceOverrideContract.request.body.safeParse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
        unitPriceFils: "45.5",
        reason: " ",
      }).success,
    ).toBe(false);
  });
  it("validates versioned quick-access settings and explicit Sale unit selection", () => {
    expect(saleQuickAccessPath()).toBe("/sales/quick-access");
    expect(
      saleQuickAccessReadContract.responses[200].parse({
        version: "1",
        categories: [],
      }),
    ).toEqual({ version: "1", categories: [] });
    expect(
      saleQuickAccessReplaceContract.request.body.parse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
        categories: [
          {
            name: "Common",
            tiles: [{ productId: DRAFT_ID, unitId: USER_ID }],
          },
        ],
      }).categories[0]?.tiles[0]?.unitId,
    ).toBe(USER_ID);
    expect(
      saleQuickAccessReplaceContract.request.body.safeParse({
        expectedVersion: "0",
        idempotencyKey: USER_ID,
        categories: [],
      }).success,
    ).toBe(false);
    expect(
      saleDraftLineAddRequestSchema.parse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
        productId: DRAFT_ID,
        unitId: USER_ID,
      }).unitId,
    ).toBe(USER_ID);
  });
  it("accepts the minimal create, resume, and list request shapes exactly", () => {
    expect(
      saleDraftCreateContract.request.body.parse({ idempotencyKey: USER_ID }),
    ).toEqual({ idempotencyKey: USER_ID });
    expect(
      saleDraftResumeContract.request.body.parse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
      }),
    ).toEqual({ expectedVersion: "1", idempotencyKey: USER_ID });
    expect(saleDraftListQuerySchema.parse({})).toEqual({});
    expect(saleDraftListQuerySchema.parse({ status: "active" })).toEqual({
      status: "active",
    });

    for (const request of [
      { idempotencyKey: USER_ID, extra: true },
      { idempotencyKey: "not-a-uuid" },
    ]) {
      expect(
        saleDraftCreateContract.request.body.safeParse(request).success,
      ).toBe(false);
    }
    expect(
      saleDraftResumeContract.request.body.safeParse({
        expectedVersion: "0",
        idempotencyKey: USER_ID,
      }).success,
    ).toBe(false);
    expect(saleDraftListQuerySchema.safeParse({ extra: true }).success).toBe(
      false,
    );
  });

  it("keeps the draft wire record exact and rejects unrelated sale scope", () => {
    expect(saleDraftCreateContract.responses[201].parse(draft)).toEqual(draft);
    expect(
      saleDraftReadContract.responses[200].safeParse({
        ...draft,
        patientId: USER_ID,
      }).success,
    ).toBe(false);
    expect(
      saleDraftListContract.responses[200].parse({ drafts: [draft] }),
    ).toEqual({ drafts: [draft] });
  });

  it("keeps sale statuses, paths, methods, and success statuses stable", () => {
    expect([...SALE_DRAFT_STATUSES]).toEqual([
      "active",
      "suspended",
      "discarded",
    ]);
    expect(saleProductSearchPath()).toBe("/sales/product-search");
    expect(saleProductContextPath(DRAFT_ID)).toBe(
      `/sales/products/${DRAFT_ID}/context`,
    );
    expect(saleProductSearchContract.method).toBe("GET");
    expect(saleProductContextContract.method).toBe("GET");
    expect(saleDraftsPath()).toBe("/sales/drafts");
    expect(saleDraftPath(DRAFT_ID)).toBe(`/sales/drafts/${DRAFT_ID}`);
    expect(saleDraftResumptionsPath(DRAFT_ID)).toBe(
      `/sales/drafts/${DRAFT_ID}/resumptions`,
    );
    expect(saleDraftListContract.method).toBe("GET");
    expect(saleDraftListContract.path).toBe("/sales/drafts");
    expect(saleDraftReadContract.method).toBe("GET");
    expect(saleDraftReadContract.path).toBe("/sales/drafts/:draftId");
    expect(saleDraftCreateContract.method).toBe("POST");
    expect(saleDraftCreateContract.path).toBe("/sales/drafts");
    expect(saleDraftResumeContract.method).toBe("POST");
    expect(saleDraftResumeContract.path).toBe(
      "/sales/drafts/:draftId/resumptions",
    );
    expect(Object.hasOwn(saleDraftCreateContract.responses, 201)).toBe(true);
    expect(Object.hasOwn(saleDraftResumeContract.responses, 200)).toBe(true);
  });
});
