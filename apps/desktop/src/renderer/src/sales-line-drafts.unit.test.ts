import type { SaleDraftLine } from "@breev/contracts/local-rest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSaleLineEdits,
  readSaleLineEdit,
  reconcileSaleLineEdits,
  saleLineEditValues,
  saveSaleLineEdit,
} from "./sales-line-drafts";

const line: SaleDraftLine = {
  id: "line-one",
  kind: "catalog",
  productId: "product-one",
  displayName: "Panadol",
  unitId: "strip",
  unitName: "Strip",
  eligibleUnits: [
    { unitId: "strip", unitName: "Strip", baseUnitsPerUnit: "1" },
    { unitId: "pack", unitName: "Pack", baseUnitsPerUnit: "4" },
  ],
  quantity: "1",
  unitPriceFils: "100000",
  priceSource: "retail",
  priceOverrideReason: null,
  priceVersion: "1",
  priceCapturedAt: "2026-10-02T00:00:00Z",
  lineDiscountPercentage: "0",
  grossFils: "100000",
  discountFils: "0",
  totalFils: "100000",
};

describe("unsubmitted sale row drafts", () => {
  beforeEach(clearSaleLineEdits);

  it("isolates edits by authenticated workspace, draft and line", () => {
    const edit = {
      quantity: "7",
      unitId: "pack",
      lineDiscountPercentage: "12",
    };
    saveSaleLineEdit("session-a", "draft-a", line, edit);
    expect(readSaleLineEdit("session-a", "draft-a", { ...line })).toEqual(edit);
    expect(readSaleLineEdit("session-b", "draft-a", line)).toEqual(
      saleLineEditValues(line),
    );
    expect(readSaleLineEdit("session-a", "draft-b", line)).toEqual(
      saleLineEditValues(line),
    );
    const otherLine = { ...line, id: "line-two" };
    expect(readSaleLineEdit("session-a", "draft-a", otherLine)).toEqual(
      saleLineEditValues(otherLine),
    );
    clearSaleLineEdits();
    expect(readSaleLineEdit("session-a", "draft-a", line)).toEqual(
      saleLineEditValues(line),
    );
  });

  it("keeps dirty fields through unrelated updates and consumes only acknowledged fields", () => {
    saveSaleLineEdit("session", "draft", line, {
      quantity: "7",
      unitId: "strip",
      lineDiscountPercentage: "12",
    });
    const unrelated = { ...line, unitPriceFils: "110000" };
    reconcileSaleLineEdits("session", {
      id: "draft",
      status: "active",
      lines: [unrelated],
    });
    expect(readSaleLineEdit("session", "draft", unrelated).quantity).toBe("7");
    const acknowledged = { ...unrelated, quantity: "7" };
    reconcileSaleLineEdits("session", {
      id: "draft",
      status: "active",
      lines: [acknowledged],
    });
    const later = { ...acknowledged, quantity: "3" };
    expect(readSaleLineEdit("session", "draft", later)).toEqual({
      quantity: "3",
      unitId: "strip",
      lineDiscountPercentage: "12",
    });
  });

  it("drops cached fields on revert, line removal and draft discard", () => {
    const edited = { ...saleLineEditValues(line), quantity: "7" };
    saveSaleLineEdit("session", "draft", line, edited);
    saveSaleLineEdit("session", "draft", line, saleLineEditValues(line));
    expect(readSaleLineEdit("session", "draft", line).quantity).toBe("1");
    saveSaleLineEdit("session", "draft", line, edited);
    reconcileSaleLineEdits("session", {
      id: "draft",
      status: "active",
      lines: [],
    });
    expect(readSaleLineEdit("session", "draft", line).quantity).toBe("1");
    saveSaleLineEdit("session", "draft", line, edited);
    reconcileSaleLineEdits("session", {
      id: "draft",
      status: "discarded",
      lines: [line],
    });
    expect(readSaleLineEdit("session", "draft", line).quantity).toBe("1");
  });
});
