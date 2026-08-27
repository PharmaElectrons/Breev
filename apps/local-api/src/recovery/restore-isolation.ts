import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface RestoreTargetValidationOptions {
  readonly liveDataDir?: string | undefined;
  readonly livePort?: number | undefined;
  readonly targetDataDir: string;
  readonly targetPort?: number | undefined;
}

export interface IsolatedRestoreConfig {
  readonly isolatedDataDir: string;
  readonly isolatedPort: number;
  readonly restoreCommand: string;
}

/**
 * Validates that a restore target is strictly isolated from the live database cluster.
 * Throws a fatal safety error if any property matches the running service.
 */
export function assertStrictRestoreIsolation(
  options: RestoreTargetValidationOptions,
): void {
  const { liveDataDir, livePort, targetDataDir, targetPort } = options;

  const resolvedTarget = path.resolve(targetDataDir);

  if (liveDataDir) {
    const resolvedLive = path.resolve(liveDataDir);
    if (resolvedTarget.toLowerCase() === resolvedLive.toLowerCase()) {
      throw new Error(
        `RESTORE_SAFETY_VIOLATION: Restore target directory "${resolvedTarget}" matches the live database data directory. Refusing restore to protect the active pharmacy database.`,
      );
    }

    // Check if target is inside live directory or live directory is inside target
    const relative = path.relative(resolvedLive, resolvedTarget);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new Error(
        `RESTORE_SAFETY_VIOLATION: Restore target directory "${resolvedTarget}" is located inside the live database directory.`,
      );
    }
  }

  if (livePort !== undefined && targetPort !== undefined) {
    if (livePort === targetPort) {
      throw new Error(
        `RESTORE_SAFETY_VIOLATION: Restore target port ${targetPort} matches the live database port ${livePort}. Isolated instance must bind to a different port.`,
      );
    }
  }
}

/**
 * Prepares an isolated data directory for restore.
 */
export function prepareIsolatedRestoreDirectory(
  targetDir: string,
  options: RestoreTargetValidationOptions,
): string {
  assertStrictRestoreIsolation(options);

  const resolved = path.resolve(targetDir);
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }

  return resolved;
}
