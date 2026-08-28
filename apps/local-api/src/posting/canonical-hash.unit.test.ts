import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  canonicalJson,
  canonicalRequestHash,
  type JsonValue,
} from "./canonical-hash.js";

const COMMAND = "pharmacy.settings.update";

describe("canonical posting request hashing", () => {
  it("produces a 32-byte digest that is stable across calls", () => {
    const body = { attendanceEnabled: true, expectedRevision: "3" };
    const first = canonicalRequestHash(COMMAND, body);
    const second = canonicalRequestHash(COMMAND, body);

    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(true);
  });

  it("ignores object key order at every nesting level", () => {
    const ordered = {
      idempotencyKey: "a",
      nested: { deep: { one: 1, two: [{ x: 1, y: 2 }] }, other: null },
    };
    const shuffled = {
      nested: { other: null, deep: { two: [{ y: 2, x: 1 }], one: 1 } },
      idempotencyKey: "a",
    };

    expect(canonicalJson(ordered)).toBe(canonicalJson(shuffled));
    expect(
      canonicalRequestHash(COMMAND, ordered).equals(
        canonicalRequestHash(COMMAND, shuffled),
      ),
    ).toBe(true);
  });

  it("sorts keys by UTF-16 code unit rather than by locale", () => {
    expect(canonicalJson({ a: 1, Z: 2 })).toBe('{"Z":2,"a":1}');
    expect(canonicalJson({ é: 1, z: 2 })).toBe('{"z":2,"é":1}');
    expect(canonicalJson({ b: 3, A: 4, "-": 5 })).toBe('{"-":5,"A":4,"b":3}');
  });

  it("keeps array order significant", () => {
    expect(
      canonicalRequestHash(COMMAND, { items: [1, 2] }).equals(
        canonicalRequestHash(COMMAND, { items: [2, 1] }),
      ),
    ).toBe(false);
    expect(canonicalJson({ items: [1, 2] })).toBe('{"items":[1,2]}');
  });

  it("detects a difference in any field, including the idempotency key", () => {
    const base = {
      attendanceEnabled: true,
      expectedRevision: "3",
      idempotencyKey: "0198e7ce-7685-7000-8000-000000000001",
    };
    const changes: readonly JsonValue[] = [
      { ...base, attendanceEnabled: false },
      { ...base, expectedRevision: "4" },
      { ...base, idempotencyKey: "0198e7ce-7685-7000-8000-000000000002" },
      { ...base, extra: null },
    ];

    for (const change of changes) {
      expect(
        canonicalRequestHash(COMMAND, base).equals(
          canonicalRequestHash(COMMAND, change),
        ),
      ).toBe(false);
    }
  });

  it("separates commands that carry an identical body", () => {
    const body = { attendanceEnabled: true };

    expect(
      canonicalRequestHash(COMMAND, body).equals(
        canonicalRequestHash("pharmacy.settings.other", body),
      ),
    ).toBe(false);
  });

  it("cannot be confused by a newline inside a command name or a string", () => {
    expect(
      canonicalRequestHash("a\nb", { value: "c" }).equals(
        canonicalRequestHash("a", { value: "b\nc" }),
      ),
    ).toBe(false);
    expect(canonicalJson({ value: "a\nb" })).toBe('{"value":"a\\nb"}');
  });

  it("omits an object property whose value is undefined", () => {
    expect(canonicalJson({ kept: 1, dropped: undefined })).toBe('{"kept":1}');
    expect(
      canonicalRequestHash(COMMAND, { kept: 1, dropped: undefined }).equals(
        canonicalRequestHash(COMMAND, { kept: 1 }),
      ),
    ).toBe(true);
  });

  it("serializes JSON primitives exactly as JSON.stringify does", () => {
    expect(canonicalJson({ a: null, b: false, c: -0, d: 1e21, e: " " })).toBe(
      JSON.stringify({ a: null, b: false, c: -0, d: 1e21, e: " " }),
    );
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson("plain")).toBe('"plain"');
  });

  it.each([
    { label: "a non-finite number", body: { value: Number.POSITIVE_INFINITY } },
    { label: "not a number", body: { value: Number.NaN } },
    { label: "a bigint", body: { value: 1n } },
    { label: "a function", body: { value: () => 1 } },
    { label: "a symbol", body: { value: Symbol("value") } },
    { label: "a date", body: { value: new Date() } },
    { label: "a map", body: { value: new Map() } },
    {
      label: "a class instance",
      body: { value: new CanonicalJsonError("", "") },
    },
    { label: "an undefined array element", body: { value: [1, undefined, 3] } },
  ])("refuses to canonicalize $label", ({ body }) => {
    expect(() => canonicalRequestHash(COMMAND, body as JsonValue)).toThrow(
      CanonicalJsonError,
    );
  });

  it("names the path of the value it refused", () => {
    expect(() =>
      canonicalJson({ outer: { list: [{ bad: Number.NaN }] } } as JsonValue),
    ).toThrow("$.outer.list[0].bad");
  });

  it("accepts a null-prototype object as a plain object", () => {
    const bare = Object.create(null) as Record<string, JsonValue>;
    bare.b = 2;
    bare.a = 1;

    expect(canonicalJson(bare)).toBe('{"a":1,"b":2}');
  });
});
