import { describe, expect, it } from "vitest";

import { stepCalculatorQuantity } from "./sales-calculator";

describe("sales calculator quantity stepper", () => {
  it("increments large quantities without losing integer precision", () => {
    expect(stepCalculatorQuantity("9007199254740993", 1)).toBe(
      "9007199254740994",
    );
  });

  it("keeps quantities at one or leaves invalid text untouched", () => {
    expect(stepCalculatorQuantity("1", -1)).toBe("1");
    expect(stepCalculatorQuantity("", 1)).toBe("1");
    expect(stepCalculatorQuantity("1.5", 1)).toBe("1.5");
  });
});
