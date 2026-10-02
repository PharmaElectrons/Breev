import { CatalogApiDenied } from "./catalog-api";
import { catalogMessages } from "./catalog-messages";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { identityMessages } from "./identity-messages";
import { licensingMessages } from "./licensing-messages";
import type { Locale } from "./preferences";

export type CatalogAction =
  "load" | "save" | "barcode" | "print" | "archive" | "merge" | "matching";
export type CatalogError = { readonly action: CatalogAction } & (
  | { readonly kind: "catalog"; readonly denial: CatalogApiDenied["denial"] }
  | { readonly kind: "identity"; readonly denial: IdentityApiDenied["denial"] }
  | {
      readonly kind: "licensing";
      readonly denial: LicensingApiDenied["denial"];
    }
  | { readonly kind: "unavailable" | "required" }
);

export function catalogError(
  failure: unknown,
  action: CatalogAction,
): CatalogError {
  if (failure instanceof CatalogApiDenied)
    return { action, kind: "catalog", denial: failure.denial };
  if (failure instanceof IdentityApiDenied)
    return { action, kind: "identity", denial: failure.denial };
  if (failure instanceof LicensingApiDenied)
    return { action, kind: "licensing", denial: failure.denial };
  return { action, kind: "unavailable" };
}

export function catalogErrorText(error: CatalogError, locale: Locale): string {
  switch (error.kind) {
    case "catalog":
      return catalogMessages[locale].denials[error.denial.code];
    case "identity":
      return identityMessages[locale].denials[error.denial.code];
    case "licensing":
      return licensingMessages[locale].denials[error.denial.code];
    case "required":
      return catalogMessages[locale].fieldErrors.required;
    case "unavailable":
      return catalogMessages[locale].errors.unavailable[error.action];
  }
}
