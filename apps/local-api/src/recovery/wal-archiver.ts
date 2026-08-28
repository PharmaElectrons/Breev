import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { copyFile, link, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { syncDirectory, syncFile } from "./durable-file.js";

export interface ArchiveWalSegmentOptions {
  readonly destinationDir: string;
  readonly sourceWalPath: string;
  readonly walFileName: string;
}

export interface ArchiveWalResult {
  readonly alreadyArchived: boolean;
  readonly destinationPath: string;
  readonly sizeBytes: number;
  readonly walFileName: string;
}

/**
 * Validates a PostgreSQL WAL segment filename (24 hex characters, e.g.
 * 000000010000000000000001), a timeline history file (00000001.history), or a
 * backup label file (000000010000000000000001.00000028.backup). Partial
 * segments (`.partial`) are never valid archive input: archiving one as if it
 * were complete would silently break WAL continuity.
 */
export function isValidWalFileName(fileName: string): boolean {
  return (
    /^[0-9A-F]{24}$/u.test(fileName) ||
    /^[0-9A-F]{8}\.history$/u.test(fileName) ||
    /^[0-9A-F]{24}\.[0-9A-F]{8}\.backup$/u.test(fileName)
  );
}

/**
 * Archives one WAL file for use as PostgreSQL's `archive_command`.
 *
 * The contract PostgreSQL requires of an archive command is strict: report
 * success only after the file is durably stored, never overwrite an existing
 * archived file, and fail when a different file already occupies the name.
 * This implementation therefore copies into a unique temporary file, flushes
 * that file and the archive directory to disk, and publishes the result with a
 * hard link, which fails rather than clobbers when the name is taken. A retry
 * of an already-archived segment succeeds only when the stored bytes are
 * identical.
 */
export async function archiveWalSegment(
  options: ArchiveWalSegmentOptions,
): Promise<ArchiveWalResult> {
  const { destinationDir, sourceWalPath, walFileName } = options;

  if (!isValidWalFileName(walFileName)) {
    throw new Error(`Invalid WAL filename: "${walFileName}"`);
  }

  const resolvedSource = path.resolve(sourceWalPath);
  if (!existsSync(resolvedSource)) {
    throw new Error(`Source WAL file does not exist: "${resolvedSource}"`);
  }

  const resolvedDestDir = path.resolve(destinationDir);
  if (!existsSync(resolvedDestDir)) {
    mkdirSync(resolvedDestDir, { recursive: true });
  }

  const finalTargetPath = path.join(resolvedDestDir, walFileName);
  if (existsSync(finalTargetPath)) {
    return await assertIdenticalArchivedSegment(
      resolvedSource,
      finalTargetPath,
      walFileName,
    );
  }

  const tempTargetPath = path.join(
    resolvedDestDir,
    `${walFileName}.${randomUUID()}.tmp`,
  );

  try {
    await copyFile(resolvedSource, tempTargetPath);
    syncFile(tempTargetPath);
    try {
      await link(tempTargetPath, finalTargetPath);
    } catch (error) {
      if (isFileExistsError(error)) {
        await unlink(tempTargetPath);
        return await assertIdenticalArchivedSegment(
          resolvedSource,
          finalTargetPath,
          walFileName,
        );
      }
      throw error;
    }
    syncDirectory(resolvedDestDir);
  } finally {
    await unlink(tempTargetPath).catch(() => undefined);
  }

  return {
    alreadyArchived: false,
    destinationPath: finalTargetPath,
    sizeBytes: statSync(finalTargetPath).size,
    walFileName,
  };
}

async function assertIdenticalArchivedSegment(
  sourcePath: string,
  archivedPath: string,
  walFileName: string,
): Promise<ArchiveWalResult> {
  const [sourceDigest, archivedDigest] = await Promise.all([
    sha256File(sourcePath),
    sha256File(archivedPath),
  ]);

  if (sourceDigest !== archivedDigest) {
    throw new Error(
      `WAL segment "${walFileName}" is already archived with different content. Refusing to overwrite an archived segment.`,
    );
  }

  return {
    alreadyArchived: true,
    destinationPath: archivedPath,
    sizeBytes: statSync(archivedPath).size,
    walFileName,
  };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}
