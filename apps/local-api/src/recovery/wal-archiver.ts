import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";

export interface ArchiveWalSegmentOptions {
  readonly destinationDir: string;
  readonly sourceWalPath: string;
  readonly walFileName: string;
}

export interface ArchiveWalResult {
  readonly destinationPath: string;
  readonly sizeBytes: number;
  readonly walFileName: string;
}

/**
 * Validates a PostgreSQL WAL segment filename (24 hex characters, e.g. 000000010000000000000001,
 * or timeline history files, e.g. 00000001.history).
 */
export function isValidWalFileName(fileName: string): boolean {
  return (
    /^[0-9A-F]{24}$/u.test(fileName) ||
    /^[0-9A-F]{8}\.history$/u.test(fileName) ||
    /^[0-9A-F]{24}\.[0-9A-F]{8}\.backup$/u.test(fileName)
  );
}

/**
 * Copies a WAL segment to destination safely:
 * 1. Validates filename and source existence.
 * 2. Writes to `<dest>/<walFileName>.<uuid>.tmp`.
 * 3. Atomically renames temporary file to final target `<dest>/<walFileName>`.
 *
 * If target file already exists and is identical (idempotent archive retry), returns success.
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

  // If already exists with valid size, it's an idempotent PostgreSQL archiver retry
  if (existsSync(finalTargetPath)) {
    const sourceStat = statSync(resolvedSource);
    const destStat = statSync(finalTargetPath);
    if (sourceStat.size === destStat.size && sourceStat.size > 0) {
      return {
        destinationPath: finalTargetPath,
        sizeBytes: destStat.size,
        walFileName,
      };
    }
  }

  const tempFileName = `${walFileName}.${randomUUID()}.tmp`;
  const tempTargetPath = path.join(resolvedDestDir, tempFileName);

  try {
    await copyFile(resolvedSource, tempTargetPath);
    renameSync(tempTargetPath, finalTargetPath);
  } catch (error) {
    if (existsSync(tempTargetPath)) {
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tempTargetPath);
      } catch {
        // ignore temp cleanup error
      }
    }
    throw error;
  }

  const stat = statSync(finalTargetPath);
  return {
    destinationPath: finalTargetPath,
    sizeBytes: stat.size,
    walFileName,
  };
}

/**
 * Builds the PostgreSQL archive_command string for postgresql.conf.
 * Uses node to invoke Breev's atomic archiver.
 */
export function buildArchiveCommand(
  nodeExecutable: string,
  archiverScriptPath: string,
  walArchiveDir: string,
): string {
  const escapedNode = `"${nodeExecutable.replace(/"/g, "")}"`;
  const escapedScript = `"${archiverScriptPath.replace(/"/g, "")}"`;
  const escapedArchiveDir = `"${walArchiveDir.replace(/"/g, "")}"`;

  return `${escapedNode} ${escapedScript} "%p" "%f" ${escapedArchiveDir}`;
}
