import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  default as builderConfiguration,
  refreshPayloadExecutableHashes,
  windowsFuseConfig,
} from "./electron-builder.config.mjs";

describe("Windows electron-builder candidate", () => {
  it("pins the secure machine-wide NSIS toolset", () => {
    expect(builderConfiguration.toolsets).toEqual({
      nsis: "1.2.1",
      wine: "1.0.1",
      winCodeSign: "1.1.0",
    });
    expect(builderConfiguration.nsis).toMatchObject({
      oneClick: false,
      perMachine: true,
      differentialPackage: true,
      include: "windows/installer.nsh",
    });
  });

  it("locks the packaged Electron trust boundary before signing", () => {
    expect(builderConfiguration.asar).toBe(true);
    expect(builderConfiguration.disableAsarIntegrity).toBe(false);
    expect(windowsFuseConfig).toMatchObject({
      version: "1",
      strictlyRequireAllFuses: true,
      0: false,
      1: true,
      2: false,
      3: false,
      4: true,
      5: true,
      6: false,
      7: false,
      8: true,
    });
    expect(builderConfiguration.afterPack).toBeTypeOf("function");
    expect(builderConfiguration.afterSign).toBeTypeOf("function");
    expect(builderConfiguration.win.verifyUpdateCodeSignature).toBe(true);
    expect(builderConfiguration.win.signExts).toEqual([
      ".exe",
      ".dll",
      ".node",
      ".sys",
      ".efi",
      ".scr",
      ".msi",
      ".cat",
      ".cab",
      ".xap",
      ".vbs",
      ".wsf",
      ".ps1",
    ]);
  });

  it("embeds one offline payload instead of a web installer", () => {
    expect(builderConfiguration.extraMetadata).toEqual({ version: "0.0.0" });
    expect(builderConfiguration.win.target).toEqual([
      { target: "nsis", arch: ["x64"] },
    ]);
    expect(builderConfiguration.extraResources).toEqual([
      {
        from: "../../artifacts/windows/payload",
        to: "windows-payload",
      },
    ]);
  });

  it("records post-sign runtime hashes without losing pinned provenance", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "breev-payload-manifest-"));
    try {
      await mkdir(path.join(root, "service-wrapper"));
      await writeFile(
        path.join(root, "service-wrapper", "shawl.exe"),
        "signed",
      );
      await writeFile(
        path.join(root, "payload-manifest.json"),
        JSON.stringify({
          components: [
            {
              name: "shawl",
              executableHashes: { "shawl.exe": "unsigned-hash" },
              sourceExecutableHashes: { "shawl.exe": "unsigned-hash" },
            },
          ],
        }),
      );

      await refreshPayloadExecutableHashes(root);
      const manifest = JSON.parse(
        await readFile(path.join(root, "payload-manifest.json"), "utf8"),
      );
      expect(manifest.components[0].sourceExecutableHashes).toEqual({
        "shawl.exe": "unsigned-hash",
      });
      expect(manifest.components[0].executableHashes).toEqual({
        "shawl.exe": createHash("sha256").update("signed").digest("hex"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
