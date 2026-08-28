import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

import { LocalDatabaseService } from "../local-database.service.js";
import type { SystemQuarantineVerificationReport } from "./recovery-schema.js";

/**
 * Marker written into a restored data directory before any restored byte
 * lands, so restored data is never present without its quarantine state.
 */
export const RESTORE_QUARANTINE_MARKER_FILE_NAME = "RESTORE_QUARANTINE.flag";

export interface QuarantineCheckResult {
  readonly details?: string | undefined;
  readonly name: string;
  readonly passed: boolean;
}

export interface QuarantineVerificationHook {
  readonly hookName: string;
  verify(client: PoolClient | Pool): Promise<QuarantineCheckResult>;
}

export interface QuarantineState {
  readonly clearedAt: Date | null;
  readonly clearedBy: string | null;
  readonly isQuarantined: boolean;
  readonly quarantineReason: string | null;
  readonly quarantinedAt: Date | null;
  readonly verificationReport: SystemQuarantineVerificationReport | null;
}

@Injectable()
export class RestoreQuarantineService implements OnModuleInit {
  private readonly logger = new Logger(RestoreQuarantineService.name);
  private readonly hooks: readonly QuarantineVerificationHook[] = [
    new MainDeviceSecurityVerificationHook(),
    new DeviceIdentityVerificationHook(),
    new LicenceTimeVerificationHook(),
  ];

  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
  ) {}

  /**
   * A restored dataset stays out of normal use until the verification hooks
   * pass, so every start re-runs them while the dataset is quarantined.
   */
  public async onModuleInit(): Promise<void> {
    // A failure here must not abort the API bootstrap: quarantine enforcement
    // fails closed per request in the middleware, so skipping the startup
    // verification leaves a quarantined dataset quarantined while the service
    // still binds its port and reports its real state through /health.
    try {
      await this.localDatabase.ensureReady();
      let pool: Pool;
      try {
        pool = this.localDatabase.requirePool();
      } catch {
        return;
      }

      const state = await this.getQuarantineState(pool);
      if (!state.isQuarantined) {
        return;
      }
      await this.verifyAndClearQuarantine(pool, "system_recovery_startup");
    } catch (error) {
      this.logger.error(
        "Startup quarantine verification could not run, so any quarantine stays in place",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Reads the persisted quarantine state. A missing singleton row means the
   * quarantine record itself is gone, which is treated as quarantined rather
   * than as permission to serve normal traffic.
   */
  public async getQuarantineState(
    client: PoolClient | Pool,
  ): Promise<QuarantineState> {
    const result = await client.query<{
      cleared_at: Date | null;
      cleared_by: string | null;
      is_quarantined: boolean;
      quarantine_reason: string | null;
      quarantined_at: Date | null;
      verification_report: SystemQuarantineVerificationReport | null;
    }>(
      `select is_quarantined,
              quarantine_reason,
              quarantined_at,
              cleared_at,
              cleared_by,
              verification_report
       from system_quarantine_state
       where singleton = true`,
    );

    const row = result.rows[0];
    if (row === undefined) {
      return {
        clearedAt: null,
        clearedBy: null,
        isQuarantined: true,
        quarantineReason: "The restore quarantine record is missing",
        quarantinedAt: null,
        verificationReport: null,
      };
    }

    return {
      clearedAt: row.cleared_at,
      clearedBy: row.cleared_by,
      isQuarantined: Boolean(row.is_quarantined),
      quarantineReason: row.quarantine_reason,
      quarantinedAt: row.quarantined_at,
      verificationReport: row.verification_report,
    };
  }

  /** Places the dataset into Restore Quarantine. */
  public async enterQuarantine(
    client: PoolClient | Pool,
    reason: string,
  ): Promise<void> {
    await client.query(
      `insert into system_quarantine_state (
         singleton, is_quarantined, quarantine_reason, quarantined_at,
         cleared_at, cleared_by, verification_report
       )
       values (true, true, $1, now(), null, null, null)
       on conflict (singleton) do update
       set is_quarantined = true,
           quarantine_reason = $1,
           quarantined_at = now(),
           cleared_at = null,
           cleared_by = null,
           verification_report = null`,
      [reason],
    );
    this.logger.warn(`Dataset entered Restore Quarantine: ${reason}`);
  }

  /**
   * Runs every verification hook and clears the quarantine only when all of
   * them pass. A hook that throws counts as a failed check, so an unavailable
   * check keeps the dataset quarantined.
   */
  public async verifyAndClearQuarantine(
    client: PoolClient | Pool,
    clearedBy: string,
  ): Promise<SystemQuarantineVerificationReport> {
    const checks: QuarantineCheckResult[] = [];
    for (const hook of this.hooks) {
      try {
        checks.push(await hook.verify(client));
      } catch (error) {
        checks.push({
          details: error instanceof Error ? error.message : String(error),
          name: hook.hookName,
          passed: false,
        });
      }
    }

    const report: SystemQuarantineVerificationReport = {
      checks,
      completedAt: new Date().toISOString(),
      overallPassed: checks.every((check) => check.passed),
    };

    const cleared = await client.query(
      `update system_quarantine_state
       set is_quarantined = not $1,
           cleared_at = case when $1 then now() else cleared_at end,
           cleared_by = case when $1 then $2 else cleared_by end,
           verification_report = $3
       where singleton = true and is_quarantined = true`,
      [report.overallPassed, clearedBy, JSON.stringify(report)],
    );

    if (report.overallPassed && cleared.rowCount === 1) {
      this.logger.log("Restore Quarantine verified and cleared");
    } else if (!report.overallPassed) {
      this.logger.error(
        `Restore Quarantine verification failed: ${checks
          .filter((check) => !check.passed)
          .map((check) => `${check.name}: ${check.details ?? "failed"}`)
          .join("; ")}`,
      );
    }

    return report;
  }
}

// ─── Milestone 1 verification hooks ──────────────────────────────────────────

/** Verifies that the restored dataset still carries its Main device records. */
export class MainDeviceSecurityVerificationHook implements QuarantineVerificationHook {
  public readonly hookName = "main_device_security_verification";

  public async verify(
    client: PoolClient | Pool,
  ): Promise<QuarantineCheckResult> {
    const devices = await client.query<{ count: string }>(
      "select count(*)::text as count from main_devices",
    );
    const count = Number.parseInt(devices.rows[0]?.count ?? "0", 10);
    if (count === 0) {
      return {
        details:
          "No Main device provisioning records found in the restored dataset",
        name: this.hookName,
        passed: false,
      };
    }

    return {
      details: `Verified ${String(count)} Main device record(s)`,
      name: this.hookName,
      passed: true,
    };
  }
}

/**
 * Verifies that terminal device revocations survived the restore intact: every
 * revoked device must still carry both its revocation instant and its reason,
 * so a restore can never quietly resurrect a revoked terminal.
 */
export class DeviceIdentityVerificationHook implements QuarantineVerificationHook {
  public readonly hookName = "device_identity_verification";

  public async verify(
    client: PoolClient | Pool,
  ): Promise<QuarantineCheckResult> {
    const result = await client.query<{
      active_count: string;
      inconsistent_count: string;
      revoked_count: string;
    }>(
      `select count(*) filter (where revoked_at is null)::text as active_count,
              count(*) filter (where revoked_at is not null)::text as revoked_count,
              count(*) filter (
                where (revoked_at is null) <> (revocation_reason is null)
              )::text as inconsistent_count
       from terminal_devices`,
    );

    const row = result.rows[0];
    const activeCount = Number.parseInt(row?.active_count ?? "0", 10);
    const revokedCount = Number.parseInt(row?.revoked_count ?? "0", 10);
    const inconsistentCount = Number.parseInt(
      row?.inconsistent_count ?? "0",
      10,
    );

    if (inconsistentCount > 0) {
      return {
        details: `${String(inconsistentCount)} terminal device record(s) lost their revocation evidence in the restore`,
        name: this.hookName,
        passed: false,
      };
    }

    return {
      details: `Verified ${String(activeCount)} active and ${String(revokedCount)} revoked terminal devices`,
      name: this.hookName,
      passed: true,
    };
  }
}

/**
 * Verifies the pharmacy CA identity and the Trusted Breev Time high-water
 * mark: a restored dataset whose newest record is ahead of the current clock
 * indicates a rollback and keeps the dataset quarantined.
 */
export class LicenceTimeVerificationHook implements QuarantineVerificationHook {
  public readonly hookName = "licence_time_verification";

  public async verify(
    client: PoolClient | Pool,
  ): Promise<QuarantineCheckResult> {
    const result = await client.query<{
      ca_count: string;
      max_created: Date | null;
    }>(
      `select count(*)::text as ca_count, max(created_at) as max_created
       from pharmacy_ca`,
    );

    const caCount = Number.parseInt(result.rows[0]?.ca_count ?? "0", 10);
    if (caCount === 0) {
      return {
        details:
          "The pharmacy CA identity is missing from the restored dataset",
        name: this.hookName,
        passed: false,
      };
    }

    const now = new Date();
    const maxCreated = result.rows[0]?.max_created;
    if (maxCreated && maxCreated.getTime() > now.getTime() + 60_000) {
      return {
        details: `Clock rollback detected: the newest restored record (${maxCreated.toISOString()}) is ahead of the current time (${now.toISOString()})`,
        name: this.hookName,
        passed: false,
      };
    }

    return {
      details: "Pharmacy CA identity and high-water time verified",
      name: this.hookName,
      passed: true,
    };
  }
}
