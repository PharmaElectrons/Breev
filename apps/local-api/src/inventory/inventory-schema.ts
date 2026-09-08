import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const inventoryReceiptClass = pgEnum("inventory_receipt_class", [
  "general-item",
  "general-item-cold-chain",
  "medication",
  "medication-cold-chain",
]);

export const inventoryReceiptClassRules = pgTable(
  "inventory_receipt_class_rules",
  {
    pharmacyId: uuid("pharmacy_id").notNull(),
    class: inventoryReceiptClass().notNull(),
    expiryRequired: boolean("expiry_required").notNull(),
    lotRequired: boolean("lot_required").notNull(),
  },
  (table) => [primaryKey({ columns: [table.pharmacyId, table.class] })],
);

export const inventoryBatches = pgTable(
  "inventory_batches",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    productId: uuid("product_id").notNull(),
    lotNumber: text("lot_number"),
    expiryDate: date("expiry_date"),
    quantity: bigint({ mode: "bigint" }).notNull(),
    status: text().default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    unique("inventory_batches_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    productId: uuid("product_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    reason: text().notNull(),
    quantity: bigint({ mode: "bigint" }).notNull(),
    carryingAmountFils: bigint("carrying_amount_fils", {
      mode: "bigint",
    }).notNull(),
    sourceDocumentType: text("source_document_type").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    sourceRowOrdinal: integer("source_row_ordinal").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    unique("inventory_movements_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
  ],
);

export const inventoryValuationState = pgTable(
  "inventory_valuation_state",
  {
    pharmacyId: uuid("pharmacy_id").notNull(),
    productId: uuid("product_id").notNull(),
    totalQuantity: bigint("total_quantity", { mode: "bigint" })
      .default(0n)
      .notNull(),
    totalValueScaled: numeric("total_value_scaled").default("0").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.pharmacyId, table.productId] })],
);
