import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Flushes a file's contents to stable storage. A recovery point that only
 * exists in the page cache is not a recovery point: the database row that
 * records it must never become durable before the bytes it describes.
 */
export function syncFile(filePath: string): void {
  const descriptor = openSync(filePath, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Flushes a directory entry so a rename or link survives a crash.
 * Windows exposes no directory handle to flush; NTFS orders the metadata
 * update with the file data instead, so the call is a no-op there.
 */
export function syncDirectory(directoryPath: string): void {
  if (process.platform === "win32") {
    return;
  }
  const descriptor = openSync(directoryPath, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Writes a file so that a crash at any point leaves either the previous
 * contents or the complete new contents, never a truncated file. The temporary
 * name is unique per write, so an interrupted run never leaves a partial file
 * that a later run can mistake for a finished one.
 */
export function writeFileDurably(
  filePath: string,
  contents: Buffer | string,
  temporarySuffix: string,
): void {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${temporarySuffix}.tmp`;
  writeFileSync(temporaryPath, contents);
  syncFile(temporaryPath);
  renameSync(temporaryPath, filePath);
  syncDirectory(directory);
}
