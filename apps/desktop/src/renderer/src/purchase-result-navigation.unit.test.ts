import type { PurchasePostedListResponse } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";
import { purchaseResultNavigation } from "./purchase-result-navigation";

describe("filtered Purchase navigation", () => {
  const list = {
    purchases: [
      { id: "newer", rowKind: "purchase" },
      { id: "adjustment", rowKind: "adjustment", originalPurchaseId: "newer" },
      { id: "return", rowKind: "return", originalPurchaseId: "older" },
      { id: "older", rowKind: "purchase" },
    ],
  } as PurchasePostedListResponse;
  it("uses the active filtered order and excludes correction documents", () => {
    expect(purchaseResultNavigation(list, "newer")).toEqual({
      previousId: null,
      nextId: "older",
      position: 1,
      total: 2,
    });
    expect(purchaseResultNavigation(list, "older")).toEqual({
      previousId: "newer",
      nextId: null,
      position: 2,
      total: 2,
    });
  });
  it("cannot navigate outside an absent or changed filter result", () => {
    expect(purchaseResultNavigation(list, "outside")).toEqual({
      previousId: null,
      nextId: null,
      position: 0,
      total: 2,
    });
    expect(purchaseResultNavigation(null, "newer")).toEqual({
      previousId: null,
      nextId: null,
      position: 0,
      total: 0,
    });
  });
});
