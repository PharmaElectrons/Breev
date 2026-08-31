import {
  PRODUCT_NAME_TEMPLATE_VERSIONS,
  type ProductDefinition,
  type ProductDefinitionMode,
  type ProductNameTemplateVersion,
} from "@breev/contracts/local-rest";

/**
 * The approved product naming templates, expressed without a database, a
 * request, or a screen.
 *
 * Breev generates a Product's English display name from separate approved
 * fields; it is never unrelated free text (`docs/domain.md` §Catalog,
 * purchasing, and inventory). Every decision that turns fields into a name
 * lives in this file as a total function of its inputs, so each template, each
 * absent optional part, and each version can be proven without PostgreSQL,
 * Nest, or React.
 *
 * Two rules are structural here rather than merely documented:
 *
 * - The Arabic search name is not a parameter of any function below. It is a
 *   sibling field on the Product, displayed on its own line beneath the English
 *   name, and no code path can concatenate it into the English display because
 *   no code path is ever given it.
 * - The template version is an explicit argument, never an ambient constant. A
 *   Product stores the version its name was generated under, so a later
 *   template revision cannot silently rewrite a name that already exists.
 */

/**
 * The naming fields of each mode, taken from the contract rather than restated,
 * so the generator and the wire can never disagree about what a mode holds.
 *
 * Medication Mode is Trade Name → Strength → Dosage Form → Manufacturer.
 * General/Medical/Cosmetic Item Mode is Company → Sub-brand/Series → Type/Use →
 * Property/Degree → Target/Audience → Size/Volume. The first field of each is
 * mandatory; every later one is optional and skips cleanly when absent.
 */
export type ProductNameFieldsByMode = {
  readonly [TMode in ProductDefinitionMode]: Extract<
    ProductDefinition,
    { mode: TMode }
  >["fields"];
};

export type MedicationNameFields = ProductNameFieldsByMode["medication"];
export type GeneralItemNameFields = ProductNameFieldsByMode["general-item"];

export const CURRENT_PRODUCT_NAME_TEMPLATE_VERSION = 1 as const;

type ProductNameTemplate = {
  readonly [
    TMode in ProductDefinitionMode
  ]: readonly (keyof ProductNameFieldsByMode[TMode])[];
};

/**
 * One approved template exists. A revision adds a version here instead of
 * editing this entry, because Products already carry version 1 and must keep
 * regenerating the exact string they were stored with.
 */
export const PRODUCT_NAME_TEMPLATES: Readonly<
  Record<ProductNameTemplateVersion, ProductNameTemplate>
> = {
  1: {
    "general-item": [
      "company",
      "subBrand",
      "typeOfUse",
      "property",
      "targetAudience",
      "size",
    ],
    medication: ["tradeName", "strength", "dosageForm", "manufacturer"],
  },
};

const DISPLAY_NAME_PART_SEPARATOR = " ";
const COLLAPSIBLE_WHITESPACE = /\s+/gu;

/**
 * Joins the parts a template names, in the template's order, skipping the ones
 * that are not there.
 *
 * "Skips cleanly" is achieved by construction rather than by cleanup: an absent
 * or blank part is never pushed, so the join can leave no doubled separator, no
 * leading separator, and no trailing separator whatever combination of optional
 * parts is missing. Each surviving part is trimmed and its internal runs of
 * whitespace collapsed, so a value typed with stray spacing cannot smuggle a
 * doubled separator into the middle of a name.
 *
 * The joiner reads only the keys the template lists. A field no template names
 * — the Arabic search name above all — cannot reach the English display even
 * when it rides along on the record the caller passes in.
 */
export function composeDisplayName(
  fieldOrder: readonly string[],
  fields: Readonly<Record<string, string | null>>,
): string {
  const parts: string[] = [];
  for (const field of fieldOrder) {
    const value = fields[field];
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim().replace(COLLAPSIBLE_WHITESPACE, " ");
    if (normalized.length > 0) {
      parts.push(normalized);
    }
  }
  return parts.join(DISPLAY_NAME_PART_SEPARATOR);
}

/**
 * The Product display name for one mode's fields under one approved template
 * version.
 *
 * Deterministic and total: the same inputs always produce the same string, and
 * no combination of absent optional parts throws. The result is not an
 * identity — two legitimately distinct Products may generate the same string,
 * and uniqueness belongs to the internal ID, SKU, barcode, and registration
 * number instead.
 */
export function generateDisplayName<TMode extends ProductDefinitionMode>(
  mode: TMode,
  fields: ProductNameFieldsByMode[TMode],
  templateVersion: ProductNameTemplateVersion,
): string {
  return composeDisplayName(
    PRODUCT_NAME_TEMPLATES[templateVersion][mode],
    fields,
  );
}

export function isProductNameTemplateVersion(
  value: number,
): value is ProductNameTemplateVersion {
  return (PRODUCT_NAME_TEMPLATE_VERSIONS as readonly number[]).includes(value);
}
