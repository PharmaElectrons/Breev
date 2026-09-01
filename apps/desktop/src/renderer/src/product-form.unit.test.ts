import { describe, expect, it } from "vitest";

import { catalogMessages } from "./catalog-messages";
import {
  composeProductDisplayName,
  getAbandonedDirtyFields,
} from "./product-form";

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
});
