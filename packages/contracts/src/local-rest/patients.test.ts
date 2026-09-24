import { describe, expect, it } from "vitest";
import {
  patientBmiRegex,
  patientDiscountRegex,
  patientHeightRegex,
  patientWeightRegex,
  patientProfileResponseSchema,
} from "./patients.js";

describe("Patient exact decimal regex", () => {
  it("validates weight format", () => {
    expect("72.5").toMatch(patientWeightRegex);
    expect("0.5").toMatch(patientWeightRegex);
    expect("700.0").toMatch(patientWeightRegex);
    expect("700").toMatch(patientWeightRegex);
    expect("999.9").toMatch(patientWeightRegex);
    expect("0").not.toMatch(patientWeightRegex);
    expect("72.55").not.toMatch(patientWeightRegex);
    expect("-10").not.toMatch(patientWeightRegex);
  });

  it("validates height format", () => {
    expect("175.5").toMatch(patientHeightRegex);
    expect("0.5").toMatch(patientHeightRegex);
    expect("300.0").toMatch(patientHeightRegex);
    expect("175.55").not.toMatch(patientHeightRegex);
  });

  it("validates discount format", () => {
    expect("10.00").toMatch(patientDiscountRegex);
    expect("10.5").toMatch(patientDiscountRegex);
    expect("0").toMatch(patientDiscountRegex);
    expect("100").toMatch(patientDiscountRegex);
    expect("100.00").toMatch(patientDiscountRegex);
    expect("100.01").not.toMatch(patientDiscountRegex);
    expect("101").not.toMatch(patientDiscountRegex);
    expect("-1").not.toMatch(patientDiscountRegex);
  });

  it("validates bmi format", () => {
    expect("23.5").toMatch(patientBmiRegex);
    expect("0.1").toMatch(patientBmiRegex);
    expect("23.55").not.toMatch(patientBmiRegex);
  });

  it("parses patientProfileResponseSchema with bmiCategory", () => {
    const payload = {
      id: "01923e20-7f2a-7b3b-8b5d-1c32cfa030f0",
      firstName: "Fatima",
      lastName: "Ali",
      phone: "0123456789",
      dateOfBirth: "1990-05-15",
      gender: "female",
      heightCm: "165.0",
      discountPercent: "5.00",
      doNotDisturb: false,
      address: null,
      email: null,
      chronicConditions: ["Asthma"],
      chronicMedications: [],
      interests: [],
      createdAt: "2026-09-24T10:00:00.000Z",
      updatedAt: "2026-09-24T10:00:00.000Z",
      archivedAt: null,
      bmi: "22.5",
      bmiCategory: "normal",
    };
    const parsed = patientProfileResponseSchema.parse(payload);
    expect(parsed.bmiCategory).toBe("normal");
  });
});
