import { describe, expect, it } from "vitest";

import {
  extractPurchaseAdjustmentDelta,
  isEmptyPurchaseAdjustmentDelta,
  type PurchaseAdjustmentRowSnapshot,
} from "./purchase-adjustment-delta.js";

const header = {
  supplierId: "0199ed80-0000-7000-8000-000000000001",
  supplierInvoiceNumber: "SUP-42",
};

function row(
  lineageId: string,
  enteredQuantity: bigint,
  primarySupplierCostFils = 1_000n,
  retailPriceFils = 1_500n,
): PurchaseAdjustmentRowSnapshot {
  return {
    enteredQuantity,
    inventoryUnitQuantity: enteredQuantity,
    itemDisplayName: `Item ${lineageId}`,
    itemId: `0199ed80-0000-7000-8000-0000000000${lineageId}`,
    lineageId,
    originalRowId: lineageId,
    primarySupplierCostFils,
    retailPriceFils,
  };
}

function extract(
  originalRows: readonly PurchaseAdjustmentRowSnapshot[],
  correctedRows: readonly PurchaseAdjustmentRowSnapshot[],
  priorEffects: Parameters<
    typeof extractPurchaseAdjustmentDelta
  >[0]["priorEffects"] = [],
) {
  const outcome = extractPurchaseAdjustmentDelta({
    allowancePercentage: "10",
    correctedHeader: header,
    correctedRows,
    originalHeader: header,
    originalRows,
    priorAllowanceDeltaFils: 0n,
    priorCostAfterDiscountDeltaFils: 0n,
    priorEffects,
    priorPrimarySupplierCostDeltaFils: 0n,
  });
  if (!outcome.ok) throw new Error(outcome.problem);
  return outcome.delta;
}

describe("purchase adjustment Delta extraction", () => {
  it("posts exactly +4 for the verbatim 4 to 8 case", () => {
    const delta = extract([row("01", 4n)], [row("01", 8n)]);
    expect(delta.quantityDelta).toBe(4n);
    expect(delta.primarySupplierCostDeltaFils).toBe(4_000n);
    expect(delta.costAfterDiscountDeltaFils).toBe(3_600n);
    expect(delta.rowDeltas).toHaveLength(1);
    expect(delta.rowDeltas[0]).toMatchObject({
      primarySupplierCostDeltaFils: 4_000n,
      quantityDelta: 4n,
    });
  });

  it("creates no movement or value effect for nine unchanged lines", () => {
    const original = Array.from({ length: 10 }, (_, index) =>
      row(String(index + 10), 4n),
    );
    const corrected = original.map((value, index) =>
      index === 4 ? row(value.lineageId, 8n) : { ...value },
    );
    const delta = extract(original, corrected);
    expect(delta.rowDeltas).toHaveLength(1);
    expect(delta.rowDeltas[0]?.lineageId).toBe("14");
  });

  it("extracts cost, retail-price, header, added, and removed changes exactly", () => {
    const added = {
      ...row("03", 2n, 333n, 777n),
      originalRowId: null,
    };
    const outcome = extractPurchaseAdjustmentDelta({
      allowancePercentage: "0",
      correctedHeader: {
        supplierId: "0199ed80-0000-7000-8000-000000000099",
        supplierInvoiceNumber: "SUP-42-CORRECTED",
      },
      correctedRows: [row("01", 4n, 1_250n, 1_900n), added],
      originalHeader: header,
      originalRows: [row("01", 4n), row("02", 1n, 600n)],
      priorAllowanceDeltaFils: 0n,
      priorCostAfterDiscountDeltaFils: 0n,
      priorEffects: [],
      priorPrimarySupplierCostDeltaFils: 0n,
    });
    if (!outcome.ok) throw new Error(outcome.problem);
    expect(outcome.delta.headerChanges.map((change) => change.field)).toEqual([
      "supplier",
      "supplier-invoice-number",
    ]);
    expect(outcome.delta.rowDeltas.map((change) => change.kind)).toEqual([
      "changed",
      "removed",
      "added",
    ]);
    expect(outcome.delta.primarySupplierCostDeltaFils).toBe(1_066n);
    expect(
      outcome.delta.rowDeltas[0]?.changes.map((change) => change.field),
    ).toEqual(["primary-supplier-cost", "retail-price"]);
  });

  it("subtracts prior effects so successive adjustments stand alone", () => {
    const outcome = extractPurchaseAdjustmentDelta({
      allowancePercentage: "10",
      correctedHeader: header,
      correctedRows: [row("01", 6n)],
      originalHeader: header,
      originalRows: [row("01", 4n)],
      priorAllowanceDeltaFils: 400n,
      priorCostAfterDiscountDeltaFils: 3_600n,
      priorEffects: [
        {
          lineageId: "01",
          primarySupplierCostDeltaFils: 4_000n,
          quantityDelta: 4n,
        },
      ],
      priorPrimarySupplierCostDeltaFils: 4_000n,
    });
    if (!outcome.ok) throw new Error(outcome.problem);
    const { delta } = outcome;
    expect(delta.quantityDelta).toBe(-2n);
    expect(delta.primarySupplierCostDeltaFils).toBe(-2_000n);
  });

  it("is empty when the reconstructed copy still equals the original", () => {
    const delta = extract([row("01", 4n)], [row("01", 4n)]);
    expect(isEmptyPurchaseAdjustmentDelta(delta)).toBe(true);
  });
});
