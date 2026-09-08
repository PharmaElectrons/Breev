import type { ProductDefinitionMode } from "@breev/contracts/local-rest";

/**
 * Which received stock must carry a lot number and a complete expiry date.
 *
 * docs/domain.md §"Catalog, purchasing, and inventory": "Batch carries product,
 * lot where required, acquisition/receipt evidence, expiry, status, and
 * physical quantity... The legal/pharmacist gate decides which product classes
 * require lot and complete expiry at receipt. That decision cannot break the
 * uninterrupted keyboard row flow of purchase entry."
 *
 * ## A configurable rule with an engineering default
 *
 * That gate is **G-02** in docs/open-decisions.md, and it is open. Its
 * confirmed boundary is only that movements and snapshots are mandatory and
 * that the absolute blocks stand; which classes need what is not settled, and
 * the issue calls for the classes to be configurable and defaulted rather than
 * fixed. So this module separates the two questions:
 *
 * - {@link DEFAULT_RECEIPT_CLASS_RULES} is the seed -- Breev engineering's
 *   current default, chosen to be defensible for an Iraqi pharmacy rather than
 *   to anticipate the pharmacist's answer.
 * - {@link checkReceiptEvidence} validates against a *resolved* rule, which the
 *   persistence caller selects. A pharmacy that has configured an override
 *   passes the configured rule; one that has not passes the default. There is
 *   still exactly one policy -- {@link receiptRuleFor} is the only place a
 *   class is turned into a rule, and the override is data flowing through it,
 *   never a second code path.
 *
 * The default itself:
 *
 * - Medicines need a complete expiry date at receipt, because expiry drives a
 *   non-overridable sale block and FEFO picking, and a batch with no expiry
 *   could not participate in either.
 * - Cold-chain stock additionally needs a lot number, because a cold-chain
 *   recall has to reach an identified lot rather than a whole product.
 * - General items need neither by default. Requiring an expiry on a
 *   non-perishable general item would stop the keyboard row flow for evidence
 *   the supplier may not print at all, which the domain rule above forbids.
 *
 * The classes are derived from product facts Catalog already stores, so no
 * caller tests a product field itself.
 *
 * Framework-free: no Nest, Drizzle, PostgreSQL, or transport code. Storing an
 * override is the persistence caller's concern and appears nowhere here.
 */

/** The receipt classes the current default distinguishes. */
export const INVENTORY_RECEIPT_CLASSES = [
  "general-item",
  "general-item-cold-chain",
  "medication",
  "medication-cold-chain",
] as const;
export type InventoryReceiptClass = (typeof INVENTORY_RECEIPT_CLASSES)[number];

export interface InventoryReceiptRule {
  readonly expiryRequired: boolean;
  readonly lotRequired: boolean;
}

/** One rule per class: what a pharmacy's configuration must supply in full. */
export type InventoryReceiptRuleSet = Readonly<
  Record<InventoryReceiptClass, InventoryReceiptRule>
>;

/**
 * The engineering default pending G-02, and the seed a pharmacy's stored
 * configuration starts from. Frozen so that reading it can never be a way to
 * edit the shipped default in place; a configured pharmacy overrides it by
 * passing its own set, not by mutating this one.
 */
export const DEFAULT_RECEIPT_CLASS_RULES: InventoryReceiptRuleSet =
  Object.freeze({
    "general-item": Object.freeze({
      expiryRequired: false,
      lotRequired: false,
    }),
    "general-item-cold-chain": Object.freeze({
      expiryRequired: true,
      lotRequired: false,
    }),
    medication: Object.freeze({ expiryRequired: true, lotRequired: false }),
    "medication-cold-chain": Object.freeze({
      expiryRequired: true,
      lotRequired: true,
    }),
  });

/** The product facts the class is derived from. Both are Catalog's own. */
export interface InventoryReceiptProduct {
  readonly coldStorageRequired: boolean;
  readonly definitionMode: ProductDefinitionMode;
}

/** The receipt evidence a committed purchase row carries. */
export interface InventoryReceiptEvidence {
  readonly expiryDate: string | null;
  readonly lotNumber: string | null;
}

/** What the rule found missing, or `null` when the receipt satisfies it. */
export type InventoryReceiptProblem = "expiry-required" | "lot-required";

export function receiptClassOf(
  product: InventoryReceiptProduct,
): InventoryReceiptClass {
  if (product.definitionMode === "medication") {
    return product.coldStorageRequired ? "medication-cold-chain" : "medication";
  }
  return product.coldStorageRequired
    ? "general-item-cold-chain"
    : "general-item";
}

/**
 * Selects the rule that governs one product's receipt.
 *
 * `rules` is the pharmacy's configured set when it has one, and the shipped
 * default otherwise. Passing the whole set rather than a partial patch keeps
 * the resolution total: there is no merge order to reason about and no class
 * that could silently fall through to a different answer than the caller read.
 */
export function receiptRuleFor(
  product: InventoryReceiptProduct,
  rules: InventoryReceiptRuleSet = DEFAULT_RECEIPT_CLASS_RULES,
): InventoryReceiptRule {
  return rules[receiptClassOf(product)];
}

/**
 * Checks one row's receipt evidence against the rule that governs it.
 *
 * This takes the resolved rule rather than the product, so the decision about
 * *which* rule applies -- default or configured -- is made once by the caller
 * that holds the pharmacy's configuration, and the validation itself has no
 * opinion about where the rule came from.
 *
 * Expiry is checked before lot so a row missing both reports the fact that
 * blocks a sale, not the one that only limits a recall.
 */
export function checkReceiptEvidence(
  rule: InventoryReceiptRule,
  evidence: InventoryReceiptEvidence,
): InventoryReceiptProblem | null {
  if (rule.expiryRequired && evidence.expiryDate === null) {
    return "expiry-required";
  }
  if (rule.lotRequired && evidence.lotNumber === null) {
    return "lot-required";
  }
  return null;
}
