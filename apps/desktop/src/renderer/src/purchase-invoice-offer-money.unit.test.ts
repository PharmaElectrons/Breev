import { describe, expect, it } from "vitest";
import {
  invoiceOfferFilsToIqd,
  invoiceOfferIqdToFils,
} from "./purchase-invoice-offer-money";

describe("invoice offer amount display units", () => {
  it.each([
    ["50", "50000"],
    ["0.001", "1"],
    ["50.005", "50005"],
    ["9007199254740.993", "9007199254740993"],
    ["9223372036854775.807", "9223372036854775807"],
  ])("converts %s IQD exactly and restores it", (iqd, fils) => {
    expect(invoiceOfferIqdToFils(iqd)).toBe(fils);
    expect(invoiceOfferFilsToIqd(fils)).toBe(iqd);
  });
  it.each(["", "50.", "-1", "0.0001", "1e3", "NaN", "9223372036854775.808"])(
    "refuses invalid or unrepresentable amount %s",
    (input) => {
      expect(invoiceOfferIqdToFils(input)).toBeNull();
    },
  );
});
