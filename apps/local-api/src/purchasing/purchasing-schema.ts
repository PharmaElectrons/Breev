import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { catalogPricingMethod } from "../catalog/catalog-schema.js";

export const supplierStatus = pgEnum("supplier_status", [
  "active",
  "archived",
  "merged",
]);
export const purchaseSettlementContext = pgEnum("purchase_settlement_context", [
  "cash",
  "debt",
]);
export const purchaseDraftStatus = pgEnum("purchase_draft_status", [
  "active",
  "discarded",
  "posted",
]);
export const purchaseEnteredUnitKind = pgEnum("purchase_entered_unit_kind", [
  "inventory-unit",
  "package-unit",
]);
export const purchaseAfterCommit = pgEnum("purchase_after_commit", [
  "new-row",
  "return-to-item",
]);
export const purchaseAdjustmentReason = pgEnum("purchase_adjustment_reason", [
  "quantity error",
  "price error",
  "invoice-number error",
  "supplier error",
  "other",
]);
export const purchaseAdjustmentDraftStatus = pgEnum(
  "purchase_adjustment_draft_status",
  ["active", "discarded", "posted"],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    name: text().notNull(),
    terms: text(),
    status: supplierStatus().default("active").notNull(),
    mergedIntoSupplierId: uuid("merged_into_supplier_id"),
    revision: bigint({ mode: "bigint" }).default(1n).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedBy: uuid("updated_by").notNull(),
  },
  (table) => [
    unique("suppliers_id_pharmacy_unique").on(table.id, table.pharmacyId),
  ],
);

export const supplierAllowanceRates = pgTable(
  "supplier_allowance_rates",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    allowancePercentage: numeric("allowance_percentage", {
      precision: 9,
      scale: 6,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    recordedBy: uuid("recorded_by").notNull(),
  },
  (table) => [
    unique("supplier_allowance_rates_supplier_date_unique").on(
      table.supplierId,
      table.effectiveFrom,
    ),
  ],
);

export const purchaseDrafts = pgTable(
  "purchase_drafts",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    supplierInvoiceNumber: text("supplier_invoice_number").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    supplierNameSnapshot: text("supplier_name_snapshot").notNull(),
    settlementContext:
      purchaseSettlementContext("settlement_context").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    allowancePercentageSnapshot: numeric("allowance_percentage_snapshot", {
      precision: 9,
      scale: 6,
    }).notNull(),
    allowanceBasisFils: bigint("allowance_basis_fils", { mode: "bigint" })
      .default(0n)
      .notNull(),
    status: purchaseDraftStatus().default("active").notNull(),
    version: bigint({ mode: "bigint" }).default(1n).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedBy: uuid("updated_by").notNull(),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedBy: uuid("discarded_by"),
  },
  (table) => [
    unique("purchase_drafts_id_pharmacy_unique").on(table.id, table.pharmacyId),
  ],
);

export const purchaseDraftRows = pgTable(
  "purchase_draft_rows",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    ordinal: integer().notNull(),
    productId: uuid("product_id").notNull(),
    itemDisplayName: text("item_display_name").notNull(),
    inventoryUnitName: text("inventory_unit_name").notNull(),
    enteredUnitKind: purchaseEnteredUnitKind("entered_unit_kind").notNull(),
    enteredPackageUnitName: text("entered_package_unit_name"),
    baseUnitsPerEnteredUnit: bigint("base_units_per_entered_unit", {
      mode: "bigint",
    }).notNull(),
    enteredQuantity: bigint("entered_quantity", { mode: "bigint" }).notNull(),
    inventoryUnitQuantity: bigint("inventory_unit_quantity", {
      mode: "bigint",
    }).notNull(),
    primarySupplierCostFils: bigint("primary_supplier_cost_fils", {
      mode: "bigint",
    }).notNull(),
    pricingMethod: catalogPricingMethod("pricing_method").notNull(),
    retailPriceFils: bigint("retail_price_fils", { mode: "bigint" }).notNull(),
    marginPercentage: numeric("margin_percentage", { precision: 9, scale: 6 }),
    expiryDate: date("expiry_date"),
    lotNumber: text("lot_number"),
    notes: text(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    unique("purchase_draft_rows_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    unique("purchase_draft_rows_draft_ordinal_unique").on(
      table.draftId,
      table.ordinal,
    ),
  ],
);

export const postedPurchases = pgTable(
  "posted_purchases",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    supplierNameSnapshot: text("supplier_name_snapshot").notNull(),
    supplierInvoiceNumber: text("supplier_invoice_number").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    settlementContext:
      purchaseSettlementContext("settlement_context").notNull(),
    allowancePercentageSnapshot: numeric("allowance_percentage_snapshot", {
      precision: 9,
      scale: 6,
    }).notNull(),
    allowanceBasisFils: bigint("allowance_basis_fils", {
      mode: "bigint",
    }).notNull(),
    allowanceFils: bigint("allowance_fils", { mode: "bigint" }).notNull(),
    costAfterDiscountFils: bigint("cost_after_discount_fils", {
      mode: "bigint",
    }).notNull(),
    primarySupplierCostFils: bigint("primary_supplier_cost_fils", {
      mode: "bigint",
    }).notNull(),
    numberValue: bigint("number_value", { mode: "bigint" }).notNull(),
    numberYear: integer("number_year").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    postedBy: uuid("posted_by").notNull(),
  },
  (table) => [
    unique("posted_purchases_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    unique("posted_purchases_draft_unique").on(table.draftId),
    unique("posted_purchases_number_unique").on(
      table.pharmacyId,
      table.numberYear,
      table.numberValue,
    ),
  ],
);

export const postedPurchaseRows = pgTable(
  "posted_purchase_rows",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    postedPurchaseId: uuid("posted_purchase_id").notNull(),
    draftRowId: uuid("draft_row_id").notNull(),
    ordinal: integer().notNull(),
    productId: uuid("product_id").notNull(),
    itemDisplayName: text("item_display_name").notNull(),
    inventoryUnitName: text("inventory_unit_name").notNull(),
    enteredUnitKind: purchaseEnteredUnitKind("entered_unit_kind").notNull(),
    enteredPackageUnitName: text("entered_package_unit_name"),
    baseUnitsPerEnteredUnit: bigint("base_units_per_entered_unit", {
      mode: "bigint",
    }).notNull(),
    enteredQuantity: bigint("entered_quantity", { mode: "bigint" }).notNull(),
    inventoryUnitQuantity: bigint("inventory_unit_quantity", {
      mode: "bigint",
    }).notNull(),
    primarySupplierCostFils: bigint("primary_supplier_cost_fils", {
      mode: "bigint",
    }).notNull(),
    linePrimarySupplierCostFils: bigint("line_primary_supplier_cost_fils", {
      mode: "bigint",
    }).notNull(),
    costAfterDiscountFils: bigint("cost_after_discount_fils", {
      mode: "bigint",
    }).notNull(),
    pricingMethod: catalogPricingMethod("pricing_method").notNull(),
    retailPriceFils: bigint("retail_price_fils", { mode: "bigint" }).notNull(),
    marginPercentage: numeric("margin_percentage", { precision: 9, scale: 6 }),
    priceCapture: text("price_capture").notNull(),
    expiryDate: date("expiry_date"),
    lotNumber: text("lot_number"),
    notes: text(),
    batchId: uuid("batch_id").notNull(),
    movementId: uuid("movement_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("posted_purchase_rows_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    unique("posted_purchase_rows_purchase_ordinal_unique").on(
      table.postedPurchaseId,
      table.ordinal,
    ),
  ],
);

export const purchaseAdjustmentDrafts = pgTable(
  "purchase_adjustment_drafts",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    originalPurchaseId: uuid("original_purchase_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    supplierNameSnapshot: text("supplier_name_snapshot").notNull(),
    supplierInvoiceNumber: text("supplier_invoice_number").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    settlementContext:
      purchaseSettlementContext("settlement_context").notNull(),
    allowancePercentageSnapshot: numeric("allowance_percentage_snapshot", {
      precision: 9,
      scale: 6,
    }).notNull(),
    reason: purchaseAdjustmentReason().notNull(),
    evidence: text(),
    status: purchaseAdjustmentDraftStatus().default("active").notNull(),
    version: bigint({ mode: "bigint" }).default(1n).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedBy: uuid("updated_by").notNull(),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedBy: uuid("discarded_by"),
  },
  (table) => [
    unique("purchase_adjustment_drafts_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
  ],
);

export const purchaseAdjustmentDraftRows = pgTable(
  "purchase_adjustment_draft_rows",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    lineageId: uuid("lineage_id").notNull(),
    originalRowId: uuid("original_row_id"),
    ordinal: integer().notNull(),
    productId: uuid("product_id").notNull(),
    itemDisplayName: text("item_display_name").notNull(),
    inventoryUnitName: text("inventory_unit_name").notNull(),
    enteredUnitKind: purchaseEnteredUnitKind("entered_unit_kind").notNull(),
    enteredPackageUnitName: text("entered_package_unit_name"),
    baseUnitsPerEnteredUnit: bigint("base_units_per_entered_unit", {
      mode: "bigint",
    }).notNull(),
    enteredQuantity: bigint("entered_quantity", { mode: "bigint" }).notNull(),
    inventoryUnitQuantity: bigint("inventory_unit_quantity", {
      mode: "bigint",
    }).notNull(),
    primarySupplierCostFils: bigint("primary_supplier_cost_fils", {
      mode: "bigint",
    }).notNull(),
    pricingMethod: catalogPricingMethod("pricing_method").notNull(),
    retailPriceFils: bigint("retail_price_fils", { mode: "bigint" }).notNull(),
    marginPercentage: numeric("margin_percentage", { precision: 9, scale: 6 }),
    expiryDate: date("expiry_date"),
    lotNumber: text("lot_number"),
    notes: text(),
    batchId: uuid("batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("purchase_adjustment_draft_rows_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    unique("purchase_adjustment_draft_rows_draft_lineage_unique").on(
      table.draftId,
      table.lineageId,
    ),
  ],
);

export const postedPurchaseAdjustments = pgTable(
  "posted_purchase_adjustments",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    originalPurchaseId: uuid("original_purchase_id").notNull(),
    suffixValue: bigint("suffix_value", { mode: "bigint" }).notNull(),
    supplierId: uuid("supplier_id").notNull(),
    supplierNameSnapshot: text("supplier_name_snapshot").notNull(),
    supplierInvoiceNumber: text("supplier_invoice_number").notNull(),
    reason: purchaseAdjustmentReason().notNull(),
    evidence: text(),
    quantityDelta: bigint("quantity_delta", { mode: "bigint" }).notNull(),
    primarySupplierCostDeltaFils: bigint("primary_supplier_cost_delta_fils", {
      mode: "bigint",
    }).notNull(),
    allowanceDeltaFils: bigint("allowance_delta_fils", {
      mode: "bigint",
    }).notNull(),
    costAfterDiscountDeltaFils: bigint("cost_after_discount_delta_fils", {
      mode: "bigint",
    }).notNull(),
    headerChanges: jsonb("header_changes").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    postedBy: uuid("posted_by").notNull(),
  },
  (table) => [
    unique("posted_purchase_adjustments_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    unique("posted_purchase_adjustments_draft_unique").on(table.draftId),
    unique("posted_purchase_adjustments_original_suffix_unique").on(
      table.originalPurchaseId,
      table.suffixValue,
    ),
  ],
);

export const postedPurchaseAdjustmentRows = pgTable(
  "posted_purchase_adjustment_rows",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    adjustmentId: uuid("adjustment_id").notNull(),
    lineageId: uuid("lineage_id").notNull(),
    originalRowId: uuid("original_row_id"),
    ordinal: integer().notNull(),
    effectKind: text("effect_kind").notNull(),
    beforeSnapshot: jsonb("before_snapshot"),
    afterSnapshot: jsonb("after_snapshot"),
    changes: jsonb().notNull(),
    quantityDelta: bigint("quantity_delta", { mode: "bigint" }).notNull(),
    primarySupplierCostDeltaFils: bigint("primary_supplier_cost_delta_fils", {
      mode: "bigint",
    }).notNull(),
    batchId: uuid("batch_id"),
    movementId: uuid("movement_id"),
    valueEffectId: uuid("value_effect_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("posted_purchase_adjustment_rows_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    unique("posted_purchase_adjustment_rows_adjustment_lineage_unique").on(
      table.adjustmentId,
      table.lineageId,
    ),
  ],
);

export const purchaseEntryPreferences = pgTable(
  "purchase_entry_preferences",
  {
    pharmacyId: uuid("pharmacy_id").notNull(),
    userId: uuid("user_id").notNull(),
    columns: jsonb().notNull(),
    afterCommit: purchaseAfterCommit("after_commit").notNull(),
    detailsPanelFields: jsonb("details_panel_fields").notNull(),
    revision: bigint({ mode: "bigint" }).default(1n).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedBy: uuid("updated_by").notNull(),
  },
  (table) => [primaryKey({ columns: [table.pharmacyId, table.userId] })],
);
