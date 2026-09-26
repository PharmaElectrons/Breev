import type { SaleDraftLine } from "@breev/contracts/local-rest";
import type { PoolClient } from "pg";

export interface SaleLineRecord {
  readonly id: string;
  readonly draftId: string;
  readonly kind: "catalog" | "misc";
  readonly productId: string | null;
  readonly displayName: string;
  readonly unitId: string | null;
  readonly unitName: string;
  readonly baseUnitsPerUnit: string;
  readonly eligibleUnits: readonly {
    unitId: string;
    unitName: string;
    baseUnitsPerUnit: string;
  }[];
  readonly quantity: string;
  readonly capturedRetailPriceFils: string;
  readonly capturedUnitRatio: string;
  readonly unitPriceFils: string;
  readonly priceVersion: string | null;
  readonly priceCapturedAt: string;
  readonly priceSource: "retail" | "misc" | "manual";
  readonly priceOverrideReason: string | null;
  readonly lineDiscountPercentage: string;
  readonly ordinal: string;
}

interface LineRow {
  readonly id: string;
  readonly draft_id: string;
  readonly line_kind: "catalog" | "misc";
  readonly product_id: string | null;
  readonly display_name: string;
  readonly unit_id: string | null;
  readonly unit_name: string;
  readonly base_units_per_unit: string;
  readonly eligible_units: SaleLineRecord["eligibleUnits"];
  readonly quantity: string;
  readonly captured_retail_price_fils: string;
  readonly captured_unit_ratio: string;
  readonly unit_price_fils: string;
  readonly price_version: string | null;
  readonly price_captured_at: string;
  readonly price_source: "retail" | "misc" | "manual";
  readonly price_override_reason: string | null;
  readonly line_discount_percentage: string;
  readonly ordinal: string;
}

const COLUMNS = `id, draft_id, line_kind, product_id, display_name, unit_id, unit_name,
 base_units_per_unit::text, eligible_units, quantity::text,
 captured_retail_price_fils::text, captured_unit_ratio::text,
 unit_price_fils::text, price_version::text, price_captured_at::text,
 price_source, price_override_reason,
 line_discount_percentage::text, ordinal::text`;

export async function resolveRetailProduct(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<
  | {
      readonly productId: string;
      readonly displayName: string;
      readonly priceVersion: string;
      readonly retailPriceFils: string;
      readonly unitId: string;
      readonly unitName: string;
      readonly baseUnitsPerUnit: string;
      readonly eligibleUnits: SaleLineRecord["eligibleUnits"];
    }
  | undefined
> {
  const product = await client.query<{
    id: string;
    display_name: string;
    revision: string;
    retail_price_fils: string;
    sale_default_unit_id: string;
  }>(
    `select id, display_name, revision::text, retail_price_fils::text, sale_default_unit_id
      from catalog_products where pharmacy_id=$1 and id=$2 and status='active' for share`,
    [pharmacyId, productId],
  );
  const row = product.rows[0];
  if (row === undefined) return undefined;
  const units = await client.query<{ id: string; name: string; ratio: string }>(
    `select id, name, coalesce(base_units_per_package, 1)::text as ratio
     from catalog_product_units where pharmacy_id=$1 and product_id=$2 order by ordinal`,
    [pharmacyId, productId],
  );
  const eligibleUnits = units.rows.map((unit) => ({
    unitId: unit.id,
    unitName: unit.name,
    baseUnitsPerUnit: unit.ratio,
  }));
  const selected = eligibleUnits.find(
    (unit) => unit.unitId === row.sale_default_unit_id,
  );
  if (selected === undefined) throw new Error("Catalog Sale Unit missing");
  return {
    productId: row.id,
    displayName: row.display_name,
    priceVersion: row.revision,
    retailPriceFils: row.retail_price_fils,
    unitId: selected.unitId,
    unitName: selected.unitName,
    baseUnitsPerUnit: selected.baseUnitsPerUnit,
    eligibleUnits,
  };
}

export async function listSaleLines(
  client: PoolClient,
  pharmacyId: string,
  draftIds: readonly string[],
): Promise<readonly SaleLineRecord[]> {
  if (draftIds.length === 0) return [];
  const result = await client.query<LineRow>(
    `select ${COLUMNS} from sale_draft_lines
     where pharmacy_id = $1 and draft_id = any($2::uuid[])
     order by draft_id, ordinal`,
    [pharmacyId, draftIds],
  );
  return result.rows.map(mapLine);
}

export async function addSaleLine(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly draftId: string;
    readonly productId: string;
    readonly displayName: string;
    readonly unitId: string;
    readonly unitName: string;
    readonly baseUnitsPerUnit: string;
    readonly eligibleUnits: SaleLineRecord["eligibleUnits"];
    readonly retailPriceFils: string;
    readonly capturedUnitRatio: string;
    readonly unitPriceFils: string;
    readonly priceVersion: string;
  },
): Promise<void> {
  await client.query(
    `insert into sale_draft_lines (
       pharmacy_id, draft_id, product_id, display_name, unit_id, unit_name,
       base_units_per_unit, eligible_units, quantity,
       captured_retail_price_fils, captured_unit_ratio, unit_price_fils,
       price_version, ordinal
     ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9,$10,$11,$12,
       (select coalesce(max(ordinal), 0) + 1 from sale_draft_lines
        where pharmacy_id = $1 and draft_id = $2))`,
    [
      input.pharmacyId,
      input.draftId,
      input.productId,
      input.displayName,
      input.unitId,
      input.unitName,
      input.baseUnitsPerUnit,
      JSON.stringify(input.eligibleUnits),
      input.retailPriceFils,
      input.capturedUnitRatio,
      input.unitPriceFils,
      input.priceVersion,
    ],
  );
}

export async function addMiscSaleLine(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly draftId: string;
    readonly displayName: string;
    readonly unitName: string;
    readonly quantity: string;
    readonly unitPriceFils: string;
  },
): Promise<void> {
  await client.query(
    `insert into sale_draft_lines (
       pharmacy_id, draft_id, line_kind, display_name, unit_name,
       base_units_per_unit, eligible_units, quantity,
       captured_retail_price_fils, captured_unit_ratio, unit_price_fils,
       cost_fils, price_source, ordinal
     ) values ($1,$2,'misc',$3,$4,1,'[]'::jsonb,$5,$6,1,$6,0,'misc',
       (select coalesce(max(ordinal), 0) + 1 from sale_draft_lines
        where pharmacy_id = $1 and draft_id = $2))`,
    [
      input.pharmacyId,
      input.draftId,
      input.displayName,
      input.unitName,
      input.quantity,
      input.unitPriceFils,
    ],
  );
}

export async function changeSaleLine(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
  lineId: string,
  input: {
    unitId: string | null;
    unitName: string;
    baseUnitsPerUnit: string;
    quantity: string;
    unitPriceFils: string;
    lineDiscountPercentage: string;
    priceSource: "retail" | "misc" | "manual";
    priceOverrideReason: string | null;
  },
): Promise<void> {
  await client.query(
    `update sale_draft_lines set unit_id=$4, unit_name=$5, base_units_per_unit=$6,
       quantity=$7, unit_price_fils=$8, line_discount_percentage=$9,
       price_source=$10, price_override_reason=$11
     where pharmacy_id=$1 and draft_id=$2 and id=$3`,
    [
      pharmacyId,
      draftId,
      lineId,
      input.unitId,
      input.unitName,
      input.baseUnitsPerUnit,
      input.quantity,
      input.unitPriceFils,
      input.lineDiscountPercentage,
      input.priceSource,
      input.priceOverrideReason,
    ],
  );
}

export async function overrideSaleLinePrice(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly draftId: string;
    readonly lineId: string;
    readonly unitPriceFils: string;
    readonly currentRetailPriceFils: string;
    readonly currentUnitRatio: string;
    readonly currentPriceVersion: string;
    readonly reason: string;
  },
): Promise<void> {
  await client.query(
    `update sale_draft_lines
     set unit_price_fils=$4, captured_retail_price_fils=$5,
         captured_unit_ratio=$6, price_version=$7,
         price_captured_at=statement_timestamp(),
         price_source='manual', price_override_reason=$8
     where pharmacy_id=$1 and draft_id=$2 and id=$3 and line_kind='catalog'`,
    [
      input.pharmacyId,
      input.draftId,
      input.lineId,
      input.unitPriceFils,
      input.currentRetailPriceFils,
      input.currentUnitRatio,
      input.currentPriceVersion,
      input.reason,
    ],
  );
}

export async function removeSaleLine(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
  lineId: string,
): Promise<void> {
  await client.query(
    `delete from sale_draft_lines where pharmacy_id=$1 and draft_id=$2 and id=$3`,
    [pharmacyId, draftId, lineId],
  );
}

export async function clearSaleLines(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<void> {
  await client.query(
    `delete from sale_draft_lines where pharmacy_id=$1 and draft_id=$2`,
    [pharmacyId, draftId],
  );
}

export function lineView(line: SaleLineRecord): SaleDraftLine {
  const gross = BigInt(line.quantity) * BigInt(line.unitPriceFils);
  const discount = (gross * BigInt(line.lineDiscountPercentage) + 50n) / 100n;
  return {
    id: line.id,
    kind: line.kind,
    productId: line.productId,
    displayName: line.displayName,
    unitId: line.unitId,
    unitName: line.unitName,
    eligibleUnits: [...line.eligibleUnits],
    quantity: line.quantity,
    unitPriceFils: line.unitPriceFils,
    priceSource: line.priceSource,
    priceOverrideReason: line.priceOverrideReason,
    priceVersion: line.priceVersion,
    priceCapturedAt: new Date(line.priceCapturedAt).toISOString(),
    lineDiscountPercentage: line.lineDiscountPercentage,
    grossFils: gross.toString(),
    discountFils: discount.toString(),
    totalFils: (gross - discount).toString(),
  };
}

function mapLine(row: LineRow): SaleLineRecord {
  return {
    id: row.id,
    draftId: row.draft_id,
    kind: row.line_kind,
    productId: row.product_id,
    displayName: row.display_name,
    unitId: row.unit_id,
    unitName: row.unit_name,
    baseUnitsPerUnit: row.base_units_per_unit,
    eligibleUnits: row.eligible_units,
    quantity: row.quantity,
    capturedRetailPriceFils: row.captured_retail_price_fils,
    capturedUnitRatio: row.captured_unit_ratio,
    unitPriceFils: row.unit_price_fils,
    priceVersion: row.price_version,
    priceCapturedAt: row.price_captured_at,
    priceSource: row.price_source,
    priceOverrideReason: row.price_override_reason,
    lineDiscountPercentage: row.line_discount_percentage,
    ordinal: row.ordinal,
  };
}
