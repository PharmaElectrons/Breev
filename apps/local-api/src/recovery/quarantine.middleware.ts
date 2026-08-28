import {
  localHealthContract,
  localRecoveryStatusContract,
  LOCAL_RESTORE_QUARANTINE_STATUS,
  type LocalRestoreQuarantineDenial,
} from "@breev/contracts/local-rest";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";

import { RestoreQuarantineService } from "./restore-quarantine.service.js";

/**
 * The only routes a quarantined dataset still answers: the health handshake
 * and the read-only recovery status that reports why it is quarantined.
 */
const QUARANTINE_EXEMPT_PATHS: ReadonlySet<string> = new Set<string>([
  localHealthContract.path,
  localRecoveryStatusContract.path,
]);

/**
 * Blocks normal use while the restored dataset is in Restore Quarantine.
 *
 * The check fails closed: if the quarantine state cannot be read, the request
 * is refused rather than served, because an unreadable quarantine record is
 * not evidence that the dataset is fit for normal use.
 */
export function createRestoreQuarantineMiddleware(options: {
  getPool: () => Pool | undefined;
  quarantineService: RestoreQuarantineService;
}) {
  const { getPool, quarantineService } = options;

  return async function restoreQuarantineMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (QUARANTINE_EXEMPT_PATHS.has(req.path)) {
      next();
      return;
    }

    const pool = getPool();
    if (pool === undefined) {
      next();
      return;
    }

    let quarantinedAt: string | null = null;
    let reason: string | null = null;
    try {
      const state = await quarantineService.getQuarantineState(pool);
      if (!state.isQuarantined) {
        next();
        return;
      }
      quarantinedAt = state.quarantinedAt?.toISOString() ?? null;
      reason = state.quarantineReason;
    } catch {
      reason = "The restore quarantine state could not be read";
    }

    const denial: LocalRestoreQuarantineDenial = {
      code: "restore-quarantine",
      quarantinedAt,
      reason,
    };
    res.status(LOCAL_RESTORE_QUARANTINE_STATUS).json(denial);
  };
}
