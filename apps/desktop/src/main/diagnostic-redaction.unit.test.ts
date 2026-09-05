import { describe, expect, it } from "vitest";

import {
  containsDiagnosticCanary,
  redactDiagnosticText,
  redactDiagnosticValue,
} from "./diagnostic-redaction.js";

describe("diagnostic redaction", () => {
  it.each([
    "Bearer token-canary.abc",
    "eyJhbGciOiJIUzI1NiJ9.cGF0aWVudA.signature",
    "support@example.test",
    "+20 010 1234 5678",
    "+964 770 123 4567",
    "29801011234567",
    "Iraqi ID 1234 5678 9012",
    "Dr Ali Hassan prescribed dosage 10mg",
    "token=secret-canary",
    "https://user:secret-canary@example.test/path",
    "-----BEGIN PRIVATE KEY-----\nsecret-canary\n-----END PRIVATE KEY-----",
  ])("removes a sensitive textual form: %s", (input) => {
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("secret-canary");
    expect(output).not.toContain("29801011234567");
    expect(output).not.toContain("010 1234 5678");
    expect(output).not.toContain("support@example.test");
  });

  it("redacts sensitive fields recursively and limits collection breadth", () => {
    const output = redactDiagnosticValue({
      safe: "healthy",
      patient: { name: "patient-name-canary", phone: "phone-canary" },
      clinicalNotes: "prescription-canary",
      address: "12 Patient Street",
      age: 42,
      balance: 123.45,
      doctor: "Dr Ali Hassan",
      dosage: "10mg",
      invoice: "INV-42",
      nested: [{ authorization: "token-canary" }],
      supplierCost: 88,
      weight: 70,
    });
    const serialized = JSON.stringify(output);
    expect(serialized).toContain("healthy");
    expect(serialized).not.toContain("patient-name-canary");
    expect(serialized).not.toContain("prescription-canary");
    expect(serialized).not.toContain("token-canary");
    expect(containsDiagnosticCanary(serialized)).toBe(false);
  });

  it("fails closed for every synthetic canary label, including unknown ones", () => {
    expect(containsDiagnosticCanary("doctor-name-unknown-canary")).toBe(true);
    expect(containsDiagnosticCanary("future-sensitive-CANARY-value")).toBe(
      true,
    );
  });
});
