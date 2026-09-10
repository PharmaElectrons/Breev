import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeExportedJson } from "./exported-file.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.length = 0;
});

describe("safe exported JSON writer", () => {
  it("enforces the byte cap and leaves no staging file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "breev-export-"));
    directories.push(directory);
    const destination = path.join(directory, "inventory.json");
    await expect(writeExportedJson(destination, "12345", 4)).rejects.toThrow(
      "safe export limit",
    );
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("writes complete UTF-8 JSON through a staging file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "breev-export-"));
    directories.push(directory);
    const destination = path.join(directory, "inventory.json");
    const serialized = JSON.stringify({ message: "مخزون Breev" });
    await writeExportedJson(destination, serialized, 16_384);
    await expect(readFile(destination, "utf8")).resolves.toBe(serialized);
    await expect(readdir(directory)).resolves.toEqual(["inventory.json"]);
  });
});
