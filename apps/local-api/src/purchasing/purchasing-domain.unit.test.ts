import { describe, expect, it } from "vitest";
import { copyAllowanceSnapshot } from "./purchasing-domain.js";

describe("Purchase allowance snapshot", () => {
  it("copies exact percentage text and an integer-fils basis", () => {
    expect(copyAllowanceSnapshot("1.125000", 5_000_000n)).toEqual({
      basisFils: 5_000_000n,
      percentage: "1.125000",
    });
  });

  it("does not change after the supplier default changes", () => {
    const supplier = { percentage: "2.5" };
    const snapshot = copyAllowanceSnapshot(supplier.percentage);
    supplier.percentage = "7.75";
    expect(snapshot).toEqual({ basisFils: 0n, percentage: "2.5" });
  });

  it("rejects floating point values and negative bases", () => {
    expect(() => copyAllowanceSnapshot(String(0.1 + 0.2))).toThrow();
    expect(() => copyAllowanceSnapshot("1", -1n)).toThrow();
  });
});
