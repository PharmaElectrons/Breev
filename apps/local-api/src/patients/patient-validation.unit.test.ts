import { describe, expect, it } from "vitest";
import {
  normalizeSearchQuery,
  validatePatientCreate,
  validatePatientUpdate,
  validatePatientNotes,
  validateWeightMeasurement,
} from "./patient-validation.js";

describe("patient-validation", () => {
  describe("normalizeSearchQuery", () => {
    it("trims and collapses consecutive whitespace", () => {
      expect(normalizeSearchQuery("  hello   world  ")).toBe("hello world");
      expect(normalizeSearchQuery("Fatima")).toBe("Fatima");
      expect(normalizeSearchQuery("   Mohamed    Ali   ")).toBe("Mohamed Ali");
    });

    it("returns null for empty or whitespace-only queries", () => {
      expect(normalizeSearchQuery("   ")).toBeNull();
      expect(normalizeSearchQuery("")).toBeNull();
      expect(normalizeSearchQuery(undefined)).toBeNull();
      expect(normalizeSearchQuery(null)).toBeNull();
    });
  });

  describe("validatePatientCreate", () => {
    it("returns errors when firstName or lastName is missing", () => {
      const errors = validatePatientCreate({});
      expect(errors.some((e) => e.field === "firstName")).toBe(true);
      expect(errors.some((e) => e.field === "lastName")).toBe(true);
    });

    it("returns error when firstName is whitespace-only", () => {
      const errors = validatePatientCreate({
        firstName: "   ",
        lastName: "Valid",
      });
      expect(errors.some((e) => e.field === "firstName")).toBe(true);
      expect(errors.some((e) => e.field === "lastName")).toBe(false);
    });

    it("returns error when lastName is whitespace-only", () => {
      const errors = validatePatientCreate({
        firstName: "Valid",
        lastName: "   ",
      });
      expect(errors.some((e) => e.field === "lastName")).toBe(true);
      expect(errors.some((e) => e.field === "firstName")).toBe(false);
    });

    it("passes for valid payload", () => {
      const errors = validatePatientCreate({
        firstName: "Mariam",
        lastName: "Hassan",
        phone: "01012345678",
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe("validatePatientUpdate", () => {
    it("returns error if updated firstName is whitespace-only", () => {
      const errors = validatePatientUpdate({
        firstName: "   ",
        updatedAt: "2026-09-24T10:00:00.000Z",
      });
      expect(errors.some((e) => e.field === "firstName")).toBe(true);
    });

    it("passes for valid partial update", () => {
      const errors = validatePatientUpdate({
        firstName: "Sarah",
        updatedAt: "2026-09-24T10:00:00.000Z",
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe("validatePatientNotes", () => {
    it("passes for valid notes payload", () => {
      const errors = validatePatientNotes({
        allergies: "Aspirin",
        smoking: "no",
        sensitivities: null,
        otherNotes: null,
        updatedAt: "2026-09-24T10:00:00.000Z",
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe("validateWeightMeasurement", () => {
    it("passes for valid weight measurement", () => {
      const errors = validateWeightMeasurement({
        weightKg: "75.5",
        measuredAt: "2026-09-24T10:00:00.000Z",
      });
      expect(errors).toHaveLength(0);
    });

    it("fails for invalid weight measurement", () => {
      const errors = validateWeightMeasurement({
        weightKg: "invalid",
        measuredAt: "not-a-date",
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
