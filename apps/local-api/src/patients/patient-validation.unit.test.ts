import { describe, expect, it } from "vitest";
import { normalizeSearchQuery } from "./patient-validation.js";

describe("patient-validation", () => {
  describe("normalizeSearchQuery", () => {
    it("trims and collapses consecutive whitespace", () => {
      expect(normalizeSearchQuery("  hello   world  ")).toBe("hello world");
      expect(normalizeSearchQuery("Fatima")).toBe("Fatima");
      expect(normalizeSearchQuery("   Mohamed    Ali   ")).toBe("Mohamed Ali");
    });

    it("returns null for empty or whitespace-only queries", () => {
      expect(normalizeSearchQuery("   ")).toBeNull();
      expect(normalizeSearchQuery("")).toBeNull();
      expect(normalizeSearchQuery(undefined)).toBeNull();
      expect(normalizeSearchQuery(null)).toBeNull();
    });
  });
});
