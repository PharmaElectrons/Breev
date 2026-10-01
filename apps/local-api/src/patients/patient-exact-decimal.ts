import {
  patientWeightRegex,
  patientHeightRegex,
  patientDiscountRegex,
} from "@breev/contracts/local-rest";

export class ExactDecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactDecimalError";
  }
}

function compareExactDecimal(a: string, b: string): number {
  const [aInt = "0", aFrac = ""] = a.split(".");
  const [bInt = "0", bFrac = ""] = b.split(".");

  const aCleanInt = aInt.replace(/^0+(?=\d)/, "");
  const bCleanInt = bInt.replace(/^0+(?=\d)/, "");

  if (aCleanInt.length !== bCleanInt.length) {
    return aCleanInt.length - bCleanInt.length;
  }
  if (aCleanInt !== bCleanInt) {
    return aCleanInt < bCleanInt ? -1 : 1;
  }

  const maxFracLen = Math.max(aFrac.length, bFrac.length);
  const aPaddedFrac = aFrac.padEnd(maxFracLen, "0");
  const bPaddedFrac = bFrac.padEnd(maxFracLen, "0");

  if (aPaddedFrac !== bPaddedFrac) {
    return aPaddedFrac < bPaddedFrac ? -1 : 1;
  }
  return 0;
}

export function parseExactWeight(value: string): string {
  if (typeof value !== "string") {
    throw new ExactDecimalError("Weight must be a string");
  }
  if (!patientWeightRegex.test(value)) {
    throw new ExactDecimalError(`Invalid weight format: ${value}`);
  }
  if (
    compareExactDecimal(value, "0.1") < 0 ||
    compareExactDecimal(value, "700.0") > 0
  ) {
    throw new ExactDecimalError(`Weight out of range (0.1 - 700.0): ${value}`);
  }
  return value;
}

export function parseExactHeight(value: string): string {
  if (typeof value !== "string") {
    throw new ExactDecimalError("Height must be a string");
  }
  if (!patientHeightRegex.test(value)) {
    throw new ExactDecimalError(`Invalid height format: ${value}`);
  }
  if (
    compareExactDecimal(value, "0.1") < 0 ||
    compareExactDecimal(value, "300.0") > 0
  ) {
    throw new ExactDecimalError(`Height out of range (0.1 - 300.0): ${value}`);
  }
  return value;
}

export function parseExactDiscount(value: string): string {
  if (typeof value !== "string") {
    throw new ExactDecimalError("Discount must be a string");
  }
  if (!patientDiscountRegex.test(value)) {
    throw new ExactDecimalError(`Invalid discount format: ${value}`);
  }
  if (
    compareExactDecimal(value, "0") < 0 ||
    compareExactDecimal(value, "100.00") > 0
  ) {
    throw new ExactDecimalError(
      `Discount out of range (0.00 - 100.00): ${value}`,
    );
  }
  return value;
}
