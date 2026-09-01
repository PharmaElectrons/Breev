import {
  PRODUCT_DEFINITION_MODES,
  PRODUCT_FOOD_TIMINGS,
  PRODUCT_STATE_COLORS,
  PRODUCT_STATUSES,
} from "@breev/contracts/local-rest";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const catalogProductDefinitionMode = pgEnum(
  "catalog_product_definition_mode",
  PRODUCT_DEFINITION_MODES,
);
export const catalogProductStatus = pgEnum(
  "catalog_product_status",
  PRODUCT_STATUSES,
);
export const catalogProductFoodTiming = pgEnum(
  "catalog_product_food_timing",
  PRODUCT_FOOD_TIMINGS,
);
export const catalogProductStateColour = pgEnum(
  "catalog_product_state_colour",
  PRODUCT_STATE_COLORS,
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    definitionMode: catalogProductDefinitionMode("definition_mode").notNull(),
    medicationTradeName: text("medication_trade_name"),
    medicationStrength: text("medication_strength"),
    medicationDosageForm: text("medication_dosage_form"),
    medicationManufacturer: text("medication_manufacturer"),
    generalCompany: text("general_company"),
    generalSubBrand: text("general_sub_brand"),
    generalTypeOfUse: text("general_type_of_use"),
    generalProperty: text("general_property"),
    generalTargetAudience: text("general_target_audience"),
    generalSize: text("general_size"),
    displayName: text("display_name").notNull(),
    nameTemplateVersion: smallint("name_template_version").notNull(),
    arabicSearchName: text("arabic_search_name"),
    scientificName: text("scientific_name"),
    category: text(),
    usesPerDay: smallint("uses_per_day"),
    usesPerWeek: smallint("uses_per_week"),
    usesPerMonth: smallint("uses_per_month"),
    foodTiming: catalogProductFoodTiming("food_timing"),
    externallyVisible: boolean("externally_visible").notNull(),
    aiSharingAllowed: boolean("ai_sharing_allowed").notNull(),
    manualStateColour: catalogProductStateColour("manual_state_colour"),
    coldStorageRequired: boolean("cold_storage_required").notNull(),
    status: catalogProductStatus().default("active").notNull(),
    mergedIntoProductId: uuid("merged_into_product_id"),
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
    unique("catalog_products_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    check("catalog_products_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const catalogProductBarcodes = pgTable(
  "catalog_product_barcodes",
  {
    pharmacyId: uuid("pharmacy_id").notNull(),
    productId: uuid("product_id").notNull(),
    barcode: text().notNull(),
    ordinal: smallint().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by"),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.barcode] }),
    uniqueIndex("catalog_product_barcodes_active_value_unique")
      .on(table.pharmacyId, table.barcode)
      .where(sql`${table.removedAt} is null`),
    uniqueIndex("catalog_product_barcodes_active_ordinal_unique")
      .on(table.productId, table.ordinal)
      .where(sql`${table.removedAt} is null`),
  ],
);

export const catalogProductSnapshots = pgTable(
  "catalog_product_snapshots",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    productId: uuid("product_id").notNull(),
    displayName: text("display_name").notNull(),
    nameTemplateVersion: smallint("name_template_version").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("catalog_product_snapshots_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
  ],
);
