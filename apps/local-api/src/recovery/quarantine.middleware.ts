import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";

import { RestoreQuarantineService } from "./restore-quarantine.service.js";

const ALLOWED_QUARANTINE_PATH_PREFIXES = [
  "/health",
  "/api/v1/recovery",
  "/api/v1/quarantine",
];

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
    const pool = getPool();
    if (!pool) {
      next();
      return;
    }

    const path = req.path.toLowerCase();
    const isAllowedPath = ALLOWED_QUARANTINE_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );

    if (isAllowedPath) {
      next();
      return;
    }

    try {
      const state = await quarantineService.getQuarantineState(pool);
      if (state.isQuarantined) {
        res.status(503).json({
          code: "RESTORE_QUARANTINE",
          message:
            "The database is in Restore Quarantine. Normal operations are unavailable until recovery verification completes.",
          quarantinedAt: state.quarantinedAt?.toISOString() ?? null,
          reason: state.quarantineReason,
        });
        return;
      }
    } catch {
      // If table does not exist or database is starting up, let downstream handle it
    }

    next();
  };
}
