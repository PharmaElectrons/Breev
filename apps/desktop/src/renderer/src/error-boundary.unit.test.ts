import { describe, expect, it } from "vitest";

import { crashCopyForLocale, createIncidentCode } from "./error-boundary";

describe("renderer diagnostic error boundary", () => {
  it("creates a stable closed incident code without exposing the message", () => {
    const error = new Error("patient-name-canary");
    error.stack =
      "Error: patient-name-canary\n at Catalog (C:\\Users\\Name\\app.tsx:10:2)";

    const first = createIncidentCode(error, "workspace");
    const second = createIncidentCode(error, "workspace");

    expect(first).toBe(second);
    expect(first).toMatch(/^VIEW-[0-9A-F]{8}$/u);
    expect(first).not.toContain("patient");
    expect(first).not.toContain("Name");
  });

  it("uses distinct prefixes for each containment level", () => {
    expect(createIncidentCode(new Error("x"), "bootstrap")).toMatch(/^BOOT-/u);
    expect(createIncidentCode(new Error("x"), "application")).toMatch(/^APP-/u);
    expect(createIncidentCode(new Error("x"), "workspace")).toMatch(/^VIEW-/u);
  });

  it("provides complete and distinct Arabic and English recovery copy", () => {
    const english = crashCopyForLocale("en");
    const arabic = crashCopyForLocale("ar");
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect(english[key].trim().length, "English " + key).toBeGreaterThan(0);
      expect(arabic[key].trim().length, "Arabic " + key).toBeGreaterThan(0);
      expect(arabic[key], key).not.toBe(english[key]);
    }
  });
});
