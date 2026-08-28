import { describe, expect, it } from "vitest";

import {
  assertLockStageProgression,
  POSTING_LOCK_STAGES,
  type PostingLockStage,
} from "./lock-order.js";

/**
 * Names that are close enough to a real stage to be typed by accident: the
 * documents' prose spelling, a different case, a stray space, and the empty
 * string. Each must be rejected rather than silently ordered.
 */
const UNKNOWN_STAGE_NAMES = [
  ["the prose spelling from the documents", "batch/stock"],
  ["a spaced spelling", "number sequence"],
  ["a capitalised stage", "Draft"],
  ["a trailing space", "valuation "],
  ["a leading space", " draft"],
  ["an empty name", ""],
  ["a stage that does not exist", "journal"],
  ["a plural stage", "drafts"],
] as const;

/**
 * Presents an arbitrary name as a stage, the way an untyped caller or a stage
 * name read from configuration would reach the assert at run time.
 */
function asStage(name: string): PostingLockStage {
  return name as PostingLockStage;
}

describe("POSTING_LOCK_STAGES", () => {
  it("publishes the documented order exactly", () => {
    expect(POSTING_LOCK_STAGES).toEqual([
      "draft",
      "number-sequence",
      "period",
      "batch-stock",
      "valuation",
    ]);
  });

  it("names the five stages docs/architecture.md publishes, in that sequence", () => {
    // "draft, number sequence, period, batch/stock, valuation"
    expect(POSTING_LOCK_STAGES).toHaveLength(5);
    expect(POSTING_LOCK_STAGES.indexOf("draft")).toBe(0);
    expect(POSTING_LOCK_STAGES.indexOf("number-sequence")).toBe(1);
    expect(POSTING_LOCK_STAGES.indexOf("period")).toBe(2);
    expect(POSTING_LOCK_STAGES.indexOf("batch-stock")).toBe(3);
    expect(POSTING_LOCK_STAGES.indexOf("valuation")).toBe(4);
  });

  it("has no duplicate stage", () => {
    expect(new Set(POSTING_LOCK_STAGES).size).toBe(POSTING_LOCK_STAGES.length);
  });
});

describe("assertLockStageProgression", () => {
  POSTING_LOCK_STAGES.forEach((previous, previousIndex) => {
    POSTING_LOCK_STAGES.forEach((next, nextIndex) => {
      if (nextIndex > previousIndex) {
        it(`allows "${next}" after "${previous}"`, () => {
          expect(() =>
            assertLockStageProgression(previous, next),
          ).not.toThrow();
        });
        return;
      }
      if (nextIndex === previousIndex) {
        it(`rejects taking "${previous}" twice`, () => {
          expect(() => assertLockStageProgression(previous, next)).toThrow(
            `Posting lock stage "${previous}" cannot be acquired twice in one command`,
          );
        });
        return;
      }
      it(`rejects "${next}" after "${previous}"`, () => {
        expect(() => assertLockStageProgression(previous, next)).toThrow(
          `Posting lock stage "${next}" cannot be acquired after "${previous}"`,
        );
      });
    });
  });

  it("allows a command to skip the stages it does not touch", () => {
    // The settings command locks only its own row; a sale that allocates no
    // number goes straight from the draft to the period.
    expect(() =>
      assertLockStageProgression("draft", "valuation"),
    ).not.toThrow();
    expect(() => assertLockStageProgression("draft", "period")).not.toThrow();
    expect(() =>
      assertLockStageProgression("number-sequence", "batch-stock"),
    ).not.toThrow();
  });

  it("accepts a whole command walked stage by stage", () => {
    expect(() => {
      POSTING_LOCK_STAGES.reduce((previous, next) => {
        assertLockStageProgression(previous, next);
        return next;
      });
    }).not.toThrow();
  });

  it("names the published order when it rejects a step", () => {
    expect(() => assertLockStageProgression("valuation", "draft")).toThrow(
      "the published order is draft, number-sequence, period, batch-stock, valuation",
    );
  });

  for (const [label, name] of UNKNOWN_STAGE_NAMES) {
    it(`rejects ${label} as a previous stage`, () => {
      expect(() =>
        assertLockStageProgression(asStage(name), "valuation"),
      ).toThrow(TypeError);
      expect(() =>
        assertLockStageProgression(asStage(name), "valuation"),
      ).toThrow(/Unknown posting lock stage/);
    });

    it(`rejects ${label} as a next stage`, () => {
      expect(() => assertLockStageProgression("draft", asStage(name))).toThrow(
        /Unknown posting lock stage/,
      );
    });
  }

  it("rejects a pair where neither stage is known", () => {
    expect(() =>
      assertLockStageProgression(asStage("journal"), asStage("ledger")),
    ).toThrow(/Unknown posting lock stage "journal"/);
  });

  it("rejects a stage that did not arrive as a stage name at all", () => {
    for (const value of [
      undefined,
      null,
      3,
      {},
      ["draft"],
      1n,
      Symbol("draft"),
    ]) {
      expect(() =>
        assertLockStageProgression(
          value as unknown as PostingLockStage,
          "valuation",
        ),
      ).toThrow(/Unknown posting lock stage/);
    }
  });

  it("reports the mistake rather than failing while describing it", () => {
    // A bigint would break JSON.stringify and a symbol would break string
    // interpolation, so the message would have hidden the real problem.
    expect(() =>
      assertLockStageProgression(1n as unknown as PostingLockStage, "period"),
    ).toThrow("Unknown posting lock stage a bigint value");
    expect(() =>
      assertLockStageProgression(
        Symbol("period") as unknown as PostingLockStage,
        "period",
      ),
    ).toThrow("Unknown posting lock stage a symbol value");
  });

  it("refuses an unknown stage before it reports an ordering problem", () => {
    // Ordering can only be judged between two published stages.
    expect(() =>
      assertLockStageProgression("valuation", asStage("draught")),
    ).toThrow(/Unknown posting lock stage "draught"/);
  });

  it("rejects a compile-time stage name that is not published", () => {
    // @ts-expect-error the stage set is closed by the published order
    expect(() => assertLockStageProgression("draft", "batch/stock")).toThrow(
      TypeError,
    );
  });
});
