import { describe, expect, it } from "vitest";

import * as moneyModule from "./money.js";
import {
  addFils,
  addQuantity,
  compareFils,
  compareQuantity,
  equalsFils,
  equalsQuantity,
  FILS_PER_IQD,
  formatFilsString,
  formatQuantityString,
  inventoryQuantity,
  iqdFils,
  negateFils,
  negateQuantity,
  parseFilsString,
  parseQuantityString,
  type InventoryQuantity,
  type IqdFils,
} from "./money.js";

/** Wire values that must survive a byte-exact round trip in both directions. */
const CANONICAL_WIRE = [
  "0",
  "1",
  "-1",
  "7",
  "999",
  "1000",
  "-1000",
  // Number.MAX_SAFE_INTEGER and the first two integers a double cannot hold.
  "9007199254740991",
  "9007199254740993",
  "-9007199254740993",
  // The PostgreSQL bigint bounds that store authoritative IQD.
  "9223372036854775807",
  "-9223372036854775808",
  // Far beyond any exact floating point or 64-bit range.
  "123456789012345678901234567890",
  "-123456789012345678901234567890",
] as const;

/** Every rejected wire spelling, with the reason it is rejected. */
const MALFORMED_WIRE = [
  ["an empty string", ""],
  ["a lone minus sign", "-"],
  ["an explicit plus sign", "+1"],
  ["negative zero", "-0"],
  ["a leading zero", "01"],
  ["a zero-padded value", "007"],
  ["a negative leading zero", "-01"],
  ["leading whitespace", " 1"],
  ["trailing whitespace", "1 "],
  ["a leading tab", "\t1"],
  ["a trailing newline", "1\n"],
  ["only whitespace", " "],
  ["an internal space", "1 000"],
  ["a thousands separator", "1,000"],
  ["a numeric separator", "1_000"],
  ["a decimal point", "1.0"],
  ["a trailing decimal point", "1."],
  ["a leading decimal point", ".5"],
  ["a fractional value", "0.5"],
  ["an exponent", "1e3"],
  ["an uppercase exponent", "1E3"],
  ["a signed exponent", "1e+3"],
  ["a hexadecimal literal", "0x1f"],
  ["an octal literal", "0o7"],
  ["a binary literal", "0b1"],
  ["NaN", "NaN"],
  ["Infinity", "Infinity"],
  ["negative infinity", "-Infinity"],
  ["Arabic-Indic digits", "١٢٣"],
  ["Arabic-Indic digits mixed with ASCII", "1٢3"],
  ["fullwidth digits", "１２３"],
  ["a trailing sign", "1-"],
  ["a doubled sign", "--1"],
  ["a bigint literal suffix", "1n"],
  ["a currency suffix", "1000 IQD"],
] as const;

/** Every `number` is binary floating point, whole-looking ones included. */
const FLOATING_POINT_INPUTS = [
  ["a whole number", 5],
  ["a fractional number", 1.5],
  ["an accumulated float", 0.1 + 0.2],
  ["zero", 0],
  ["negative zero", -0],
  ["NaN", Number.NaN],
  ["positive infinity", Number.POSITIVE_INFINITY],
  ["negative infinity", Number.NEGATIVE_INFINITY],
  ["a value past exact integer precision", 9007199254740993],
] as const;

/** Values that are neither a bigint nor a number. */
const NON_NUMERIC_INPUTS = [
  ["a decimal string", "5"],
  ["null", null],
  ["undefined", undefined],
  ["a boolean", true],
  ["an object", {}],
  ["an array", [1n]],
  ["a symbol", Symbol("1000")],
] as const;

describe("FILS_PER_IQD", () => {
  it("publishes the exact fils-per-dinar ratio as a bigint", () => {
    expect(FILS_PER_IQD).toBe(1000n);
    expect(typeof FILS_PER_IQD).toBe("bigint");
  });
});

describe("iqdFils", () => {
  it("keeps positive, negative, and zero amounts exactly as given", () => {
    expect(iqdFils(1500n)).toBe(1500n);
    expect(iqdFils(-1500n)).toBe(-1500n);
    expect(iqdFils(0n)).toBe(0n);
  });

  it("keeps amounts far beyond exact floating point precision", () => {
    const beyondDoubles = 2n ** 80n + 7n;
    expect(iqdFils(beyondDoubles)).toBe(1208925819614629174706183n);
  });

  for (const [label, value] of FLOATING_POINT_INPUTS) {
    it(`rejects ${label} because binary floating point cannot carry an amount`, () => {
      expect(() => iqdFils(value as unknown as bigint)).toThrow(TypeError);
      expect(() => iqdFils(value as unknown as bigint)).toThrow(
        /binary floating point cannot carry an authoritative value/,
      );
    });
  }

  for (const [label, value] of NON_NUMERIC_INPUTS) {
    it(`rejects ${label}`, () => {
      expect(() => iqdFils(value as unknown as bigint)).toThrow(
        /An IQD fils amount must be an exact bigint, received/,
      );
    });
  }

  it("rejects a number at compile time as well as at run time", () => {
    // @ts-expect-error a number can never carry an authoritative amount
    expect(() => iqdFils(5)).toThrow(TypeError);
  });
});

describe("inventoryQuantity", () => {
  it("keeps signed movement quantities exactly as given", () => {
    expect(inventoryQuantity(40n)).toBe(40n);
    expect(inventoryQuantity(-40n)).toBe(-40n);
    expect(inventoryQuantity(0n)).toBe(0n);
  });

  for (const [label, value] of FLOATING_POINT_INPUTS) {
    it(`rejects ${label} because a fractional base unit cannot exist`, () => {
      expect(() => inventoryQuantity(value as unknown as bigint)).toThrow(
        TypeError,
      );
    });
  }

  for (const [label, value] of NON_NUMERIC_INPUTS) {
    it(`rejects ${label}`, () => {
      expect(() => inventoryQuantity(value as unknown as bigint)).toThrow(
        /An inventory quantity must be an exact bigint, received/,
      );
    });
  }
});

describe("branded exactness", () => {
  it("refuses a raw bigint, a number, and the other brand at compile time", () => {
    const fils = iqdFils(1n);
    const quantity = inventoryQuantity(1n);

    // @ts-expect-error a raw bigint has not been validated as an amount
    const rawBigint: IqdFils = 1n;
    // @ts-expect-error a quantity of stock is not a sum of money
    const quantityAsMoney: IqdFils = quantity;
    // @ts-expect-error money is not a count of inventory units
    const moneyAsQuantity: InventoryQuantity = fils;

    expect([rawBigint, quantityAsMoney, moneyAsQuantity]).toEqual([1n, 1n, 1n]);
  });

  it("relies on the compiler alone to keep the two brands apart in arithmetic", () => {
    const fils = iqdFils(1n);
    const quantity = inventoryQuantity(1n);
    // @ts-expect-error adding stock to money is meaningless and must not compile
    expect(addFils(fils, quantity)).toBe(2n);
  });

  it("stays assignable to bigint, which is what PostgreSQL receives", () => {
    const asBigint: bigint = iqdFils(-5n);
    expect(asBigint).toBe(-5n);
  });
});

describe("parseFilsString", () => {
  for (const wire of CANONICAL_WIRE) {
    it(`round-trips ${wire} byte for byte`, () => {
      expect(formatFilsString(parseFilsString(wire))).toBe(wire);
    });
  }

  it("parses to the exact amount, not to a rounded double", () => {
    const amount = parseFilsString("9007199254740993");
    expect(amount).toBe(9007199254740993n);
    // What the forbidden floating point path would have produced instead.
    expect(Number(amount)).toBe(9007199254740992);
  });

  it("reads sign and magnitude separately", () => {
    expect(parseFilsString("-1")).toBe(-1n);
    expect(parseFilsString("-9223372036854775808")).toBe(-9223372036854775808n);
    expect(parseFilsString("0")).toBe(0n);
  });

  for (const [label, wire] of MALFORMED_WIRE) {
    it(`rejects ${label}`, () => {
      expect(() => parseFilsString(wire)).toThrow(TypeError);
      expect(() => parseFilsString(wire)).toThrow(
        /must be a canonical decimal integer string/,
      );
    });
  }

  it("closes the coercion holes that BigInt would otherwise accept", () => {
    // BigInt is not a validator: each of these would become a silent amount.
    expect(BigInt("")).toBe(0n);
    expect(BigInt(" 12 ")).toBe(12n);
    expect(BigInt("0x1f")).toBe(31n);
    expect(BigInt("-0")).toBe(0n);
    for (const wire of ["", " 12 ", "0x1f", "-0"]) {
      expect(() => parseFilsString(wire)).toThrow(TypeError);
    }
  });

  it("rejects a value that did not arrive as a string", () => {
    expect(() => parseFilsString(5 as unknown as string)).toThrow(
      /must arrive on the wire as a decimal integer string, received number/,
    );
    expect(() => parseFilsString(null as unknown as string)).toThrow(TypeError);
    expect(() => parseFilsString(1n as unknown as string)).toThrow(TypeError);
    expect(() => parseFilsString(undefined as unknown as string)).toThrow(
      TypeError,
    );
  });

  it("quotes and truncates a rejected value in the error message", () => {
    expect(() => parseFilsString("\t1")).toThrow(/"\\t1"/);
    expect(() => parseFilsString("0".repeat(64))).toThrow(/0{32}\.\.\./);
  });

  it("stays unbounded, leaving the range to the column that stores it", () => {
    const sixtyFourDigits = "9".repeat(64);
    expect(formatFilsString(parseFilsString(sixtyFourDigits))).toBe(
      sixtyFourDigits,
    );
  });
});

describe("formatFilsString", () => {
  it("writes zero as the single canonical spelling", () => {
    expect(formatFilsString(iqdFils(0n))).toBe("0");
    expect(formatFilsString(negateFils(iqdFils(0n)))).toBe("0");
  });

  it("writes one leading minus sign for a negative amount", () => {
    expect(formatFilsString(iqdFils(-250n))).toBe("-250");
  });

  it("never writes an exponent for a large amount", () => {
    expect(formatFilsString(iqdFils(10n ** 21n))).toBe(
      "1000000000000000000000",
    );
  });

  it("refuses to put a forged floating point value on the wire", () => {
    // A cast is the only way to forge the brand; the wire is the last place a
    // float could still do damage, so formatting re-validates.
    expect(() => formatFilsString(1e21 as unknown as IqdFils)).toThrow(
      /binary floating point cannot carry an authoritative value/,
    );
    expect(() => formatFilsString("5" as unknown as IqdFils)).toThrow(
      TypeError,
    );
  });
});

describe("quantity wire form", () => {
  for (const wire of CANONICAL_WIRE) {
    it(`round-trips ${wire} byte for byte`, () => {
      expect(formatQuantityString(parseQuantityString(wire))).toBe(wire);
    });
  }

  it("carries signed movements, because an issue reduces stock", () => {
    expect(parseQuantityString("-4")).toBe(-4n);
    expect(formatQuantityString(inventoryQuantity(-4n))).toBe("-4");
  });

  for (const [label, wire] of MALFORMED_WIRE) {
    it(`rejects ${label}`, () => {
      expect(() => parseQuantityString(wire)).toThrow(
        /An inventory quantity must be a canonical decimal integer string/,
      );
    });
  }

  it("rejects a value that did not arrive as a string", () => {
    expect(() => parseQuantityString(4 as unknown as string)).toThrow(
      /must arrive on the wire as a decimal integer string, received number/,
    );
  });

  it("refuses to put a forged floating point value on the wire", () => {
    expect(() =>
      formatQuantityString(4.5 as unknown as InventoryQuantity),
    ).toThrow(/binary floating point cannot carry an authoritative value/);
  });
});

describe("addFils", () => {
  it("adds exactly past the range doubles can represent", () => {
    const left = iqdFils(2n ** 80n);
    const right = iqdFils(1n);
    expect(addFils(left, right)).toBe(1208925819614629174706177n);
  });

  it("adds signed amounts, including back to zero", () => {
    expect(addFils(iqdFils(1500n), iqdFils(-1500n))).toBe(0n);
    expect(addFils(iqdFils(-1500n), iqdFils(-250n))).toBe(-1750n);
    expect(addFils(iqdFils(0n), iqdFils(0n))).toBe(0n);
  });

  it("loses nothing across a long chain of additions", () => {
    let total = iqdFils(0n);
    for (let index = 0; index < 1000; index += 1) {
      total = addFils(total, iqdFils(1n));
    }
    expect(total).toBe(1000n);
    expect(formatFilsString(total)).toBe("1000");
  });

  it("rejects a forged floating point operand", () => {
    expect(() => addFils(1.5 as unknown as IqdFils, iqdFils(1n))).toThrow(
      TypeError,
    );
    expect(() => addFils(iqdFils(1n), 1.5 as unknown as IqdFils)).toThrow(
      TypeError,
    );
  });
});

describe("negateFils", () => {
  it("reverses the sign", () => {
    expect(negateFils(iqdFils(250n))).toBe(-250n);
    expect(negateFils(iqdFils(-250n))).toBe(250n);
  });

  it("has no negative zero to produce", () => {
    expect(negateFils(iqdFils(0n))).toBe(0n);
    expect(Object.is(negateFils(iqdFils(0n)), 0n)).toBe(true);
  });

  it("is its own inverse at any magnitude", () => {
    const amount = iqdFils(-(10n ** 30n) - 1n);
    expect(negateFils(negateFils(amount))).toBe(amount);
  });

  it("rejects a forged floating point operand", () => {
    expect(() => negateFils(1.5 as unknown as IqdFils)).toThrow(TypeError);
  });
});

describe("compareFils and equalsFils", () => {
  it("orders amounts as -1, 0, and 1", () => {
    expect(compareFils(iqdFils(1n), iqdFils(2n))).toBe(-1);
    expect(compareFils(iqdFils(2n), iqdFils(1n))).toBe(1);
    expect(compareFils(iqdFils(2n), iqdFils(2n))).toBe(0);
    expect(compareFils(iqdFils(-2n), iqdFils(-1n))).toBe(-1);
    expect(compareFils(iqdFils(-1n), iqdFils(0n))).toBe(-1);
  });

  it("separates amounts that a double would collapse into one", () => {
    const left = iqdFils(2n ** 53n);
    const right = iqdFils(2n ** 53n + 1n);
    expect(Number(left)).toBe(Number(right));
    expect(compareFils(left, right)).toBe(-1);
    expect(equalsFils(left, right)).toBe(false);
  });

  it("treats equal amounts as equal whatever their provenance", () => {
    expect(equalsFils(parseFilsString("1000"), iqdFils(1000n))).toBe(true);
    expect(equalsFils(iqdFils(0n), negateFils(iqdFils(0n)))).toBe(true);
    expect(equalsFils(iqdFils(1n), iqdFils(-1n))).toBe(false);
  });

  it("rejects a forged floating point operand", () => {
    expect(() => compareFils(1.5 as unknown as IqdFils, iqdFils(1n))).toThrow(
      TypeError,
    );
    expect(() => equalsFils(iqdFils(1n), 1 as unknown as IqdFils)).toThrow(
      TypeError,
    );
  });
});

describe("quantity arithmetic", () => {
  it("adds and negates movements exactly", () => {
    expect(addQuantity(inventoryQuantity(40n), inventoryQuantity(-4n))).toBe(
      36n,
    );
    expect(negateQuantity(inventoryQuantity(4n))).toBe(-4n);
    expect(negateQuantity(inventoryQuantity(0n))).toBe(0n);
  });

  it("stays exact past double precision", () => {
    const large = inventoryQuantity(2n ** 70n);
    expect(addQuantity(large, inventoryQuantity(1n))).toBe(
      1180591620717411303425n,
    );
  });

  it("orders and compares quantities", () => {
    expect(compareQuantity(inventoryQuantity(1n), inventoryQuantity(2n))).toBe(
      -1,
    );
    expect(compareQuantity(inventoryQuantity(2n), inventoryQuantity(1n))).toBe(
      1,
    );
    expect(compareQuantity(inventoryQuantity(2n), inventoryQuantity(2n))).toBe(
      0,
    );
    expect(equalsQuantity(inventoryQuantity(2n), inventoryQuantity(2n))).toBe(
      true,
    );
    expect(equalsQuantity(inventoryQuantity(2n), inventoryQuantity(-2n))).toBe(
      false,
    );
  });

  it("rejects a forged floating point operand", () => {
    expect(() =>
      addQuantity(0.5 as unknown as InventoryQuantity, inventoryQuantity(1n)),
    ).toThrow(TypeError);
    expect(() => negateQuantity(0.5 as unknown as InventoryQuantity)).toThrow(
      TypeError,
    );
  });
});

describe("excluded scope", () => {
  it("exposes no multiplication, division, rounding, or allocation", () => {
    // Those need the accountant-approved rounding and remainder policy that
    // docs/domain.md defers to G-01; they arrive with weighted-average cost in
    // issue #50. Until then no caller can round an authoritative value here.
    const forbidden = Object.keys(moneyModule).filter((name) =>
      /multiply|divide|round|allocat|percent|ratio|float|toNumber/i.test(name),
    );
    expect(forbidden).toEqual([]);
  });
});
