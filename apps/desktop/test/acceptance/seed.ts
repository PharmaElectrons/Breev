import {
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type Product,
  type ProductCreateRequest,
  type ProductPricingInput,
  type PurchaseDraft,
  type PurchasePostResult,
} from "@breev/contracts/local-rest";
import { expect } from "@playwright/test";

import { uuidV7, type LocalApi } from "./packaged-desktop.js";

/**
 * The fixture one acceptance pass runs against, seeded only through the public
 * REST contract the renderer itself uses — never SQL.
 *
 * The catalogue is deliberately small and literal. The search scenario claims
 * that `"extra"` returns *every* item containing "Extra", which is only a
 * checkable claim when the whole catalogue is known: every other seeded name
 * here is free of the letter `x`, so ordered-subsequence matching
 * (`catalog-search.ts`) cannot pull one of them into the result by accident.
 *
 * "Panadol Extra GSK" is absent from this module on purpose. Clause 1 of the
 * contractual criterion is "a user defines an item and finds it", so that item
 * is defined through the packaged renderer's own form, by keyboard.
 */

export const OWNER_USERNAME = "m2.acceptance.owner";
export const OWNER_PASSWORD = "milestone two acceptance owner password";
export const SUPPLIER_NAME = "Al-Nahrain Medical";

export const PANADOL_DISPLAY_NAME = "Panadol Extra GSK";
export const PANADOL_TRADE_NAME = "Panadol Extra";
export const PANADOL_MANUFACTURER = "GSK";
export const PANADOL_ARABIC_SEARCH_NAME = "بنادول اكسترا";
export const PANADOL_BARCODE = "5000167000101";
export const PANADOL_RETAIL_PRICE_FILS = "100000";
export const PANADOL_INVENTORY_UNIT = "Strip";

export const EXTRA_COLD_NAME = "Cold Extra Relief";
export const EXTRA_VITAMIN_NAME = "Vitamin Extra Daily";
export const PLAIN_ITEM_NAME = "Cetirizine Allergy Bayer";

export const PANEL_ITEM_TRADE_NAME = "Panel Detail Item";
export const PANEL_ITEM_BARCODE = "5000167000115";
export const PANEL_ITEM_SCIENTIFIC_NAME = "Paracetamol and Caffeine";
export const PANEL_ITEM_CATEGORY = "Analgesic";
export const PANEL_ITEM_WHOLESALE_PRICE_FILS = "90000";
/** `packagingText` joins the inventory unit and each package unit with " · ". */
export const PANEL_ITEM_PACKAGING = "Strip · Pack × 4";

export const ADJUSTMENT_INVOICE_NUMBER = "M2-ADJ-1";
export const BLOCKED_INVOICE_NUMBER = "M2-BLOCK-1";

export interface SeededFixture {
  readonly adjusted: Product;
  readonly adjustmentPurchaseId: string;
  readonly blocked: Product;
  readonly blockedPurchaseId: string;
  readonly byPrice: Product;
  readonly extraCold: Product;
  readonly extraVitamin: Product;
  readonly fefoItem: Product;
  readonly margin1000: Product;
  readonly margin250: Product;
  readonly margin500: Product;
  readonly marginOff: Product;
  readonly marginOffMidpoint: Product;
  readonly panelItem: Product;
  readonly plain: Product;
  readonly reviewItem: Product;
  readonly silent: Product;
  readonly supplierId: string;
  readonly unitsItem: Product;
}

export async function seedFixture(api: LocalApi): Promise<SeededFixture> {
  const bootstrap = await api.request("POST", "/identity/bootstrap", {
    owner: {
      displayName: "Milestone Two Acceptance Owner",
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    },
    pharmacyName: "Breev Milestone Two Acceptance Pharmacy",
  });
  expect(bootstrap.status, JSON.stringify(bootstrap.body)).toBe(201);

  const supplier = await api.request("POST", "/suppliers", {
    allowanceEffectiveFrom: "2026-01-01",
    defaultAllowancePercentage: "2.5",
    idempotencyKey: uuidV7(),
    name: SUPPLIER_NAME,
    terms: "Net 30",
  });
  expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
  const supplierId = (supplier.body as { readonly id: string }).id;

  const extraCold = await createProduct(api, {
    barcode: "5000167000102",
    tradeName: EXTRA_COLD_NAME,
  });
  const extraVitamin = await createProduct(api, {
    barcode: "5000167000103",
    tradeName: EXTRA_VITAMIN_NAME,
  });
  const plain = await createProduct(api, {
    barcode: "5000167000104",
    tradeName: PLAIN_ITEM_NAME,
  });

  // The margin cases are `catalog-pricing.unit`'s golden figures: the
  // scenario's own 80 → 100 with rounding off, then one cost per rounding step
  // whose exact price sits on the step midpoint — and, below, one more that
  // does not, so the "only when enabled" claim never depends on a tie rule.
  const marginOff = await createProduct(api, {
    barcode: "5000167000105",
    pricing: {
      costFils: "80000",
      marginPercentage: "20",
      method: "by-percentage",
      rounding: "off",
      wholesalePriceFils: null,
    },
    tradeName: "Margin Item Plain",
  });
  const margin250 = await createProduct(api, {
    barcode: "5000167000106",
    pricing: {
      costFils: "300000",
      marginPercentage: "20",
      method: "by-percentage",
      rounding: "nearest-250-iqd",
      wholesalePriceFils: null,
    },
    tradeName: "Margin Item Quarter",
  });
  const margin500 = await createProduct(api, {
    barcode: "5000167000107",
    pricing: {
      costFils: "200000",
      marginPercentage: "20",
      method: "by-percentage",
      rounding: "nearest-500-iqd",
      wholesalePriceFils: null,
    },
    tradeName: "Margin Item Half",
  });
  const margin1000 = await createProduct(api, {
    barcode: "5000167000108",
    pricing: {
      costFils: "400000",
      marginPercentage: "20",
      method: "by-percentage",
      rounding: "nearest-1000-iqd",
      wholesalePriceFils: null,
    },
    tradeName: "Margin Item Whole",
  });
  // An off-midpoint case, so "rounding applies only when enabled" does not rest
  // on the tie rule: 250,000 fils at 20% is exactly 312,500, a quarter of the
  // way up the 250-IQD step, which no tie decision can move.
  const marginOffMidpoint = await createProduct(api, {
    barcode: "5000167000116",
    pricing: {
      costFils: "250000",
      marginPercentage: "20",
      method: "by-percentage",
      rounding: "nearest-250-iqd",
      wholesalePriceFils: null,
    },
    tradeName: "Margin Item Below Midpoint",
  });
  const byPrice = await createProduct(api, {
    barcode: "5000167000109",
    pricing: {
      method: "by-price",
      retailPriceFils: "90000",
      wholesalePriceFils: null,
    },
    tradeName: "Price Mode Item",
  });

  // The units item is purchased one Pack at a time, so its default purchase
  // unit is the Pack the scenario names.
  const unitsItem = await createProduct(api, {
    barcode: "5000167000110",
    purchaseUnit: { kind: "package-unit", packageUnitName: "Pack" },
    stockLevels: {
      maximumLevel: "60",
      minimumLevel: "10",
      reorderPoint: "20",
    },
    tradeName: "Unit Pack Item",
  });

  // The item the purchasing item-details panel is read from: every field the
  // panel can show carries a distinct, recognisable value, and the wholesale
  // price is unlike any cost or retail price this pass enters, so "the
  // wholesale price appears in the panel and nowhere else" is checkable.
  const panelItem = await createProduct(api, {
    barcode: "5000167000115",
    category: PANEL_ITEM_CATEGORY,
    pricing: {
      method: "by-price",
      retailPriceFils: "140000",
      wholesalePriceFils: PANEL_ITEM_WHOLESALE_PRICE_FILS,
    },
    scientificName: PANEL_ITEM_SCIENTIFIC_NAME,
    tradeName: PANEL_ITEM_TRADE_NAME,
  });

  // Clause 4 reads quantity, batches and expiry off the inventory grid and the
  // reorder basket. It gets its own item, stocked through the REST contract, so
  // that clause never depends on another flow's purchase having gone through
  // first — a failure in the units scenario must not take the inventory clause
  // down with it.
  const reviewItem = await createProduct(api, {
    barcode: "5000167000117",
    stockLevels: {
      maximumLevel: "60",
      minimumLevel: "10",
      reorderPoint: "20",
    },
    tradeName: "Review Stock Item",
  });

  // Two batches with different expiry dates, so the FEFO order clause 4 reads
  // has something to order.
  const fefoItem = await createProduct(api, {
    barcode: "5000167000114",
    tradeName: "Fefo Batch Item",
  });

  const adjusted = await createProduct(api, {
    barcode: "5000167000111",
    tradeName: "Adjusted Line Item",
  });
  const silent = await createProduct(api, {
    barcode: "5000167000112",
    tradeName: "Silent Line Item",
  });
  const blocked = await createProduct(api, {
    barcode: "5000167000113",
    tradeName: "Blocked Delta Item",
  });

  const adjustmentPurchase = await postPurchase(
    api,
    supplierId,
    ADJUSTMENT_INVOICE_NUMBER,
    [
      { productId: adjusted.id, quantity: "4" },
      { productId: silent.id, quantity: "2" },
    ],
  );
  await postPurchase(api, supplierId, "M2-REVIEW-1", [
    { expiryDate: "2029-05-31", productId: reviewItem.id, quantity: "4" },
  ]);
  await postPurchase(api, supplierId, "M2-FEFO-LATE", [
    { expiryDate: "2029-12-31", productId: fefoItem.id, quantity: "3" },
  ]);
  await postPurchase(api, supplierId, "M2-FEFO-EARLY", [
    { expiryDate: "2027-06-30", productId: fefoItem.id, quantity: "5" },
  ]);
  const blockedPurchase = await postPurchase(
    api,
    supplierId,
    BLOCKED_INVOICE_NUMBER,
    [{ productId: blocked.id, quantity: "4" }],
  );

  return {
    adjusted,
    adjustmentPurchaseId: adjustmentPurchase.posted.id,
    blocked,
    blockedPurchaseId: blockedPurchase.posted.id,
    byPrice,
    extraCold,
    extraVitamin,
    fefoItem,
    margin1000,
    margin250,
    margin500,
    marginOff,
    marginOffMidpoint,
    panelItem,
    plain,
    reviewItem,
    silent,
    supplierId,
    unitsItem,
  };
}

async function createProduct(
  api: LocalApi,
  options: {
    readonly barcode: string;
    readonly category?: string;
    readonly pricing?: ProductPricingInput;
    readonly purchaseUnit?: ProductCreateRequest["packaging"]["defaultUnits"]["purchase"];
    readonly scientificName?: string;
    readonly stockLevels?: ProductCreateRequest["stockLevels"];
    readonly tradeName: string;
  },
): Promise<Product> {
  const request: ProductCreateRequest = {
    arabicSearchName: "صنف اختبار القبول",
    barcodes: [{ kind: "product", value: options.barcode }],
    category: options.category ?? "Acceptance",
    definition: {
      fields: {
        dosageForm: null,
        manufacturer: null,
        strength: null,
        tradeName: options.tradeName,
      },
      mode: "medication",
    },
    idempotencyKey: uuidV7(),
    instructions: {
      foodTiming: "after-food",
      usesPerDay: 3,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    packaging: {
      defaultUnits: {
        count: { kind: "inventory-unit" },
        purchase: options.purchaseUnit ?? { kind: "inventory-unit" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Strip",
      packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
      thirdUnit: null,
    },
    pricing: options.pricing ?? {
      method: "by-price",
      retailPriceFils: "50000",
      wholesalePriceFils: null,
    },
    scientificName: options.scientificName ?? options.tradeName,
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: null },
    stockLevels: options.stockLevels ?? {
      maximumLevel: null,
      minimumLevel: null,
      reorderPoint: null,
    },
  };
  const response = await api.request("POST", "/catalog/products", request);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as Product;
}

async function postPurchase(
  api: LocalApi,
  supplierId: string,
  supplierInvoiceNumber: string,
  rows: readonly {
    readonly expiryDate?: string;
    readonly productId: string;
    readonly quantity: string;
  }[],
): Promise<PurchasePostResult> {
  const created = await api.request("POST", "/purchases/drafts", {
    idempotencyKey: uuidV7(),
    invoiceDate: "2026-09-08",
    settlementContext: "debt",
    supplierId,
    supplierInvoiceNumber,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  let draft = (created.body as { readonly draft: PurchaseDraft }).draft;

  for (const row of rows) {
    const committed = await api.request(
      "POST",
      purchaseDraftRowsPath(draft.id),
      {
        costFils: "80000",
        enteredQuantity: row.quantity,
        expectedVersion: draft.version,
        expiryDate: row.expiryDate ?? "2029-05-31",
        idempotencyKey: uuidV7(),
        itemId: row.productId,
        lotNumber: "ACCEPTANCE-LOT",
        notes: null,
        pricing: { method: "by-price", retailPriceFils: "120000" },
        unit: { kind: "inventory-unit" },
      },
    );
    expect(committed.status, JSON.stringify(committed.body)).toBe(201);
    draft = (committed.body as { readonly draft: PurchaseDraft }).draft;
  }

  const posted = await api.request(
    "POST",
    purchaseDraftPostingsPath(draft.id),
    { expectedVersion: draft.version, idempotencyKey: uuidV7() },
  );
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  return posted.body as PurchasePostResult;
}
