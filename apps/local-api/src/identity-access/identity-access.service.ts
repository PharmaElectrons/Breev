import {
  attendanceEventSchema,
  identityDenialSchema,
  identityRoleSchema,
  identityStateSchema,
  identityStepUpChallengeSchema,
  identityUserSchema,
  pharmacySettingsSchema,
  type AttendanceEvent,
  type AttendanceEventRequest,
  type IdentityAuthenticatedState,
  type IdentityBootstrapRequest,
  type IdentityChangePasswordRequest,
  type IdentityCreateRoleRequest,
  type IdentityCreateUserRequest,
  type IdentityDenial,
  type IdentityDenialCode,
  type IdentityLoginRequest,
  type IdentityRenameRoleRequest,
  type IdentityResetUserPasswordRequest,
  type IdentityRole,
  type IdentityRoleReference,
  type IdentityRoles,
  type IdentityState,
  type IdentityStepUpApproveRequest,
  type IdentityStepUpChallenge,
  type IdentityStepUpCreateRequest,
  type IdentityUpdateRolePermissionsRequest,
  type IdentityUpdateUserRequest,
  type IdentityUser,
  type IdentityUsers,
  type EntitlementContext,
  type PaidCapabilityName,
  type PharmacySettings,
  type PharmacySettingsUpdateRequest,
  type PharmacyRoleKey,
} from "@breev/contracts/local-rest";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";

import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { LicensingService } from "../licensing/licensing.service.js";
import { MainDeviceSecurityService } from "../main-device/main-device-security.service.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import { canonicalRequestHash } from "../posting/canonical-hash.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
  type PostingCommandReplay,
} from "../posting/idempotency.js";
import {
  CURRENT_ENVELOPE_VERSIONS,
  POSTING_EVENT_TYPES,
  appendOutboxEntry,
} from "../posting/outbox.js";
import {
  IMPLEMENTED_PERMISSION_NAMES,
  PERMISSION_NAMES,
  STEP_UP_ACTIONS,
  evaluateStepUpApproval,
  hasPermission,
  isImplementedPermissionName,
  isPermissionName,
  isStepUpAction,
  type PermissionName,
  type StepUpAction,
} from "./authorization.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  SETTINGS_POST_COMMIT_QUEUE,
  type SettingsPostCommitPayload,
} from "./settings-post-commit.service.js";

type UserView = IdentityUser;

const SESSION_LIFETIME_HOURS = 8;
const AUTH_RATE_LIMIT = readPositiveInteger(
  process.env.BREEV_AUTH_RATE_LIMIT,
  5,
  "BREEV_AUTH_RATE_LIMIT",
);
const AUTH_RATE_WINDOW_SECONDS = readPositiveInteger(
  process.env.BREEV_AUTH_RATE_WINDOW_SECONDS,
  60,
  "BREEV_AUTH_RATE_WINDOW_SECONDS",
);
/**
 * The posting command name of `PATCH /pharmacy/settings`. It is part of the
 * idempotency identity of every settings request, so it is never renamed: a
 * different name would make every in-flight retry look like a new command.
 */
const SETTINGS_COMMAND_NAME = "pharmacy.settings.update";

/**
 * The capability that permits an Additional POS Terminal to operate at all.
 * Free Core permits exactly one device — the Main Pharmacy Computer — so a
 * terminal is licensed equipment, and it stops being permitted the moment the
 * licence that added it stops holding.
 */
const TERMINAL_CAPABILITY: PaidCapabilityName = "additional-device-pos";

const PHARMACY_ROLE_KEYS = [
  "owner",
  "manager",
  "pharmacist",
  "sales_employee",
  "purchasing_employee",
  "inventory_employee",
  "accountant",
  "support",
] as const satisfies readonly PharmacyRoleKey[];

const OWNER_PERMISSION_FLOOR = [
  "identity.roles.manage",
  "identity.users.manage",
] as const satisfies readonly PermissionName[];

/**
 * How a custom role name is compared for uniqueness and reservation: NFKC,
 * trimmed, runs of whitespace, underscores, and hyphens collapsed to one
 * space, lower-cased. "Senior cashier", "senior  CASHIER", and
 * "Senior-Cashier" are one role. The stored display name keeps the
 * pharmacy's own spelling.
 */
function normalizeRoleName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/[\s_-]+/gu, " ")
    .toLocaleLowerCase("en-US");
}

/**
 * A custom role may not take a built-in role's identity through its name. The
 * database identifies a built-in role by `role_key` regardless, so this guard
 * only stops a misleading label ("Owner", "sales employee") from appearing
 * beside the real one; it is not what keeps the owner floor.
 */
const RESERVED_ROLE_NAME_KEYS: ReadonlySet<string> = new Set(
  PHARMACY_ROLE_KEYS.map((key) => normalizeRoleName(key)),
);

/** One `pharmacy_roles` row: exactly one of `role_key` and `custom_name` is set. */
interface RoleRow {
  readonly custom_name: string | null;
  readonly id: string;
  readonly revision: string;
  readonly role_key: PharmacyRoleKey | null;
}

interface SessionRow {
  readonly session_id: string;
  readonly device_id: string | null;
  readonly terminal_device_id: string | null;
  readonly pharmacy_id: string;
  readonly pharmacy_name: string;
  readonly pharmacy_identity_revision: string;
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly user_status: "active" | "locked";
  readonly auth_revision: string;
  readonly role_id: string;
  readonly role_key: PharmacyRoleKey | null;
  readonly role_custom_name: string | null;
  readonly role_revision: string;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
  readonly revocation_reason:
    "administrative" | "logout" | "replaced" | "user-locked" | null;
  readonly attendance_enabled: boolean;
  readonly settings_revision: string;
  readonly attendance_status: "checked-in" | "checked-out";
  readonly attendance_version: string;
}

interface UserRow {
  readonly id: string;
  readonly pharmacy_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly status: "active" | "locked";
  readonly password_hash: Buffer;
  readonly auth_revision: string;
  readonly role_id: string;
  readonly role_key: PharmacyRoleKey | null;
  readonly role_custom_name: string | null;
  readonly role_revision: string;
}

interface ChallengeRow {
  readonly id: string;
  readonly pharmacy_id: string;
  readonly actor_user_id: string;
  readonly identity_session_id: string;
  readonly device_id: string | null;
  readonly device_session_hash: Buffer | null;
  readonly terminal_device_id: string | null;
  readonly action_name: string;
  readonly required_permission: string;
  readonly subject_id: string;
  readonly subject_revision: string;
  readonly pharmacy_identity_revision: string;
  readonly actor_auth_revision: string;
  readonly role_revision: string;
  readonly expires_at: Date;
  readonly status: "approved" | "denied" | "pending";
  readonly consumed_at: Date | null;
}

/**
 * Every credential an idempotent command can carry names itself: `password`,
 * `approverPassword`, and anything else a future command adds. The fingerprint
 * filters on the name rather than on a list, so a new credential field cannot
 * be hashed by omission.
 */
const CREDENTIAL_FIELD_PATTERN = /password/iu;

interface IdentityCommandInput {
  readonly approverPassword?: string;
  readonly idempotencyKey: string;
  readonly password?: string;
}

interface PayloadParser<T> {
  parse(payload: unknown): T;
}

/**
 * Which device carries a request.
 *
 * The Main Pharmacy Computer presents its provisioned binding through headers.
 * An Additional POS Terminal presents a certificate the pharmacy CA issued,
 * already verified by the mTLS boundary. Exactly one of the two is ever set, so
 * a caller can never combine them, and every audit fact records which one it
 * was.
 */
export type RequestDeviceBinding =
  | {
      readonly deviceId: string;
      readonly deviceSessionHash: Buffer;
      readonly terminalCertFingerprint: undefined;
      readonly terminalDeviceId: undefined;
    }
  | {
      readonly deviceId: undefined;
      readonly deviceSessionHash: undefined;
      readonly terminalCertFingerprint: Buffer;
      readonly terminalDeviceId: string;
    };

export interface IdentityExecutionContext {
  readonly actorId: string;
  readonly authRevision: bigint;
  readonly deviceId: string | undefined;
  readonly deviceSessionHash: Buffer | undefined;
  readonly entitlement: EntitlementContext;
  /**
   * The installation's Main device. Licence and entitlement facts are bound to
   * it whatever device is asking, so a terminal reads the same entitlement the
   * Main does rather than an entitlement of its own.
   */
  readonly licensingDeviceId: string;
  readonly permissions: readonly PermissionName[];
  readonly pharmacyId: string;
  readonly pharmacyIdentityRevision: bigint;
  readonly roleId: string;
  /** The built-in key, or `null` for a pharmacy custom role. */
  readonly roleKey: PharmacyRoleKey | null;
  readonly roleRevision: bigint;
  readonly sessionId: string;
  readonly terminalCertFingerprint: Buffer | undefined;
  readonly terminalDeviceId: string | undefined;
}

/** The device columns every audit fact carries: one set, one null. */
export interface AuditDeviceColumns {
  readonly deviceId: string | undefined;
  readonly terminalDeviceId: string | undefined;
}

/**
 * The device identity a Step-Up challenge is pinned to, as one comparable
 * string. Prefixing the kind keeps a Main device id and a terminal device id
 * from ever comparing equal.
 */
export function deviceBindingKey(binding: AuditDeviceColumns): string {
  return binding.deviceId === undefined
    ? `terminal:${binding.terminalDeviceId ?? ""}`
    : `main:${binding.deviceId}`;
}

export class IdentityAccessDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: IdentityDenial,
  ) {
    super(denial.code);
    this.name = "IdentityAccessDenied";
  }
}

@Injectable()
export class IdentityAccessService {
  private readonly contexts = new WeakMap<Request, IdentityExecutionContext>();
  private readonly dummyPassword = hashPassword(
    randomBytes(32).toString("base64url"),
  );

  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly deviceSecurity: MainDeviceSecurityService,
    private readonly licensing: LicensingService,
    private readonly durableJobs: DurableJobsService,
  ) {}

  /**
   * The device the request boundary already verified — the Main binding on
   * loopback, or the terminal certificate on the LAN listener. Reaching a
   * handler without either is a programming fault, not a denial, so it throws.
   */
  public verifiedDevice(request: Request): RequestDeviceBinding {
    const terminal = this.deviceSecurity.verifiedTerminalContext(request);
    if (terminal !== undefined) {
      return {
        deviceId: undefined,
        deviceSessionHash: undefined,
        terminalCertFingerprint: terminal.certFingerprint,
        terminalDeviceId: terminal.terminalDeviceId,
      };
    }
    const context = this.deviceSecurity.verifiedDeviceContext(request);
    if (context === undefined) {
      throw new Error("The device boundary did not verify this request");
    }
    return {
      deviceId: context.deviceId,
      deviceSessionHash: context.deviceSessionHash,
      terminalCertFingerprint: undefined,
      terminalDeviceId: undefined,
    };
  }

  /**
   * The Main device a licence, an entitlement, and a Trusted Breev Time mark
   * are keyed to.
   *
   * A request from the Main Pharmacy Computer answers with its own verified
   * binding — that is the device the licence was installed from, and it is what
   * every entitlement read has always used. A terminal has no Main binding of
   * its own, so it resolves the installation's provisioned Main device: a
   * terminal must read the same entitlement the Main reads, never one keyed to
   * itself. Without a provisioned binding there is no answer, and the request
   * fails rather than guessing at one.
   */
  private licensingDeviceId(deviceId: string | null | undefined): string {
    if (deviceId !== null && deviceId !== undefined) {
      return deviceId;
    }
    const provisioned = this.localDatabase.provisionedMainDeviceId();
    if (provisioned === undefined) {
      throw new Error(
        "This installation has no provisioned Main device binding",
      );
    }
    return provisioned;
  }

  public async state(request: Request): Promise<IdentityState> {
    const device = this.verifiedDevice(request);
    const pool = this.localDatabase.requirePool();
    const pharmacy = await pool.query("select 1 from pharmacies");
    if (pharmacy.rowCount === 0) {
      return { state: "bootstrap-required" };
    }

    const row = await this.latestSession(device);
    if (row === undefined) {
      return { state: "unauthenticated" };
    }
    if (row.revoked_at !== null) {
      return row.revocation_reason === "logout" ||
        row.revocation_reason === "replaced"
        ? { state: "unauthenticated" }
        : { state: "session-revoked" };
    }
    if (row.expires_at.getTime() <= Date.now()) {
      return { state: "session-expired" };
    }
    if (row.user_status !== "active") {
      return { state: "session-revoked" };
    }
    return await this.authenticatedState(row);
  }

  public async rejectInvalidBody(request: Request): Promise<never> {
    const device = this.verifiedDevice(request);
    const row = await this.latestSession(device);
    const requestId = await this.writeAudit(this.localDatabase.requirePool(), {
      action: "identity.request",
      device,
      outcome: "body-invalid",
      ...(row === undefined
        ? {}
        : {
            actorUserId: row.user_id,
            identitySessionId: row.session_id,
            pharmacyId: row.pharmacy_id,
          }),
    });
    throw this.denied(400, "body-invalid", requestId);
  }

  public async bootstrap(
    request: Request,
    input: IdentityBootstrapRequest,
  ): Promise<IdentityAuthenticatedState> {
    const device = this.verifiedDevice(request);
    const storedPassword = await hashPassword(input.owner.password);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(165308860)");
      const pharmacy = await client.query<{ id: string }>(
        `insert into pharmacies (id, name)
         values (uuidv7(), $1)
         on conflict (singleton) do nothing
         returning id`,
        [input.pharmacyName],
      );
      const pharmacyId = pharmacy.rows[0]?.id;
      if (pharmacyId === undefined) {
        const existing = await client.query<{ id: string }>(
          "select id from pharmacies where singleton = true",
        );
        const requestId = await this.writeAudit(client, {
          action: "identity.bootstrap",
          device,
          outcome: "denied-already-complete",
          ...(existing.rows[0] === undefined
            ? {}
            : { pharmacyId: existing.rows[0].id }),
        });
        await client.query("commit");
        throw this.denied(409, "bootstrap-already-complete", requestId);
      }

      await client.query(
        `insert into permission_definitions (name)
         select name from unnest($1::text[]) as names(name)
         on conflict (name) do nothing`,
        [PERMISSION_NAMES],
      );
      await client.query(
        `insert into step_up_action_definitions (name, required_permission)
         select action_name, required_permission
         from unnest($1::text[], $2::text[])
           as actions(action_name, required_permission)
         on conflict (name) do nothing`,
        [Object.keys(STEP_UP_ACTIONS), Object.values(STEP_UP_ACTIONS)],
      );
      await client.query(
        `insert into pharmacy_roles (pharmacy_id, role_key)
         select $1, role_key
         from unnest($2::pharmacy_role_key[]) as roles(role_key)`,
        [pharmacyId, PHARMACY_ROLE_KEYS],
      );
      const ownerRole = await client.query<{ id: string }>(
        `select id from pharmacy_roles
         where pharmacy_id = $1 and role_key = 'owner'`,
        [pharmacyId],
      );
      const ownerRoleId = ownerRole.rows[0]?.id;
      if (ownerRoleId === undefined) {
        throw new Error("Bootstrap did not create the owner role");
      }
      const owner = await client.query<{ id: string }>(
        `insert into identity_users (
           pharmacy_id, username, username_key, display_name, role_id,
           password_hash, password_algorithm, password_version,
           password_memory_kib, password_iterations, password_parallelism
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          pharmacyId,
          input.owner.username,
          normalizeUsername(input.owner.username),
          input.owner.displayName,
          ownerRoleId,
          storedPassword.hash,
          storedPassword.algorithm,
          storedPassword.parameters.version,
          storedPassword.parameters.memoryKiB,
          storedPassword.parameters.iterations,
          storedPassword.parameters.parallelism,
        ],
      );
      const ownerId = owner.rows[0]?.id;
      if (ownerId === undefined) {
        throw new Error("Bootstrap did not create the owner");
      }
      // Only the implemented permissions are granted here. A name with no
      // live operation behind it stays out of the owner's grants until the
      // change that lands its operation grants it — see
      // `IMPLEMENTED_PERMISSION_NAMES` in authorization.ts.
      await client.query(
        `insert into role_permission_grants
           (pharmacy_id, role_id, permission_name, granted_by)
         select $1, $2, name, $3
         from unnest($4::text[]) as implemented(name)`,
        [pharmacyId, ownerRoleId, ownerId, IMPLEMENTED_PERMISSION_NAMES],
      );
      // The built-in manager role administers roles through the ordinary
      // permission check (stakeholder decision of 3 September 2026). It
      // receives no other authority: assigning roles to users still needs
      // identity.users.manage, which the pharmacy grants if it wants to.
      await client.query(
        `insert into role_permission_grants
           (pharmacy_id, role_id, permission_name, granted_by)
         select $1, id, 'identity.roles.manage', $2
         from pharmacy_roles
         where pharmacy_id = $1 and role_key = 'manager'`,
        [pharmacyId, ownerId],
      );
      await client.query(
        `insert into pharmacy_settings
           (pharmacy_id, attendance_enabled, updated_by)
         values ($1, false, $2)`,
        [pharmacyId, ownerId],
      );
      await client.query(
        `insert into attendance_presence (pharmacy_id, user_id)
         values ($1, $2)`,
        [pharmacyId, ownerId],
      );
      const sessionId = await this.replaceSession(client, {
        device,
        pharmacyId,
        userId: ownerId,
      });
      await this.writeAudit(client, {
        action: "identity.bootstrap",
        actorUserId: ownerId,
        afterState: { role: "owner" },
        device,
        identitySessionId: sessionId,
        outcome: "succeeded",
        pharmacyId,
        targetId: pharmacyId,
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const state = await this.state(request);
    if (state.state !== "authenticated") {
      throw new Error("Bootstrap did not establish an owner session");
    }
    return state;
  }

  public async login(
    request: Request,
    input: IdentityLoginRequest,
  ): Promise<IdentityAuthenticatedState> {
    const device = this.verifiedDevice(request);
    const pool = this.localDatabase.requirePool();
    const pharmacy = await pool.query<{ id: string }>(
      "select id from pharmacies where singleton = true",
    );
    const pharmacyId = pharmacy.rows[0]?.id;
    if (pharmacyId === undefined) {
      const requestId = await this.writeAudit(pool, {
        action: "identity.login",
        device,
        outcome: "bootstrap-required",
      });
      throw this.denied(409, "bootstrap-required", requestId);
    }

    const usernameKey = normalizeUsername(input.username);
    if (!(await this.consumeAuthAttempt(device, "login", usernameKey))) {
      const requestId = await this.writeAudit(pool, {
        action: "identity.login",
        device,
        outcome: "rate-limit-exceeded",
        pharmacyId,
      });
      throw this.denied(429, "rate-limit-exceeded", requestId);
    }

    const result = await pool.query<UserRow>(
      `select identity_user.id,
              identity_user.pharmacy_id,
              identity_user.username,
              identity_user.display_name,
              identity_user.status,
              identity_user.password_hash,
              identity_user.auth_revision::text,
              role.id as role_id,
              role.role_key,
              role.custom_name as role_custom_name,
              role.revision::text as role_revision
       from identity_users identity_user
       join pharmacy_roles role on role.id = identity_user.role_id
       where identity_user.pharmacy_id = $1
         and identity_user.username_key = $2`,
      [pharmacyId, usernameKey],
    );
    const user = result.rows[0];
    const storedHash = user?.password_hash ?? (await this.dummyPassword).hash;
    const verification = await verifyPassword(input.password, storedHash);
    if (
      user === undefined ||
      !verification.matches ||
      user.status !== "active"
    ) {
      const requestId = await this.writeAudit(pool, {
        action: "identity.login",
        ...(user === undefined ? {} : { actorUserId: user.id }),
        device,
        outcome: "invalid-credentials",
        pharmacyId,
      });
      throw this.denied(401, "invalid-credentials", requestId);
    }

    const rehashed = verification.needsRehash
      ? await hashPassword(input.password)
      : undefined;
    const client = await pool.connect();
    let sessionId = "";
    try {
      await client.query("begin");
      await this.lockIdentity(client, pharmacyId);
      const current = await client.query<{
        auth_revision: string;
        status: "active" | "locked";
      }>(
        `select auth_revision::text, status
         from identity_users where id = $1 and pharmacy_id = $2
         for update`,
        [user.id, pharmacyId],
      );
      if (
        current.rows[0]?.status !== "active" ||
        current.rows[0]?.auth_revision !== user.auth_revision
      ) {
        const requestId = await this.writeAudit(client, {
          action: "identity.login",
          actorUserId: user.id,
          device,
          outcome: "invalid-credentials",
          pharmacyId,
        });
        await client.query("commit");
        throw this.denied(401, "invalid-credentials", requestId);
      }
      if (rehashed !== undefined) {
        await client.query(
          `update identity_users
           set password_hash = $2,
               password_algorithm = $3,
               password_version = $4,
               password_memory_kib = $5,
               password_iterations = $6,
               password_parallelism = $7
           where id = $1`,
          [
            user.id,
            rehashed.hash,
            rehashed.algorithm,
            rehashed.parameters.version,
            rehashed.parameters.memoryKiB,
            rehashed.parameters.iterations,
            rehashed.parameters.parallelism,
          ],
        );
      }
      // An Additional POS Terminal has to still be a device, and this
      // installation has to still be permitted to run one, before it is given a
      // session. Both are read inside this transaction, in that order, so a
      // revocation or a licence change that commits alongside this login wins.
      await this.requireLiveTerminalDevice(client, device);
      if (device.terminalDeviceId !== undefined) {
        const licensingDeviceId = this.licensingDeviceId(device.deviceId);
        await this.requireTerminalEntitlement({
          actorId: user.id,
          client,
          entitlement: await this.licensing.current(
            {
              actorId: user.id,
              mainDeviceId: licensingDeviceId,
              now: new Date(),
              pharmacyId,
            },
            client,
          ),
          licensingDeviceId,
          pharmacyId,
          terminalDeviceId: device.terminalDeviceId,
        });
      }
      sessionId = await this.replaceSession(client, {
        device,
        pharmacyId,
        userId: user.id,
      });
      await this.clearAuthAttempts(client, device, "login", usernameKey);
      await this.writeAudit(client, {
        action: "identity.login",
        actorUserId: user.id,
        device,
        identitySessionId: sessionId,
        outcome: "succeeded",
        pharmacyId,
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const state = await this.sessionState(sessionId, device);
    if (state.state !== "authenticated") {
      throw await this.auditDenial(device, 401, "session-revoked");
    }
    return state;
  }

  public async logout(request: Request): Promise<void> {
    const context = await this.requireExecutionContext(request);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await client.query(
        `update identity_sessions
         set revoked_at = statement_timestamp(), revocation_reason = 'logout'
         where id = $1 and revoked_at is null`,
        [context.sessionId],
      );
      await this.writeAudit(client, {
        action: "identity.logout",
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async requireIdentityAfterBootstrap(request: Request): Promise<void> {
    const client = await this.localDatabase.requirePool().connect();
    let bootstrapped = false;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(165308860)");
      const pharmacy = await client.query("select 1 from pharmacies");
      bootstrapped = pharmacy.rowCount === 1;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (bootstrapped) {
      await this.requireExecutionContext(request);
    }
  }

  /**
   * The users, plus the roles they can be assigned. A holder of
   * `identity.users.manage` picks a role by id from this list; the grants
   * behind each role stay on the roles route, behind `identity.roles.manage`.
   */
  public async users(request: Request): Promise<IdentityUsers> {
    const context = await this.requirePermission(
      request,
      "identity.users.manage",
    );
    const pool = this.localDatabase.requirePool();
    const [users, roles] = await Promise.all([
      pool.query<UserRow>(
        `${USER_SELECT}
         where identity_user.pharmacy_id = $1
         order by identity_user.display_name, identity_user.id`,
        [context.pharmacyId],
      ),
      pool.query<RoleRow>(
        `select id, role_key, custom_name, revision::text
         from pharmacy_roles
         where pharmacy_id = $1
         ${ROLE_ORDER}`,
        [context.pharmacyId, PHARMACY_ROLE_KEYS],
      ),
    ]);
    return {
      roles: roles.rows.map(roleReference),
      users: users.rows.map(userView),
    };
  }

  /**
   * Creates a custom role with its name and its initial grants in one
   * command. The Step-Up subject is the pharmacy's identity revision, which
   * this command advances, so a challenge cannot be spent twice.
   */
  public async createRole(
    request: Request,
    input: IdentityCreateRoleRequest,
  ): Promise<IdentityRole> {
    const context = await this.requirePermission(
      request,
      "identity.roles.manage",
    );
    if (!input.permissions.every(isImplementedPermissionName)) {
      return await this.rejectInvalidBody(request);
    }
    const permissions = [...new Set(input.permissions)].sort();
    const nameKey = normalizeRoleName(input.name);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.role.create",
        input,
        identityRoleSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const refusal = await this.roleNameRefusal(
        client,
        context.pharmacyId,
        nameKey,
      );
      if (refusal !== undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.role.create",
          actorUserId: context.actorId,
          afterState: { name: input.name, permissions },
          device: context,
          identitySessionId: context.sessionId,
          outcome: refusal,
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(
          refusal === "role-name-reserved" ? 400 : 409,
          refusal,
          requestId,
        );
      }
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.role.create",
        subjectId: context.pharmacyId,
      });
      const created = await client.query<{ id: string; revision: string }>(
        `insert into pharmacy_roles (pharmacy_id, custom_name, custom_name_key)
         values ($1, $2, $3)
         returning id, revision::text`,
        [context.pharmacyId, input.name, nameKey],
      );
      const role = created.rows[0];
      if (role === undefined) {
        throw new Error("The custom role was not created");
      }
      if (permissions.length > 0) {
        await client.query(
          `insert into role_permission_grants
             (pharmacy_id, role_id, permission_name, granted_by)
           select $1, $2, permission_name, $3
           from unnest($4::text[]) as values_to_grant(permission_name)`,
          [context.pharmacyId, role.id, context.actorId, permissions],
        );
      }
      await this.advanceIdentityRevision(client, context.pharmacyId);
      await this.writeAudit(client, {
        action: "identity.role.create",
        actorUserId: context.actorId,
        afterState: { kind: "custom", name: input.name, permissions },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: role.id,
      });
      const response = roleView(
        {
          custom_name: input.name,
          id: role.id,
          revision: role.revision,
          role_key: null,
        },
        permissions,
      );
      await this.recordCommandResult(
        client,
        context,
        "identity.role.create",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Renames a custom role. A built-in role is identified by its key and named
   * by the renderer in the user's language, so it is never renamed here.
   */
  public async renameRole(
    request: Request,
    roleId: string,
    input: IdentityRenameRoleRequest,
  ): Promise<IdentityRole> {
    const context = await this.requirePermission(
      request,
      "identity.roles.manage",
    );
    const nameKey = normalizeRoleName(input.name);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.role.rename",
        input,
        identityRoleSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const role = await this.selectRole(
        client,
        context.pharmacyId,
        roleId,
        true,
      );
      if (role === undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.role.rename",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "identity-resource-not-found",
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(404, "identity-resource-not-found", requestId);
      }
      if (role.role_key !== null) {
        const requestId = await this.writeAudit(client, {
          action: "identity.role.rename",
          actorUserId: context.actorId,
          afterState: { name: input.name },
          beforeState: roleReference(role),
          device: context,
          identitySessionId: context.sessionId,
          outcome: "role-not-custom",
          pharmacyId: context.pharmacyId,
          targetId: roleId,
        });
        await client.query("commit");
        throw this.denied(409, "role-not-custom", requestId);
      }
      if (role.revision !== input.expectedRevision) {
        return await this.rejectVersionConflict(
          client,
          context,
          "identity.role.rename",
          roleId,
        );
      }
      const refusal = await this.roleNameRefusal(
        client,
        context.pharmacyId,
        nameKey,
        roleId,
      );
      if (refusal !== undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.role.rename",
          actorUserId: context.actorId,
          afterState: { name: input.name },
          beforeState: roleReference(role),
          device: context,
          identitySessionId: context.sessionId,
          outcome: refusal,
          pharmacyId: context.pharmacyId,
          targetId: roleId,
        });
        await client.query("commit");
        throw this.denied(
          refusal === "role-name-reserved" ? 400 : 409,
          refusal,
          requestId,
        );
      }
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.role.rename",
        subjectId: roleId,
      });
      const updated = await client.query<{ revision: string }>(
        `update pharmacy_roles
         set custom_name = $2, custom_name_key = $3, revision = revision + 1
         where id = $1
         returning revision::text`,
        [roleId, input.name, nameKey],
      );
      await this.advanceIdentityRevision(client, context.pharmacyId);
      const grants = await this.rolePermissions(client, roleId);
      await this.writeAudit(client, {
        action: "identity.role.rename",
        actorUserId: context.actorId,
        afterState: { kind: "custom", name: input.name },
        beforeState: roleReference(role),
        device: context,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: roleId,
      });
      const response = roleView(
        {
          custom_name: input.name,
          id: roleId,
          revision: updated.rows[0]?.revision ?? "",
          role_key: null,
        },
        grants,
      );
      await this.recordCommandResult(
        client,
        context,
        "identity.role.rename",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Why a custom role name cannot be used, or `undefined` when it can. Runs
   * under the pharmacy identity lock, so two concurrent creations of the
   * same name cannot both pass; the partial unique index is the last line.
   */
  private async roleNameRefusal(
    client: PoolClient,
    pharmacyId: string,
    nameKey: string,
    exceptRoleId?: string,
  ): Promise<"role-name-reserved" | "role-name-taken" | undefined> {
    if (RESERVED_ROLE_NAME_KEYS.has(nameKey)) {
      return "role-name-reserved";
    }
    const taken = await client.query(
      `select 1 from pharmacy_roles
       where pharmacy_id = $1 and custom_name_key = $2
         and id is distinct from $3`,
      [pharmacyId, nameKey, exceptRoleId ?? null],
    );
    return taken.rowCount === 0 ? undefined : "role-name-taken";
  }

  public async createUser(
    request: Request,
    input: IdentityCreateUserRequest,
  ): Promise<UserView> {
    const context = await this.requirePermission(
      request,
      "identity.users.manage",
    );
    const storedPassword = await hashPassword(input.password);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.user.create",
        input,
        identityUserSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      // The role is resolved within this pharmacy before the challenge is
      // spent: a role id that is not this pharmacy's — or no longer exists —
      // is a not-found, and leaves the challenge usable.
      const role = await this.selectRole(
        client,
        context.pharmacyId,
        input.roleId,
      );
      if (role === undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.user.create",
          actorUserId: context.actorId,
          afterState: { roleId: input.roleId },
          device: context,
          identitySessionId: context.sessionId,
          outcome: "identity-resource-not-found",
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(404, "identity-resource-not-found", requestId);
      }
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.user.create",
        subjectId: context.actorId,
      });
      const roleId = role.id;
      const created = await client.query<{ id: string }>(
        `insert into identity_users (
           pharmacy_id, username, username_key, display_name, role_id,
           password_hash, password_algorithm, password_version,
           password_memory_kib, password_iterations, password_parallelism,
           created_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (pharmacy_id, username_key) do nothing
         returning id`,
        [
          context.pharmacyId,
          input.username,
          normalizeUsername(input.username),
          input.displayName,
          roleId,
          storedPassword.hash,
          storedPassword.algorithm,
          storedPassword.parameters.version,
          storedPassword.parameters.memoryKiB,
          storedPassword.parameters.iterations,
          storedPassword.parameters.parallelism,
          context.actorId,
        ],
      );
      const userId = created.rows[0]?.id;
      if (userId === undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.user.create",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "username-taken",
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(409, "username-taken", requestId);
      }
      await client.query(
        `insert into attendance_presence (pharmacy_id, user_id)
         values ($1, $2)`,
        [context.pharmacyId, userId],
      );
      await this.advanceIdentityRevision(client, context.pharmacyId);
      await this.writeAudit(client, {
        action: "identity.user.create",
        actorUserId: context.actorId,
        afterState: { role: roleReference(role), status: "active" },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: userId,
      });
      const selected = await this.selectUser(
        client,
        context.pharmacyId,
        userId,
      );
      const response = userView(selected);
      await this.recordCommandResult(
        client,
        context,
        "identity.user.create",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateUser(
    request: Request,
    userId: string,
    input: IdentityUpdateUserRequest,
  ): Promise<UserView> {
    const context = await this.requirePermission(
      request,
      "identity.users.manage",
    );
    if (
      input.displayName === undefined &&
      input.roleId === undefined &&
      input.status === undefined
    ) {
      return await this.rejectInvalidBody(request);
    }
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.user.update",
        input,
        identityUserSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const before = await this.selectUser(
        client,
        context.pharmacyId,
        userId,
        true,
      );
      if (before.auth_revision !== input.expectedRevision) {
        return await this.rejectVersionConflict(
          client,
          context,
          "identity.user.update",
          userId,
        );
      }
      const nextRole =
        input.roleId === undefined
          ? {
              custom_name: before.role_custom_name,
              id: before.role_id,
              revision: before.role_revision,
              role_key: before.role_key,
            }
          : await this.selectRole(client, context.pharmacyId, input.roleId);
      if (nextRole === undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.user.update",
          actorUserId: context.actorId,
          afterState: { roleId: input.roleId },
          beforeState: userAuditState(before),
          device: context,
          identitySessionId: context.sessionId,
          outcome: "identity-resource-not-found",
          pharmacyId: context.pharmacyId,
          targetId: userId,
        });
        await client.query("commit");
        throw this.denied(404, "identity-resource-not-found", requestId);
      }
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.user.update",
        subjectId: userId,
      });
      const nextStatus = input.status ?? before.status;
      const nextDisplayName = input.displayName ?? before.display_name;
      if (
        before.role_key === "owner" &&
        before.status === "active" &&
        (nextRole.role_key !== "owner" || nextStatus !== "active")
      ) {
        const ownerCount = await client.query<{ count: string }>(
          `select count(*)::text as count
           from identity_users identity_user
           join pharmacy_roles role on role.id = identity_user.role_id
           where identity_user.pharmacy_id = $1
             and identity_user.status = 'active'
             and role.role_key = 'owner'`,
          [context.pharmacyId],
        );
        if (ownerCount.rows[0]?.count === "1") {
          const requestId = await this.writeAudit(client, {
            action: "identity.user.update",
            actorUserId: context.actorId,
            beforeState: userAuditState(before),
            device: context,
            identitySessionId: context.sessionId,
            outcome: "last-owner-required",
            pharmacyId: context.pharmacyId,
            targetId: userId,
          });
          await client.query("commit");
          throw this.denied(409, "last-owner-required", requestId);
        }
      }
      await client.query(
        `update identity_users
         set role_id = $2, status = $3, display_name = $4,
             auth_revision = auth_revision + 1
         where id = $1`,
        [userId, nextRole.id, nextStatus, nextDisplayName],
      );
      if (nextStatus === "locked") {
        await client.query(
          `update identity_sessions
           set revoked_at = statement_timestamp(), revocation_reason = 'user-locked'
           where user_id = $1 and revoked_at is null`,
          [userId],
        );
      }
      await this.advanceIdentityRevision(client, context.pharmacyId);
      const after = await this.selectUser(client, context.pharmacyId, userId);
      await this.writeAudit(client, {
        action: "identity.user.update",
        actorUserId: context.actorId,
        afterState: userAuditState(after),
        beforeState: userAuditState(before),
        device: context,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: userId,
      });
      const response = userView(after);
      await this.recordCommandResult(
        client,
        context,
        "identity.user.update",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async changePassword(
    request: Request,
    input: IdentityChangePasswordRequest,
  ): Promise<UserView> {
    const context = await this.requireExecutionContext(request);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.password.change",
        input,
        identityUserSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.currentContext(client, context);
      const before = await this.selectUser(
        client,
        fresh.pharmacyId,
        fresh.actorId,
        true,
      );
      if (before.auth_revision !== input.expectedRevision) {
        return await this.rejectVersionConflict(
          client,
          fresh,
          "identity.password.change",
          fresh.actorId,
        );
      }
      const usernameKey = normalizeUsername(before.username);
      if (!(await this.consumeAuthAttempt(fresh, "login", usernameKey))) {
        const requestId = await this.writeAudit(client, {
          action: "identity.password.change",
          actorUserId: fresh.actorId,
          beforeState: { authRevision: before.auth_revision },
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "rate-limit-exceeded",
          pharmacyId: fresh.pharmacyId,
          targetId: fresh.actorId,
        });
        await client.query("commit");
        throw this.denied(429, "rate-limit-exceeded", requestId);
      }
      const verification = await verifyPassword(
        input.currentPassword,
        before.password_hash,
      );
      if (!verification.matches) {
        const requestId = await this.writeAudit(client, {
          action: "identity.password.change",
          actorUserId: fresh.actorId,
          beforeState: { authRevision: before.auth_revision },
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "invalid-credentials",
          pharmacyId: fresh.pharmacyId,
          targetId: fresh.actorId,
        });
        await client.query("commit");
        throw this.denied(401, "invalid-credentials", requestId);
      }
      const storedPassword = await hashPassword(input.newPassword);
      await client.query(
        `update identity_users
         set password_hash = $2,
             password_algorithm = $3,
             password_version = $4,
             password_memory_kib = $5,
             password_iterations = $6,
             password_parallelism = $7,
             auth_revision = auth_revision + 1
         where id = $1`,
        [
          fresh.actorId,
          storedPassword.hash,
          storedPassword.algorithm,
          storedPassword.parameters.version,
          storedPassword.parameters.memoryKiB,
          storedPassword.parameters.iterations,
          storedPassword.parameters.parallelism,
        ],
      );
      await client.query(
        `update identity_sessions
         set revoked_at = statement_timestamp(),
             revocation_reason = 'administrative'
         where user_id = $1 and revoked_at is null`,
        [fresh.actorId],
      );
      await this.replaceSession(client, {
        device: bindingOf(fresh),
        pharmacyId: fresh.pharmacyId,
        userId: fresh.actorId,
      });
      await this.clearAuthAttempts(client, fresh, "login", usernameKey);
      await this.advanceIdentityRevision(client, fresh.pharmacyId);
      const after = await this.selectUser(
        client,
        fresh.pharmacyId,
        fresh.actorId,
      );
      await this.writeAudit(client, {
        action: "identity.password.change",
        actorUserId: fresh.actorId,
        afterState: { authRevision: after.auth_revision },
        beforeState: { authRevision: before.auth_revision },
        device: fresh,
        identitySessionId: fresh.sessionId,
        outcome: "succeeded",
        pharmacyId: fresh.pharmacyId,
        targetId: fresh.actorId,
      });
      const response = userView(after);
      await this.recordCommandResult(
        client,
        fresh,
        "identity.password.change",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async resetUserPassword(
    request: Request,
    userId: string,
    input: IdentityResetUserPasswordRequest,
  ): Promise<UserView> {
    const context = await this.requirePermission(
      request,
      "identity.users.manage",
    );
    const storedPassword = await hashPassword(input.newPassword);
    const commandInput = { ...input, targetId: userId };
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.user.password.reset",
        commandInput,
        identityUserSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.requirePermissionInTransaction(
        client,
        context,
        "identity.users.manage",
      );
      const before = await this.findUser(
        client,
        fresh.pharmacyId,
        userId,
        true,
      );
      if (before === undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.user.password.reset",
          actorUserId: fresh.actorId,
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "identity-resource-not-found",
          pharmacyId: fresh.pharmacyId,
          targetId: userId,
        });
        await client.query("commit");
        throw this.denied(404, "identity-resource-not-found", requestId);
      }
      if (userId === fresh.actorId) {
        const requestId = await this.writeAudit(client, {
          action: "identity.user.password.reset",
          actorUserId: fresh.actorId,
          beforeState: { authRevision: before.auth_revision },
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "body-invalid",
          pharmacyId: fresh.pharmacyId,
          targetId: userId,
        });
        await client.query("commit");
        throw this.denied(400, "body-invalid", requestId);
      }
      if (before.auth_revision !== input.expectedRevision) {
        return await this.rejectVersionConflict(
          client,
          fresh,
          "identity.user.password.reset",
          userId,
        );
      }
      await this.consumeStepUp(client, fresh, input.challengeId, {
        action: "identity.user.password.reset",
        subjectId: userId,
      });
      await client.query(
        `update identity_users
         set password_hash = $2,
             password_algorithm = $3,
             password_version = $4,
             password_memory_kib = $5,
             password_iterations = $6,
             password_parallelism = $7,
             auth_revision = auth_revision + 1
         where id = $1`,
        [
          userId,
          storedPassword.hash,
          storedPassword.algorithm,
          storedPassword.parameters.version,
          storedPassword.parameters.memoryKiB,
          storedPassword.parameters.iterations,
          storedPassword.parameters.parallelism,
        ],
      );
      await client.query(
        `update identity_sessions
         set revoked_at = statement_timestamp(),
             revocation_reason = 'administrative'
         where user_id = $1 and revoked_at is null`,
        [userId],
      );
      await this.advanceIdentityRevision(client, fresh.pharmacyId);
      const after = await this.selectUser(client, fresh.pharmacyId, userId);
      await this.writeAudit(client, {
        action: "identity.user.password.reset",
        actorUserId: fresh.actorId,
        afterState: { authRevision: after.auth_revision },
        beforeState: { authRevision: before.auth_revision },
        device: fresh,
        identitySessionId: fresh.sessionId,
        outcome: "succeeded",
        pharmacyId: fresh.pharmacyId,
        targetId: userId,
      });
      const response = userView(after);
      await this.recordCommandResult(
        client,
        fresh,
        "identity.user.password.reset",
        commandInput,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async createStepUp(
    request: Request,
    input: IdentityStepUpCreateRequest,
  ): Promise<IdentityStepUpChallenge> {
    const context = await this.requireExecutionContext(request);
    if (!isStepUpAction(input.action)) {
      return await this.rejectInvalidBody(request);
    }
    const requiredPermission = STEP_UP_ACTIONS[input.action];
    if (!hasPermission(context.permissions, requiredPermission)) {
      const requestId = await this.writeAudit(
        this.localDatabase.requirePool(),
        {
          action: input.action,
          actorUserId: context.actorId,
          afterState: { requiredPermission },
          device: context,
          identitySessionId: context.sessionId,
          outcome: "step-up-missing-permission",
          pharmacyId: context.pharmacyId,
        },
      );
      throw this.denied(
        403,
        "step-up-missing-permission",
        requestId,
        requiredPermission,
      );
    }

    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.step_up.create",
        input,
        identityStepUpChallengeSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.currentContext(client, context);
      if (!hasPermission(fresh.permissions, requiredPermission)) {
        const requestId = await this.writeAudit(client, {
          action: input.action,
          actorUserId: context.actorId,
          afterState: { requiredPermission },
          device: context,
          identitySessionId: context.sessionId,
          outcome: "step-up-missing-permission",
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(
          403,
          "step-up-missing-permission",
          requestId,
          requiredPermission,
        );
      }
      const subject = await this.stepUpSubject(
        client,
        fresh,
        input.action,
        input.subjectId,
      );
      const challenge = await client.query<{
        expires_at: Date;
        id: string;
      }>(
        `insert into step_up_challenges (
           pharmacy_id, actor_user_id, identity_session_id, device_id,
           device_session_hash, terminal_device_id, action_name,
           required_permission, subject_id, subject_revision,
           pharmacy_identity_revision, actor_auth_revision, role_revision,
           expires_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           statement_timestamp() + interval '5 minutes'
         ) returning id, expires_at`,
        [
          fresh.pharmacyId,
          fresh.actorId,
          fresh.sessionId,
          fresh.deviceId ?? null,
          fresh.deviceSessionHash ?? null,
          fresh.terminalDeviceId ?? null,
          input.action,
          requiredPermission,
          subject.id,
          subject.revision,
          fresh.pharmacyIdentityRevision,
          fresh.authRevision,
          fresh.roleRevision,
        ],
      );
      const created = challenge.rows[0];
      if (created === undefined) {
        throw new Error("The Step-Up challenge was not created");
      }
      await this.writeAudit(client, {
        action: input.action,
        actorUserId: fresh.actorId,
        afterState: { challengeStatus: "pending" },
        device: fresh,
        identitySessionId: fresh.sessionId,
        outcome: "step-up-created",
        pharmacyId: fresh.pharmacyId,
        targetId: subject.id,
      });
      const response = identityStepUpChallengeSchema.parse({
        action: input.action,
        expiresAt: created.expires_at.toISOString(),
        id: created.id,
        status: "pending",
      });
      await this.recordCommandResult(
        client,
        fresh,
        "identity.step_up.create",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async approveStepUp(
    request: Request,
    challengeId: string,
    input: IdentityStepUpApproveRequest,
  ): Promise<IdentityStepUpChallenge> {
    const context = await this.requireExecutionContext(request);
    const preview = await this.localDatabase
      .requirePool()
      .query<ChallengeRow & { password_hash: Buffer }>(
        `select challenge.*, identity_user.password_hash
       from step_up_challenges challenge
       join identity_users identity_user on identity_user.id = challenge.actor_user_id
       where challenge.id = $1`,
        [challengeId],
      );
    const candidate = preview.rows[0];
    if (candidate === undefined) {
      const requestId = await this.writeAudit(
        this.localDatabase.requirePool(),
        {
          action: "identity.step-up.approve",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "identity-resource-not-found",
          pharmacyId: context.pharmacyId,
        },
      );
      throw this.denied(404, "identity-resource-not-found", requestId);
    }
    if (
      candidate.actor_user_id !== context.actorId ||
      candidate.pharmacy_id !== context.pharmacyId ||
      !challengeBindingMatches(candidate, context) ||
      candidate.identity_session_id !== context.sessionId
    ) {
      const requestId = await this.writeAudit(
        this.localDatabase.requirePool(),
        {
          action: "identity.step-up.approve",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "step-up-context-mismatch",
          pharmacyId: context.pharmacyId,
        },
      );
      throw this.denied(403, "step-up-context-mismatch", requestId);
    }
    let passwordMatches = false;
    if (candidate.status === "pending") {
      if (
        !(await this.consumeAuthAttempt(context, "step-up", context.actorId))
      ) {
        const requestId = await this.writeAudit(
          this.localDatabase.requirePool(),
          {
            action: candidate.action_name,
            actorUserId: context.actorId,
            device: context,
            identitySessionId: context.sessionId,
            outcome: "rate-limit-exceeded",
            pharmacyId: context.pharmacyId,
            targetId: candidate.subject_id,
          },
        );
        throw this.denied(429, "rate-limit-exceeded", requestId);
      }
      passwordMatches = (
        await verifyPassword(input.password, candidate.password_hash)
      ).matches;
    }

    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.step_up.approve",
        input,
        identityStepUpChallengeSchema,
      );
      if (replay !== undefined) {
        await this.clearAuthAttempts(
          client,
          context,
          "step-up",
          context.actorId,
        );
        await client.query("commit");
        return replay;
      }
      const locked = await this.selectChallenge(client, challengeId, true);
      if (locked === undefined) {
        throw new Error("The Step-Up challenge disappeared");
      }
      if (locked.status !== "pending") {
        const requestId = await this.writeAudit(client, {
          action: locked.action_name,
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "step-up-reused",
          pharmacyId: context.pharmacyId,
          targetId: locked.subject_id,
        });
        await client.query("commit");
        throw this.denied(409, "step-up-reused", requestId);
      }
      if (!passwordMatches) {
        const requestId = await this.writeAudit(client, {
          action: locked.action_name,
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "step-up-wrong-password",
          pharmacyId: context.pharmacyId,
          targetId: locked.subject_id,
        });
        await client.query("commit");
        throw this.denied(401, "step-up-wrong-password", requestId);
      }
      const fresh = await this.currentContext(client, context);
      const action = isStepUpAction(locked.action_name)
        ? locked.action_name
        : undefined;
      const requiredPermission = isPermissionName(locked.required_permission)
        ? locked.required_permission
        : undefined;
      if (action === undefined || requiredPermission === undefined) {
        throw new Error("The stored Step-Up definition is invalid");
      }
      const subject = await this.stepUpSubject(
        client,
        fresh,
        action,
        locked.subject_id,
      );
      const decision = evaluateStepUpApproval({
        challenge: {
          action,
          actorId: locked.actor_user_id,
          authRevision: BigInt(locked.actor_auth_revision),
          deviceId: challengeDeviceKey(locked),
          expiresAt: locked.expires_at,
          pharmacyIdentityRevision: BigInt(locked.pharmacy_identity_revision),
          requiredPermission,
          resolved: false,
          roleRevision: BigInt(locked.role_revision),
          sessionId: locked.identity_session_id,
          subjectRevision: BigInt(locked.subject_revision),
        },
        context: stepUpContext(fresh),
        currentSubjectRevision: subject.revision,
        now: new Date(),
      });
      if (decision !== "approved") {
        await this.denyChallenge(client, locked.id, decision);
        const requestId = await this.writeAudit(client, {
          action,
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: decision,
          pharmacyId: context.pharmacyId,
          targetId: locked.subject_id,
        });
        await client.query("commit");
        throw this.denied(
          decision === "step-up-expired" ? 409 : 403,
          decision,
          requestId,
          decision === "step-up-missing-permission"
            ? requiredPermission
            : undefined,
        );
      }
      await client.query(
        `update step_up_challenges
         set status = 'approved', resolved_at = statement_timestamp()
         where id = $1`,
        [locked.id],
      );
      await this.clearAuthAttempts(client, context, "step-up", context.actorId);
      await this.writeAudit(client, {
        action,
        actorUserId: context.actorId,
        afterState: { challengeStatus: "approved" },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "step-up-approved",
        pharmacyId: context.pharmacyId,
        targetId: locked.subject_id,
      });
      const response = identityStepUpChallengeSchema.parse({
        action,
        expiresAt: locked.expires_at.toISOString(),
        id: locked.id,
        status: "approved",
      });
      await this.recordCommandResult(
        client,
        context,
        "identity.step_up.approve",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateRolePermissions(
    request: Request,
    roleId: string,
    input: IdentityUpdateRolePermissionsRequest,
  ): Promise<IdentityRole> {
    const context = await this.requirePermission(
      request,
      "identity.roles.manage",
    );
    // Refused server-side even though a compliant renderer never offers a
    // future name: the UI is never the boundary for what a role can be
    // granted.
    if (!input.permissions.every(isImplementedPermissionName)) {
      return await this.rejectInvalidBody(request);
    }
    const permissions = [...new Set(input.permissions)].sort();
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "identity.role.permissions.update",
        input,
        identityRoleSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const role = await this.selectRole(
        client,
        context.pharmacyId,
        roleId,
        true,
      );
      if (role === undefined) {
        const requestId = await this.writeAudit(client, {
          action: "identity.role.permissions.update",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "identity-resource-not-found",
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(404, "identity-resource-not-found", requestId);
      }
      if (role.revision !== input.expectedRevision) {
        return await this.rejectVersionConflict(
          client,
          context,
          "identity.role.permissions.update",
          roleId,
        );
      }
      const before = await this.rolePermissions(client, roleId);
      const missingOwnerPermissions = OWNER_PERMISSION_FLOOR.filter(
        (permission) => !permissions.includes(permission),
      );
      if (role.role_key === "owner" && missingOwnerPermissions.length > 0) {
        const requestId = await this.writeAudit(client, {
          action: "identity.role.permissions.update",
          actorUserId: context.actorId,
          afterState: { missingOwnerPermissions, permissions },
          beforeState: { permissions: before },
          device: context,
          identitySessionId: context.sessionId,
          outcome: "owner-permission-floor-required",
          pharmacyId: context.pharmacyId,
          targetId: roleId,
        });
        await client.query("commit");
        throw this.denied(409, "owner-permission-floor-required", requestId);
      }
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.role.permissions.update",
        subjectId: roleId,
      });
      await client.query(
        "delete from role_permission_grants where role_id = $1",
        [roleId],
      );
      if (permissions.length > 0) {
        await client.query(
          `insert into role_permission_grants
             (pharmacy_id, role_id, permission_name, granted_by)
           select $1, $2, permission_name, $3
           from unnest($4::text[]) as values_to_grant(permission_name)`,
          [context.pharmacyId, roleId, context.actorId, permissions],
        );
      }
      const updated = await client.query<{ revision: string }>(
        `update pharmacy_roles
         set revision = revision + 1
         where id = $1
         returning revision::text`,
        [roleId],
      );
      await this.advanceIdentityRevision(client, context.pharmacyId);
      await this.writeAudit(client, {
        action: "identity.role.permissions.update",
        actorUserId: context.actorId,
        afterState: { permissions },
        beforeState: { permissions: before },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: roleId,
      });
      const response = roleView(
        { ...role, revision: updated.rows[0]?.revision ?? "" },
        permissions,
      );
      await this.recordCommandResult(
        client,
        context,
        "identity.role.permissions.update",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The first posting command: it changes the pharmacy settings, records why,
   * announces the change, and remembers its own outcome inside one PostgreSQL
   * transaction, so a client that retries can never post twice.
   *
   * Permission is checked before the transaction opens, because a caller
   * without it must never take a lock. Everything else happens inside the
   * transaction, and a serialization or deadlock abort reruns the whole
   * command — connection included — under the same idempotency key.
   */
  public async updateSettings(
    request: Request,
    input: PharmacySettingsUpdateRequest,
  ): Promise<PharmacySettings> {
    const context = await this.requirePermission(
      request,
      "pharmacy.settings.manage",
    );
    // The whole validated body is hashed, including its idempotency key: a
    // retry that reuses a key while changing any field is a different request
    // and must be refused rather than replayed. Nothing is excluded, so a field
    // added to the contract is covered without touching this line.
    const requestHash = canonicalRequestHash(SETTINGS_COMMAND_NAME, input);
    return await runWholeCommandWithRetry(
      async () => await this.postSettingsUpdate(context, input, requestHash),
    );
  }

  /**
   * One attempt at the settings command. The attempt owns its connection from
   * the first statement to the last, so a rerun after a transient abort shares
   * nothing with the attempt it replaces.
   *
   * Two paths deliberately commit and then throw: the idempotency conflict and
   * the version conflict. Both are decisions, not faults, and the evidence of
   * the decision has to survive the response. Neither carries a PostgreSQL
   * error code, so the retry wrapper returns them to the caller untouched
   * rather than replaying a decision that has already been recorded.
   */
  private async postSettingsUpdate(
    context: IdentityExecutionContext,
    input: PharmacySettingsUpdateRequest,
    requestHash: Buffer,
  ): Promise<PharmacySettings> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);

      let replay: PostingCommandReplay | undefined;
      try {
        replay = await beginPostingIdempotency(client, {
          commandName: SETTINGS_COMMAND_NAME,
          idempotencyKey: input.idempotencyKey,
          pharmacyId: context.pharmacyId,
          requestHash,
        });
      } catch (error) {
        if (!(error instanceof PostingIdempotencyConflict)) {
          throw error;
        }
        // The conflict leaves the transaction usable so this denial fact
        // commits. The recorded result slot keeps the original outcome: what
        // was actually posted is evidence, and a later request never overwrites
        // it.
        const requestId = await writePostingAudit(client, {
          action: SETTINGS_COMMAND_NAME,
          actorUserId: context.actorId,
          correlationId: input.idempotencyKey,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "idempotency-conflict",
          pharmacyId: context.pharmacyId,
          targetId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(409, "idempotency-conflict", requestId);
      }

      if (replay !== undefined) {
        await client.query("commit");
        return replaySettingsOutcome(replay);
      }

      // The in-transaction context is the authority for the write: the session,
      // the actor, the role grants, and the entitlement are all re-read under
      // the lock, so a revocation that landed between the request and this
      // point wins.
      const authority = await this.requirePermissionInTransaction(
        client,
        context,
        "pharmacy.settings.manage",
      );

      const before = await client.query<{
        attendance_enabled: boolean;
        revision: string;
      }>(
        `select attendance_enabled, revision::text
         from pharmacy_settings where pharmacy_id = $1 for update`,
        [authority.pharmacyId],
      );
      const previousSettings = before.rows[0];
      if (
        previousSettings === undefined ||
        previousSettings.revision !== input.expectedRevision
      ) {
        const requestId = await writePostingAudit(client, {
          action: SETTINGS_COMMAND_NAME,
          actorUserId: authority.actorId,
          correlationId: input.idempotencyKey,
          device: authority,
          identitySessionId: authority.sessionId,
          outcome: "version-conflict",
          pharmacyId: authority.pharmacyId,
          targetId: authority.pharmacyId,
        });
        const conflict = this.denied(409, "version-conflict", requestId);
        await this.recordSettingsResult(client, authority, {
          idempotencyKey: input.idempotencyKey,
          requestHash,
          responseBody: conflict.denial,
          responseStatus: 409,
        });
        await client.query("commit");
        throw conflict;
      }

      const result = await client.query<{
        attendance_enabled: boolean;
        revision: string;
      }>(
        `update pharmacy_settings
         set attendance_enabled = $2,
             revision = revision + 1,
             updated_at = statement_timestamp(),
             updated_by = $3
         where pharmacy_id = $1
         returning attendance_enabled, revision::text`,
        [authority.pharmacyId, input.attendanceEnabled, authority.actorId],
      );
      const settings = result.rows[0];
      if (settings === undefined) {
        throw new Error("The pharmacy settings are missing");
      }

      await writePostingAudit(client, {
        action: SETTINGS_COMMAND_NAME,
        actorUserId: authority.actorId,
        afterState: { attendanceEnabled: settings.attendance_enabled },
        beforeState: {
          attendanceEnabled: previousSettings.attendance_enabled,
        },
        correlationId: input.idempotencyKey,
        device: authority,
        identitySessionId: authority.sessionId,
        outcome: "succeeded",
        pharmacyId: authority.pharmacyId,
        targetId: authority.pharmacyId,
      });

      const response = pharmacySettingsSchema.parse({
        attendanceEnabled: settings.attendance_enabled,
        revision: settings.revision,
      });

      const outboxEntry = await appendOutboxEntry(client, {
        correlationId: input.idempotencyKey,
        envelopeVersion:
          CURRENT_ENVELOPE_VERSIONS[
            POSTING_EVENT_TYPES.pharmacySettingsChanged
          ],
        eventType: POSTING_EVENT_TYPES.pharmacySettingsChanged,
        payload: {
          attendanceEnabled: settings.attendance_enabled,
          revision: settings.revision,
        },
        pharmacyId: authority.pharmacyId,
      });

      await this.recordSettingsResult(client, authority, {
        idempotencyKey: input.idempotencyKey,
        requestHash,
        responseBody: response,
        responseStatus: 200,
      });

      // The job is enqueued through this transaction's connection, so it
      // becomes visible to a worker only when the change it describes commits.
      await this.durableJobs.sendInTransaction<SettingsPostCommitPayload>(
        client,
        SETTINGS_POST_COMMIT_QUEUE,
        { outboxEntryId: outboxEntry.id, pharmacyId: authority.pharmacyId },
      );

      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordSettingsResult(
    client: PoolClient,
    authority: IdentityExecutionContext,
    outcome: {
      readonly idempotencyKey: string;
      readonly requestHash: Buffer;
      readonly responseBody: unknown;
      readonly responseStatus: number;
    },
  ): Promise<void> {
    await recordPostingResult(client, {
      actorUserId: authority.actorId,
      commandName: SETTINGS_COMMAND_NAME,
      idempotencyKey: outcome.idempotencyKey,
      device: authority,
      identitySessionId: authority.sessionId,
      pharmacyId: authority.pharmacyId,
      requestHash: outcome.requestHash,
      responseBody: outcome.responseBody,
      responseStatus: outcome.responseStatus,
    });
  }

  public async recordAttendance(
    request: Request,
    input: AttendanceEventRequest,
  ): Promise<AttendanceEvent> {
    const context = await this.requirePermission(request, "attendance.record");
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "attendance.record",
        input,
        attendanceEventSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      await this.requirePermissionInTransaction(
        client,
        context,
        "attendance.record",
      );
      const settings = await client.query<{ attendance_enabled: boolean }>(
        `select attendance_enabled from pharmacy_settings
         where pharmacy_id = $1`,
        [context.pharmacyId],
      );
      if (!settings.rows[0]?.attendance_enabled) {
        const requestId = await this.writeAudit(client, {
          action: "attendance.record",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "attendance-disabled",
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(403, "attendance-disabled", requestId);
      }
      const expected = input.kind === "check-in" ? "checked-out" : "checked-in";
      const next = input.kind === "check-in" ? "checked-in" : "checked-out";
      const currentPresence = await client.query<{
        status: "checked-in" | "checked-out";
        version: string;
      }>(
        `select status, version::text
         from attendance_presence
         where pharmacy_id = $1 and user_id = $2
         for update`,
        [context.pharmacyId, context.actorId],
      );
      const current = currentPresence.rows[0];
      if (current === undefined || current.version !== input.expectedVersion) {
        return await this.rejectVersionConflict(
          client,
          context,
          "attendance.record",
          context.actorId,
        );
      }
      if (current.status !== expected) {
        const code =
          input.kind === "check-in"
            ? "attendance-already-checked-in"
            : "attendance-already-checked-out";
        const requestId = await this.writeAudit(client, {
          action: "attendance.record",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: code,
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(409, code, requestId);
      }
      const presence = await client.query<{ version: string }>(
        `update attendance_presence
         set status = $3,
             version = version + 1,
             updated_at = statement_timestamp()
         where pharmacy_id = $1 and user_id = $2 and status = $4 and version = $5
         returning version::text`,
        [
          context.pharmacyId,
          context.actorId,
          next,
          expected,
          input.expectedVersion,
        ],
      );
      const version = presence.rows[0]?.version;
      if (version === undefined) {
        const code =
          input.kind === "check-in"
            ? "attendance-already-checked-in"
            : "attendance-already-checked-out";
        const requestId = await this.writeAudit(client, {
          action: "attendance.record",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: code,
          pharmacyId: context.pharmacyId,
        });
        await client.query("commit");
        throw this.denied(409, code, requestId);
      }
      const event = await client.query<{ id: string; occurred_at: Date }>(
        `insert into attendance_events (
           pharmacy_id, user_id, identity_session_id, device_id,
           terminal_device_id, kind, presence_version
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id, occurred_at`,
        [
          context.pharmacyId,
          context.actorId,
          context.sessionId,
          context.deviceId ?? null,
          context.terminalDeviceId ?? null,
          input.kind,
          version,
        ],
      );
      const created = event.rows[0];
      if (created === undefined) {
        throw new Error("The attendance event was not created");
      }
      await this.writeAudit(client, {
        action: "attendance.record",
        actorUserId: context.actorId,
        afterState: { kind: input.kind, status: next, version },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: created.id,
      });
      const response = attendanceEventSchema.parse({
        id: created.id,
        kind: input.kind,
        occurredAt: created.occurred_at.toISOString(),
        status: next,
        version,
      });
      await this.recordCommandResult(
        client,
        context,
        "attendance.record",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async roles(request: Request): Promise<IdentityRoles> {
    const context = await this.requirePermission(
      request,
      "identity.roles.manage",
    );
    const result = await this.localDatabase
      .requirePool()
      .query<RoleRow & { grants: string[] }>(
        `select role.id,
              role.role_key,
              role.custom_name,
              role.revision::text,
              coalesce(
                array_agg(grant_row.permission_name order by grant_row.permission_name)
                  filter (where grant_row.permission_name is not null),
                '{}'::text[]
              ) as grants
       from pharmacy_roles role
       left join role_permission_grants grant_row on grant_row.role_id = role.id
       where role.pharmacy_id = $1
       group by role.id
       ${ROLE_ORDER}`,
        [context.pharmacyId, PHARMACY_ROLE_KEYS],
      );
    return {
      // Only the implemented permissions are ever offered as grantable or
      // shown as granted. A role row can still hold a future name directly in
      // PostgreSQL — left there rather than deleted, since a later slice may
      // rely on it once its operation lands — but this endpoint filters it
      // out rather than describing authority the build cannot yet perform.
      permissions: [...IMPLEMENTED_PERMISSION_NAMES],
      roles: result.rows.map((row) => roleView(row, row.grants)),
    };
  }

  public async requireExecutionContext(
    request: Request,
  ): Promise<IdentityExecutionContext> {
    const existing = this.contexts.get(request);
    if (existing !== undefined) {
      return existing;
    }
    const device = this.verifiedDevice(request);
    const row = await this.latestSession(device);
    if (row === undefined) {
      throw await this.auditDenial(device, 401, "session-missing");
    }
    if (row.revoked_at !== null || row.user_status !== "active") {
      const code =
        row.revocation_reason === "logout" ||
        row.revocation_reason === "replaced"
          ? "session-missing"
          : "session-revoked";
      throw await this.auditDenial(device, 401, code, row);
    }
    if (row.expires_at.getTime() <= Date.now()) {
      throw await this.auditDenial(device, 401, "session-expired", row);
    }
    const permissions = await this.permissions(row.role_id);
    const licensingDeviceId = this.licensingDeviceId(device.deviceId);
    const entitlement = await this.licensing.current({
      actorId: row.user_id,
      identitySessionId: row.session_id,
      mainDeviceId: licensingDeviceId,
      now: new Date(),
      pharmacyId: row.pharmacy_id,
    });
    await this.requireTerminalEntitlement({
      actorId: row.user_id,
      entitlement,
      identitySessionId: row.session_id,
      licensingDeviceId,
      pharmacyId: row.pharmacy_id,
      terminalDeviceId: device.terminalDeviceId,
    });
    const context: IdentityExecutionContext = {
      actorId: row.user_id,
      authRevision: BigInt(row.auth_revision),
      deviceId: device.deviceId,
      deviceSessionHash: device.deviceSessionHash,
      entitlement,
      licensingDeviceId,
      permissions,
      pharmacyId: row.pharmacy_id,
      pharmacyIdentityRevision: BigInt(row.pharmacy_identity_revision),
      roleId: row.role_id,
      roleKey: row.role_key,
      roleRevision: BigInt(row.role_revision),
      sessionId: row.session_id,
      terminalCertFingerprint: device.terminalCertFingerprint,
      terminalDeviceId: device.terminalDeviceId,
    };
    this.contexts.set(request, context);
    return context;
  }

  public async requirePermission(
    request: Request,
    permission: PermissionName,
  ): Promise<IdentityExecutionContext> {
    const context = await this.requireExecutionContext(request);
    if (!hasPermission(context.permissions, permission)) {
      const requestId = await this.writeAudit(
        this.localDatabase.requirePool(),
        {
          action: "identity.authorization",
          actorUserId: context.actorId,
          afterState: { requiredPermission: permission },
          device: context,
          identitySessionId: context.sessionId,
          outcome: "denied",
          pharmacyId: context.pharmacyId,
        },
      );
      throw this.denied(403, "permission-denied", requestId, permission);
    }
    return context;
  }

  public async revalidateLicenceAdministration(
    client: PoolClient,
    expected: IdentityExecutionContext,
  ): Promise<IdentityExecutionContext> {
    await this.lockIdentity(client, expected.pharmacyId);
    return await this.requirePermissionInTransaction(
      client,
      expected,
      "licensing.manage",
    );
  }

  /**
   * The device-administration equivalent of the licence path: take the
   * per-pharmacy write lock, then re-read the session, the grants, and the
   * entitlement inside the transaction. Whatever the request believed on
   * arrival, this is the authority the write runs under.
   */
  public async revalidateDeviceAdministration(
    client: PoolClient,
    expected: IdentityExecutionContext,
  ): Promise<IdentityExecutionContext> {
    await this.lockIdentity(client, expected.pharmacyId);
    return await this.requirePermissionInTransaction(
      client,
      expected,
      "devices.pair",
    );
  }

  public async consumeDeviceStepUp(
    client: PoolClient,
    context: IdentityExecutionContext,
    challengeId: string,
    use: {
      readonly action:
        | "devices.pairing.start"
        | "devices.revoke"
        | "devices.seat.release.request";
      readonly subjectId: string;
    },
  ): Promise<void> {
    await this.consumeStepUp(client, context, challengeId, use);
  }

  public async beginDeviceCommand<T>(
    client: PoolClient,
    context: IdentityExecutionContext,
    commandName: string,
    input: IdentityCommandInput,
    parser: PayloadParser<T>,
  ): Promise<T | undefined> {
    return await this.beginIdempotentCommand(
      client,
      context,
      commandName,
      input,
      parser,
    );
  }

  public async recordDeviceCommandResult(
    client: PoolClient,
    context: IdentityExecutionContext,
    commandName: string,
    input: IdentityCommandInput,
    response: unknown,
  ): Promise<void> {
    await this.recordCommandResult(
      client,
      context,
      commandName,
      input,
      response,
    );
  }

  /**
   * The second user of a Dual Control decision.
   *
   * The approver authenticates here and now — username, password, active
   * status, and the required permission are all checked against current state,
   * under the same rate limit as a login. It returns the approver's identity or
   * nothing; the caller decides what a valid approver is allowed to approve,
   * including that they are not the requester.
   */
  public async authenticateApprover(
    client: PoolClient,
    context: IdentityExecutionContext,
    input: {
      readonly password: string;
      readonly permission: PermissionName;
      readonly username: string;
    },
  ): Promise<{ readonly actorId: string } | undefined> {
    const usernameKey = normalizeUsername(input.username);
    if (!(await this.consumeAuthAttempt(context, "login", usernameKey))) {
      throw await this.contextDenial(context, 429, "rate-limit-exceeded");
    }
    const result = await client.query<UserRow>(
      `${USER_SELECT}
       where identity_user.pharmacy_id = $1
         and identity_user.username_key = $2`,
      [context.pharmacyId, usernameKey],
    );
    const approver = result.rows[0];
    const storedHash =
      approver?.password_hash ?? (await this.dummyPassword).hash;
    const verification = await verifyPassword(input.password, storedHash);
    if (
      approver === undefined ||
      !verification.matches ||
      approver.status !== "active"
    ) {
      return undefined;
    }
    const grants = await this.rolePermissions(client, approver.role_id);
    if (!hasPermission(grants, input.permission)) {
      return undefined;
    }
    await this.clearAuthAttempts(client, context, "login", usernameKey);
    return { actorId: approver.id };
  }

  public async consumeLicenceAdministrationStepUp(
    client: PoolClient,
    context: IdentityExecutionContext,
    challengeId: string,
    action: "licensing.licence.deactivate" | "licensing.licence.install",
  ): Promise<void> {
    await this.consumeStepUp(client, context, challengeId, {
      action,
      subjectId: context.pharmacyId,
    });
  }

  private async authenticatedState(
    row: SessionRow,
  ): Promise<IdentityAuthenticatedState> {
    const permissions = await this.permissions(row.role_id);
    const entitlement = await this.licensing.current({
      actorId: row.user_id,
      identitySessionId: row.session_id,
      mainDeviceId: this.licensingDeviceId(row.device_id),
      now: new Date(),
      pharmacyId: row.pharmacy_id,
    });
    return identityStateSchema.parse({
      allowedPermissions: permissions,
      entitlement,
      attendance:
        row.attendance_enabled &&
        hasPermission(permissions, "attendance.record")
          ? {
              status: row.attendance_status,
              version: row.attendance_version,
            }
          : null,
      pharmacy: { id: row.pharmacy_id, name: row.pharmacy_name },
      session: {
        expiresAt: row.expires_at.toISOString(),
        id: row.session_id,
      },
      settings: {
        attendanceEnabled: row.attendance_enabled,
        revision: row.settings_revision,
      },
      state: "authenticated",
      user: {
        displayName: row.display_name,
        id: row.user_id,
        revision: row.auth_revision,
        role: roleReference({
          custom_name: row.role_custom_name,
          id: row.role_id,
          role_key: row.role_key,
        }),
        status: row.user_status,
        username: row.username,
      },
    }) as IdentityAuthenticatedState;
  }

  private async latestSession(
    device: RequestDeviceBinding,
  ): Promise<SessionRow | undefined> {
    const result = await this.localDatabase.requirePool().query<SessionRow>(
      `${SESSION_SELECT}
       ${SESSION_BINDING_FILTER}
       order by session.created_at desc, session.id desc
       limit 1`,
      sessionBindingValues(device),
    );
    return result.rows[0];
  }

  private async permissions(roleId: string): Promise<PermissionName[]> {
    const result = await this.localDatabase.requirePool().query<{
      permission_name: string;
    }>(
      `select permission_name
       from role_permission_grants
       where role_id = $1
       order by permission_name`,
      [roleId],
    );
    return result.rows
      .map((row) => row.permission_name)
      .filter(isPermissionName);
  }

  /**
   * Establishes the one active session of a device binding, ending whatever it
   * had before. Both device kinds enforce a single active session — the Main
   * device session hash and the terminal device each carry a partial unique
   * index — and the advisory lock serializes two logins racing on the same
   * device.
   */
  private async replaceSession(
    client: PoolClient,
    input: {
      readonly device: RequestDeviceBinding;
      readonly pharmacyId: string;
      readonly userId: string;
    },
  ): Promise<string> {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text, 165308858))",
      [deviceBindingKey(input.device)],
    );
    if (input.device.terminalDeviceId === undefined) {
      await client.query(
        `update identity_sessions
         set revoked_at = statement_timestamp(), revocation_reason = 'replaced'
         where device_session_hash = $1 and revoked_at is null`,
        [input.device.deviceSessionHash],
      );
    } else {
      await client.query(
        `update identity_sessions
         set revoked_at = statement_timestamp(), revocation_reason = 'replaced'
         where terminal_device_id = $1 and revoked_at is null`,
        [input.device.terminalDeviceId],
      );
    }
    const session = await client.query<{ id: string }>(
      `insert into identity_sessions (
         pharmacy_id, user_id, device_id, device_session_hash,
         terminal_device_id, terminal_cert_fingerprint, expires_at
       ) values (
         $1, $2, $3, $4, $5, $6,
         statement_timestamp() + make_interval(hours => $7)
       ) returning id`,
      [
        input.pharmacyId,
        input.userId,
        input.device.deviceId ?? null,
        input.device.deviceSessionHash ?? null,
        input.device.terminalDeviceId ?? null,
        input.device.terminalCertFingerprint ?? null,
        SESSION_LIFETIME_HOURS,
      ],
    );
    const sessionId = session.rows[0]?.id;
    if (sessionId === undefined) {
      throw new Error("The identity session was not created");
    }
    return sessionId;
  }

  /**
   * The device record an Additional POS Terminal is acting under, held for the
   * rest of the caller's transaction.
   *
   * The mTLS boundary checks revocation before the handler runs, which leaves a
   * window: a request verified a moment before a revocation commits could
   * otherwise still create a session after it. Revocation takes the matching
   * exclusive lock on this row, so a caller either sees the revocation and
   * refuses, or holds the row and the revocation waits for its commit.
   */
  private async requireLiveTerminalDevice(
    client: PoolClient,
    device: RequestDeviceBinding,
  ): Promise<void> {
    if (device.terminalDeviceId === undefined) {
      return;
    }
    const live = await client.query(
      `select 1 from terminal_devices
       where id = $1 and revoked_at is null
       for share`,
      [device.terminalDeviceId],
    );
    if (live.rowCount !== 1) {
      throw await this.auditDenial(device, 401, "session-revoked");
    }
  }

  /**
   * The entitlement an Additional POS Terminal must hold to do anything at all.
   *
   * A terminal exists only because a licence added `additional-device-pos`, so
   * a licence that expires, is deactivated, is invalidated by a detected clock
   * rollback, or simply loses the add-on takes the terminal's permission to
   * operate away with it. That is checked here and now — at login, on every
   * request, and again under the write lock — never from what the request
   * believed on arrival, so a licence change fails the terminal closed
   * immediately instead of at its next handshake. The Main Pharmacy Computer is
   * never asked: it is the one device Free Core is defined around.
   *
   * The refusal is recorded, the success is not. An allowed terminal request
   * must not append an audit row per request; a refusal is rare and is exactly
   * the fact an operator needs when a till stops working.
   */
  private async requireTerminalEntitlement(input: {
    readonly actorId: string;
    readonly client?: PoolClient;
    readonly entitlement: EntitlementContext;
    readonly identitySessionId?: string;
    readonly licensingDeviceId: string;
    readonly pharmacyId: string;
    readonly terminalDeviceId: string | undefined;
  }): Promise<void> {
    if (
      input.terminalDeviceId === undefined ||
      input.entitlement.capabilities.includes(TERMINAL_CAPABILITY)
    ) {
      return;
    }
    // Denial-then-commit. Inside a transaction the refusal is written on that
    // transaction's own connection and committed before it is raised: a second
    // connection writing an audit row that references the actor would have to
    // wait for row locks this transaction is still holding. Nothing else has
    // been written by the time an execution context is refused, so the commit
    // carries the refusal and only the refusal.
    const denial = await this.licensing.denyTerminalCapability(
      input.client ?? this.localDatabase.requirePool(),
      {
        actorId: input.actorId,
        capability: TERMINAL_CAPABILITY,
        entitlementStatus: input.entitlement.status,
        ...(input.identitySessionId === undefined
          ? {}
          : { identitySessionId: input.identitySessionId }),
        mainDeviceId: input.licensingDeviceId,
        now: new Date(),
        pharmacyId: input.pharmacyId,
        terminalDeviceId: input.terminalDeviceId,
      },
    );
    if (input.client !== undefined) {
      await input.client.query("commit");
    }
    throw denial;
  }

  private async sessionState(
    sessionId: string,
    device: RequestDeviceBinding,
  ): Promise<IdentityState> {
    const result = await this.localDatabase.requirePool().query<SessionRow>(
      `${SESSION_SELECT}
       ${SESSION_ID_BINDING_FILTER}`,
      [sessionId, ...sessionBindingValues(device)],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.revoked_at !== null ||
      row.expires_at.getTime() <= Date.now() ||
      row.user_status !== "active"
    ) {
      return { state: "session-revoked" };
    }
    return await this.authenticatedState(row);
  }

  private async lockIdentity(
    client: PoolClient,
    pharmacyId: string,
  ): Promise<void> {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text, 165308859))",
      [pharmacyId],
    );
  }

  /**
   * The in-transaction authority for a write.
   *
   * A terminal request additionally takes a share lock on its device record and
   * requires it to be unrevoked. Revocation takes the matching exclusive lock,
   * so the two can never interleave: once a revocation commits, no terminal
   * transaction that started before it can still commit a change.
   */
  private async currentContext(
    client: PoolClient,
    expected: IdentityExecutionContext,
  ): Promise<IdentityExecutionContext> {
    if (expected.terminalDeviceId !== undefined) {
      const live = await client.query(
        `select 1 from terminal_devices
         where id = $1 and revoked_at is null
         for share`,
        [expected.terminalDeviceId],
      );
      if (live.rowCount !== 1) {
        throw await this.contextDenial(expected, 401, "session-revoked");
      }
    }
    const result = await client.query<SessionRow>(
      `${SESSION_SELECT}
       ${SESSION_ID_BINDING_FILTER}`,
      [expected.sessionId, ...sessionBindingValues(bindingOf(expected))],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.revoked_at !== null ||
      row.expires_at.getTime() <= Date.now() ||
      row.user_status !== "active"
    ) {
      throw await this.contextDenial(expected, 401, "session-revoked");
    }
    const entitlement = await this.licensing.current(
      {
        actorId: row.user_id,
        identitySessionId: row.session_id,
        mainDeviceId: expected.licensingDeviceId,
        now: new Date(),
        pharmacyId: row.pharmacy_id,
      },
      client,
    );
    await this.requireTerminalEntitlement({
      actorId: row.user_id,
      client,
      entitlement,
      identitySessionId: row.session_id,
      licensingDeviceId: expected.licensingDeviceId,
      pharmacyId: row.pharmacy_id,
      terminalDeviceId: expected.terminalDeviceId,
    });
    return {
      actorId: row.user_id,
      authRevision: BigInt(row.auth_revision),
      deviceId: expected.deviceId,
      deviceSessionHash: expected.deviceSessionHash,
      entitlement,
      licensingDeviceId: expected.licensingDeviceId,
      permissions: await this.rolePermissions(client, row.role_id),
      pharmacyId: row.pharmacy_id,
      pharmacyIdentityRevision: BigInt(row.pharmacy_identity_revision),
      roleId: row.role_id,
      roleKey: row.role_key,
      roleRevision: BigInt(row.role_revision),
      sessionId: row.session_id,
      terminalCertFingerprint: expected.terminalCertFingerprint,
      terminalDeviceId: expected.terminalDeviceId,
    };
  }

  private async requirePermissionInTransaction(
    client: PoolClient,
    expected: IdentityExecutionContext,
    permission: PermissionName,
  ): Promise<IdentityExecutionContext> {
    const fresh = await this.currentContext(client, expected);
    if (!hasPermission(fresh.permissions, permission)) {
      throw await this.contextDenial(
        fresh,
        403,
        "permission-denied",
        permission,
      );
    }
    return fresh;
  }

  private async consumeStepUp(
    client: PoolClient,
    expected: IdentityExecutionContext,
    challengeId: string,
    use: { readonly action: StepUpAction; readonly subjectId: string },
  ): Promise<void> {
    const challenge = await this.selectChallenge(client, challengeId, true);
    if (challenge === undefined) {
      throw await this.contextDenial(
        expected,
        404,
        "identity-resource-not-found",
      );
    }
    const requiredPermission = STEP_UP_ACTIONS[use.action];
    if (
      challenge.pharmacy_id !== expected.pharmacyId ||
      challenge.actor_user_id !== expected.actorId ||
      challenge.identity_session_id !== expected.sessionId ||
      !challengeBindingMatches(challenge, expected) ||
      challenge.action_name !== use.action ||
      challenge.required_permission !== requiredPermission ||
      challenge.subject_id !== use.subjectId
    ) {
      throw await this.contextDenial(
        expected,
        403,
        "step-up-context-mismatch",
        undefined,
        challenge.subject_id,
        use.action,
      );
    }
    if (challenge.status === "pending") {
      throw await this.contextDenial(
        expected,
        409,
        "step-up-not-approved",
        undefined,
        challenge.subject_id,
        use.action,
      );
    }
    if (challenge.status !== "approved" || challenge.consumed_at !== null) {
      throw await this.contextDenial(
        expected,
        409,
        "step-up-reused",
        undefined,
        challenge.subject_id,
        use.action,
      );
    }
    if (challenge.expires_at.getTime() <= Date.now()) {
      throw await this.contextDenial(
        expected,
        409,
        "step-up-expired",
        undefined,
        challenge.subject_id,
        use.action,
      );
    }

    const fresh = await this.currentContext(client, expected);
    const subject = await this.stepUpSubject(
      client,
      fresh,
      use.action,
      use.subjectId,
    );
    const decision = evaluateStepUpApproval({
      challenge: {
        action: use.action,
        actorId: challenge.actor_user_id,
        authRevision: BigInt(challenge.actor_auth_revision),
        deviceId: challengeDeviceKey(challenge),
        expiresAt: challenge.expires_at,
        pharmacyIdentityRevision: BigInt(challenge.pharmacy_identity_revision),
        requiredPermission,
        resolved: false,
        roleRevision: BigInt(challenge.role_revision),
        sessionId: challenge.identity_session_id,
        subjectRevision: BigInt(challenge.subject_revision),
      },
      context: stepUpContext(fresh),
      currentSubjectRevision: subject.revision,
      now: new Date(),
    });
    if (decision !== "approved") {
      throw await this.contextDenial(
        fresh,
        decision === "step-up-expired" ? 409 : 403,
        decision,
        decision === "step-up-missing-permission"
          ? requiredPermission
          : undefined,
        challenge.subject_id,
        use.action,
      );
    }
    const consumed = await client.query(
      `update step_up_challenges
       set consumed_at = statement_timestamp()
       where id = $1 and status = 'approved' and consumed_at is null`,
      [challenge.id],
    );
    if (consumed.rowCount !== 1) {
      throw await this.contextDenial(
        fresh,
        409,
        "step-up-reused",
        undefined,
        challenge.subject_id,
        use.action,
      );
    }
  }

  private async stepUpSubject(
    client: PoolClient,
    context: IdentityExecutionContext,
    action: StepUpAction,
    subjectId?: string,
  ): Promise<{ readonly id: string; readonly revision: bigint }> {
    if (
      action === "licensing.licence.install" ||
      action === "licensing.licence.deactivate"
    ) {
      if (subjectId !== undefined && subjectId !== context.pharmacyId) {
        throw await this.contextDenial(context, 400, "body-invalid");
      }
      return {
        id: context.pharmacyId,
        revision: context.pharmacyIdentityRevision,
      };
    }
    if (
      action === "devices.pairing.start" ||
      action === "identity.role.create" ||
      action === "identity.user.create"
    ) {
      // Creating a role or a user has no subject row yet; the pharmacy's
      // identity revision, which both commands advance, stands in for it.
      const expectedSubject =
        action === "identity.user.create"
          ? context.actorId
          : context.pharmacyId;
      if (subjectId !== undefined && subjectId !== expectedSubject) {
        throw await this.contextDenial(context, 400, "body-invalid");
      }
      return {
        id: expectedSubject,
        revision: context.pharmacyIdentityRevision,
      };
    }
    if (subjectId === undefined) {
      throw await this.contextDenial(context, 400, "body-invalid");
    }
    if (
      action === "devices.revoke" ||
      action === "devices.seat.release.request"
    ) {
      // The subject revision advances as the device's trust state changes, so
      // a challenge approved for a live device cannot be spent on the same
      // device after someone else revoked it or released its seat.
      const device = await client.query<{
        released: number;
        revoked: number;
      }>(
        `select (revoked_at is not null)::int as revoked,
                (seat_released_at is not null)::int as released
         from terminal_devices
         where id = $1 and pharmacy_id = $2`,
        [subjectId, context.pharmacyId],
      );
      const row = device.rows[0];
      if (row === undefined) {
        throw await this.contextDenial(
          context,
          404,
          "identity-resource-not-found",
        );
      }
      return {
        id: subjectId,
        revision: BigInt(1 + row.revoked + 2 * row.released),
      };
    }
    if (
      action === "identity.user.password.reset" ||
      action === "identity.user.update"
    ) {
      const user = await client.query<{ auth_revision: string }>(
        `select auth_revision::text from identity_users
         where id = $1 and pharmacy_id = $2`,
        [subjectId, context.pharmacyId],
      );
      const revision = user.rows[0]?.auth_revision;
      if (revision === undefined) {
        throw await this.contextDenial(
          context,
          404,
          "identity-resource-not-found",
        );
      }
      return { id: subjectId, revision: BigInt(revision) };
    }
    const role = await this.selectRole(client, context.pharmacyId, subjectId);
    if (role === undefined) {
      throw await this.contextDenial(
        context,
        404,
        "identity-resource-not-found",
      );
    }
    return { id: subjectId, revision: BigInt(role.revision) };
  }

  private async selectChallenge(
    client: PoolClient,
    challengeId: string,
    lock = false,
  ): Promise<ChallengeRow | undefined> {
    const result = await client.query<ChallengeRow>(
      `select id, pharmacy_id, actor_user_id, identity_session_id,
              device_id, device_session_hash, terminal_device_id, action_name,
              required_permission, subject_id, subject_revision::text,
              pharmacy_identity_revision::text, actor_auth_revision::text,
              role_revision::text, expires_at, status, consumed_at
       from step_up_challenges
       where id = $1
       ${lock ? "for update" : ""}`,
      [challengeId],
    );
    return result.rows[0];
  }

  private async denyChallenge(
    client: PoolClient,
    challengeId: string,
    code: string,
  ): Promise<void> {
    await client.query(
      `update step_up_challenges
       set status = 'denied', resolved_at = statement_timestamp(),
           denial_code = $2
       where id = $1 and status = 'pending'`,
      [challengeId, code],
    );
  }

  private async selectUser(
    client: PoolClient,
    pharmacyId: string,
    userId: string,
    lock = false,
  ): Promise<UserRow> {
    const user = await this.findUser(client, pharmacyId, userId, lock);
    if (user === undefined) {
      throw new Error("The identity user is missing");
    }
    return user;
  }

  private async findUser(
    client: PoolClient,
    pharmacyId: string,
    userId: string,
    lock = false,
  ): Promise<UserRow | undefined> {
    const result = await client.query<UserRow>(
      `${USER_SELECT}
       where identity_user.pharmacy_id = $1 and identity_user.id = $2
       ${lock ? "for update of identity_user" : ""}`,
      [pharmacyId, userId],
    );
    return result.rows[0];
  }

  private async selectRole(
    client: PoolClient,
    pharmacyId: string,
    roleId: string,
    lock = false,
  ): Promise<RoleRow | undefined> {
    const result = await client.query<RoleRow>(
      `select id, role_key, custom_name, revision::text
       from pharmacy_roles
       where pharmacy_id = $1 and id = $2
       ${lock ? "for update" : ""}`,
      [pharmacyId, roleId],
    );
    return result.rows[0];
  }

  private async rolePermissions(
    queryable: Queryable,
    roleId: string,
  ): Promise<PermissionName[]> {
    const result = await queryable.query<{ permission_name: string }>(
      `select permission_name from role_permission_grants
       where role_id = $1 order by permission_name`,
      [roleId],
    );
    return result.rows
      .map((row) => row.permission_name)
      .filter(isPermissionName);
  }

  private async advanceIdentityRevision(
    client: PoolClient,
    pharmacyId: string,
  ): Promise<void> {
    await client.query(
      `update pharmacies set identity_revision = identity_revision + 1
       where id = $1`,
      [pharmacyId],
    );
  }

  private async contextDenial(
    context: IdentityExecutionContext,
    statusCode: number,
    code: IdentityDenialCode,
    requiredPermission?: PermissionName,
    targetId?: string,
    action = "identity.authorization",
  ): Promise<IdentityAccessDenied> {
    const requestId = await this.writeAudit(this.localDatabase.requirePool(), {
      action,
      actorUserId: context.actorId,
      device: context,
      identitySessionId: context.sessionId,
      outcome: code,
      pharmacyId: context.pharmacyId,
      ...(targetId === undefined ? {} : { targetId }),
      ...(requiredPermission === undefined
        ? {}
        : { afterState: { requiredPermission } }),
    });
    return this.denied(statusCode, code, requestId, requiredPermission);
  }

  private async auditDenial(
    device: RequestDeviceBinding,
    statusCode: number,
    code: IdentityDenialCode,
    row?: SessionRow,
  ): Promise<IdentityAccessDenied> {
    const requestId = await this.writeAudit(this.localDatabase.requirePool(), {
      action: "identity.session",
      device,
      outcome: code,
      ...(row === undefined
        ? {}
        : {
            actorUserId: row.user_id,
            identitySessionId: row.session_id,
            pharmacyId: row.pharmacy_id,
          }),
    });
    return this.denied(statusCode, code, requestId);
  }

  private denied(
    statusCode: number,
    code: IdentityDenialCode,
    requestId: string,
    requiredPermission?: PermissionName,
  ): IdentityAccessDenied {
    return new IdentityAccessDenied(statusCode, {
      code,
      requestId,
      ...(requiredPermission === undefined ? {} : { requiredPermission }),
      status: "denied",
    });
  }

  private async beginIdempotentCommand<T>(
    client: PoolClient,
    context: IdentityExecutionContext,
    commandName: string,
    input: IdentityCommandInput,
    parser: PayloadParser<T>,
  ): Promise<T | undefined> {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 38))",
      [`${context.pharmacyId}:${context.actorId}:${input.idempotencyKey}`],
    );
    const fingerprint = commandFingerprint(commandName, input);
    const result = await client.query<{
      command_name: string;
      request_fingerprint: Buffer;
      response_body: unknown;
    }>(
      `select command_name, request_fingerprint, response_body
       from identity_command_results
       where pharmacy_id = $1 and actor_user_id = $2 and idempotency_key = $3`,
      [context.pharmacyId, context.actorId, input.idempotencyKey],
    );
    const stored = result.rows[0];
    if (stored === undefined) {
      return undefined;
    }
    if (
      stored.command_name !== commandName ||
      !stored.request_fingerprint.equals(fingerprint)
    ) {
      const requestId = await this.writeAudit(client, {
        action: commandName,
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: "idempotency-conflict",
        pharmacyId: context.pharmacyId,
      });
      await client.query("commit");
      throw this.denied(409, "idempotency-conflict", requestId);
    }
    return parser.parse(stored.response_body);
  }

  private async recordCommandResult(
    client: PoolClient,
    context: IdentityExecutionContext,
    commandName: string,
    input: IdentityCommandInput,
    response: unknown,
  ): Promise<void> {
    await client.query(
      `insert into identity_command_results (
         pharmacy_id, actor_user_id, identity_session_id, device_id,
         terminal_device_id, idempotency_key, command_name,
         request_fingerprint, response_body
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        context.pharmacyId,
        context.actorId,
        context.sessionId,
        context.deviceId ?? null,
        context.terminalDeviceId ?? null,
        input.idempotencyKey,
        commandName,
        commandFingerprint(commandName, input),
        JSON.stringify(response),
      ],
    );
  }

  private async rejectVersionConflict(
    client: PoolClient,
    context: IdentityExecutionContext,
    action: string,
    targetId: string,
  ): Promise<never> {
    const requestId = await this.writeAudit(client, {
      action,
      actorUserId: context.actorId,
      device: context,
      identitySessionId: context.sessionId,
      outcome: "version-conflict",
      pharmacyId: context.pharmacyId,
      targetId,
    });
    await client.query("commit");
    throw this.denied(409, "version-conflict", requestId);
  }

  /**
   * Each device kind counts its own attempts, in its own table: a terminal
   * being brute-forced must never consume the Main Pharmacy Computer's budget
   * and lock the pharmacy out of its own till.
   */
  private async consumeAuthAttempt(
    device: AuditDeviceColumns,
    action: "login" | "step-up",
    subject: string,
  ): Promise<boolean> {
    const [deviceKey, subjectKey] = authRateKeys(action, subject);
    const table = authRateTable(device);
    const result = await this.localDatabase.requirePool().query<{
      allowed: boolean;
    }>(
      `with clock as (
         select floor(extract(epoch from statement_timestamp()) / $5)::bigint
           as window_number
       ), pruned as (
         delete from ${table.name}
         where ${table.column} = $1 and action = $2
           and window_number < (select window_number from clock)
       ), counted as (
         insert into ${table.name} (
           ${table.column}, action, subject_key, window_number, request_count
         )
         select $1, $2, subject_key, (select window_number from clock), 1
         from unnest(array[$3::bytea, $4::bytea]) as keys(subject_key)
         on conflict (${table.column}, action, subject_key, window_number)
         do update
         set request_count = ${table.name}.request_count + 1
         returning request_count
       )
       select bool_and(request_count <= $6) as allowed from counted`,
      [
        table.deviceId,
        action,
        deviceKey,
        subjectKey,
        AUTH_RATE_WINDOW_SECONDS,
        AUTH_RATE_LIMIT,
      ],
    );
    return result.rows[0]?.allowed === true;
  }

  /**
   * Settles the budget after an attempt that actually authenticated.
   *
   * The subject's own window is cleared outright: proving the credential ends
   * any suspicion attached to that username.
   *
   * The device window is only refunded the one increment this attempt made. It
   * must not be cleared, because a device budget any single success can reset
   * is no budget at all — an attacker holding one valid credential would zero
   * it between guesses at other usernames. It must not be left either, because
   * the counter is charged before success is known, and an owner who approves
   * six Step-Ups in a minute would otherwise lock the device out of its own
   * administration. Refunding leaves exactly the failures on the meter.
   */
  private async clearAuthAttempts(
    queryable: Queryable,
    device: AuditDeviceColumns,
    action: "login" | "step-up",
    subject: string,
  ): Promise<void> {
    const [deviceKey, subjectKey] = authRateKeys(action, subject);
    const table = authRateTable(device);
    // The refund and the removal target disjoint rows — one where this attempt
    // was not the only charge in the window, one where it was — so both read
    // the same snapshot safely. The stored count is constrained positive, so a
    // last remaining charge is deleted rather than decremented to zero.
    await queryable.query(
      `with clock as (
         select floor(extract(epoch from statement_timestamp()) / $4)::bigint
           as window_number
       ), cleared_subject as (
         delete from ${table.name}
         where ${table.column} = $1 and action = $2
           and subject_key = $3
       ), refunded_device as (
         update ${table.name}
         set request_count = request_count - 1
         where ${table.column} = $1 and action = $2
           and subject_key = $5
           and window_number = (select window_number from clock)
           and request_count > 1
       )
       delete from ${table.name}
       where ${table.column} = $1 and action = $2
         and subject_key = $5
         and window_number = (select window_number from clock)
         and request_count = 1`,
      [table.deviceId, action, subjectKey, AUTH_RATE_WINDOW_SECONDS, deviceKey],
    );
  }

  private async writeAudit(
    queryable: Queryable,
    input: {
      readonly action: string;
      readonly actorUserId?: string;
      readonly afterState?: Record<string, unknown>;
      readonly beforeState?: Record<string, unknown>;
      readonly device: AuditDeviceColumns;
      readonly identitySessionId?: string;
      readonly outcome: string;
      readonly pharmacyId?: string;
      readonly targetId?: string;
    },
  ): Promise<string> {
    const result = await queryable.query<{ id: string }>(
      `insert into identity_audit_records (
         pharmacy_id, actor_user_id, identity_session_id, device_id,
         terminal_device_id, action, outcome, target_id, before_state,
         after_state
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        input.pharmacyId ?? null,
        input.actorUserId ?? null,
        input.identitySessionId ?? null,
        input.device.deviceId ?? null,
        input.device.terminalDeviceId ?? null,
        input.action,
        input.outcome,
        input.targetId ?? null,
        input.beforeState ?? null,
        input.afterState ?? null,
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("The identity audit record was not created");
    }
    return id;
  }
}

interface Queryable {
  query<R extends object>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

const SESSION_SELECT = `select session.id as session_id,
       session.device_id,
       session.terminal_device_id,
       session.pharmacy_id,
       pharmacy.name as pharmacy_name,
       pharmacy.identity_revision::text as pharmacy_identity_revision,
       session.user_id,
       identity_user.username,
       identity_user.display_name,
       identity_user.status as user_status,
       identity_user.auth_revision::text,
       role.id as role_id,
       role.role_key,
       role.custom_name as role_custom_name,
       role.revision::text as role_revision,
       session.expires_at,
       session.revoked_at,
       session.revocation_reason,
       settings.attendance_enabled,
       settings.revision::text as settings_revision,
       presence.status as attendance_status,
       presence.version::text as attendance_version
from identity_sessions session
join pharmacies pharmacy on pharmacy.id = session.pharmacy_id
join identity_users identity_user on identity_user.id = session.user_id
join pharmacy_roles role on role.id = identity_user.role_id
join pharmacy_settings settings on settings.pharmacy_id = session.pharmacy_id
join attendance_presence presence
  on presence.pharmacy_id = session.pharmacy_id
 and presence.user_id = session.user_id`;

/**
 * A session is found by its whole binding, never by a fragment of it: a
 * terminal certificate must not be able to select a Main device session, and a
 * Main device session hash must not be able to select a terminal's.
 */
const SESSION_BINDING_FILTER = `where session.device_id is not distinct from $1
   and session.device_session_hash is not distinct from $2
   and session.terminal_device_id is not distinct from $3
   and session.terminal_cert_fingerprint is not distinct from $4`;

const SESSION_ID_BINDING_FILTER = `where session.id = $1
   and session.device_id is not distinct from $2
   and session.device_session_hash is not distinct from $3
   and session.terminal_device_id is not distinct from $4
   and session.terminal_cert_fingerprint is not distinct from $5`;

function sessionBindingValues(device: RequestDeviceBinding): unknown[] {
  return [
    device.deviceId ?? null,
    device.deviceSessionHash ?? null,
    device.terminalDeviceId ?? null,
    device.terminalCertFingerprint ?? null,
  ];
}

function bindingOf(context: IdentityExecutionContext): RequestDeviceBinding {
  if (
    context.deviceId !== undefined &&
    context.deviceSessionHash !== undefined
  ) {
    return {
      deviceId: context.deviceId,
      deviceSessionHash: context.deviceSessionHash,
      terminalCertFingerprint: undefined,
      terminalDeviceId: undefined,
    };
  }
  if (
    context.terminalDeviceId !== undefined &&
    context.terminalCertFingerprint !== undefined
  ) {
    return {
      deviceId: undefined,
      deviceSessionHash: undefined,
      terminalCertFingerprint: context.terminalCertFingerprint,
      terminalDeviceId: context.terminalDeviceId,
    };
  }
  throw new Error("An execution context always carries one device binding");
}

/**
 * A Step-Up challenge is pinned to the exact device that created it. A Main
 * challenge additionally has to match the device session hash, so a new Main
 * session cannot finish a challenge an older one started.
 */
function challengeBindingMatches(
  challenge: ChallengeRow,
  context: IdentityExecutionContext,
): boolean {
  if (context.deviceId !== undefined) {
    return (
      challenge.device_id === context.deviceId &&
      challenge.device_session_hash !== null &&
      context.deviceSessionHash !== undefined &&
      challenge.device_session_hash.equals(context.deviceSessionHash)
    );
  }
  return (
    challenge.terminal_device_id !== null &&
    challenge.terminal_device_id === context.terminalDeviceId
  );
}

function challengeDeviceKey(challenge: ChallengeRow): string {
  return deviceBindingKey({
    deviceId: challenge.device_id ?? undefined,
    terminalDeviceId: challenge.terminal_device_id ?? undefined,
  });
}

function stepUpContext(context: IdentityExecutionContext): {
  readonly actorId: string;
  readonly authRevision: bigint;
  readonly deviceId: string;
  readonly permissions: readonly PermissionName[];
  readonly pharmacyIdentityRevision: bigint;
  readonly roleRevision: bigint;
  readonly sessionId: string;
} {
  return {
    actorId: context.actorId,
    authRevision: context.authRevision,
    deviceId: deviceBindingKey(context),
    permissions: context.permissions,
    pharmacyIdentityRevision: context.pharmacyIdentityRevision,
    roleRevision: context.roleRevision,
    sessionId: context.sessionId,
  };
}

function authRateTable(device: AuditDeviceColumns): {
  readonly column: string;
  readonly deviceId: string;
  readonly name: string;
} {
  if (device.deviceId !== undefined) {
    return {
      column: "device_id",
      deviceId: device.deviceId,
      name: "identity_auth_rate_windows",
    };
  }
  if (device.terminalDeviceId === undefined) {
    throw new Error("A rate-limited attempt always names its device");
  }
  return {
    column: "terminal_device_id",
    deviceId: device.terminalDeviceId,
    name: "terminal_auth_rate_windows",
  };
}

const USER_SELECT = `select identity_user.id,
       identity_user.pharmacy_id,
       identity_user.username,
       identity_user.display_name,
       identity_user.status,
       identity_user.password_hash,
       identity_user.auth_revision::text,
       role.id as role_id,
       role.role_key,
       role.custom_name as role_custom_name,
       role.revision::text as role_revision
from identity_users identity_user
join pharmacy_roles role on role.id = identity_user.role_id`;

/**
 * Built-in roles first, in their canonical order, then custom roles by their
 * normalized name. Bound parameters: `$1` pharmacy id, `$2` the role keys.
 */
const ROLE_ORDER = `order by (role_key is null),
         array_position($2::pharmacy_role_key[], role_key),
         custom_name_key,
         id`;

/** The role as a user carries it: identity and name, never grants. */
function roleReference(row: {
  readonly custom_name: string | null;
  readonly id: string;
  readonly role_key: PharmacyRoleKey | null;
}): IdentityRoleReference {
  if (row.role_key !== null) {
    return { id: row.id, key: row.role_key, kind: "built-in" };
  }
  if (row.custom_name === null) {
    throw new Error("A pharmacy role carries a built-in key or a custom name");
  }
  return { id: row.id, kind: "custom", name: row.custom_name };
}

function roleView(row: RoleRow, grants: readonly string[]): IdentityRole {
  return identityRoleSchema.parse({
    ...roleReference(row),
    grants: grants.filter(isImplementedPermissionName),
    revision: row.revision,
  });
}

/**
 * Replays a recorded settings outcome exactly as it was first returned. A
 * stored success returns its stored body; a stored terminal rejection — today
 * only the version conflict — is raised again with its stored status and
 * denial, so a client that retries a request Breev already refused gets the
 * same refusal instead of a second decision.
 */
function replaySettingsOutcome(replay: PostingCommandReplay): PharmacySettings {
  if (replay.responseStatus === 200) {
    return pharmacySettingsSchema.parse(replay.responseBody);
  }
  throw new IdentityAccessDenied(
    replay.responseStatus,
    identityDenialSchema.parse(replay.responseBody),
  );
}

function userRoleReference(row: UserRow): IdentityRoleReference {
  return roleReference({
    custom_name: row.role_custom_name,
    id: row.role_id,
    role_key: row.role_key,
  });
}

function userView(row: UserRow): UserView {
  return identityUserSchema.parse({
    displayName: row.display_name,
    id: row.id,
    revision: row.auth_revision,
    role: userRoleReference(row),
    status: row.status,
    username: row.username,
  });
}

function userAuditState(row: UserRow): Record<string, unknown> {
  return {
    displayName: row.display_name,
    role: userRoleReference(row),
    status: row.status,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function authRateKeys(
  action: "login" | "step-up",
  subject: string,
): readonly [Buffer, Buffer] {
  return [
    createHash("sha256").update(`device:${action}`).digest(),
    createHash("sha256").update(`subject:${action}:${subject}`).digest(),
  ];
}

/**
 * The canonical identity of one idempotent command, with every credential
 * removed.
 *
 * A recorded command result is an ordinary database row, and its fingerprint is
 * a fast SHA-256 of the request. A credential inside it would therefore be a
 * fast offline verifier for that credential — the command name, the actor, and
 * the idempotency key sit in the same row — so no field whose name mentions a
 * password is ever hashed. Excluding them costs nothing: a retry differs from a
 * new command by what it asks for, never by the password used to authorize it.
 */
function commandFingerprint(
  commandName: string,
  input: IdentityCommandInput,
): Buffer {
  const safeInput = Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !CREDENTIAL_FIELD_PATTERN.test(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256")
    .update(JSON.stringify({ commandName, input: safeInput }))
    .digest();
}

function readPositiveInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3600) {
    throw new Error(`${name} must be an integer between 1 and 3600`);
  }
  return parsed;
}

export { normalizeUsername };
