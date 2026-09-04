import { copyFile, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const postgresqlRuntime = JSON.parse(
  await readFile(
    new URL("./postgresql-runtime-files.json", import.meta.url),
    "utf8",
  ),
);

export async function copyPostgresqlRuntime(source, destination, component) {
  if (
    component.version !== postgresqlRuntime.version ||
    component.sha256 !== postgresqlRuntime.archiveSha256
  ) {
    throw new Error(
      "Review the PostgreSQL runtime inventory for the pinned archive",
    );
  }
  return copyRuntimeFiles(source, destination, postgresqlRuntime.files);
}

// Copy a reviewed inventory, never a broad directory followed by guessed deletes.
// Verify every input before publishing any output; reject links and escaped paths.
export async function copyRuntimeFiles(source, destination, files) {
  const sourceRoot = await realpath(source);
  const names = new Set();
  let bytes = 0;
  for (const relative of files) {
    if (
      !/^[a-zA-Z0-9_./+-]+$/.test(relative) ||
      relative
        .split("/")
        .some((part) => part === ".." || part === "." || part === "") ||
      path.isAbsolute(relative) ||
      names.has(relative.toLowerCase())
    ) {
      throw new Error(
        `Invalid or duplicate PostgreSQL runtime path: ${relative}`,
      );
    }
    names.add(relative.toLowerCase());
    const input = path.join(sourceRoot, relative);
    const entry = await lstat(input);
    const resolved = await realpath(input);
    const resolvedRelative = path.relative(sourceRoot, resolved);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      resolvedRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolvedRelative)
    ) {
      throw new Error(
        `PostgreSQL runtime input must be a contained regular file: ${relative}`,
      );
    }
    bytes += entry.size;
  }
  if (bytes >= 70 * 1024 * 1024) {
    throw new Error("PostgreSQL runtime exceeds the reviewed 70 MiB budget");
  }
  for (const relative of files) {
    const output = path.join(destination, relative);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(path.join(sourceRoot, relative), output);
  }
  return { files: files.length, bytes };
}
