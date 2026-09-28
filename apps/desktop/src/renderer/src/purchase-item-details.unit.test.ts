import type { Product } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as preferencesModule from "./preferences-provider";
import {
  PurchaseItemPanel,
  type PurchaseItemSelection,
} from "./purchase-item-details";

function mockPreferences(locale: "ar" | "en" = "ar"): void {
  vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
    direction: locale === "ar" ? "rtl" : "ltr",
    locale,
    setLocale: vi.fn(),
    setTheme: vi.fn(),
    theme: "light",
  });
}

function buildMockProduct(overrides: Partial<Product> = {}): Product {
  return {
    arabicSearchName: "بانادول اكسترا",
    barcodes: [{ kind: "package", source: "provided", value: "6291100123456" }],
    category: "Analgesic",
    definition: {
      fields: {
        tradeName: "Panadol Extra",
      },
      mode: "medication",
    },
    displayName: "Panadol Extra 500mg",
    id: "prod-1",
    instructions: null,
    mergedIntoProductId: null,
    nameTemplateVersion: 1,
    packaging: {
      defaultUnits: {
        count: { kind: "inventory-unit" },
        purchase: { kind: "package-unit", packageUnitName: "باكيت" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "شريط",
      packageUnits: [
        {
          baseUnitsPerPackage: "10",
          name: "باكيت",
        },
      ],
      thirdUnit: null,
    },
    pricing: {
      costFils: "2000000",
      retailPriceFils: "3000000",
      wholesalePriceFils: "2500000",
    },
    revision: "1",
    scientificName: "Paracetamol + Caffeine",
    sharing: { isPublic: false },
    stateColours: null,
    status: "active",
    stockLevels: {
      maximumLevel: "100",
      minimumLevel: "10",
      reorderPoint: "20",
    },
    ...overrides,
  } as unknown as Product;
}

describe("PurchaseItemPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty placeholder state when selection is null", () => {
    mockPreferences("ar");
    const markup = renderToStaticMarkup(
      createElement(PurchaseItemPanel, {
        hidden: false,
        selection: null,
      }),
    );

    expect(markup).toContain("شريط معلومات المادة");
    expect(markup).toContain("لا توجد مادة محددة");
  });

  it("does not fall back to rowQuantity for stock balance and computes verified units", () => {
    mockPreferences("ar");
    const product = buildMockProduct();
    const selection: PurchaseItemSelection = {
      product,
      rowQuantity: "50", // 50 boxes entered in the draft row
      currentStock: 25, // only 25 strips actually in warehouse
    };

    const markup = renderToStaticMarkup(
      createElement(PurchaseItemPanel, {
        hidden: false,
        selection,
      }),
    );

    // Large count = floor(25 / 10) = 2 باكيت
    expect(markup).toContain('<p class="purchase-fraction-num">2</p>');
    expect(markup).toContain('<p class="purchase-fraction-label">باكيت</p>');
    // Remainder units = 25 % 10 = 5 شريط
    expect(markup).toContain('<p class="purchase-fraction-num">5</p>');
    expect(markup).toContain('<p class="purchase-fraction-label">شريط</p>');
    // Total detailed balance = 25 شريط (NOT 500 from draft rowQuantity * 10)
    expect(markup).toContain("الإجمالي : <bdi>25</bdi> شريط");
  });

  it("renders 0 stock gracefully without draft quantity leakage when currentStock is 0", () => {
    mockPreferences("ar");
    const product = buildMockProduct();
    const selection: PurchaseItemSelection = {
      product,
      rowQuantity: "100",
      currentStock: 0,
    };

    const markup = renderToStaticMarkup(
      createElement(PurchaseItemPanel, {
        hidden: false,
        selection,
      }),
    );

    expect(markup).toContain('<p class="purchase-fraction-num">0</p>');
    expect(markup).toContain("الإجمالي : <bdi>0</bdi> شريط");
  });

  it("renders two-tier packaging with .is-two-unit and no empty column", () => {
    mockPreferences("ar");
    const product = buildMockProduct();
    const selection: PurchaseItemSelection = {
      product,
      currentStock: 15,
    };

    const markup = renderToStaticMarkup(
      createElement(PurchaseItemPanel, {
        hidden: false,
        selection,
      }),
    );

    expect(markup).toContain("purchase-fraction-grid is-two-unit");
  });

  it("renders fact card with zero placeholder dashes in Arabic", () => {
    mockPreferences("ar");
    const product = buildMockProduct({
      stockLevels: {
        maximumLevel: null,
        minimumLevel: null,
        reorderPoint: null,
      },
    });
    const selection: PurchaseItemSelection = {
      product,
      currentStock: 0,
      expiryDate: null,
    };

    const markup = renderToStaticMarkup(
      createElement(PurchaseItemPanel, {
        hidden: false,
        selection,
      }),
    );

    // Visible fact sheet should have concrete values and localized fallbacks, not "—"
    expect(markup).toContain("1 باكيت = 10 شريط");
    expect(markup).toContain("غير محدد"); // Stock limits fallback
    expect(markup).toContain("سعر الجملة");
    expect(markup).toContain("<bdi>2,500 د.ع</bdi>");
    expect(markup).toContain("معدل الصرف");
    expect(markup).toContain("أيام الكفاية");
    expect(markup).toContain("<bdi>0</bdi> أيام");
    expect(markup).toContain("لم يسجل تاريخ انتهاء"); // Expiry fallback
  });

  it("renders fact card with zero placeholder dashes in English", () => {
    mockPreferences("en");
    const product = buildMockProduct({
      packaging: {
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "package-unit", packageUnitName: "Box" },
          sale: { kind: "inventory-unit" },
        },
        inventoryUnitName: "Strip",
        packageUnits: [
          {
            baseUnitsPerPackage: "10",
            name: "Box",
          },
        ],
        thirdUnit: null,
      },
      stockLevels: {
        maximumLevel: null,
        minimumLevel: null,
        reorderPoint: null,
      },
    });
    const selection: PurchaseItemSelection = {
      product,
      currentStock: 0,
      expiryDate: null,
    };

    const markup = renderToStaticMarkup(
      createElement(PurchaseItemPanel, {
        hidden: false,
        selection,
      }),
    );

    expect(markup).toContain("1 Box = 10 Strip");
    expect(markup).toContain("Not set");
    expect(markup).toContain("Wholesale price");
    expect(markup).toContain("<bdi>2,500 IQD</bdi>");
    expect(markup).toContain("Consumption rate");
    expect(markup).toContain("Days of supply");
    expect(markup).toContain("<bdi>0</bdi> days");
    expect(markup).toContain("No expiry recorded");
  });

  it("renders min and max stock limits with down and up arrows when defined", () => {
    mockPreferences("ar");
    const product = buildMockProduct({
      stockLevels: {
        maximumLevel: "80",
        minimumLevel: "15",
        reorderPoint: "20",
      },
    });
    const selection: PurchaseItemSelection = {
      product,
      currentStock: 10,
    };

    const markup = renderToStaticMarkup(
      createElement(PurchaseItemPanel, {
        hidden: false,
        selection,
      }),
    );

    expect(markup).toContain("↓ 15");
    expect(markup).toContain("↑ 80");
    expect(markup).toContain("باكيت");
  });
});
