import { describe, expect, it } from "vitest";

import {
  DEFAULT_SALE_PANEL_SETTINGS,
  SALE_DRAFT_STATUSES,
  saleDrawerBalanceContract,
  saleDrawerBalancePath,
  saleDraftMiscLineAddRequestSchema,
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
  SALE_QUICK_ACCESS_REPLACE_MAX_BODY_BYTES,
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
  it("requires a barcode slot in the retail-only Sale search projection", () => {
    const response = {
      hasMore: false,
      query: "Amoxicillin",
      resultCount: 1,
      results: [
        {
          matchedField: "english-name",
          product: {
            id: DRAFT_ID,
            displayName: "Amoxicillin",
            arabicSearchName: null,
            barcodeValue: "1234567890123",
            retailPriceFils: "45000",
          },
        },
      ],
    };
    const schema = saleProductSearchContract.responses[200];
    expect(schema.parse(response)).toEqual(response);
    expect(
      schema.parse({
        ...response,
        results: [
          {
            ...response.results[0],
            product: { ...response.results[0]!.product, barcodeValue: null },
          },
        ],
      }).results[0]?.product.barcodeValue,
    ).toBeNull();
    expect(
      schema.safeParse({
        ...response,
        results: [
          {
            ...response.results[0],
            product: {
              ...response.results[0]!.product,
              barcodeValue: undefined,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("exposes only POS-safe inventory context and requires a complete projection", () => {
    const response = {
      id: DRAFT_ID,
      displayName: "Amoxicillin",
      scientificName: null,
      wholesalePriceFils: "40000",
      thumbnailDataUrl: "data:image/png;base64,AAAA",
      currentRetailPriceFils: "45000",
      currentRetailUnitName: "Strip",
      inventoryUnitName: "Strip",
      packageUnits: [],
      eligibleUnits: [],
      stockLevels: { minimumLevel: "10", maximumLevel: "60" },
      inventory: {
        onHandBaseUnits: "72",
        estimatedSurplusBaseUnits: "12",
        consumptionAverages: {
          oneMonth: "8",
          twoMonths: "10",
          threeMonths: "12",
        },
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
        inventory: {
          ...response.inventory,
          consumptionAverages: {
            oneMonth: null,
            twoMonths: null,
            threeMonths: null,
          },
        },
      }).success,
    ).toBe(true);
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        inventory: undefined,
      }).success,
    ).toBe(false);
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        wholesalePriceFils: undefined,
      }).success,
    ).toBe(false);
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        thumbnailDataUrl: undefined,
      }).success,
    ).toBe(false);
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        inventory: { ...response.inventory, consumptionAverages: undefined },
      }).success,
    ).toBe(false);
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        inventory: { ...response.inventory, averageUnitCostFils: "10" },
      }).success,
    ).toBe(false);
    for (const thumbnailDataUrl of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "https://example.test/item.png",
    ]) {
      expect(
        saleProductContextContract.responses[200].safeParse({
          ...response,
          thumbnailDataUrl,
        }).success,
      ).toBe(false);
    }
    expect(
      saleProductContextContract.responses[200].safeParse({
        ...response,
        metadata: { source: "untrusted" },
      }).success,
    ).toBe(false);
  });

  it("accepts only nonnegative integer misc cost and requires command concurrency keys", () => {
    const valid = {
      displayName: "Courier service",
      unitName: "service",
      quantity: "1",
      unitPriceFils: "30000",
      expectedVersion: "1",
      idempotencyKey: USER_ID,
    };
    expect(saleDraftMiscLineAddRequestSchema.parse(valid)).toEqual(valid);
    expect(
      saleDraftMiscLineAddRequestSchema.parse({ ...valid, costFils: "0" })
        .costFils,
    ).toBe("0");
    expect(
      saleDraftMiscLineAddRequestSchema.parse({ ...valid, costFils: "8500" })
        .costFils,
    ).toBe("8500");
    for (const costFils of ["-1", "8.5"]) {
      expect(
        saleDraftMiscLineAddRequestSchema.safeParse({ ...valid, costFils })
          .success,
      ).toBe(false);
    }
    expect(
      saleDraftMiscLineAddRequestSchema.safeParse({
        ...valid,
        costFils: 8500,
      }).success,
    ).toBe(false);
    expect(
      saleDraftMiscLineAddRequestSchema.safeParse({
        displayName: valid.displayName,
        unitName: valid.unitName,
        quantity: valid.quantity,
        unitPriceFils: valid.unitPriceFils,
        idempotencyKey: valid.idempotencyKey,
      }).success,
    ).toBe(false);
    expect(
      saleDraftMiscLineAddRequestSchema.safeParse({
        displayName: valid.displayName,
        unitName: valid.unitName,
        quantity: valid.quantity,
        unitPriceFils: valid.unitPriceFils,
        expectedVersion: valid.expectedVersion,
      }).success,
    ).toBe(false);
  });

  it("requires a reason and exact unit price for manual override", () => {
    expect(saleDraftLinePriceOverridePath(DRAFT_ID, USER_ID)).toBe(
      `/sales/drafts/${DRAFT_ID}/lines/${USER_ID}/price-override`,
    );
    const validRequest = {
      expectedVersion: "1",
      idempotencyKey: USER_ID,
      unitPriceFils: "45000",
      reason: "Approved by manager",
    };
    expect(
      saleDraftLinePriceOverrideContract.request.body.parse(validRequest)
        .reason,
    ).toBe("Approved by manager");
    expect(
      saleDraftLinePriceOverrideContract.request.body.safeParse({
        idempotencyKey: USER_ID,
        unitPriceFils: "45000",
        reason: "Approved by manager",
      }).success,
    ).toBe(false);
    expect(
      saleDraftLinePriceOverrideContract.request.body.safeParse({
        expectedVersion: "1",
        unitPriceFils: "45000",
        reason: "Approved by manager",
      }).success,
    ).toBe(false);
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
    const tile = { productId: DRAFT_ID, unitId: USER_ID };
    const request = {
      expectedVersion: "1",
      idempotencyKey: USER_ID,
      categories: [{ name: "Common", tiles: [tile] }],
    };
    const response = {
      version: "1",
      panelSettings: DEFAULT_SALE_PANEL_SETTINGS,
      categories: [
        {
          name: "Common",
          tiles: [
            {
              ...tile,
              available: true,
              thumbnailDataUrl: null,
              displayName: "Amoxicillin",
              unitName: "Strip",
              currentUnitPriceFils: "45000",
            },
          ],
        },
      ],
    };
    expect(saleQuickAccessReadContract.responses[200].parse(response)).toEqual(
      response,
    );
    for (const invalid of [
      { version: "1", categories: [] },
      {
        ...response,
        categories: [
          {
            name: "Common",
            tiles: [
              {
                ...response.categories[0]!.tiles[0]!,
                thumbnailDataUrl: undefined,
              },
            ],
          },
        ],
      },
      { ...response, metadata: { source: "untrusted" } },
    ]) {
      expect(
        saleQuickAccessReadContract.responses[200].safeParse(invalid).success,
      ).toBe(false);
    }
    expect(
      saleQuickAccessReplaceContract.request.body.parse({
        ...request,
        categories: [
          {
            name: "Common",
            tiles: [
              { ...tile, thumbnailDataUrl: "data:image/webp;base64,AAAA" },
            ],
          },
        ],
        panelSettings: {
          visibleFields: ["scientificName", "thumbnail", "wholesalePrice"],
          consumptionMonths: 1,
          showDrawerBalance: false,
        },
      }).panelSettings?.showDrawerBalance,
    ).toBe(false);
    // Panel settings and per-tile thumbnails are optional on writes.
    expect(
      saleQuickAccessReplaceContract.request.body.safeParse(request).success,
    ).toBe(true);
    const thumbnailDataUrl = `data:image/png;base64,${"A".repeat(30_000)}`;
    expect(
      saleQuickAccessReplaceContract.request.body.safeParse({
        ...request,
        categories: [
          { name: "Common", tiles: [{ ...tile, thumbnailDataUrl }] },
        ],
      }).success,
    ).toBe(true);
    expect(SALE_QUICK_ACCESS_REPLACE_MAX_BODY_BYTES).toBe(1024 * 1024);
    const nearMaximumThumbnail = `data:image/png;base64,${"A".repeat(99_970)}`;
    const oversizedAggregate = {
      ...request,
      categories: [
        {
          name: "Common",
          tiles: Array.from({ length: 11 }, () => ({
            ...tile,
            thumbnailDataUrl: nearMaximumThumbnail,
          })),
        },
      ],
    };
    expect(
      saleQuickAccessReplaceContract.request.body.safeParse(oversizedAggregate)
        .success,
    ).toBe(false);
    for (const thumbnailDataUrl of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "https://example.test/item.png",
    ]) {
      expect(
        saleQuickAccessReplaceContract.request.body.safeParse({
          ...request,
          categories: [
            { name: "Common", tiles: [{ ...tile, thumbnailDataUrl }] },
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      saleQuickAccessReplaceContract.request.body.safeParse({
        ...request,
        panelSettings: {
          ...DEFAULT_SALE_PANEL_SETTINGS,
          visibleFields: ["balance", "balance"],
        },
      }).success,
    ).toBe(false);
    for (const invalid of [
      { idempotencyKey: USER_ID, categories: request.categories },
      { expectedVersion: "1", categories: request.categories },
      { ...request, metadata: { source: "untrusted" } },
    ]) {
      expect(
        saleQuickAccessReplaceContract.request.body.safeParse(invalid).success,
      ).toBe(false);
    }
    expect(
      saleQuickAccessReplaceContract.request.body.safeParse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
        categories: [],
        metadata: { source: "untrusted" },
      }).success,
    ).toBe(false);
    expect(
      saleQuickAccessReplaceContract.request.body.safeParse({
        expectedVersion: "0",
        idempotencyKey: USER_ID,
        categories: [],
      }).success,
    ).toBe(false);
    expect(
      saleQuickAccessReplaceContract.responses[413].parse({
        status: "denied",
        code: "request-too-large",
        requestId: DRAFT_ID,
      }).code,
    ).toBe("request-too-large");
    expect(
      saleDraftLineAddRequestSchema.parse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
        productId: DRAFT_ID,
        unitId: USER_ID,
      }).unitId,
    ).toBe(USER_ID);
    expect(
      saleDraftLineAddRequestSchema.safeParse({
        idempotencyKey: USER_ID,
        productId: DRAFT_ID,
        unitId: USER_ID,
      }).success,
    ).toBe(false);
    expect(
      saleDraftLineAddRequestSchema.safeParse({
        expectedVersion: "1",
        productId: DRAFT_ID,
        unitId: USER_ID,
      }).success,
    ).toBe(false);
  });

  it("exposes an exact signed integer drawer balance read contract", () => {
    expect(saleDrawerBalancePath()).toBe("/sales/drawer-balance");
    expect(saleDrawerBalanceContract.method).toBe("GET");
    expect(
      saleDrawerBalanceContract.responses[200].parse({
        balanceFils: "-2500",
      }),
    ).toEqual({ balanceFils: "-2500" });
    expect(
      saleDrawerBalanceContract.responses[200].parse({ balanceFils: null }),
    ).toEqual({ balanceFils: null });
    expect(
      saleDrawerBalanceContract.responses[200].safeParse({
        balanceFils: "25.5",
      }).success,
    ).toBe(false);
    expect(
      saleDrawerBalanceContract.responses[200].safeParse({
        balanceFils: 2500,
      }).success,
    ).toBe(false);
    expect(
      saleDrawerBalanceContract.responses[200].safeParse({
        balanceFils: "2500",
        metadata: {},
      }).success,
    ).toBe(false);
  });
  it("accepts the minimal create, resume, and list request shapes exactly", () => {
    expect(
      saleDraftCreateContract.request.body.parse({ idempotencyKey: USER_ID }),
    ).toEqual({ idempotencyKey: USER_ID });
    expect(saleDraftCreateContract.request.body.safeParse({}).success).toBe(
      false,
    );
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
    expect(
      saleDraftResumeContract.request.body.safeParse({
        idempotencyKey: USER_ID,
      }).success,
    ).toBe(false);
    expect(
      saleDraftResumeContract.request.body.safeParse({
        expectedVersion: "1",
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
