import { describe, expect, it } from "vitest";

import {
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  PRODUCT_NAME_TEMPLATE_VERSIONS,
  PRODUCT_NAME_TEMPLATES,
  composeDisplayName,
  generateDisplayName,
  isProductNameTemplateVersion,
  type GeneralItemNameFields,
  type MedicationNameFields,
} from "./index.js";

const MEDICATION: MedicationNameFields = {
  tradeName: "Panadol Extra",
  strength: "500 mg",
  dosageForm: "Tablet",
  manufacturer: "GSK",
};

const GENERAL_ITEM: GeneralItemNameFields = {
  company: "Nivea",
  subBrand: "Sun Protect",
  typeOfUse: "Sunscreen Lotion",
  property: "SPF 50",
  targetAudience: "Kids",
  size: "200 ml",
};

describe("medication display names", () => {
  it("generates the approved Trade Name, Strength, Dosage Form, Manufacturer order", () => {
    expect(generateDisplayName("medication", MEDICATION, 1)).toBe(
      "Panadol Extra 500 mg Tablet GSK",
    );
  });

  it.each([
    ["strength", { strength: null }, "Panadol Extra Tablet GSK"],
    ["dosageForm", { dosageForm: null }, "Panadol Extra 500 mg GSK"],
    ["manufacturer", { manufacturer: null }, "Panadol Extra 500 mg Tablet"],
  ] as const)(
    "skips %s cleanly when it alone is absent",
    (_field, absent, expected) => {
      expect(
        generateDisplayName("medication", { ...MEDICATION, ...absent }, 1),
      ).toBe(expected);
    },
  );

  it("skips several absent parts at once without doubling the separator", () => {
    expect(
      generateDisplayName(
        "medication",
        { ...MEDICATION, strength: null, manufacturer: null },
        1,
      ),
    ).toBe("Panadol Extra Tablet");
    expect(
      generateDisplayName(
        "medication",
        { ...MEDICATION, dosageForm: null, manufacturer: null },
        1,
      ),
    ).toBe("Panadol Extra 500 mg");
  });

  it("names a medication from its trade name alone", () => {
    const name = generateDisplayName(
      "medication",
      {
        tradeName: "Panadol Extra",
        strength: null,
        dosageForm: null,
        manufacturer: null,
      },
      1,
    );
    expect(name).toBe("Panadol Extra");
    expect(name).toBe(name.trim());
  });
});

describe("general, medical, and cosmetic item display names", () => {
  it("generates the approved Company through Size/Volume order", () => {
    expect(generateDisplayName("general-item", GENERAL_ITEM, 1)).toBe(
      "Nivea Sun Protect Sunscreen Lotion SPF 50 Kids 200 ml",
    );
  });

  it.each([
    [
      "subBrand",
      { subBrand: null },
      "Nivea Sunscreen Lotion SPF 50 Kids 200 ml",
    ],
    ["typeOfUse", { typeOfUse: null }, "Nivea Sun Protect SPF 50 Kids 200 ml"],
    [
      "property",
      { property: null },
      "Nivea Sun Protect Sunscreen Lotion Kids 200 ml",
    ],
    [
      "targetAudience",
      { targetAudience: null },
      "Nivea Sun Protect Sunscreen Lotion SPF 50 200 ml",
    ],
    ["size", { size: null }, "Nivea Sun Protect Sunscreen Lotion SPF 50 Kids"],
  ] as const)(
    "skips %s cleanly when it alone is absent",
    (_field, absent, expected) => {
      expect(
        generateDisplayName("general-item", { ...GENERAL_ITEM, ...absent }, 1),
      ).toBe(expected);
    },
  );

  it("skips several absent parts at once without doubling the separator", () => {
    expect(
      generateDisplayName(
        "general-item",
        { ...GENERAL_ITEM, subBrand: null, property: null, size: null },
        1,
      ),
    ).toBe("Nivea Sunscreen Lotion Kids");
  });

  it("names a general item from its company alone", () => {
    const name = generateDisplayName(
      "general-item",
      {
        company: "Nivea",
        subBrand: null,
        typeOfUse: null,
        property: null,
        targetAudience: null,
        size: null,
      },
      1,
    );
    expect(name).toBe("Nivea");
    expect(name).toBe(name.trim());
  });
});

describe("clean skipping", () => {
  it("treats a blank part as an absent part", () => {
    // A field the user cleared to spaces rather than emptied must not become a
    // separator of its own.
    expect(
      generateDisplayName(
        "medication",
        { ...MEDICATION, strength: "   ", dosageForm: "" },
        1,
      ),
    ).toBe("Panadol Extra GSK");
  });

  it("collapses stray spacing inside a part it keeps", () => {
    expect(
      generateDisplayName(
        "medication",
        { ...MEDICATION, strength: "  500   mg  " },
        1,
      ),
    ).toBe("Panadol Extra 500 mg Tablet GSK");
  });

  it("never leaves a leading, doubled, or trailing separator for any combination of absent optional parts", () => {
    const optional = ["strength", "dosageForm", "manufacturer"] as const;
    for (let mask = 0; mask < 1 << optional.length; mask += 1) {
      const fields: MedicationNameFields = {
        ...MEDICATION,
        ...Object.fromEntries(
          optional.map((field, index) => [
            field,
            (mask & (1 << index)) === 0 ? MEDICATION[field] : null,
          ]),
        ),
      };
      const name = generateDisplayName("medication", fields, 1);
      expect(name, `mask ${mask}`).toBe(name.trim());
      expect(name, `mask ${mask}`).not.toMatch(/ {2}/u);
      expect(name.length, `mask ${mask}`).toBeGreaterThan(0);
    }
  });

  it("is deterministic and never throws on an absent optional part", () => {
    const empty: GeneralItemNameFields = {
      company: "Nivea",
      subBrand: null,
      typeOfUse: null,
      property: null,
      targetAudience: null,
      size: null,
    };
    expect(generateDisplayName("general-item", empty, 1)).toBe(
      generateDisplayName("general-item", empty, 1),
    );
  });
});

describe("the Arabic search name is structurally excluded", () => {
  it("is named by no approved template in any mode or version", () => {
    for (const version of PRODUCT_NAME_TEMPLATE_VERSIONS) {
      for (const fieldOrder of Object.values(PRODUCT_NAME_TEMPLATES[version])) {
        for (const field of fieldOrder as readonly string[]) {
          expect(field.toLowerCase(), `version ${version}`).not.toContain(
            "arabic",
          );
        }
      }
    }
  });

  it("cannot be appended to the English display even when it rides along on the record", () => {
    // The joiner reads only the keys the template names, so a caller that hands
    // over a whole Product row still gets the English name alone.
    const withSibling = {
      ...MEDICATION,
      arabicSearchName: "بنادول إكسترا",
    };
    expect(
      composeDisplayName(PRODUCT_NAME_TEMPLATES[1].medication, withSibling),
    ).toBe("Panadol Extra 500 mg Tablet GSK");
  });
});

describe("template versioning", () => {
  it("carries exactly the approved versions and names the current one", () => {
    expect(PRODUCT_NAME_TEMPLATE_VERSIONS).toEqual([1]);
    expect(
      isProductNameTemplateVersion(CURRENT_PRODUCT_NAME_TEMPLATE_VERSION),
    ).toBe(true);
    expect(isProductNameTemplateVersion(2)).toBe(false);
  });

  it("keeps a stored version reproducing its own string when a later template would produce a different one", () => {
    // The hypothetical revision lives here rather than in the module: only
    // Breev-approved templates ship. What is proven is the mechanism — a
    // different field order yields a different name, while a Product stored
    // under version 1 keeps regenerating the exact string it was stored with.
    const revisedFieldOrder = [
      "tradeName",
      "dosageForm",
      "strength",
      "manufacturer",
    ] as const;

    expect(composeDisplayName(revisedFieldOrder, MEDICATION)).toBe(
      "Panadol Extra Tablet 500 mg GSK",
    );
    expect(composeDisplayName(revisedFieldOrder, MEDICATION)).not.toBe(
      generateDisplayName("medication", MEDICATION, 1),
    );
    expect(generateDisplayName("medication", MEDICATION, 1)).toBe(
      "Panadol Extra 500 mg Tablet GSK",
    );
  });

  it("resolves the template by version rather than by an ambient current value", () => {
    // Adding a version must not touch version 1's entry, so version 1 is
    // asserted against its literal field order rather than against whatever
    // the current version happens to be.
    expect(PRODUCT_NAME_TEMPLATES[1]).toEqual({
      medication: ["tradeName", "strength", "dosageForm", "manufacturer"],
      "general-item": [
        "company",
        "subBrand",
        "typeOfUse",
        "property",
        "targetAudience",
        "size",
      ],
    });
  });
});
