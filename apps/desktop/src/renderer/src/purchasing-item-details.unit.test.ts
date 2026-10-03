import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  purchaseItemDetailsSchema,
  type Product,
} from "@breev/contracts/local-rest";
import * as preferences from "./preferences-provider";
import * as identity from "./identity-state-provider";
import {
  PurchasingItemPanel,
  PurchaseItemDetailsBody,
} from "./purchasing-item-details";
import { purchasingMessages } from "./purchasing-messages";

const facts = purchaseItemDetailsSchema.parse({
  productId: "019c0000-0000-7000-8000-000000000001",
  displayName: "Truthful item",
  scientificName: null,
  category: null,
  barcode: null,
  visibleFields: [
    "scientific-name",
    "category",
    "packaging",
    "wholesale-price",
  ],
  packaging: {
    inventoryUnitName: "Strip",
    packageUnits: [{ name: "Pack", baseUnitsPerPackage: "4" }],
  },
  pricingMethod: "by-price",
  retailPriceFils: "0",
  wholesalePriceFils: "0",
  businessDate: "2026-10-01",
  inventoryVisibility: "visible",
  inventory: {
    balance: "0",
    breakdown: [
      { name: "Pack", quantity: "0" },
      { name: "Strip", quantity: "0" },
    ],
    minimumLevel: "0",
    maximumLevel: null,
    reconciliation: "consistent",
    alerts: ["out-of-stock"],
    batches: [],
  },
  costVisibility: "visible",
  averageCostVisibility: "visible",
  averageUnitCostFils: null,
  lastPostedCost: null,
});
function context(locale: "en" | "ar") {
  vi.spyOn(preferences, "usePreferences").mockReturnValue({
    locale,
    direction: locale === "ar" ? "rtl" : "ltr",
    theme: "light",
    setLocale: vi.fn(),
    setTheme: vi.fn(),
  });
  vi.spyOn(identity, "useIdentityState").mockReturnValue({
    state: null,
    refresh: vi.fn(),
    setState: vi.fn(),
  });
}
describe("Purchasing authoritative panel states", () => {
  afterEach(() => vi.restoreAllMocks());
  for (const locale of ["en", "ar"] as const) {
    it(`keeps true zero separate from absent facts and deferred Reporting in ${locale}`, () => {
      context(locale);
      const markup = renderToStaticMarkup(
        createElement(PurchaseItemDetailsBody, { details: facts }),
      );
      expect(markup).toContain(locale === "ar" ? "٠٫٠٠٠" : "0.000");
      expect(markup).toContain(purchasingMessages[locale].panelMissing);
      expect(markup).toContain(
        purchasingMessages[locale].panelReportingUnavailable,
      );
      expect(markup).toContain(purchasingMessages[locale].panelNoBatches);
      expect(markup).not.toContain("Treatment day");
    });
    it(`renders denied stock and costs without invented balances or frozen costs in ${locale}`, () => {
      context(locale);
      const details = purchaseItemDetailsSchema.parse({
        ...facts,
        inventoryVisibility: "hidden-by-permission",
        inventory: null,
        costVisibility: "hidden-by-permission",
        averageCostVisibility: "hidden-by-permission",
        visibleFields: [],
      });
      const markup = renderToStaticMarkup(
        createElement(PurchaseItemDetailsBody, { details }),
      );
      expect(markup).toContain(purchasingMessages[locale].panelDeniedStock);
      expect(markup).toContain(purchasingMessages[locale].panelHidden);
      expect(markup).not.toContain("purchase-fraction-num");
      expect(markup).not.toContain('data-panel-field="reference-primary"');
      expect(markup).not.toContain('data-panel-field="batch-balance"');
    });
    it(`announces disconnected local facts without a perpetual loading state in ${locale}`, () => {
      context(locale);
      const markup = renderToStaticMarkup(
        createElement(PurchasingItemPanel, {
          baseUrl: "",
          hidden: false,
          selection: {
            product: {
              id: facts.productId,
              displayName: facts.displayName,
            } as Product,
          },
        }),
      );
      expect(markup).toContain(purchasingMessages[locale].panelOffline);
      expect(markup).toContain('aria-busy="false"');
      expect(markup).not.toContain('data-panel-field="balance"');
    });
  }
});
