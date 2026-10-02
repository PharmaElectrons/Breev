import { describe, expect, it } from "vitest";
import { countUnitLabel, unitDisplayName } from "./unit-display.js";
describe("recognized unit presentation", () => {
  it.each([
    ["Bottle", "زجاجة"],
    ["STRIPS", "شريط"],
    [" box ", "علبة"],
    ["Capsules", "كبسولة"],
    ["Vial", "قارورة"],
    ["Sachet", "كيس"],
  ])("matches complete names %s", (name, translated) => {
    expect(unitDisplayName(name!, "ar")).toBe(translated);
    expect(unitDisplayName(name!, "en")).toBe(name);
  });
  it.each([
    "Pack of 10",
    "BOTTLE-12",
    "وحدة خاصة",
    "my strip",
    "",
    "package:Pack",
  ])("preserves custom name %s", (name) => {
    expect(unitDisplayName(name, "ar")).toBe(name);
    expect(countUnitLabel(name, 3n, "ar")).toBe(name);
  });
  it.each([
    [0n, "علبة"],
    [1n, "علبة"],
    [2n, "علبتان"],
    [3n, "علب"],
    [11n, "علبة"],
    [100n, "علبة"],
    [-3n, "علب"],
  ] as const)("preserves Pack count form %s", (n, name) =>
    expect(countUnitLabel("Pack", n, "ar")).toBe(name),
  );
});
