import type {
  PurchaseAdjustmentDraft,
  PurchaseAdjustmentSnapshotRow,
  PurchaseAdjustmentSummary,
} from "@breev/contracts/local-rest";
import {
  canonicalRequestHash,
  type JsonObject,
} from "../posting/canonical-hash.js";

/** One server-owned payload for both preview and Post. Saved rows include
 * unchanged lines: an audit fact must never disappear just because its Delta
 * is zero. Actor authority is revalidated at each boundary, not delegated by
 * this digest. The original is immutable; its correction revision is monotonic. */
export function purchaseAdjustmentConfirmationHash(input: {
  readonly pharmacyId: string;
  readonly draft: Pick<
    PurchaseAdjustmentDraft,
    | "id"
    | "version"
    | "originalPurchaseId"
    | "invoiceDate"
    | "settlementContext"
    | "allowancePercentageSnapshot"
    | "invoiceOffer"
    | "offerRuleVersion"
    | "reason"
    | "evidence"
    | "supplierId"
    | "supplierNameSnapshot"
    | "supplierInvoiceNumber"
  >;
  readonly savedRows: readonly PurchaseAdjustmentSnapshotRow[];
  readonly original: JsonObject;
  readonly current: JsonObject;
  readonly inventory: JsonObject[];
  readonly preview: Omit<PurchaseAdjustmentSummary, "confirmationHash">;
}): string {
  return canonicalRequestHash("purchase.adjustment.confirmation.v1", {
    pharmacyId: input.pharmacyId,
    draft: {
      ...input.draft,
      rows: input.savedRows.map((row) => ({ ...row, unit: { ...row.unit } })),
    },
    original: input.original,
    current: input.current,
    inventory: input.inventory,
    requiredPermissions: [
      "purchases.adjustments.manage",
      "purchases.costs.view",
    ],
    preview: input.preview as JsonObject,
  }).toString("hex");
}
