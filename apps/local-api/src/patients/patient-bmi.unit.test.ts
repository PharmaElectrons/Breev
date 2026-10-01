import { describe, expect, it } from "vitest";
import { categorizeBmi } from "./patient-bmi.js";

describe("categorizeBmi (exact arithmetic)", () => {
  it("correctly identifies exact boundaries without float precision loss", () => {
    expect(categorizeBmi("18.4")).toBe("underweight");
    expect(categorizeBmi("18.5")).toBe("normal");

    expect(categorizeBmi("24.9")).toBe("normal");
    expect(categorizeBmi("25.0")).toBe("overweight");

    expect(categorizeBmi("29.9")).toBe("overweight");
    expect(categorizeBmi("30.0")).toBe("obese");
    expect(categorizeBmi("300.0")).toBe("obese");
  });

  it("handles null, undefined, and unparseable input", () => {
    expect(categorizeBmi(null)).toBe("unknown");
    expect(categorizeBmi(undefined)).toBe("unknown");
    expect(categorizeBmi("")).toBe("unknown");
    expect(categorizeBmi("invalid")).toBe("unknown");
  });
});
