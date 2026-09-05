import { describe, expect, it } from "vitest";

import { catalogMessages } from "./catalog-messages";
import {
  buildPackagingPayload,
  buildPricingPayload,
  cleanDefaultUnitsOnPackageRemoval,
  composeProductDisplayName,
  getAbandonedDirtyFields,
  serverPathToFormKey,
} from "./product-form";
import { formatDefaultUnit, formatFilsToIqd } from "./product-record";

describe("Product form and name generation", () => {
  describe("composeProductDisplayName - medication mode", () => {
    it("composes a full medication name in tradeName → strength → dosageForm → manufacturer order", () => {
      const name = composeProductDisplayName("medication", {
        dosageForm: "Tablet",
        manufacturer: "GSK",
        strength: "500mg",
        tradeName: "Panadol Extra",
      });
      expect(name).toBe("Panadol Extra 500mg Tablet GSK");
    });

    it("skips optional medication parts cleanly without doubled spaces", () => {
      const nameOnly = composeProductDisplayName("medication", {
        dosageForm: null,
        manufacturer: null,
        strength: null,
        tradeName: "Amoxicillin",
      });
      expect(nameOnly).toBe("Amoxicillin");

      const noDosageForm = composeProductDisplayName("medication", {
        dosageForm: "",
        manufacturer: "Pfizer",
        strength: "250mg",
        tradeName: "Amoxicillin",
      });
      expect(noDosageForm).toBe("Amoxicillin 250mg Pfizer");

      const strengthOnly = composeProductDisplayName("medication", {
        dosageForm: null,
        manufacturer: null,
        strength: "100mg",
        tradeName: "Aspirin",
      });
      expect(strengthOnly).toBe("Aspirin 100mg");
    });

    it("trims and collapses internal whitespace", () => {
      const name = composeProductDisplayName("medication", {
        dosageForm: "  Film   Coated   Tablet  ",
        manufacturer: "  Bayer  ",
        strength: " 500  mg ",
        tradeName: "  Aspirin   Plus  ",
      });
      expect(name).toBe("Aspirin Plus 500 mg Film Coated Tablet Bayer");
    });

    it("never includes the Arabic search name in the composed name", () => {
      const fields = {
        arabicSearchName: "بنادول اكسترا",
        dosageForm: "Tablet",
        manufacturer: "GSK",
        strength: "500mg",
        tradeName: "Panadol Extra",
      };
      const name = composeProductDisplayName("medication", fields);
      expect(name).toBe("Panadol Extra 500mg Tablet GSK");
      expect(name).not.toContain("بنادول");
    });
  });

  describe("composeProductDisplayName - general item mode", () => {
    it("composes a full general item name in Company → Sub-brand → Type/Use → Property → Target → Size order", () => {
      const name = composeProductDisplayName("general-item", {
        company: "Nivea",
        property: "Hydrating",
        size: "250ml",
        subBrand: "Men",
        targetAudience: "Adults",
        typeOfUse: "Body Lotion",
      });
      expect(name).toBe("Nivea Men Body Lotion Hydrating Adults 250ml");
    });

    it("skips optional general item parts cleanly", () => {
      const companyOnly = composeProductDisplayName("general-item", {
        company: "Dettol",
        property: null,
        size: null,
        subBrand: null,
        targetAudience: null,
        typeOfUse: null,
      });
      expect(companyOnly).toBe("Dettol");

      const partial = composeProductDisplayName("general-item", {
        company: "Dettol",
        property: "Antibacterial",
        size: "500ml",
        subBrand: null,
        targetAudience: null,
        typeOfUse: "Soap",
      });
      expect(partial).toBe("Dettol Soap Antibacterial 500ml");
    });
  });

  describe("getAbandonedDirtyFields", () => {
    const copy = catalogMessages.en;

    it("detects dirty fields in medication mode when switching away", () => {
      const dirty = getAbandonedDirtyFields(
        "medication",
        {
          dosageForm: "Capsule",
          manufacturer: "",
          strength: "500mg",
          tradeName: "Augmentin",
        },
        {
          company: "",
          property: "",
          size: "",
          subBrand: "",
          targetAudience: "",
          typeOfUse: "",
        },
        copy,
      );

      expect(dirty).toHaveLength(3);
      expect(dirty.map((d) => d.fieldKey)).toEqual([
        "tradeName",
        "strength",
        "dosageForm",
      ]);
      expect(dirty.find((d) => d.fieldKey === "tradeName")?.value).toBe(
        "Augmentin",
      );
    });

    it("detects dirty fields in general item mode when switching away", () => {
      const dirty = getAbandonedDirtyFields(
        "general-item",
        {
          dosageForm: "",
          manufacturer: "",
          strength: "",
          tradeName: "",
        },
        {
          company: "CeraVe",
          property: "",
          size: "236ml",
          subBrand: "",
          targetAudience: "",
          typeOfUse: "Cleanser",
        },
        copy,
      );

      expect(dirty).toHaveLength(3);
      expect(dirty.map((d) => d.fieldKey)).toEqual([
        "company",
        "typeOfUse",
        "size",
      ]);
    });

    it("returns an empty array when all fields in the active mode are empty", () => {
      const dirty = getAbandonedDirtyFields(
        "medication",
        {
          dosageForm: "   ",
          manufacturer: "",
          strength: "",
          tradeName: "",
        },
        {
          company: "",
          property: "",
          size: "",
          subBrand: "",
          targetAudience: "",
          typeOfUse: "",
        },
        copy,
      );

      expect(dirty).toHaveLength(0);
    });
  });

  describe("serverPathToFormKey", () => {
    it("maps nested package unit paths to index-specific field keys", () => {
      expect(
        serverPathToFormKey(["packaging", "packageUnits", 0, "name"]),
      ).toBe("packaging.packageUnits.0.name");
      expect(
        serverPathToFormKey([
          "packaging",
          "packageUnits",
          1,
          "baseUnitsPerPackage",
        ]),
      ).toBe("packaging.packageUnits.1.baseUnitsPerPackage");
    });

    it("maps inventoryUnitName path deterministically", () => {
      expect(serverPathToFormKey(["packaging", "inventoryUnitName"])).toBe(
        "packaging.inventoryUnitName",
      );
    });

    it("maps thirdUnit paths to the thirdUnit name key", () => {
      expect(serverPathToFormKey(["packaging", "thirdUnit", "name"])).toBe(
        "packaging.thirdUnit.name",
      );
      expect(serverPathToFormKey(["packaging", "thirdUnit"])).toBe(
        "packaging.thirdUnit.name",
      );
    });

    it("maps default units paths to the interface-specific default key", () => {
      expect(
        serverPathToFormKey([
          "packaging",
          "defaultUnits",
          "count",
          "packageUnitName",
        ]),
      ).toBe("packaging.defaultUnits.count");
      expect(
        serverPathToFormKey(["packaging", "defaultUnits", "purchase"]),
      ).toBe("packaging.defaultUnits.purchase");
      expect(serverPathToFormKey(["packaging", "defaultUnits", "sale"])).toBe(
        "packaging.defaultUnits.sale",
      );
    });

    it("maps pricing paths deterministically", () => {
      expect(serverPathToFormKey(["pricing", "retailPriceFils"])).toBe(
        "pricing.retailPriceFils",
      );
      expect(serverPathToFormKey(["pricing", "wholesalePriceFils"])).toBe(
        "pricing.wholesalePriceFils",
      );
      expect(serverPathToFormKey(["pricing", "costFils"])).toBe(
        "pricing.costFils",
      );
      expect(serverPathToFormKey(["pricing", "marginPercentage"])).toBe(
        "pricing.marginPercentage",
      );
      expect(serverPathToFormKey(["pricing", "rounding"])).toBe(
        "pricing.rounding",
      );
    });

    it("maps existing definition field paths to their form controls", () => {
      expect(serverPathToFormKey(["definition", "fields", "tradeName"])).toBe(
        "tradeName",
      );
      expect(serverPathToFormKey(["definition", "fields", "company"])).toBe(
        "company",
      );
    });
  });

  describe("cleanDefaultUnitsOnPackageRemoval", () => {
    it("safely resets only default selectors that pointed to the removed package", () => {
      const initial = {
        count: {
          kind: "package-unit" as const,
          packageUnitName: "Strip",
        },
        purchase: {
          kind: "package-unit" as const,
          packageUnitName: "Box",
        },
        sale: {
          kind: "inventory-unit" as const,
        },
      };

      const cleaned = cleanDefaultUnitsOnPackageRemoval(initial, "Box");

      expect(cleaned.purchase).toEqual({ kind: "inventory-unit" });
      expect(cleaned.count).toEqual({
        kind: "package-unit",
        packageUnitName: "Strip",
      });
      expect(cleaned.sale).toEqual({ kind: "inventory-unit" });
    });

    it("leaves default selectors unchanged if they do not reference the removed package", () => {
      const initial = {
        count: { kind: "inventory-unit" as const },
        purchase: {
          kind: "package-unit" as const,
          packageUnitName: "Box",
        },
        sale: { kind: "inventory-unit" as const },
      };

      const cleaned = cleanDefaultUnitsOnPackageRemoval(initial, "Carton");

      expect(cleaned).toEqual(initial);
    });
  });

  describe("buildPackagingPayload", () => {
    it("builds a full packaging payload with trimmed values", () => {
      const payload = buildPackagingPayload({
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "package-unit", packageUnitName: " Box " },
          sale: { kind: "inventory-unit" },
        },
        hasThirdUnit: true,
        inventoryUnitName: "  Strip  ",
        packageUnits: [
          { baseUnitsPerPackage: " 10 ", name: " Box " },
          { baseUnitsPerPackage: " 100 ", name: " Carton " },
        ],
        thirdUnitName: " Course ",
      });

      expect(payload).toEqual({
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "package-unit", packageUnitName: "Box" },
          sale: { kind: "inventory-unit" },
        },
        inventoryUnitName: "Strip",
        packageUnits: [
          { baseUnitsPerPackage: "10", name: "Box" },
          { baseUnitsPerPackage: "100", name: "Carton" },
        ],
        thirdUnit: { name: "Course" },
      });
    });

    it("sets thirdUnit to null when hasThirdUnit is false or thirdUnitName is whitespace", () => {
      const payloadWithoutThird = buildPackagingPayload({
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "inventory-unit" },
          sale: { kind: "inventory-unit" },
        },
        hasThirdUnit: false,
        inventoryUnitName: "Tablet",
        packageUnits: [],
        thirdUnitName: "Day",
      });
      expect(payloadWithoutThird.thirdUnit).toBeNull();

      const payloadWithEmptyName = buildPackagingPayload({
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "inventory-unit" },
          sale: { kind: "inventory-unit" },
        },
        hasThirdUnit: true,
        inventoryUnitName: "Tablet",
        packageUnits: [],
        thirdUnitName: "   ",
      });
      expect(payloadWithEmptyName.thirdUnit).toBeNull();
    });
  });

  describe("buildPricingPayload", () => {
    it("builds a by-price payload without cost, margin, or rounding", () => {
      const payload = buildPricingPayload({
        costFils: "80000",
        marginPercentage: "20",
        method: "by-price",
        retailPriceFils: " 100000 ",
        rounding: "nearest-250-iqd",
        wholesalePriceFils: " 90000 ",
      });

      expect(payload).toEqual({
        method: "by-price",
        retailPriceFils: "100000",
        wholesalePriceFils: "90000",
      });
      expect(payload).not.toHaveProperty("costFils");
      expect(payload).not.toHaveProperty("marginPercentage");
      expect(payload).not.toHaveProperty("rounding");
    });

    it("builds a by-percentage payload with cost, margin, rounding, and without retailPriceFils", () => {
      const payload = buildPricingPayload({
        costFils: " 80000 ",
        marginPercentage: " 20 ",
        method: "by-percentage",
        retailPriceFils: "100000",
        rounding: "nearest-500-iqd",
        wholesalePriceFils: "",
      });

      expect(payload).toEqual({
        costFils: "80000",
        marginPercentage: "20",
        method: "by-percentage",
        rounding: "nearest-500-iqd",
        wholesalePriceFils: null,
      });
      expect(payload).not.toHaveProperty("retailPriceFils");
    });
  });

  describe("formatFilsToIqd", () => {
    it("formats exact thousands of fils without fractional remainder", () => {
      expect(formatFilsToIqd("80000", "en")).toBe("80 IQD");
      expect(formatFilsToIqd("100000", "en")).toBe("100 IQD");
      expect(formatFilsToIqd("0", "en")).toBe("0 IQD");
    });

    it("formats fractional fils with trimmed decimals without float arithmetic", () => {
      expect(formatFilsToIqd("80250", "en")).toBe("80.25 IQD");
      expect(formatFilsToIqd("80500", "en")).toBe("80.5 IQD");
      expect(formatFilsToIqd("80001", "en")).toBe("80.001 IQD");
      expect(formatFilsToIqd("250", "en")).toBe("0.25 IQD");
    });

    it("formats Arabic locale with د.ع currency symbol", () => {
      expect(formatFilsToIqd("80000", "ar")).toBe("80 د.ع");
      expect(formatFilsToIqd("80250", "ar")).toBe("80.25 د.ع");
    });

    it("groups large numbers with commas", () => {
      expect(formatFilsToIqd("1000000000", "en")).toBe("1,000,000 IQD");
    });

    it("returns dash for null, empty, or invalid input", () => {
      expect(formatFilsToIqd(null)).toBe("—");
      expect(formatFilsToIqd("")).toBe("—");
      expect(formatFilsToIqd("invalid")).toBe("—");
    });
  });

  describe("formatDefaultUnit", () => {
    it("formats inventory unit with the given inventoryUnitName", () => {
      expect(formatDefaultUnit({ kind: "inventory-unit" }, "Strip")).toBe(
        "Strip",
      );
    });

    it("formats package unit with its packageUnitName", () => {
      expect(
        formatDefaultUnit(
          { kind: "package-unit", packageUnitName: "Box" },
          "Strip",
        ),
      ).toBe("Box");
    });
  });
});
