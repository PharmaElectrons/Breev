import {
  purchaseInvoiceOfferInputSchema,
  type PurchaseInvoiceOfferInput,
  type PurchaseInvoiceOfferSnapshot,
} from "@breev/contracts/local-rest";
import {
  allocateFilsProportionally,
  iqdFils,
  parseRateString,
  rateOfFils,
  REMAINDER_ALLOCATION_RULE,
  ROUNDING_RULE,
} from "../posting/money.js";
import {
  calculatePurchaseCosts,
  type PurchaseCostLine,
} from "./purchase-costs.js";

export const NO_INVOICE_OFFER: PurchaseInvoiceOfferInput = {
  mode: "none",
  value: "0",
};
export const NO_INVOICE_OFFER_SNAPSHOT: PurchaseInvoiceOfferSnapshot = {
  input: NO_INVOICE_OFFER,
  ruleVersion: 1,
  basisFils: "0",
  offerFils: "0",
};

/** A policy change must explicitly preserve v1, not reinterpret its snapshots. */
export function calculateInvoiceOffer(
  input: PurchaseInvoiceOfferInput,
  ruleVersion: number,
  grossFils: bigint,
  allowanceFils: bigint,
  lineAvailableFils: readonly bigint[],
) {
  if (
    ruleVersion !== 1 ||
    ROUNDING_RULE !== "half-away-from-zero" ||
    REMAINDER_ALLOCATION_RULE !== "largest-remainder-then-line-order"
  ) {
    throw new Error("Unsupported invoice offer calculation rule");
  }
  const offer = purchaseInvoiceOfferInputSchema.parse(input);
  const amount =
    offer.mode === "none"
      ? 0n
      : offer.mode === "fixed"
        ? BigInt(offer.value)
        : rateOfFils(iqdFils(grossFils), parseRateString(offer.value));
  if (
    grossFils < 0n ||
    allowanceFils < 0n ||
    amount + allowanceFils > grossFils
  ) {
    return { ok: false as const, problem: "offer-exceeds-cost" as const };
  }
  const snapshot: PurchaseInvoiceOfferSnapshot = {
    input: offer,
    ruleVersion: 1,
    basisFils: offer.mode === "none" ? "0" : grossFils.toString(),
    offerFils: amount.toString(),
  };
  const lineShares =
    amount === 0n
      ? lineAvailableFils.map(() => 0n)
      : allocateFilsProportionally(iqdFils(amount), lineAvailableFils);
  return {
    ok: true as const,
    snapshot,
    lineShares,
    costAfterDiscountFils: grossFils - allowanceFils - amount,
  };
}

export function calculatePurchaseCostsWithOffer(
  lines: readonly PurchaseCostLine[],
  allowancePercentage: string,
  invoiceOffer: PurchaseInvoiceOfferInput,
  ruleVersion: number,
) {
  const base = calculatePurchaseCosts(lines, allowancePercentage);
  if (!base.ok) return base;
  const offer = calculateInvoiceOffer(
    invoiceOffer,
    ruleVersion,
    base.costs.primarySupplierCostFils,
    base.costs.allowanceFils,
    base.costs.lines.map((line) => line.costAfterDiscountFils),
  );
  if (!offer.ok) return offer;
  return {
    ok: true as const,
    invoiceOffer: offer.snapshot,
    offerShares: offer.lineShares,
    costs: {
      ...base.costs,
      costAfterDiscountFils: offer.costAfterDiscountFils,
      lines: base.costs.lines.map((line, index) => ({
        ...line,
        costAfterDiscountFils:
          line.costAfterDiscountFils - offer.lineShares[index]!,
      })),
    },
  };
}
