import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface MigrationJournal {
  readonly entries: readonly {
    readonly idx: number;
    readonly tag: string;
    readonly when: number;
  }[];
}

const drizzleDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const journal = JSON.parse(
  readFileSync(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as MigrationJournal;

describe("database migration journal", () => {
  it("keeps migrations ordered and matched to SQL files", () => {
    for (const [index, entry] of journal.entries.entries()) {
      expect(entry.tag.startsWith(String(entry.idx).padStart(4, "0"))).toBe(
        true,
      );
      expect(existsSync(`${drizzleDirectory}${entry.tag}.sql`)).toBe(true);

      const previous = journal.entries[index - 1];
      if (previous !== undefined) {
        expect(entry.idx).toBeGreaterThan(previous.idx);
        expect(entry.when).toBeGreaterThan(previous.when);
      }
    }
  });
});
