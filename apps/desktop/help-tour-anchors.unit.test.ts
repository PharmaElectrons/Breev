import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { tourSteps } from "./src/renderer/src/tour-steps.js";

/**
 * The `data-tour` attribute is the contract between `tour-steps.ts` and the
 * markup it points at.
 *
 * Nothing in the type system connects the two: renaming an attribute without
 * renaming the step leaves the spotlight pointing at nothing, and only at
 * runtime, on whichever screen nobody happened to open. A source scan catches
 * that at the same moment the rename happens.
 *
 * This lives beside `renderer-data-boundaries.unit.test.ts` rather than under
 * `src/renderer` because the renderer's own TypeScript project is DOM-only and
 * has no Node file APIs.
 */
const RENDERER_SOURCE = path.join(
  import.meta.dirname,
  "src",
  "renderer",
  "src",
);

/**
 * `guided-tour.tsx` builds the selector from a template literal, so it contains
 * the attribute name without ever placing one. Scanning it would match the
 * engine's own source rather than any screen.
 */
const NOT_MARKUP = new Set(["guided-tour.tsx"]);

function rendererMarkup(): string {
  return readdirSync(RENDERER_SOURCE)
    .filter(
      (name) =>
        name.endsWith(".tsx") &&
        !name.includes(".test.") &&
        !NOT_MARKUP.has(name),
    )
    .map((name) => readFileSync(path.join(RENDERER_SOURCE, name), "utf8"))
    .join("\n");
}

describe("tutorial anchors", () => {
  it("has an element in the renderer for every step", () => {
    const markup = rendererMarkup();
    for (const [moduleId, steps] of Object.entries(tourSteps)) {
      for (const step of steps) {
        expect(
          markup.includes(`data-tour="${step.anchor}"`),
          `${moduleId}: no element carries data-tour="${step.anchor}"`,
        ).toBe(true);
      }
    }
  });

  it("has a step for every anchor placed in the renderer", () => {
    // The reverse direction: an anchor nothing points at is dead markup, and
    // usually the leftover of a step someone removed.
    const anchors = new Set(
      [...rendererMarkup().matchAll(/data-tour="([^"]+)"/g)].map(
        (match) => match[1],
      ),
    );
    const referenced = new Set(
      Object.values(tourSteps).flatMap((steps) =>
        steps.map((step) => step.anchor),
      ),
    );
    expect([...anchors].filter((anchor) => !referenced.has(anchor))).toEqual(
      [],
    );
  });
});
