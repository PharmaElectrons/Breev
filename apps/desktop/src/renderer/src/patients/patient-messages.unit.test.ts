import { describe, expect, it } from "vitest";
import { patientMessages } from "./patient-messages";

describe("patient translations", () => {
  it("covers all patient message keys in Arabic and English", () => {
    for (const locale of ["ar", "en"] as const) {
      const copy = patientMessages[locale];
      expect(copy.title).not.toBe("");
      expect(copy.description).not.toBe("");
      expect(copy.searchPlaceholder).not.toBe("");
      expect(copy.searchLabel).not.toBe("");
      expect(copy.createPatient).not.toBe("");
      expect(copy.save).not.toBe("");
      expect(copy.update).not.toBe("");
      expect(copy.cancel).not.toBe("");
      expect(copy.permissionDenied).not.toBe("");
      expect(copy.createHeading).not.toBe("");
      expect(copy.editHeading).not.toBe("");
      expect(copy.firstName).not.toBe("");
      expect(copy.lastName).not.toBe("");
      expect(copy.fullName).not.toBe("");
      expect(copy.phone).not.toBe("");
      expect(copy.address).not.toBe("");
      expect(copy.email).not.toBe("");
      expect(copy.gender).not.toBe("");
      expect(copy.male).not.toBe("");
      expect(copy.female).not.toBe("");
      expect(copy.dateOfBirth).not.toBe("");
      expect(copy.age).not.toBe("");
      expect(copy.otherNotes).not.toBe("");
      expect(copy.discountPercent).not.toBe("");
      expect(copy.dnd).not.toBe("");
      expect(copy.chronicConditions).not.toBe("");
      expect(copy.chronicMedications).not.toBe("");
      expect(copy.interests).not.toBe("");
      expect(copy.profileHeading).not.toBe("");
      expect(copy.editProfile).not.toBe("");
      expect(copy.weightHistoryHeading).not.toBe("");
      expect(copy.weightKg).not.toBe("");
      expect(copy.heightCm).not.toBe("");
      expect(copy.bmi).not.toBe("");
      expect(copy.smoking).not.toBe("");
      expect(copy.allergies).not.toBe("");
      expect(copy.conflictError).not.toBe("");
      expect(copy.patientDirectory).not.toBe("");
      expect(copy.invalidWeightFormat).not.toBe("");
      expect(copy.invalidHeightFormat).not.toBe("");
      expect(copy.invalidDiscountFormat).not.toBe("");
      expect(copy.selectedWeightDetails("2026-09-01", "70")).not.toBe("");
    }
  });

  it("translates BMI categories properly in both locales", () => {
    expect(patientMessages.en.bmiCategory("underweight")).toBe("Underweight");
    expect(patientMessages.en.bmiCategory("normal")).toBe("Normal weight");
    expect(patientMessages.en.bmiCategory("overweight")).toBe("Overweight");
    expect(patientMessages.en.bmiCategory("obese")).toBe("Obese");

    expect(patientMessages.ar.bmiCategory("underweight")).toBe("نقص الوزن");
    expect(patientMessages.ar.bmiCategory("normal")).toBe("طبيعي");
    expect(patientMessages.ar.bmiCategory("overweight")).toBe("زيادة الوزن");
    expect(patientMessages.ar.bmiCategory("obese")).toBe("سمنة");
  });
});
