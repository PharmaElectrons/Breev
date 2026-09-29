import { describe, expect, it } from "vitest";

import { compareSortable } from "./inventory-screen";

describe("inventory column sorting", () => {
  it("keeps null and blank values last in both directions", () => {
    const values: Array<bigint | string | null> = [
      null,
      "",
      "2026-03-01",
      "2026-01-01",
      "  ",
    ];
    const ascending = [...values].sort((left, right) =>
      compareSortable(left, right, "ascending"),
    );
    const descending = [...values].sort((left, right) =>
      compareSortable(left, right, "descending"),
    );

    expect(ascending.slice(0, 2)).toEqual(["2026-01-01", "2026-03-01"]);
    expect(ascending.slice(2).every(isMissing)).toBe(true);
    expect(descending.slice(0, 2)).toEqual(["2026-03-01", "2026-01-01"]);
    expect(descending.slice(2).every(isMissing)).toBe(true);
  });

  it("sorts zero with the numbers and still puts null last", () => {
    const values: Array<bigint | string | null> = [2n, null, 0n, 1n];
    expect(
      [...values].sort((left, right) =>
        compareSortable(left, right, "ascending"),
      ),
    ).toEqual([0n, 1n, 2n, null]);
    expect(
      [...values].sort((left, right) =>
        compareSortable(left, right, "descending"),
      ),
    ).toEqual([2n, 1n, 0n, null]);
  });
});

function isMissing(value: bigint | string | null): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}
