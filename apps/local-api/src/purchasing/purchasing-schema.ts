import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

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
