import { Injectable } from "@nestjs/common";
import type {
  LicensingDenial,
  PaidCapabilityName,
} from "@breev/contracts/local-rest";
import type { Pool, QueryResult } from "pg";

import { LocalDatabaseService } from "../local-database.service.js";
import {
  deriveEntitlement,
  type EntitlementContext,
  type StoredLicenceVerification,
} from "./entitlement.js";
import { OFFLINE_LICENCE_PUBLIC_KEYS } from "./licence-keys.js";
import {
  type OfflineLicenceClaims,
  verifyOfflineLicence,
} from "./offline-licence.js";
import { observeTrustedTime } from "./trusted-time.js";

interface LicensingContextInput {
  readonly actorId?: string;
  readonly identitySessionId?: string;
  readonly mainDeviceId: string;
  readonly now: Date;
  readonly pharmacyId: string;
}

interface InstallLicenceInput extends LicensingContextInput {
  readonly actorId: string;
  readonly encodedLicence: string;
}

interface LicenceRow {
  readonly encoded_licence: string;
}

export class LicensingDenied extends Error {
  public constructor(public readonly denial: LicensingDenial) {
    super(denial.code);
    this.name = "LicensingDenied";
  }
}

@Injectable()
export class LicensingService {
  private readonly highWaterByBinding = new Map<string, Date>();

  public constructor(private readonly localDatabase: LocalDatabaseService) {}

  public async current(
    input: LicensingContextInput,
  ): Promise<EntitlementContext> {
    const clock = await this.observeClock(input);
    const licence = await this.latestLicence(input, clock.trustedNow);
    if (clock.rollbackDetected) {
      await writeAudit(this.localDatabase.requirePool(), {
        action: "trusted-time.rollback",
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.identitySessionId === undefined
          ? {}
          : { identitySessionId: input.identitySessionId }),
        mainDeviceId: input.mainDeviceId,
        observedAt: input.now,
        outcome: "detected",
        pharmacyId: input.pharmacyId,
        details: { trustedLowerBound: clock.trustedNow.toISOString() },
      });
    }
    return deriveEntitlement({
      licence,
      clockRollbackDetected: clock.rollbackDetected,
    });
  }

  public async install(
    input: InstallLicenceInput,
  ): Promise<EntitlementContext> {
    const clock = await this.observeClock(input);
    if (clock.rollbackDetected) {
      const requestId = await writeAudit(this.localDatabase.requirePool(), {
        action: "licence.install",
        actorId: input.actorId,
        ...(input.identitySessionId === undefined
          ? {}
          : { identitySessionId: input.identitySessionId }),
        mainDeviceId: input.mainDeviceId,
        observedAt: input.now,
        outcome: "denied",
        pharmacyId: input.pharmacyId,
        details: { reason: "clock-rollback" },
      });
      throw new LicensingDenied({
        status: "denied",
        code: "clock-rollback",
        requestId,
      });
    }

    const verification = verifyOfflineLicence({
      encodedLicence: input.encodedLicence,
      expectedMainDeviceId: input.mainDeviceId,
      expectedPharmacyId: input.pharmacyId,
      now: clock.trustedNow,
      publicKeys: OFFLINE_LICENCE_PUBLIC_KEYS,
    });
    if (verification.status === "invalid") {
      const requestId = await writeAudit(this.localDatabase.requirePool(), {
        action: "licence.install",
        actorId: input.actorId,
        ...(input.identitySessionId === undefined
          ? {}
          : { identitySessionId: input.identitySessionId }),
        mainDeviceId: input.mainDeviceId,
        observedAt: input.now,
        outcome: "denied",
        pharmacyId: input.pharmacyId,
        details: { reason: verification.reason },
      });
      throw new LicensingDenied({
        status: "denied",
        code: "licence-invalid",
        requestId,
      });
    }

    await this.storeInstallation(input, verification.claims);
    return await this.current(input);
  }

  public async requireCapability(
    input: LicensingContextInput & { readonly capability: PaidCapabilityName },
  ): Promise<void> {
    const entitlement = await this.current(input);
    const allowed = entitlement.capabilities.includes(input.capability);
    const requestId = await writeAudit(this.localDatabase.requirePool(), {
      action: "capability.authorization",
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      capability: input.capability,
      ...(input.identitySessionId === undefined
        ? {}
        : { identitySessionId: input.identitySessionId }),
      mainDeviceId: input.mainDeviceId,
      observedAt: input.now,
      outcome: allowed ? "allowed" : "denied",
      pharmacyId: input.pharmacyId,
      details: { entitlementStatus: entitlement.status },
    });
    if (!allowed) {
      throw new LicensingDenied({
        status: "denied",
        code: "entitlement-denied",
        requestId,
        requiredCapability: input.capability,
      });
    }
  }

  private async observeClock(input: LicensingContextInput): Promise<{
    readonly rollbackDetected: boolean;
    readonly trustedNow: Date;
  }> {
    const pool = this.localDatabase.requirePool();
    const binding = `${input.pharmacyId}:${input.mainDeviceId}`;
    let persistedLowerBound = await latestLowerBound(pool, input);
    const inMemoryHighWater = this.highWaterByBinding.get(binding);
    let observation = observeTrustedTime({
      now: input.now,
      ...(inMemoryHighWater === undefined ? {} : { inMemoryHighWater }),
      ...(persistedLowerBound === undefined ? {} : { persistedLowerBound }),
    });
    if (observation.persistLowerBound !== undefined) {
      try {
        await pool.query(
          `insert into trusted_breev_time_marks (
             pharmacy_id, main_device_id, lower_bound
           ) values ($1, $2, $3)`,
          [input.pharmacyId, input.mainDeviceId, observation.persistLowerBound],
        );
      } catch (error) {
        if (!isConcurrentTimeAdvance(error)) throw error;
        persistedLowerBound = await latestLowerBound(pool, input);
        const currentHighWater = this.highWaterByBinding.get(binding);
        observation = observeTrustedTime({
          now: input.now,
          ...(currentHighWater === undefined
            ? {}
            : { inMemoryHighWater: currentHighWater }),
          ...(persistedLowerBound === undefined ? {} : { persistedLowerBound }),
        });
      }
    }
    this.highWaterByBinding.set(binding, observation.nextHighWater);
    return {
      rollbackDetected: observation.rollbackDetected,
      trustedNow: observation.trustedNow,
    };
  }

  private async latestLicence(
    input: LicensingContextInput,
    trustedNow: Date,
  ): Promise<StoredLicenceVerification> {
    const result = await this.localDatabase.requirePool().query<LicenceRow>(
      `select encoded_licence
       from licence_installations
       where pharmacy_id = $1 and main_device_id = $2
       order by installed_at desc, licence_id desc
       limit 1`,
      [input.pharmacyId, input.mainDeviceId],
    );
    const row = result.rows[0];
    if (row === undefined) return { status: "missing" };
    return verifyOfflineLicence({
      encodedLicence: row.encoded_licence,
      expectedMainDeviceId: input.mainDeviceId,
      expectedPharmacyId: input.pharmacyId,
      now: trustedNow,
      publicKeys: OFFLINE_LICENCE_PUBLIC_KEYS,
    });
  }

  private async storeInstallation(
    input: InstallLicenceInput,
    claims: OfflineLicenceClaims,
  ): Promise<void> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 165308861))",
        [input.pharmacyId],
      );
      const existing = await client.query<LicenceRow>(
        "select encoded_licence from licence_installations where licence_id = $1",
        [claims.licenceId],
      );
      if (existing.rows[0] === undefined) {
        await client.query(
          `insert into licence_installations (
             licence_id, pharmacy_id, main_device_id, key_id, format_version,
             plan, features, founder_override_grants, permitted_device_count,
             issued_at, expires_at, grace_ends_at, encoded_licence, installed_by
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
           )`,
          [
            claims.licenceId,
            claims.pharmacyId,
            claims.mainDeviceId,
            claims.keyId,
            claims.formatVersion,
            claims.plan,
            claims.features,
            claims.founderOverrideGrants,
            claims.permittedDeviceCount,
            claims.issuedAt,
            claims.expiresAt,
            claims.graceEndsAt,
            input.encodedLicence,
            input.actorId,
          ],
        );
      } else if (existing.rows[0].encoded_licence !== input.encodedLicence) {
        throw new Error("A licence ID cannot identify different signed bytes");
      }
      await writeAudit(client, {
        action: "licence.install",
        actorId: input.actorId,
        ...(input.identitySessionId === undefined
          ? {}
          : { identitySessionId: input.identitySessionId }),
        mainDeviceId: input.mainDeviceId,
        observedAt: input.now,
        outcome: "installed",
        pharmacyId: input.pharmacyId,
        details: { licenceId: claims.licenceId, plan: claims.plan },
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function latestLowerBound(
  pool: Pool,
  input: Pick<LicensingContextInput, "mainDeviceId" | "pharmacyId">,
): Promise<Date | undefined> {
  const result = await pool.query<{ lower_bound: Date | null }>(
    `select max(lower_bound) as lower_bound
     from trusted_breev_time_marks
     where pharmacy_id = $1 and main_device_id = $2`,
    [input.pharmacyId, input.mainDeviceId],
  );
  return result.rows[0]?.lower_bound ?? undefined;
}

function isConcurrentTimeAdvance(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return error.code === "23505" || error.code === "23514";
}

interface AuditInput {
  readonly action:
    "capability.authorization" | "licence.install" | "trusted-time.rollback";
  readonly actorId?: string;
  readonly capability?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly identitySessionId?: string;
  readonly mainDeviceId: string;
  readonly observedAt: Date;
  readonly outcome: "allowed" | "denied" | "detected" | "installed";
  readonly pharmacyId: string;
}

interface Queryable {
  query<R extends object>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

async function writeAudit(
  queryable: Queryable,
  input: AuditInput,
): Promise<string> {
  const result = await queryable.query<{ id: string }>(
    `insert into licensing_audit_records (
       pharmacy_id, actor_user_id, identity_session_id, main_device_id,
       action, outcome, capability, observed_at, details
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      input.pharmacyId,
      input.actorId ?? null,
      input.identitySessionId ?? null,
      input.mainDeviceId,
      input.action,
      input.outcome,
      input.capability ?? null,
      input.observedAt,
      input.details ?? null,
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined)
    throw new Error("The licensing audit record was not created");
  return id;
}
