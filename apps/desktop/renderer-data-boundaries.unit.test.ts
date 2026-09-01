import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MODULE_DEFINITIONS,
  type ModuleId,
} from "./src/renderer/src/navigation.js";

/**
 * Tripwires for the client-prototype adoption.
 *
 * The prototype under `design/prototype` reads and writes pharmacy data through
 * a browser Supabase client and keeps business state in `localStorage`. Both are
 * prototype behaviour, never production authority: `docs/architecture.md` makes
 * the local API the only business and database authority and limits browser
 * storage to "non-critical per-device presentation preferences", and
 * `docs/domain.md` forbids hard-coded credentials and caller-supplied tenancy.
 *
 * These are deliberately tripwires, not proofs. A source scan cannot see through
 * a string built at runtime, an alias, or a dynamic import, so the structural
 * guarantees live where they can be enforced properly:
 *
 * - `tooling/boundaries/check.mjs` resolves imports, so it rejects a second data
 *   authority (`@supabase/supabase-js`, TanStack Start, anything under
 *   `design/prototype`) at the import graph rather than by grepping text.
 * - The Electron smoke suite proves the CSP, navigation denial, and the exact
 *   preload surface.
 *
 * What is left here catches the careless copy-paste from the prototype, which is
 * the realistic failure mode while the adoption epic runs.
 */

const RENDERER_ROOT = path.resolve(import.meta.dirname, "src/renderer");

/**
 * Locale and theme are exactly the per-device presentation preferences the
 * architecture allows, and they are read and written in one place.
 */
const BROWSER_STORAGE_OWNERS = new Set([
  "src/renderer/src/preferences-provider.tsx",
  "src/renderer/src/preferences.ts",
  "src/renderer/src/preferences.unit.test.ts",
]);

/** The only keys the presentation-preference adapter may own. */
const ALLOWED_STORAGE_KEYS = ["breev.locale", "breev.theme"];

const FORBIDDEN_DATA_SOURCES = [
  "supabase",
  "@tanstack/react-start",
  "createclient(",
  "lovable",
];

/**
 * Prose explaining why a prototype behaviour is absent must not itself trip the
 * guard, so the scan reads code with its comments removed.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

function collectRendererSources(): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target);
      } else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) {
        files.push({
          path: path
            .relative(path.resolve(import.meta.dirname), target)
            .split(path.sep)
            .join("/"),
          source: stripComments(readFileSync(target, "utf8")),
        });
      }
    }
  };
  walk(RENDERER_ROOT);
  return files;
}

describe("production renderer data boundaries", () => {
  const sources = collectRendererSources();

  it("reads renderer sources at all", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it("never names a second data authority", () => {
    const offenders = sources
      .filter(({ source }) => {
        const lowered = source.toLocaleLowerCase();
        return FORBIDDEN_DATA_SOURCES.some((needle) =>
          lowered.includes(needle),
        );
      })
      .map(({ path: file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps business data out of browser storage", () => {
    const offenders = sources
      .filter(
        ({ path: file, source }) =>
          !BROWSER_STORAGE_OWNERS.has(file) &&
          /\b(?:localStorage|sessionStorage|indexedDB)\b/u.test(source),
      )
      .map(({ path: file }) => file);
    expect(offenders).toEqual([]);
  });

  it("lets the preference adapter own only the locale and theme keys", () => {
    const adapter = sources.find(
      ({ path: file }) => file === "src/renderer/src/preferences.ts",
    );
    expect(adapter).toBeDefined();
    const keys = [...(adapter?.source.matchAll(/"(breev\.[a-z.]+)"/gu) ?? [])]
      .map((match) => match[1])
      .sort();
    expect([...new Set(keys)]).toEqual([...ALLOWED_STORAGE_KEYS].sort());
  });

  it("ships no hard-coded credential the way the prototype's auth gate does", () => {
    const offenders = sources
      .filter(({ source }) =>
        /(?:signInWithPassword|DUMMY_PASSWORD|BreefAdmin)/u.test(source),
      )
      .map(({ path: file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps the superseded Breef spelling out of production identifiers", () => {
    const offenders = sources
      .filter(({ source }) => /\bbreef\b/iu.test(source))
      .map(({ path: file }) => file);
    expect(offenders).toEqual([]);
  });

  /*
   * Asserting the registry beats grepping source prose for words like "clinic",
   * which also matches the legitimate "clinical", or "marketing", which a future
   * Phase One messaging string could legitimately contain.
   */
  it("registers no excluded or deferred prototype module", () => {
    const registered: ModuleId[] = MODULE_DEFINITIONS.map(
      (definition) => definition.id,
    );
    expect(registered).toEqual([
      "dashboard",
      "sales",
      "purchases",
      "inventory",
      "products",
      "patients",
      "messages",
      "basket",
      "reports",
      "accounts",
      "administration",
      "settings",
    ]);
    for (const definition of MODULE_DEFINITIONS) {
      expect(definition.hash).not.toMatch(
        /clinic|delivery|ecommerce|e-commerce|marketing|external/iu,
      );
    }
  });
});
