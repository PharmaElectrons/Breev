import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const BACKUP_MANIFEST_FILE_NAME = "backup_manifest";

export interface ManifestFileEntry {
  readonly checksum: string;
  readonly checksumAlgorithm: string;
  readonly encodedChecksum?: string | undefined;
  readonly path: string;
  readonly size: number;
}

export interface BackupManifest {
  readonly "Backup-Manifest-Version": number;
  readonly Files: Array<{
    readonly "Checksum-Algorithm"?: string | undefined;
    readonly Checksum?: string | undefined;
    readonly "Encoded-Checksum"?: string | undefined;
    readonly Path: string;
    readonly Size: number;
  }>;
  readonly "System-Identifier"?: string | undefined;
  readonly "WAL-Ranges"?:
    | Array<{
        readonly "End-LSN": string;
        readonly "Start-LSN": string;
        readonly Timeline: number;
      }>
    | undefined;
  readonly "Manifest-Checksum"?: string | undefined;
}

export interface ManifestVerificationResult {
  readonly fileCount: number;
  readonly isValid: boolean;
  readonly manifestChecksum: string;
  readonly totalSizeBytes: number;
  readonly verifiedAt: Date;
  readonly violations: string[];
  readonly walEndLsn?: string | undefined;
  readonly walStartLsn?: string | undefined;
}

/**
 * Computes SHA-256 checksum of a file buffer or stream.
 */
export function computeSha256Checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Parses and verifies PostgreSQL backup_manifest against the backup directory.
 * Conforms to the pg_verifybackup class of verification.
 */
export function verifyBackupManifest(
  backupDirectory: string,
  options?: { readonly ignoredPaths?: readonly string[] },
): ManifestVerificationResult {
  const violations: string[] = [];
  const ignoredPaths = new Set([
    BACKUP_MANIFEST_FILE_NAME,
    ...(options?.ignoredPaths ?? []),
  ]);
  const resolvedDir = path.resolve(backupDirectory);
  const manifestPath = path.join(resolvedDir, BACKUP_MANIFEST_FILE_NAME);

  if (!existsSync(manifestPath)) {
    return {
      fileCount: 0,
      isValid: false,
      manifestChecksum: "",
      totalSizeBytes: 0,
      verifiedAt: new Date(),
      violations: [`Missing backup_manifest file in "${resolvedDir}"`],
    };
  }

  let rawManifest: string;
  let manifest: BackupManifest;
  try {
    rawManifest = readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(rawManifest) as BackupManifest;
  } catch (error) {
    return {
      fileCount: 0,
      isValid: false,
      manifestChecksum: "",
      totalSizeBytes: 0,
      verifiedAt: new Date(),
      violations: [
        `Failed to parse backup_manifest: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  if (
    manifest["Backup-Manifest-Version"] !== 1 &&
    manifest["Backup-Manifest-Version"] !== 2
  ) {
    violations.push(
      `Unsupported backup manifest version: ${manifest["Backup-Manifest-Version"]}`,
    );
  }

  const manifestChecksum = computeSha256Checksum(
    Buffer.from(rawManifest, "utf8"),
  );
  let totalSizeBytes = 0;
  let fileCount = 0;
  const manifestPaths = new Set<string>();

  if ((manifest.Files ?? []).length === 0) {
    violations.push("The backup manifest records no files");
  }

  for (const entry of manifest.Files ?? []) {
    fileCount += 1;
    const expectedRelPath = entry.Path;
    manifestPaths.add(normalizeRelativePath(expectedRelPath));
    const expectedSize = entry.Size;
    const expectedChecksum = (
      entry.Checksum ?? entry["Encoded-Checksum"]
    )?.toLowerCase();

    const fullFilePath = path.join(resolvedDir, expectedRelPath);
    if (!existsSync(fullFilePath)) {
      violations.push(
        `Missing backup file recorded in manifest: "${expectedRelPath}"`,
      );
      continue;
    }

    const stat = statSync(fullFilePath);
    if (stat.size !== expectedSize) {
      violations.push(
        `File size mismatch for "${expectedRelPath}": expected ${expectedSize}, found ${stat.size}`,
      );
      continue;
    }

    totalSizeBytes += stat.size;

    if (expectedChecksum) {
      const fileData = readFileSync(fullFilePath);
      const actualChecksum = computeSha256Checksum(fileData).toLowerCase();
      if (actualChecksum !== expectedChecksum) {
        violations.push(
          `Checksum verification failed for "${expectedRelPath}": expected ${expectedChecksum}, computed ${actualChecksum}`,
        );
      }
    }
  }

  for (const presentPath of listBackupFiles(resolvedDir, ignoredPaths)) {
    if (!manifestPaths.has(presentPath)) {
      violations.push(
        `Extra file present in the backup but absent from the manifest: "${presentPath}"`,
      );
    }
  }

  const walRanges = manifest["WAL-Ranges"];
  const walStartLsn = walRanges?.[0]?.["Start-LSN"];
  const walEndLsn = walRanges?.[walRanges.length - 1]?.["End-LSN"];

  return {
    fileCount,
    isValid: violations.length === 0,
    manifestChecksum,
    totalSizeBytes,
    verifiedAt: new Date(),
    violations,
    walEndLsn,
    walStartLsn,
  };
}

/**
 * Builds a standardized pg_verifybackup compliant backup_manifest object
 * for synthetic, test, or custom archive scenarios.
 */
export function createBackupManifest(options: {
  files: Array<{ data: Buffer; relativePath: string }>;
  systemIdentifier: string;
  timeline?: number | undefined;
  walEndLsn?: string | undefined;
  walStartLsn?: string | undefined;
}): { manifestJson: string; manifestChecksum: string } {
  const fileEntries = options.files.map((f) => ({
    "Checksum-Algorithm": "SHA256",
    Checksum: computeSha256Checksum(f.data),
    Path: f.relativePath,
    Size: f.data.length,
  }));

  const manifest: BackupManifest = {
    "Backup-Manifest-Version": 1,
    Files: fileEntries,
    "System-Identifier": options.systemIdentifier,
    ...(options.walStartLsn && options.walEndLsn
      ? {
          "WAL-Ranges": [
            {
              "End-LSN": options.walEndLsn,
              "Start-LSN": options.walStartLsn,
              Timeline: options.timeline ?? 1,
            },
          ],
        }
      : {}),
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestChecksum = computeSha256Checksum(
    Buffer.from(manifestJson, "utf8"),
  );
  return { manifestJson, manifestChecksum };
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/**
 * Lists every file in the backup directory apart from the ignored control
 * files, so verification can report files that the manifest does not account
 * for the way `pg_verifybackup` reports extra files.
 */
function listBackupFiles(
  directory: string,
  ignoredPaths: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const relative = normalizeRelativePath(path.relative(directory, full));
      if (!ignoredPaths.has(relative)) {
        found.push(relative);
      }
    }
  };
  walk(directory);
  return found;
}
