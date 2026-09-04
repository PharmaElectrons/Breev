import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  recordPayloadFiles,
  verifyPayloadFiles,
} from "../../../tooling/windows/payload-inventory.mjs";

const execute = promisify(execFile);
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "breev-126-integrity-"));
  try {
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist/main.cjs"), "bundle");
    await writeFile(path.join(root, "runtime.dll"), "native");
    await writeFile(path.join(root, "migration.sql"), "select 1");
    const files = await recordPayloadFiles(root);
    await writeFile(
      path.join(root, "payload-manifest.json"),
      JSON.stringify({ files }),
    );
    await run(root, files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("complete Windows payload inventory", () => {
  it("covers scripts, SQL and DLLs; allows only signing changes during packaging", async () => {
    await fixture(async (root, files) => {
      expect(await verifyPayloadFiles(root, files)).toEqual(files);
      await writeFile(path.join(root, "runtime.dll"), "signed native");
      await expect(verifyPayloadFiles(root, files)).rejects.toThrow(
        "integrity",
      );
      expect(await verifyPayloadFiles(root, files, true)).toHaveLength(3);
      await writeFile(path.join(root, "migration.sql"), "tampered");
      await expect(verifyPayloadFiles(root, files, true)).rejects.toThrow(
        "integrity",
      );
    });
  });
  it("rejects missing/extra files and malformed path inventories", async () => {
    await fixture(async (root, files) => {
      await expect(verifyPayloadFiles(root, [])).rejects.toThrow("missing");
      await expect(
        verifyPayloadFiles(root, [...files, files[0]]),
      ).rejects.toThrow("invalid");
      await expect(
        verifyPayloadFiles(root, [{ ...files[0], path: "../outside" }]),
      ).rejects.toThrow("invalid");
      await writeFile(path.join(root, "unexpected.dll"), "extra");
      await expect(verifyPayloadFiles(root, files, true)).rejects.toThrow(
        "inventory",
      );
      await rm(path.join(root, "unexpected.dll"));
      await rm(path.join(root, "runtime.dll"));
      await expect(verifyPayloadFiles(root, files)).rejects.toThrow(
        "inventory",
      );
    });
  });
  it.skipIf(process.platform !== "win32")(
    "runs the actual PowerShell verifier without service or data mutations",
    async () => {
      await fixture(async (root, files) => {
        // A PowerShell 7 parent can export its incompatible module path into
        // Windows PowerShell 5.1. Let that host resolve its own system modules.
        const environment = { ...process.env };
        delete environment.PSModulePath;
        const verify = () =>
          execute(
            "powershell.exe",
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              path.join(import.meta.dirname, "test-payload-files.ps1"),
              "-PayloadRoot",
              root,
            ],
            // A clean Windows runner may spend more than 15 seconds starting
            // Windows PowerShell and loading its built-in modules under
            // Defender. Keep a bounded timeout without turning cold-start
            // variance into a payload-integrity failure.
            { timeout: 60_000, env: environment },
          );
        await verify();
        for (const name of ["runtime.dll", "dist/main.cjs", "migration.sql"]) {
          await writeFile(path.join(root, name), "tampered");
          await expect(verify()).rejects.toThrow();
          const originals = {
            "runtime.dll": "native",
            "dist/main.cjs": "bundle",
            "migration.sql": "select 1",
          };
          await writeFile(path.join(root, name), originals[name]);
        }
        await writeFile(path.join(root, "extra.node"), "extra");
        await expect(verify()).rejects.toThrow();
        await rm(path.join(root, "extra.node"));
        await writeFile(
          path.join(root, "payload-manifest.json"),
          JSON.stringify({ files: [...files, files[0]] }),
        );
        await expect(verify()).rejects.toThrow();
      });
    },
  );
});
