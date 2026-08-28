import { createHash } from "node:crypto";

/**
 * The JSON value space a posting command body may occupy. A validated request
 * body is exactly this shape, so nothing wider is ever hashed.
 */
export type JsonValue =
  JsonObject | JsonValue[] | boolean | null | number | string;

/**
 * A JSON object: the shape an audit before or after state and an outbox
 * payload must have. Typing those fields this way is what keeps a bigint, a
 * `Date`, or any other non-JSON value from reaching a stored fact, where it
 * would either throw at serialization time or be silently reshaped.
 */
export type JsonObject = { readonly [key: string]: JsonValue | undefined };

/**
 * Canonicalization rules, stated precisely because the digest they produce is
 * the arbitration key of every idempotent posting command:
 *
 * 1. Only JSON values are accepted: objects, arrays, strings, finite numbers,
 *    booleans, and null. Anything else — `undefined` outside an object
 *    property, a non-finite number, a bigint, a symbol, a function, or an
 *    object with a prototype other than `Object.prototype` or `null` (a Date,
 *    a Map, a class instance) — throws instead of being silently coerced.
 * 2. Object keys are sorted by UTF-16 code-unit order at every nesting level,
 *    which is what the `<` operator on strings already does. Locale-aware
 *    comparison is deliberately not used: it is neither stable across
 *    platforms nor injective.
 * 3. Array order is significant and preserved.
 * 4. An object property whose value is `undefined` is omitted, matching
 *    `JSON.stringify`, so an absent optional field and an explicitly
 *    undefined one hash identically.
 * 5. Primitives are serialized exactly as `JSON.stringify` serializes them,
 *    including its string escaping and its well-formed lone-surrogate escapes.
 * 6. No insignificant whitespace is emitted.
 */
export function canonicalJson(value: JsonValue): string {
  return writeValue(value, "$");
}

/**
 * The 32-byte request digest stored in `posting_command_results.request_hash`.
 *
 * The digest covers `commandName + "\n" + canonicalJson(body)`. That encoding
 * is injective without validating the command name, because canonical JSON
 * never contains a raw newline: newlines inside strings are escaped and no
 * whitespace is emitted between tokens, so the first newline in the digest
 * input always ends the command name.
 *
 * The body is the full validated request body, including its idempotency key.
 * No field is excluded: a retry that reuses a key while changing any part of
 * the request is a different request and must be refused, not replayed.
 */
export function canonicalRequestHash(
  commandName: string,
  body: JsonValue,
): Buffer {
  return createHash("sha256")
    .update(commandName, "utf8")
    .update("\n", "utf8")
    .update(canonicalJson(body), "utf8")
    .digest();
}

export class CanonicalJsonError extends Error {
  public readonly path: string;

  public constructor(reason: string, path: string) {
    super(`${reason} at ${path} cannot be canonicalized`);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

function writeValue(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean": {
      return value ? "true" : "false";
    }
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError("A non-finite number", path);
      }
      return JSON.stringify(value);
    }
    case "string": {
      return JSON.stringify(value);
    }
    case "object": {
      return Array.isArray(value)
        ? writeArray(value, path)
        : writeObject(value, path);
    }
    default: {
      throw new CanonicalJsonError(`A ${typeof value} value`, path);
    }
  }
}

function writeArray(value: readonly unknown[], path: string): string {
  const items = value.map((item, index) => {
    const itemPath = `${path}[${String(index)}]`;
    if (item === undefined) {
      throw new CanonicalJsonError("An undefined array element", itemPath);
    }
    return writeValue(item, itemPath);
  });
  return `[${items.join(",")}]`;
}

function writeObject(value: object, path: string): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError("A non-plain object", path);
  }
  const record = value as Record<string, unknown>;
  const entries: string[] = [];
  for (const key of Object.keys(record).sort(compareCodeUnits)) {
    const property = record[key];
    if (property === undefined) {
      continue;
    }
    entries.push(
      `${JSON.stringify(key)}:${writeValue(property, `${path}.${key}`)}`,
    );
  }
  return `{${entries.join(",")}}`;
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
