import { describe, expect, it } from "vitest";
import {
  catalogError,
  catalogErrorText,
  type CatalogAction,
} from "./catalog-error";
import { CatalogApiDenied } from "./catalog-api";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { catalogMessages } from "./catalog-messages";
import { identityMessages } from "./identity-messages";
import { licensingMessages } from "./licensing-messages";

describe("Catalog error presentation", () => {
  it.each([
    "load",
    "save",
    "barcode",
    "print",
    "archive",
    "merge",
    "matching",
  ] as CatalogAction[])(
    "keeps %s transport failure language independent and hides diagnostics",
    (action) => {
      const state = catalogError(
        new TypeError("Failed to fetch · internal details"),
        action,
      );
      for (const locale of ["ar", "en"] as const) {
        expect(catalogErrorText(state, locale)).toBe(
          catalogMessages[locale].errors.unavailable[action],
        );
        expect(catalogErrorText(state, locale)).not.toContain(
          "internal details",
        );
      }
    },
  );
  it("preserves denial semantics and field association independently of action wording", () => {
    const failure = new CatalogApiDenied(400, {
      status: "denied",
      code: "body-invalid",
      fieldErrors: [
        { code: "out-of-range", path: ["pricing", "retailPriceFils"] },
      ],
      requestId: "01990abc-1234-7123-8123-123456789abc",
    });
    const state = catalogError(failure, "save");
    expect(state).toMatchObject({
      kind: "catalog",
      denial: { fieldErrors: failure.denial.fieldErrors },
    });
    expect(catalogErrorText(state, "ar")).toBe(
      catalogMessages.ar.denials["body-invalid"],
    );
    expect(catalogErrorText(state, "en")).toBe(
      catalogMessages.en.denials["body-invalid"],
    );
    expect(
      catalogErrorText(catalogError(new Error("printer"), "print"), "en"),
    ).not.toBe(catalogMessages.en.denials["product-not-found"]);
  });
  it("uses identity and licensing catalogues without exposing technical codes", () => {
    const identity = new IdentityApiDenied(403, {
      status: "denied",
      code: "permission-denied",
      requestId: "01990abc-1234-7123-8123-123456789abc",
    });
    const licensing = new LicensingApiDenied(403, {
      status: "denied",
      code: "entitlement-denied",
      requestId: "01990abc-1234-7123-8123-123456789abc",
    });
    for (const locale of ["ar", "en"] as const) {
      expect(catalogErrorText(catalogError(identity, "load"), locale)).toBe(
        identityMessages[locale].denials["permission-denied"],
      );
      expect(catalogErrorText(catalogError(licensing, "load"), locale)).toBe(
        licensingMessages[locale].denials["entitlement-denied"],
      );
    }
  });
});
