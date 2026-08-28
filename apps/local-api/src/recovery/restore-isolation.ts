import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * The running pharmacy cluster a restore must never touch. Both values are
 * required: a restore that cannot name the live cluster cannot prove it is
 * isolated from it, so it must refuse to run.
 */
export interface LiveClusterIdentity {
  readonly dataDirectory: string;
  readonly port: number;
}

export interface RestoreTargetValidationOptions {
  readonly live: LiveClusterIdentity;
  readonly targetDataDir: string;
  readonly targetPort: number;
}

/**
 * Refuses any restore target that could reach the live pharmacy cluster.
 *
 * The target is rejected when it resolves to the live data directory, sits
 * inside it, contains it, or binds the live port. Paths are resolved through
 * symbolic links and Windows junctions first, so a link cannot present an
 * innocent path that lands inside the live cluster.
 */
export function assertStrictRestoreIsolation(
  options: RestoreTargetValidationOptions,
): void {
  const { live, targetDataDir, targetPort } = options;

  if (live.dataDirectory.trim() === "") {
    throw new Error(
      "RESTORE_SAFETY_VIOLATION: The live database data directory must be known before a restore can be proved isolated.",
    );
  }
  if (!Number.isInteger(live.port) || !Number.isInteger(targetPort)) {
    throw new Error(
      "RESTORE_SAFETY_VIOLATION: The live and isolated database ports must both be known before a restore can be proved isolated.",
    );
  }

  const resolvedTarget = resolveExistingPath(targetDataDir);
  const resolvedLive = resolveExistingPath(live.dataDirectory);

  if (samePath(resolvedTarget, resolvedLive)) {
    throw new Error(
      `RESTORE_SAFETY_VIOLATION: Restore target directory "${resolvedTarget}" is the live database data directory. Refusing restore to protect the active pharmacy database.`,
    );
  }
  if (contains(resolvedLive, resolvedTarget)) {
    throw new Error(
      `RESTORE_SAFETY_VIOLATION: Restore target directory "${resolvedTarget}" is inside the live database data directory.`,
    );
  }
  if (contains(resolvedTarget, resolvedLive)) {
    throw new Error(
      `RESTORE_SAFETY_VIOLATION: Restore target directory "${resolvedTarget}" contains the live database data directory.`,
    );
  }

  if (live.port === targetPort) {
    throw new Error(
      `RESTORE_SAFETY_VIOLATION: Restore target port ${targetPort} is the live database port. The isolated instance must bind a different port.`,
    );
  }
}

/**
 * Resolves a path through symbolic links and junctions. A path that does not
 * exist yet is resolved as far as its nearest existing ancestor, so a restore
 * target inside a linked directory cannot escape the comparison by not
 * existing yet.
 */
function resolveExistingPath(target: string): string {
  let current = path.resolve(target);
  const trailing: string[] = [];

  for (;;) {
    if (existsSync(current)) {
      return path.join(realpathSync(current), ...trailing.reverse());
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(target);
    }
    trailing.push(path.basename(current));
    current = parent;
  }
}

function samePath(left: string, right: string): boolean {
  return path.relative(left, right) === "";
}

function contains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
