import { describe, expect, it } from "vitest";
import {
  buildProfileChangeAudit,
  buildNotesChangeAudit,
  buildDeniedAudit,
} from "./patient-audit-builder.js";

describe("patient-audit-builder", () => {
  describe("buildProfileChangeAudit", () => {
    it("detects changed fields only", () => {
      const before = {
        id: "patient-1",
        firstName: "Ahmed",
        lastName: "Ali",
        phone: "0100000000",
        chronicConditions: ["Diabetes"],
        updatedAt: "2026-09-24T10:00:00.000Z",
      };
      const after = {
        id: "patient-1",
        firstName: "Ahmed",
        lastName: "Hassan",
        phone: "0111111111",
        chronicConditions: ["Diabetes"],
        updatedAt: "2026-09-24T10:05:00.000Z",
      };

      const audit = buildProfileChangeAudit(before, after);
      expect(audit.fields).toEqual([
        { field: "lastName", before: "Ali", after: "Hassan" },
        { field: "phone", before: "0100000000", after: "0111111111" },
      ]);
    });

    it("detects array changes", () => {
      const before = {
        chronicConditions: ["Diabetes"],
      };
      const after = {
        chronicConditions: ["Diabetes", "Hypertension"],
      };

      const audit = buildProfileChangeAudit(before, after);
      expect(audit.fields).toEqual([
        {
          field: "chronicConditions",
          before: ["Diabetes"],
          after: ["Diabetes", "Hypertension"],
        },
      ]);
    });

    it("returns empty fields when nothing changed except ignored metadata", () => {
      const before = {
        id: "patient-1",
        firstName: "Ahmed",
        updatedAt: "2026-09-24T10:00:00.000Z",
      };
      const after = {
        id: "patient-1",
        firstName: "Ahmed",
        updatedAt: "2026-09-24T10:05:00.000Z",
      };

      const audit = buildProfileChangeAudit(before, after);
      expect(audit.fields).toEqual([]);
    });
  });

  describe("buildNotesChangeAudit", () => {
    it("records field names only, not note contents", () => {
      const before = {
        allergies: "Penicillin",
        smoking: "non-smoker",
        sensitivities: null,
        otherNotes: "Initial note",
      };
      const after = {
        allergies: "Penicillin, Sulfa",
        smoking: "non-smoker",
        sensitivities: "Latex",
        otherNotes: "Initial note",
      };

      const audit = buildNotesChangeAudit(before, after);
      expect(audit.fields).toEqual(["allergies", "sensitivities"]);
      // Confirm no clinical note content leaked in changes
      expect(JSON.stringify(audit)).not.toContain("Penicillin");
      expect(JSON.stringify(audit)).not.toContain("Sulfa");
      expect(JSON.stringify(audit)).not.toContain("Latex");
    });
  });

  describe("buildDeniedAudit", () => {
    it("records required permission for denied operations", () => {
      const audit = buildDeniedAudit("patients.edit");
      expect(audit).toEqual({ requiredPermission: "patients.edit" });
    });
  });
});
