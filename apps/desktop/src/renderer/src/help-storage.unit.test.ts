import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HELP_COMPLETED_STORAGE_KEY,
  markTutorialCompleted,
  readCompletedTutorials,
} from "./help-storage";

function withStorage(storage: Partial<Storage>): void {
  vi.stubGlobal("window", { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("completed tutorials", () => {
  it("reads back what was stored", () => {
    const store = new Map<string, string>();
    withStorage({
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
    });

    expect(readCompletedTutorials()).toEqual([]);
    expect(markTutorialCompleted("inventory")).toEqual(["inventory"]);
    expect(readCompletedTutorials()).toEqual(["inventory"]);
    expect(store.get(HELP_COMPLETED_STORAGE_KEY)).toBe('["inventory"]');
  });

  it("records a module once however often a tutorial is replayed", () => {
    const store = new Map<string, string>();
    withStorage({
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
    });

    markTutorialCompleted("basket");
    expect(markTutorialCompleted("basket")).toEqual(["basket"]);
  });

  // The record decides only whether the panel offers "start" or "run again", so
  // storage that is unavailable or corrupt degrades to "nothing completed"
  // rather than taking the whole shell down with it.
  it("degrades when storage is empty, malformed, or the wrong shape", () => {
    for (const stored of [null, "not json", '{"inventory":true}', '"basket"']) {
      withStorage({ getItem: () => stored });
      expect(readCompletedTutorials()).toEqual([]);
    }
  });

  it("keeps only the entries that are module ids", () => {
    withStorage({ getItem: () => '["inventory",7,null,"basket"]' });
    expect(readCompletedTutorials()).toEqual(["inventory", "basket"]);
  });

  it("survives storage that throws on read and on write", () => {
    withStorage({
      getItem: () => {
        throw new Error("storage is blocked");
      },
      setItem: () => {
        throw new Error("storage is blocked");
      },
    });

    expect(readCompletedTutorials()).toEqual([]);
    expect(() => markTutorialCompleted("products")).not.toThrow();
    expect(markTutorialCompleted("products")).toEqual(["products"]);
  });
});
