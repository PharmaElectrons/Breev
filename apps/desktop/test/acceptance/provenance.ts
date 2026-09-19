import { extractFile } from "@electron/asar";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Provenance of everything the acceptance run drove.
 *
 * A milestone acceptance record is only worth the identity of the binary it
 * exercised, so the transcript carries the repository commit, the working-tree
 * cleanliness at run time, the packaged executable's digest, its full fuse
 * wire, the application version inside `app.asar`, and the identity of the
 * `local-api` build the packaged renderer talked to. Without those, a reader
 * cannot tell which build produced a verdict.
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");

export interface SourceProvenance {
  readonly commit: string;
  /** `git status --porcelain` at run time; empty means a clean tree. */
  readonly workingTreeStatus: string;
}

export interface ExecutableProvenance {
  readonly applicationVersion: string;
  readonly asarPath: string;
  readonly asarSha256: string;
  /** When the packaged archive was built, against the source it was built from. */
  readonly builtAt: string;
  readonly fuses: Readonly<Record<string, string>>;
  readonly newestSourceChangeAt: string;
  readonly path: string;
  readonly sha256: string;
}

export interface LocalApiProvenance {
  readonly builtAt: string;
  readonly entryPoint: string;
  readonly newestSourceChangeAt: string;
  /**
   * The repository's commit and status **at run time**, not a property of the
   * build output: `dist/` carries no commit of its own, and naming these fields
   * `commit`/`workingTreeStatus` invited a reader to believe it did.
   */
  readonly repositoryCommitAtRunTime: string;
  readonly repositoryStatusAtRunTime: string;
  readonly sha256: string;
}

const FUSE_NAMES: Readonly<Record<number, string>> = {
  [FuseV1Options.RunAsNode]: "RunAsNode",
  [FuseV1Options.EnableCookieEncryption]: "EnableCookieEncryption",
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]:
    "EnableNodeOptionsEnvironmentVariable",
  [FuseV1Options.EnableNodeCliInspectArguments]:
    "EnableNodeCliInspectArguments",
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
    "EnableEmbeddedAsarIntegrityValidation",
  [FuseV1Options.OnlyLoadAppFromAsar]: "OnlyLoadAppFromAsar",
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]:
    "LoadBrowserProcessSpecificV8Snapshot",
  [FuseV1Options.GrantFileProtocolExtraPrivileges]:
    "GrantFileProtocolExtraPrivileges",
  [FuseV1Options.WasmTrapHandlers]: "WasmTrapHandlers",
};

const FUSE_STATE_NAMES: Readonly<Record<number, string>> = {
  [FuseState.DISABLE]: "DISABLE",
  [FuseState.ENABLE]: "ENABLE",
  [FuseState.INHERIT]: "INHERIT",
  [FuseState.REMOVED]: "REMOVED",
};

export function readSourceProvenance(): SourceProvenance {
  return {
    commit: git("rev-parse", "HEAD"),
    workingTreeStatus: git("status", "--porcelain"),
  };
}

export function packagedArtifactDirectory(): string {
  return path.resolve(
    REPOSITORY_ROOT,
    "artifacts",
    `Breev-${process.platform}-${process.arch}`,
  );
}

export function packagedExecutablePath(): string {
  const artifact = packagedArtifactDirectory();
  if (process.platform === "win32") {
    return path.join(artifact, "Breev.exe");
  }
  if (process.platform === "darwin") {
    return path.join(artifact, "Breev.app", "Contents", "MacOS", "Breev");
  }
  return path.join(artifact, "Breev");
}

export function packagedAsarPath(): string {
  const artifact = packagedArtifactDirectory();
  if (process.platform === "darwin") {
    return path.join(
      artifact,
      "Breev.app",
      "Contents",
      "Resources",
      "app.asar",
    );
  }
  return path.join(artifact, "resources", "app.asar");
}

export function localApiEntryPoint(): string {
  return path.resolve(REPOSITORY_ROOT, "apps", "local-api", "dist", "main.js");
}

/**
 * Reads the packaged executable's identity and asserts the same five fuses the
 * certified packaged smoke seam asserts, while recording all nine so a reader
 * can see the whole wire rather than only the checked subset.
 *
 * It also refuses to run against a stale package, for the same reason the
 * local API does: an acceptance record attributes what it saw to a commit, and
 * a package built before the last change to `apps/desktop/src` would attribute
 * the wrong build's behaviour to it.
 */
export async function readExecutableProvenance(): Promise<ExecutableProvenance> {
  const executablePath = packagedExecutablePath();
  const asarPath = packagedAsarPath();
  const asarStats = await stat(asarPath);
  const newestSourceChange = await newestModification(
    path.resolve(REPOSITORY_ROOT, "apps", "desktop", "src"),
  );
  if (asarStats.mtimeMs <= newestSourceChange) {
    throw new Error(
      `The packaged archive at ${asarPath} (${asarStats.mtime.toISOString()}) is older than ` +
        `apps/desktop/src (${new Date(newestSourceChange).toISOString()}). ` +
        "Run `pnpm build && pnpm package:desktop` before recording an acceptance run.",
    );
  }
  const wire = await getCurrentFuseWire(executablePath);

  expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(
    FuseState.DISABLE,
  );
  expect(wire[FuseV1Options.EnableNodeCliInspectArguments]).toBe(
    FuseState.DISABLE,
  );
  expect(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).not.toBe(
    FuseState.ENABLE,
  );
  expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).not.toBe(FuseState.ENABLE);

  const fuses: Record<string, string> = {};
  for (const [option, name] of Object.entries(FUSE_NAMES)) {
    const state = wire[Number(option) as FuseV1Options];
    fuses[name] =
      state === undefined
        ? "ABSENT"
        : (FUSE_STATE_NAMES[state] ?? `UNKNOWN(${String(state)})`);
  }

  const packageJson = JSON.parse(
    extractFile(asarPath, "package.json").toString("utf8"),
  ) as { readonly version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("The packaged ASAR has no application version");
  }

  return {
    applicationVersion: packageJson.version,
    asarPath,
    asarSha256: await sha256OfFile(asarPath),
    builtAt: asarStats.mtime.toISOString(),
    fuses,
    newestSourceChangeAt: new Date(newestSourceChange).toISOString(),
    path: executablePath,
    sha256: await sha256OfFile(executablePath),
  };
}

/**
 * Identifies the `local-api` build the packaged renderer talked to, and refuses
 * to run against a stale one.
 *
 * `dist/` is build output with no commit of its own, so the only honest check
 * is that it is newer than every file it was built from. A run against a build
 * that predates a source change would attribute that build's behaviour to this
 * commit, which is exactly the claim an acceptance record makes.
 */
export async function readLocalApiProvenance(
  source: SourceProvenance,
): Promise<LocalApiProvenance> {
  const entryPoint = localApiEntryPoint();
  const stats = await stat(entryPoint);
  const newestSourceChange = await newestModification(
    path.resolve(REPOSITORY_ROOT, "apps", "local-api", "src"),
  );
  if (stats.mtimeMs <= newestSourceChange) {
    throw new Error(
      `The built local API at ${entryPoint} (${stats.mtime.toISOString()}) is older than ` +
        `apps/local-api/src (${new Date(newestSourceChange).toISOString()}). ` +
        "Run `pnpm --filter @breev/local-api build` before recording an acceptance run.",
    );
  }
  return {
    builtAt: stats.mtime.toISOString(),
    entryPoint,
    newestSourceChangeAt: new Date(newestSourceChange).toISOString(),
    repositoryCommitAtRunTime: source.commit,
    repositoryStatusAtRunTime: source.workingTreeStatus,
    sha256: await sha256OfFile(entryPoint),
  };
}

async function newestModification(directory: string): Promise<number> {
  let newest = 0;
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stats = await stat(path.join(entry.parentPath, entry.name));
    newest = Math.max(newest, stats.mtimeMs);
  }
  return newest;
}

async function sha256OfFile(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function git(...args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
}
