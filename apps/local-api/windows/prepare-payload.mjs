import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyPostgresqlRuntime } from "./postgresql-runtime.mjs";
import { buildApiRuntime } from "./build-api-runtime.mjs";
import { recordPayloadFiles } from "../../../tooling/windows/payload-inventory.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../../..");
const artifactsRoot = path.join(repoRoot, "artifacts", "windows");
const outputRoot = resolveArgument(
  "--output",
  path.join(artifactsRoot, "payload"),
);
const cacheRoot = resolveArgument("--cache", path.join(artifactsRoot, "cache"));

assertChildPath(artifactsRoot, outputRoot, "payload");
assertChildPath(artifactsRoot, cacheRoot, "cache");

const lockPath = path.join(scriptRoot, "payload-lock.json");
const payloadLock = JSON.parse(await readFile(lockPath, "utf8"));
if (payloadLock.schemaVersion !== 1 || payloadLock.architecture !== "x64") {
  throw new Error("Unsupported Windows payload lock format");
}

await mkdir(cacheRoot, { recursive: true });
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const component of payloadLock.components) {
  const archivePath = path.join(cacheRoot, component.archive);
  if ((await hashIfPresent(archivePath)) !== component.sha256) {
    await rm(archivePath, { force: true });
    await download(component.url, archivePath);
  }
  if ((await sha256(archivePath)) !== component.sha256) {
    throw new Error(`Hash verification failed for ${component.name}`);
  }

  const extractRoot = path.join(outputRoot, `.extract-${component.name}`);
  await mkdir(extractRoot, { recursive: true });
  extractArchive(archivePath, extractRoot);

  if (component.name === "node") {
    const nodeRoot = path.join(outputRoot, "node");
    await rename(path.join(extractRoot, "node-v24.19.0-win-x64"), nodeRoot);
    for (const entry of await readdir(nodeRoot)) {
      if (entry !== "LICENSE" && entry !== "node.exe") {
        await rm(path.join(nodeRoot, entry), { recursive: true, force: true });
      }
    }
  } else if (component.name === "postgresql") {
    const postgresqlRoot = path.join(outputRoot, "postgresql");
    const inventory = await copyPostgresqlRuntime(
      path.join(extractRoot, "pgsql"),
      postgresqlRoot,
      component,
    );
    process.stdout.write(`PostgreSQL runtime: ${JSON.stringify(inventory)}\n`);
  } else if (component.name === "shawl") {
    const wrapperRoot = path.join(outputRoot, "service-wrapper");
    await mkdir(wrapperRoot, { recursive: true });
    const executablePath = path.join(wrapperRoot, "shawl.exe");
    await rename(path.join(extractRoot, "shawl.exe"), executablePath);
  } else {
    throw new Error("Unknown Windows payload component");
  }
  await rm(extractRoot, { recursive: true, force: true });

  const componentRoot =
    component.name === "shawl"
      ? path.join(outputRoot, "service-wrapper")
      : path.join(outputRoot, component.name);
  for (const [relativePath, expectedHash] of Object.entries(
    component.executableHashes,
  )) {
    if (
      (await sha256(path.join(componentRoot, relativePath))) !== expectedHash
    ) {
      throw new Error(
        `Hash verification failed for ${component.name}/${relativePath}`,
      );
    }
  }
}

const localApiRoot = path.join(outputRoot, "local-api");
const apiInventory = await buildApiRuntime(localApiRoot);
process.stdout.write(`Bundled API runtime: ${JSON.stringify(apiInventory)}\n`);

await copyFile(
  path.join(scriptRoot, "bootstrap.sql"),
  path.join(outputRoot, "bootstrap.sql"),
);
await copyFile(
  path.join(scriptRoot, "lifecycle.ps1"),
  path.join(outputRoot, "lifecycle.ps1"),
);
await copyFile(lockPath, path.join(outputRoot, "payload-lock.json"));
const payloadManifest = structuredClone(payloadLock);
for (const component of payloadManifest.components) {
  component.sourceExecutableHashes = { ...component.executableHashes };
}
payloadManifest.files = await recordPayloadFiles(outputRoot);
const payloadBytes = payloadManifest.files.reduce(
  (sum, file) => sum + file.bytes,
  0,
);
if (payloadBytes >= 180 * 1024 * 1024 || payloadManifest.files.length > 1200) {
  throw new Error(
    "The Windows service payload exceeds its reviewed 180 MiB / 1,200-file budget",
  );
}
process.stdout.write(
  `Payload inventory: ${payloadManifest.files.length} files, ${payloadBytes} bytes (excluding manifest)\n`,
);
await writeFile(
  path.join(outputRoot, "payload-manifest.json"),
  `${JSON.stringify(payloadManifest, null, 2)}\n`,
  "utf8",
);

for (const requiredPath of [
  "node/node.exe",
  "postgresql/bin/postgres.exe",
  "postgresql/bin/initdb.exe",
  "service-wrapper/shawl.exe",
  "local-api/dist/main.cjs",
  "local-api/dist/migrate.cjs",
  "local-api/drizzle/meta/_journal.json",
]) {
  await assertFile(path.join(outputRoot, requiredPath));
}

// Developer secrets must never ship: the payload is distributed verbatim to
// every installation. Windows filesystems are case-insensitive, so the match
// is too, and the scan covers the whole payload recursively.
for (const entry of await readdir(outputRoot, { recursive: true })) {
  const baseName = path.basename(entry).toLowerCase();
  if (baseName === ".env" || baseName.startsWith(".env.")) {
    throw new Error(`The Windows payload must not contain ${entry}`);
  }
}

process.stdout.write(`${outputRoot}\n`);

function resolveArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return path.resolve(fallback);
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return path.resolve(value);
}

function assertChildPath(parent, child, label) {
  const relative = path.relative(parent, child);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`The ${label} path must be a child of ${parent}`);
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error("Could not download a pinned Windows payload component");
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );
}

async function hashIfPresent(filePath) {
  try {
    return await sha256(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function sha256(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

function extractArchive(archivePath, destination) {
  if (process.platform === "win32") {
    run("tar.exe", ["-xf", archivePath, "-C", destination]);
    return;
  }
  run("unzip", ["-q", archivePath, "-d", destination]);
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

async function assertFile(filePath) {
  const file = await stat(filePath);
  if (!file.isFile()) {
    throw new Error(
      `The prepared payload is missing a required file: ${filePath}`,
    );
  }
}
