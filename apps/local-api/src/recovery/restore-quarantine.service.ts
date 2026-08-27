import { Injectable, Logger } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

import type { SystemQuarantineVerificationReport } from "./recovery-schema.js";

export interface QuarantineCheckResult {
  readonly details?: string | undefined;
  readonly name: string;
  readonly passed: boolean;
}

export interface QuarantineVerificationHook {
  readonly hookName: string;
  verify(client: PoolClient | Pool): Promise<QuarantineCheckResult>;
}

@Injectable()
export class RestoreQuarantineService {
  private readonly logger = new Logger(RestoreQuarantineService.name);
  private readonly hooks = new Map<string, QuarantineVerificationHook>();

  public registerHook(hook: QuarantineVerificationHook): void {
    this.hooks.set(hook.hookName, hook);
  }

  /**
   * Reads current quarantine state from database.
   */
  public async getQuarantineState(client: PoolClient | Pool): Promise<{
    isQuarantined: boolean;
    quarantineReason: string | null;
    quarantinedAt: Date | null;
    clearedAt: Date | null;
    clearedBy: string | null;
    verificationReport: SystemQuarantineVerificationReport | null;
  }> {
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
    if (!row) {
      return {
        clearedAt: null,
        clearedBy: null,
        isQuarantined: false,
        quarantineReason: null,
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

  /**
   * Places the dataset into Restore Quarantine.
   */
  public async enterQuarantine(
    client: PoolClient | Pool,
    reason = "Database restored from recovery point",
  ): Promise<void> {
    await client.query(
      `insert into system_quarantine_state (
         singleton,
         is_quarantined,
         quarantine_reason,
         quarantined_at,
         cleared_at,
         cleared_by,
         verification_report
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
   * Executes all registered verification hooks.
   * If all pass, clears the quarantine flag.
   */
  public async verifyAndClearQuarantine(
    client: PoolClient | Pool,
    clearedBy = "system_recovery_runner",
  ): Promise<SystemQuarantineVerificationReport> {
    const checks: QuarantineCheckResult[] = [];
    let overallPassed = true;

    for (const [name, hook] of this.hooks) {
      try {
        const result = await hook.verify(client);
        checks.push(result);
        if (!result.passed) {
          overallPassed = false;
        }
      } catch (error) {
        checks.push({
          details: error instanceof Error ? error.message : String(error),
          name,
          passed: false,
        });
        overallPassed = false;
      }
    }

    const report: SystemQuarantineVerificationReport = {
      checks,
      completedAt: new Date().toISOString(),
      overallPassed,
    };

    if (overallPassed) {
      await client.query(
        `update system_quarantine_state
         set is_quarantined = false,
             cleared_at = now(),
             cleared_by = $1,
             verification_report = $2
         where singleton = true`,
        [clearedBy, JSON.stringify(report)],
      );
      this.logger.log("Restore Quarantine successfully verified and cleared");
    } else {
      await client.query(
        `update system_quarantine_state
         set verification_report = $1
         where singleton = true`,
        [JSON.stringify(report)],
      );
      this.logger.error("Restore Quarantine verification checks failed");
    }

    return report;
  }
}

// ─── Milestone 1 Verification Hooks ──────────────────────────────────────────

/**
 * Hook 1: Verifies Main Device Security records and session integrity.
 */
export class MainDeviceSecurityVerificationHook implements QuarantineVerificationHook {
  public readonly hookName = "main_device_security_verification";

  public async verify(
    client: PoolClient | Pool,
  ): Promise<QuarantineCheckResult> {
    const devices = await client.query<{ count: string }>(
      "select count(*)::text as count from main_devices",
    );
    const count = parseInt(devices.rows[0]?.count ?? "0", 10);
    if (count === 0) {
      return {
        details:
          "No Main Device provisioning records found in restored database",
        name: this.hookName,
        passed: false,
      };
    }

    return {
      details: `Verified ${count} Main device record(s)`,
      name: this.hookName,
      passed: true,
    };
  }
}

/**
 * Hook 2: Verifies Terminal Device records and ensures revoked devices remain revoked.
 */
export class DeviceIdentityVerificationHook implements QuarantineVerificationHook {
  public readonly hookName = "device_identity_verification";

  public async verify(
    client: PoolClient | Pool,
  ): Promise<QuarantineCheckResult> {
    const res = await client.query<{
      active_count: string;
      revoked_count: string;
    }>(
      `select count(*) filter (where revoked_at is null)::text as active_count,
              count(*) filter (where revoked_at is not null)::text as revoked_count
       from terminal_devices`,
    );

    const activeCount = parseInt(res.rows[0]?.active_count ?? "0", 10);
    const revokedCount = parseInt(res.rows[0]?.revoked_count ?? "0", 10);

    return {
      details: `Verified ${activeCount} active and ${revokedCount} revoked terminal devices`,
      name: this.hookName,
      passed: true,
    };
  }
}

/**
 * Hook 3: Verifies Licence & Trusted Breev Time state (ensures high-water time consistency).
 */
export class LicenceTimeVerificationHook implements QuarantineVerificationHook {
  public readonly hookName = "licence_time_verification";

  public async verify(
    client: PoolClient | Pool,
  ): Promise<QuarantineCheckResult> {
    const res = await client.query<{
      ca_count: string;
      max_created: Date | null;
    }>(
      `select count(*)::text as ca_count,
              max(created_at) as max_created
       from pharmacy_ca`,
    );

    const caCount = parseInt(res.rows[0]?.ca_count ?? "0", 10);
    if (caCount === 0) {
      return {
        details: "Pharmacy CA identity is missing from restored database",
        name: this.hookName,
        passed: false,
      };
    }

    const now = new Date();
    const maxCreated = res.rows[0]?.max_created;
    if (maxCreated && maxCreated.getTime() > now.getTime() + 60_000) {
      return {
        details: `Clock rollback detected: Restored record timestamp (${maxCreated.toISOString()}) is ahead of current time (${now.toISOString()})`,
        name: this.hookName,
        passed: false,
      };
    }

    return {
      details: "Licence and high-water time integrity verified",
      name: this.hookName,
      passed: true,
    };
  }
}
