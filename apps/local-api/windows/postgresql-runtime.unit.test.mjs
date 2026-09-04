import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyPostgresqlRuntime,
  copyRuntimeFiles,
  postgresqlRuntime,
} from "./postgresql-runtime.mjs";

describe("reviewed PostgreSQL runtime", () => {
  it("pins the archive, required tools, dynamic modules, ICU and legal notices", async () => {
    const lock = JSON.parse(
      await readFile(new URL("./payload-lock.json", import.meta.url), "utf8"),
    );
    const component = lock.components.find(({ name }) => name === "postgresql");
    expect(postgresqlRuntime.version).toBe(component.version);
    expect(postgresqlRuntime.archiveSha256).toBe(component.sha256);
    expect(postgresqlRuntime.files).toHaveLength(1022);
    expect(new Set(postgresqlRuntime.files).size).toBe(1022);
    for (const file of [
      "postgres",
      "initdb",
      "pg_ctl",
      "psql",
      "pg_isready",
      "pg_dump",
      "pg_restore",
      "pg_basebackup",
      "pg_verifybackup",
      "pg_waldump",
    ])
      expect(postgresqlRuntime.files).toContain(`bin/${file}.exe`);
    for (const file of [
      "bin/icudt77.dll",
      "bin/icuuc77.dll",
      "bin/libssl-3-x64.dll",
      "bin/libcurl.dll",
      "bin/libzstd.dll",
      "lib/plpgsql.dll",
      "share/postgres.bki",
      "share/system_functions.sql",
      "share/timezone/Asia/Baghdad",
      "share/timezonesets/Default",
      "server_license.txt",
      "commandlinetools_3rd_party_licenses.txt",
    ])
      expect(postgresqlRuntime.files).toContain(file);
    expect(
      postgresqlRuntime.files.some((file) =>
        /^(doc|include|share\/locale)\//.test(file),
      ),
    ).toBe(false);
    expect(
      postgresqlRuntime.files.some((file) =>
        /\.(lib|a)$|wx(base|msw)/.test(file),
      ),
    ).toBe(false);
    await expect(
      copyPostgresqlRuntime("unused", "unused", { version: "other" }),
    ).rejects.toThrow("Review");
  });

  it("copies only reviewed files and refuses missing inputs before output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "breev-pg-inventory-"));
    try {
      const source = path.join(root, "source");
      const output = path.join(root, "output");
      await mkdir(source);
      await writeFile(path.join(source, "runtime.dll"), "runtime");
      await writeFile(path.join(source, "unused.lib"), "development");
      await expect(
        copyRuntimeFiles(source, output, ["runtime.dll", "missing.dll"]),
      ).rejects.toThrow();
      await expect(
        readFile(path.join(output, "runtime.dll")),
      ).rejects.toThrow();
      expect(await copyRuntimeFiles(source, output, ["runtime.dll"])).toEqual({
        files: 1,
        bytes: 7,
      });
      expect(await readFile(path.join(output, "runtime.dll"), "utf8")).toBe(
        "runtime",
      );
      await expect(readFile(path.join(output, "unused.lib"))).rejects.toThrow();
      for (const invalid of [
        ["../outside"],
        ["/absolute"],
        ["runtime.dll", "RUNTIME.dll"],
      ]) {
        await expect(copyRuntimeFiles(source, output, invalid)).rejects.toThrow(
          "Invalid or duplicate",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
