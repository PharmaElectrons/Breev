import { describe, expect, it } from "vitest";

import {
  integerFromFormatted,
  localizeUnitPhrase,
  panelUnitLabel,
} from "./panel-unit-label";

describe("panel unit labels", () => {
  it("keeps stored English names in English", () => {
    expect(panelUnitLabel("Pack", 3n, "en")).toBe("Pack");
    expect(panelUnitLabel("Strip", 4n, "en")).toBe("Strip");
    expect(panelUnitLabel("Box", 1n, "en")).toBe("Box");
  });

  it("uses Arabic singular, dual, plural, and the singular form after ten", () => {
    expect(panelUnitLabel("Pack", 1n, "ar")).toBe("علبة");
    expect(panelUnitLabel("Pack", 2n, "ar")).toBe("علبتان");
    expect(panelUnitLabel("Pack", 3n, "ar")).toBe("علب");
    expect(panelUnitLabel("Pack", 11n, "ar")).toBe("علبة");
    expect(panelUnitLabel("Strip", 1n, "ar")).toBe("شريط");
    expect(panelUnitLabel("Strip", 2n, "ar")).toBe("شريطان");
    expect(panelUnitLabel("Strip", 4n, "ar")).toBe("أشرطة");
    expect(panelUnitLabel("Strip", 20n, "ar")).toBe("شريط");
    expect(panelUnitLabel("Strip", 0n, "ar")).toBe("شريط");
    expect(panelUnitLabel("Strip", 100n, "ar")).toBe("شريط");
    expect(panelUnitLabel("Strip", 103n, "ar")).toBe("أشرطة");
    expect(panelUnitLabel("Strip", -3n, "ar")).toBe("أشرطة");
  });

  it("leaves unit names that have no Arabic presentation form unchanged", () => {
    expect(panelUnitLabel("Box", 3n, "ar")).toBe("Box");
    expect(panelUnitLabel("—", 0n, "ar")).toBe("—");
  });

  it("pluralizes a unit that was already stored in Arabic", () => {
    expect(panelUnitLabel("علبة", 3n, "ar")).toBe("علب");
    expect(panelUnitLabel("شريط", 20n, "ar")).toBe("شريط");
    expect(panelUnitLabel("شريط", 4n, "ar")).toBe("أشرطة");
  });

  it("localizes unit words inside a stored count caption", () => {
    expect(localizeUnitPhrase(" Pack + ", 2n, "ar")).toBe(" علبتان + ");
    expect(localizeUnitPhrase(" Strip", 1n, "ar")).toBe(" شريط");
    expect(localizeUnitPhrase(" Pack", 3n, "ar")).toBe(" علب");
    expect(localizeUnitPhrase(" Strip", 9n, "ar")).toBe(" أشرطة");
    expect(localizeUnitPhrase(" Strip", 20n, "ar")).toBe(" شريط");
    expect(localizeUnitPhrase(" Strip", 24n, "ar")).toBe(" شريط");
    expect(localizeUnitPhrase("2 Pack + 1 Strip", 1n, "en")).toBe(
      "2 Pack + 1 Strip",
    );
    expect(localizeUnitPhrase(" Box", 3n, "ar")).toBe(" Box");
  });

  it("reads grouped and Arabic-Indic numerals back to an integer", () => {
    expect(integerFromFormatted("1,000")).toBe(1000n);
    expect(integerFromFormatted("١٬٠٢٠")).toBe(1020n);
    expect(integerFromFormatted("−4")).toBe(-4n);
    expect(integerFromFormatted("—")).toBe(0n);
  });
});
