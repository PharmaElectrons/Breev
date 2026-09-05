import {
  PRICE_ROUNDING_SETTINGS,
  PRODUCT_DEFINITION_MODES,
  PRODUCT_FOOD_TIMINGS,
  PRODUCT_PRICING_METHODS,
  PRODUCT_STATE_COLORS,
  PRODUCT_STATUSES,
} from "@breev/contracts/local-rest";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  numeric,
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
export const catalogUnitKind = pgEnum("catalog_unit_kind", [
  "inventory",
  "package",
]);
export const catalogPricingMethod = pgEnum(
  "catalog_pricing_method",
  PRODUCT_PRICING_METHODS,
);
export const catalogPriceRounding = pgEnum(
  "catalog_price_rounding",
  PRICE_ROUNDING_SETTINGS,
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
    countDefaultUnitId: uuid("count_default_unit_id").notNull(),
    purchaseDefaultUnitId: uuid("purchase_default_unit_id").notNull(),
    saleDefaultUnitId: uuid("sale_default_unit_id").notNull(),
    pricingMethod: catalogPricingMethod("pricing_method")
      .default("by-price")
      .notNull(),
    retailPriceFils: bigint("retail_price_fils", { mode: "bigint" }).notNull(),
    wholesalePriceFils: bigint("wholesale_price_fils", { mode: "bigint" }),
    marginPercentage: numeric("margin_percentage"),
    priceRounding: catalogPriceRounding("price_rounding"),
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
    check(
      "catalog_products_pricing_state",
      sql`${table.retailPriceFils} >= 0
          and (${table.wholesalePriceFils} is null or ${table.wholesalePriceFils} >= 0)
          and (${table.marginPercentage} is null or scale(${table.marginPercentage}) <= 6)
          and (
            (
              ${table.pricingMethod} = 'by-percentage'
              and ${table.marginPercentage} is not null
              and ${table.marginPercentage} >= 0
              and ${table.marginPercentage} < 100
              and ${table.priceRounding} is not null
            )
            or (
              ${table.pricingMethod} = 'by-price'
              and ${table.marginPercentage} is null
              and ${table.priceRounding} is null
            )
          )`,
    ),
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
    inventoryUnitName: text("inventory_unit_name").notNull(),
    thirdUnitName: text("third_unit_name"),
    pricingMethod: catalogPricingMethod("pricing_method").notNull(),
    retailPriceFils: bigint("retail_price_fils", { mode: "bigint" }).notNull(),
    wholesalePriceFils: bigint("wholesale_price_fils", { mode: "bigint" }),
    marginPercentage: numeric("margin_percentage"),
    priceRounding: catalogPriceRounding("price_rounding"),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("catalog_product_snapshots_id_pharmacy_unique").on(
      table.id,
      table.pharmacyId,
    ),
    check(
      "catalog_product_snapshots_pricing_state",
      sql`${table.retailPriceFils} >= 0
          and (${table.wholesalePriceFils} is null or ${table.wholesalePriceFils} >= 0)
          and (${table.marginPercentage} is null or scale(${table.marginPercentage}) <= 6)
          and (
            (
              ${table.pricingMethod} = 'by-percentage'
              and ${table.marginPercentage} is not null
              and ${table.marginPercentage} >= 0
              and ${table.marginPercentage} < 100
              and ${table.priceRounding} is not null
            )
            or (
              ${table.pricingMethod} = 'by-price'
              and ${table.marginPercentage} is null
              and ${table.priceRounding} is null
            )
          )`,
    ),
  ],
);

export const catalogProductUnits = pgTable(
  "catalog_product_units",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    productId: uuid("product_id").notNull(),
    kind: catalogUnitKind().notNull(),
    name: text().notNull(),
    ordinal: smallint().notNull(),
    baseUnitsPerPackage: bigint("base_units_per_package", { mode: "bigint" }),
  },
  (table) => [
    unique("catalog_product_units_id_product_unique").on(
      table.id,
      table.productId,
    ),
    unique("catalog_product_units_product_name_unique").on(
      table.productId,
      table.name,
    ),
    unique("catalog_product_units_product_ordinal_unique").on(
      table.productId,
      table.ordinal,
    ),
    uniqueIndex("catalog_product_units_one_inventory_unique")
      .on(table.productId)
      .where(sql`${table.kind} = 'inventory'`),
    check(
      "catalog_product_units_ordinal_state",
      sql`(${table.kind} = 'inventory' and ${table.ordinal} = 0)
          or (${table.kind} = 'package' and ${table.ordinal} > 0)`,
    ),
    check(
      "catalog_product_units_ratio_state",
      sql`(${table.kind} = 'inventory' and ${table.baseUnitsPerPackage} is null)
          or (${table.kind} = 'package' and ${table.baseUnitsPerPackage} is not null)`,
    ),
    check(
      "catalog_product_units_ratio_range",
      sql`${table.baseUnitsPerPackage} is null
          or ${table.baseUnitsPerPackage} > 0`,
    ),
  ],
);

export const catalogProductThirdUnits = pgTable("catalog_product_third_units", {
  pharmacyId: uuid("pharmacy_id").notNull(),
  productId: uuid("product_id").primaryKey(),
  name: text().notNull(),
});

export const catalogProductSnapshotPackageUnits = pgTable(
  "catalog_product_snapshot_package_units",
  {
    pharmacyId: uuid("pharmacy_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    name: text().notNull(),
    baseUnitsPerPackage: bigint("base_units_per_package", {
      mode: "bigint",
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.name] }),
    check(
      "catalog_product_snapshot_package_units_ratio_range",
      sql`${table.baseUnitsPerPackage} > 0`,
    ),
  ],
);
