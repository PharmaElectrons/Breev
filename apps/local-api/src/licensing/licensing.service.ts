import { Injectable } from "@nestjs/common";
import type {
  LicensingDenial,
  PaidCapabilityName,
} from "@breev/contracts/local-rest";
import { entitlementContextSchema } from "@breev/contracts/local-rest";
import { createHash } from "node:crypto";
import type { QueryResult } from "pg";

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

export interface LicensingContextInput {
  readonly actorId?: string;
  readonly identitySessionId?: string;
  readonly mainDeviceId: string;
  readonly now: Date;
  readonly pharmacyId: string;
}

export interface InstallLicenceInput extends LicensingContextInput {
  readonly actorId: string;
  readonly encodedLicence: string;
}

interface LicenceRow {
  readonly encoded_licence: string | null;
  readonly event_kind: "deactivated" | "installed";
}

interface CommandResultRow {
  readonly request_fingerprint: Buffer;
  readonly response_body: unknown;
}

export type LicensingCommandName = "licence.deactivate" | "licence.install";

export interface PreparedLicenceInstallation {
  readonly claims: OfflineLicenceClaims;
  readonly entitlement: EntitlementContext;
}

export class LicensingCommandConflict extends Error {
  public constructor() {
    super("idempotency-conflict");
    this.name = "LicensingCommandConflict";
  }
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
    queryable: Queryable = this.localDatabase.requirePool(),
  ): Promise<EntitlementContext> {
    const clock = await this.observeClock(input, queryable);
    const licence = await this.latestLicence(
      input,
      clock.trustedNow,
      queryable,
    );
    if (clock.rollbackDetected) {
      await writeRollbackAudit(queryable, {
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
    const prepared = await this.prepareInstallation(input);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.installPrepared(client, input, prepared);
      await client.query("commit");
      return prepared.entitlement;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async prepareInstallation(
    input: InstallLicenceInput,
    queryable: Queryable = this.localDatabase.requirePool(),
  ): Promise<PreparedLicenceInstallation> {
    const clock = await this.observeClock(input, queryable);
    if (clock.rollbackDetected) {
      const requestId = await writeAudit(queryable, {
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
      const requestId = await writeAudit(queryable, {
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
    return {
      claims: verification.claims,
      entitlement: deriveEntitlement({
        licence: verification,
        clockRollbackDetected: false,
      }),
    };
  }

  public async installPrepared(
    queryable: Queryable,
    input: InstallLicenceInput,
    prepared: PreparedLicenceInstallation,
  ): Promise<void> {
    await this.storeInstallation(queryable, input, prepared.claims);
  }

  public async deactivate(
    queryable: Queryable,
    input: LicensingContextInput & { readonly actorId: string },
  ): Promise<EntitlementContext> {
    await queryable.query(
      `insert into licence_state_events (
         pharmacy_id, main_device_id, event_kind, actor_user_id,
         identity_session_id
       ) values ($1, $2, 'deactivated', $3, $4)`,
      [
        input.pharmacyId,
        input.mainDeviceId,
        input.actorId,
        input.identitySessionId ?? null,
      ],
    );
    await writeAudit(queryable, {
      action: "licence.deactivate",
      actorId: input.actorId,
      ...(input.identitySessionId === undefined
        ? {}
        : { identitySessionId: input.identitySessionId }),
      mainDeviceId: input.mainDeviceId,
      observedAt: input.now,
      outcome: "deactivated",
      pharmacyId: input.pharmacyId,
    });
    return deriveEntitlement({
      licence: { status: "missing" },
      clockRollbackDetected: false,
    });
  }

  public fingerprint(
    command: LicensingCommandName,
    encodedLicence?: string,
  ): Buffer {
    return createHash("sha256")
      .update(command, "utf8")
      .update("\0", "utf8")
      .update(encodedLicence ?? "", "utf8")
      .digest();
  }

  public async replayCommand(
    queryable: Queryable,
    input: {
      readonly command: LicensingCommandName;
      readonly fingerprint: Buffer;
      readonly idempotencyKey: string;
      readonly pharmacyId: string;
    },
  ): Promise<EntitlementContext | undefined> {
    const result = await queryable.query<CommandResultRow>(
      `select request_fingerprint, response_body
       from licensing_command_results
       where pharmacy_id = $1 and command_name = $2 and idempotency_key = $3`,
      [input.pharmacyId, input.command, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    if (!row.request_fingerprint.equals(input.fingerprint)) {
      throw new LicensingCommandConflict();
    }
    return entitlementContextSchema.parse(row.response_body);
  }

  public async recordCommandResult(
    queryable: Queryable,
    input: LicensingContextInput & {
      readonly actorId: string;
      readonly command: LicensingCommandName;
      readonly fingerprint: Buffer;
      readonly idempotencyKey: string;
      readonly response: EntitlementContext;
    },
  ): Promise<void> {
    await queryable.query(
      `insert into licensing_command_results (
         pharmacy_id, command_name, idempotency_key, actor_user_id,
         identity_session_id, main_device_id, request_fingerprint,
         response_body
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        input.pharmacyId,
        input.command,
        input.idempotencyKey,
        input.actorId,
        input.identitySessionId ?? null,
        input.mainDeviceId,
        input.fingerprint,
        JSON.stringify(input.response),
      ],
    );
  }

  public async idempotencyConflict(
    queryable: Queryable,
    input: LicensingContextInput & {
      readonly actorId: string;
      readonly command: LicensingCommandName;
    },
  ): Promise<LicensingDenied> {
    const requestId = await writeAudit(queryable, {
      action: input.command,
      actorId: input.actorId,
      ...(input.identitySessionId === undefined
        ? {}
        : { identitySessionId: input.identitySessionId }),
      mainDeviceId: input.mainDeviceId,
      observedAt: input.now,
      outcome: "denied",
      pharmacyId: input.pharmacyId,
      details: { reason: "idempotency-conflict" },
    });
    return new LicensingDenied({
      status: "denied",
      code: "idempotency-conflict",
      requestId,
    });
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

  private async observeClock(
    input: LicensingContextInput,
    queryable: Queryable = this.localDatabase.requirePool(),
  ): Promise<{
    readonly rollbackDetected: boolean;
    readonly trustedNow: Date;
  }> {
    const binding = `${input.pharmacyId}:${input.mainDeviceId}`;
    const inMemoryHighWater = this.highWaterByBinding.get(binding);
    let persistedLowerBound = await latestLowerBound(queryable, input);
    let observation = observeTrustedTime({
      now: input.now,
      ...(inMemoryHighWater === undefined ? {} : { inMemoryHighWater }),
      ...(persistedLowerBound === undefined ? {} : { persistedLowerBound }),
    });
    if (observation.persistLowerBound !== undefined) {
      // The mark trigger skips any bound that does not advance the stored
      // high-water mark, so a concurrent advance never fails this statement
      // and never aborts a caller's open transaction.
      const persisted = await queryable.query(
        `insert into trusted_breev_time_marks (
           pharmacy_id, main_device_id, lower_bound
         ) values ($1, $2, $3)
         on conflict do nothing`,
        [input.pharmacyId, input.mainDeviceId, observation.persistLowerBound],
      );
      if (persisted.rowCount === 0) {
        persistedLowerBound = await latestLowerBound(queryable, input);
        const currentHighWater = this.highWaterByBinding.get(binding);
        const concurrentHighWater = laterDate(
          currentHighWater,
          persistedLowerBound,
        );
        observation =
          concurrentHighWater !== undefined &&
          concurrentHighWater.getTime() > input.now.getTime()
            ? concurrentAdvance(concurrentHighWater)
            : observeTrustedTime({
                now: input.now,
                ...(currentHighWater === undefined
                  ? {}
                  : { inMemoryHighWater: currentHighWater }),
                ...(persistedLowerBound === undefined
                  ? {}
                  : { persistedLowerBound }),
              });
      }
    }
    const concurrentMemoryHighWater = this.highWaterByBinding.get(binding);
    if (
      concurrentMemoryHighWater !== undefined &&
      concurrentMemoryHighWater.getTime() > observation.nextHighWater.getTime()
    ) {
      observation = concurrentAdvance(concurrentMemoryHighWater);
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
    queryable: Queryable = this.localDatabase.requirePool(),
  ): Promise<StoredLicenceVerification> {
    const result = await queryable.query<LicenceRow>(
      `select state_event.event_kind, installation.encoded_licence
       from licence_state_events state_event
       left join licence_installations installation
         on installation.licence_id = state_event.licence_id
       where state_event.pharmacy_id = $1
         and state_event.main_device_id = $2
       order by state_event.recorded_at desc, state_event.id desc
       limit 1`,
      [input.pharmacyId, input.mainDeviceId],
    );
    const row = result.rows[0];
    if (row === undefined || row.event_kind === "deactivated") {
      return { status: "missing" };
    }
    if (row.encoded_licence === null) {
      throw new Error("An installed licence event has no signed document");
    }
    return verifyOfflineLicence({
      encodedLicence: row.encoded_licence,
      expectedMainDeviceId: input.mainDeviceId,
      expectedPharmacyId: input.pharmacyId,
      now: trustedNow,
      publicKeys: OFFLINE_LICENCE_PUBLIC_KEYS,
    });
  }

  private async storeInstallation(
    queryable: Queryable,
    input: InstallLicenceInput,
    claims: OfflineLicenceClaims,
  ): Promise<void> {
    await queryable.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 165308861))",
      [input.pharmacyId],
    );
    const existing = await queryable.query<{ encoded_licence: string }>(
      "select encoded_licence from licence_installations where licence_id = $1",
      [claims.licenceId],
    );
    if (existing.rows[0] === undefined) {
      await queryable.query(
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
    await queryable.query(
      `insert into licence_state_events (
         pharmacy_id, main_device_id, event_kind, licence_id, actor_user_id,
         identity_session_id
       ) values ($1, $2, 'installed', $3, $4, $5)`,
      [
        input.pharmacyId,
        input.mainDeviceId,
        claims.licenceId,
        input.actorId,
        input.identitySessionId ?? null,
      ],
    );
    await writeAudit(queryable, {
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
  }
}

async function latestLowerBound(
  queryable: Queryable,
  input: Pick<LicensingContextInput, "mainDeviceId" | "pharmacyId">,
): Promise<Date | undefined> {
  const result = await queryable.query<{ lower_bound: Date | null }>(
    `select max(lower_bound) as lower_bound
     from trusted_breev_time_marks
     where pharmacy_id = $1 and main_device_id = $2`,
    [input.pharmacyId, input.mainDeviceId],
  );
  return result.rows[0]?.lower_bound ?? undefined;
}

function concurrentAdvance(highWater: Date) {
  const value = new Date(highWater);
  return {
    rollbackDetected: false,
    trustedNow: value,
    nextHighWater: value,
    persistLowerBound: undefined,
  } as const;
}

function laterDate(left?: Date, right?: Date): Date | undefined {
  if (left === undefined)
    return right === undefined ? undefined : new Date(right);
  if (right === undefined) return new Date(left);
  return new Date(Math.max(left.getTime(), right.getTime()));
}

interface AuditInput {
  readonly action:
    | "capability.authorization"
    | "licence.deactivate"
    | "licence.install"
    | "trusted-time.rollback";
  readonly actorId?: string;
  readonly capability?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly identitySessionId?: string;
  readonly mainDeviceId: string;
  readonly observedAt: Date;
  readonly outcome:
    "allowed" | "deactivated" | "denied" | "detected" | "installed";
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

async function writeRollbackAudit(
  queryable: Queryable,
  input: AuditInput,
): Promise<void> {
  await queryable.query(
    `insert into licensing_audit_records (
       pharmacy_id, actor_user_id, identity_session_id, main_device_id,
       action, outcome, capability, observed_at, details
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict do nothing`,
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
}
