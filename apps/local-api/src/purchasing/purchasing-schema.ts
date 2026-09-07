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
]);
export const purchaseEnteredUnitKind = pgEnum("purchase_entered_unit_kind", [
  "inventory-unit",
  "package-unit",
]);
export const purchaseAfterCommit = pgEnum("purchase_after_commit", [
  "new-row",
  "return-to-item",
]);

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
