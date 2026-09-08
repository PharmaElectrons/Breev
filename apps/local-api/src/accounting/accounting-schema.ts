import { sql } from "drizzle-orm";
import {
  bigint,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const accountingJournalEntries = pgTable(
  "accounting_journal_entries",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    postedBy: uuid("posted_by").notNull(),
  },
  (table) => [
    unique("accounting_journal_entries_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
  ],
);

export const accountingJournalLines = pgTable(
  "accounting_journal_lines",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    ordinal: integer().notNull(),
    accountCode: text("account_code").notNull(),
    supplierId: uuid("supplier_id"),
    debitFils: bigint("debit_fils", { mode: "bigint" }).default(0n).notNull(),
    creditFils: bigint("credit_fils", { mode: "bigint" }).default(0n).notNull(),
  },
  (table) => [
    unique("accounting_journal_lines_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    unique("accounting_journal_lines_entry_ordinal_unique").on(
      table.entryId,
      table.ordinal,
    ),
  ],
);

export const accountingSupplierBalances = pgTable(
  "accounting_supplier_balances",
  {
    pharmacyId: uuid("pharmacy_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    balanceFils: bigint("balance_fils", { mode: "bigint" })
      .default(0n)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.pharmacyId, table.supplierId] })],
);

export const accountingCashBoxBalances = pgTable(
  "accounting_cash_box_balances",
  {
    pharmacyId: uuid("pharmacy_id").primaryKey(),
    balanceFils: bigint("balance_fils", { mode: "bigint" })
      .default(0n)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);
