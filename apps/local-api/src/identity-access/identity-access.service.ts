import {
  attendanceEventSchema,
  identityRoleSchema,
  identityStateSchema,
  identityStepUpChallengeSchema,
  identityUserSchema,
  pharmacySettingsSchema,
  type AttendanceEvent,
  type AttendanceEventRequest,
  type IdentityAuthenticatedState,
  type IdentityBootstrapRequest,
  type IdentityCreateUserRequest,
  type IdentityDenial,
  type IdentityDenialCode,
  type IdentityLoginRequest,
  type IdentityRole,
  type IdentityRoles,
  type IdentityState,
  type IdentityStepUpApproveRequest,
  type IdentityStepUpChallenge,
  type IdentityStepUpCreateRequest,
  type IdentityUpdateRolePermissionsRequest,
  type IdentityUpdateUserRequest,
  type IdentityUser,
  type EntitlementContext,
  type PharmacySettingsUpdateRequest,
  type PharmacyRoleKey,
} from "@breev/contracts/local-rest";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";

import { LocalDatabaseService } from "../local-database.service.js";
import { LicensingService } from "../licensing/licensing.service.js";
import {
  MainDeviceSecurityService,
  type VerifiedMainDeviceContext,
} from "../main-device/main-device-security.service.js";
import {
  PERMISSION_NAMES,
  STEP_UP_ACTIONS,
  evaluateStepUpApproval,
  hasPermission,
  isPermissionName,
  isStepUpAction,
  type PermissionName,
  type StepUpAction,
} from "./authorization.js";
import { hashPassword, verifyPassword } from "./password.js";

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

interface SessionRow {
  readonly session_id: string;
  readonly device_id: string;
  readonly pharmacy_id: string;
  readonly pharmacy_name: string;
  readonly pharmacy_identity_revision: string;
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly user_status: "active" | "locked";
  readonly auth_revision: string;
  readonly role_id: string;
  readonly role_key: PharmacyRoleKey;
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
  readonly role_key: PharmacyRoleKey;
  readonly role_revision: string;
}

interface ChallengeRow {
  readonly id: string;
  readonly pharmacy_id: string;
  readonly actor_user_id: string;
  readonly identity_session_id: string;
  readonly device_id: string;
  readonly device_session_hash: Buffer;
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

interface IdentityCommandInput {
  readonly idempotencyKey: string;
  readonly password?: string;
}

interface PayloadParser<T> {
  parse(payload: unknown): T;
}

export interface IdentityExecutionContext {
  readonly actorId: string;
  readonly authRevision: bigint;
  readonly deviceId: string;
  readonly deviceSessionHash: Buffer;
  readonly entitlement: EntitlementContext;
  readonly permissions: readonly PermissionName[];
  readonly pharmacyId: string;
  readonly pharmacyIdentityRevision: bigint;
  readonly roleId: string;
  readonly roleKey: PharmacyRoleKey;
  readonly roleRevision: bigint;
  readonly sessionId: string;
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
  ) {}

  public verifiedDevice(request: Request): VerifiedMainDeviceContext {
    const context = this.deviceSecurity.verifiedDeviceContext(request);
    if (context === undefined) {
      throw new Error("The device boundary did not verify this request");
    }
    return context;
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
      deviceId: device.deviceId,
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
          deviceId: device.deviceId,
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
         on conflict (name) do update
         set required_permission = excluded.required_permission`,
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
      await client.query(
        `insert into role_permission_grants
           (pharmacy_id, role_id, permission_name, granted_by)
         select $1, $2, name, $3
         from permission_definitions`,
        [pharmacyId, ownerRoleId, ownerId],
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
        deviceId: device.deviceId,
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
        deviceId: device.deviceId,
        outcome: "bootstrap-required",
      });
      throw this.denied(409, "bootstrap-required", requestId);
    }

    const usernameKey = normalizeUsername(input.username);
    if (
      !(await this.consumeAuthAttempt(device.deviceId, "login", usernameKey))
    ) {
      const requestId = await this.writeAudit(pool, {
        action: "identity.login",
        deviceId: device.deviceId,
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
        deviceId: device.deviceId,
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
          deviceId: device.deviceId,
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
      sessionId = await this.replaceSession(client, {
        device,
        pharmacyId,
        userId: user.id,
      });
      await this.clearAuthAttempts(
        client,
        device.deviceId,
        "login",
        usernameKey,
      );
      await this.writeAudit(client, {
        action: "identity.login",
        actorUserId: user.id,
        deviceId: device.deviceId,
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
        deviceId: context.deviceId,
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

  public async users(request: Request): Promise<{ users: UserView[] }> {
    const context = await this.requirePermission(
      request,
      "identity.users.manage",
    );
    const result = await this.localDatabase.requirePool().query<UserRow>(
      `${USER_SELECT}
       where identity_user.pharmacy_id = $1
       order by identity_user.display_name, identity_user.id`,
      [context.pharmacyId],
    );
    return { users: result.rows.map(userView) };
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
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.user.create",
        subjectId: context.actorId,
      });
      const role = await client.query<{ id: string }>(
        `select id from pharmacy_roles
         where pharmacy_id = $1 and role_key = $2`,
        [context.pharmacyId, input.role],
      );
      const roleId = role.rows[0]?.id;
      if (roleId === undefined) {
        throw new Error("The configured pharmacy role is missing");
      }
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
          deviceId: context.deviceId,
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
        afterState: { role: input.role, status: "active" },
        deviceId: context.deviceId,
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
    if (input.role === undefined && input.status === undefined) {
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
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.user.update",
        subjectId: userId,
      });
      const nextRole = input.role ?? before.role_key;
      const nextStatus = input.status ?? before.status;
      if (
        before.role_key === "owner" &&
        before.status === "active" &&
        (nextRole !== "owner" || nextStatus !== "active")
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
            deviceId: context.deviceId,
            identitySessionId: context.sessionId,
            outcome: "last-owner-required",
            pharmacyId: context.pharmacyId,
            targetId: userId,
          });
          await client.query("commit");
          throw this.denied(409, "last-owner-required", requestId);
        }
      }
      const role = await client.query<{ id: string }>(
        `select id from pharmacy_roles
         where pharmacy_id = $1 and role_key = $2`,
        [context.pharmacyId, nextRole],
      );
      const roleId = role.rows[0]?.id;
      if (roleId === undefined) {
        throw new Error("The configured pharmacy role is missing");
      }
      await client.query(
        `update identity_users
         set role_id = $2, status = $3, auth_revision = auth_revision + 1
         where id = $1`,
        [userId, roleId, nextStatus],
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
        deviceId: context.deviceId,
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
          deviceId: context.deviceId,
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
          deviceId: context.deviceId,
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
           device_session_hash, action_name, required_permission,
           subject_id, subject_revision, pharmacy_identity_revision,
           actor_auth_revision, role_revision, expires_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           statement_timestamp() + interval '5 minutes'
         ) returning id, expires_at`,
        [
          fresh.pharmacyId,
          fresh.actorId,
          fresh.sessionId,
          fresh.deviceId,
          fresh.deviceSessionHash,
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
        deviceId: fresh.deviceId,
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
          deviceId: context.deviceId,
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
      candidate.device_id !== context.deviceId ||
      !candidate.device_session_hash.equals(context.deviceSessionHash) ||
      candidate.identity_session_id !== context.sessionId
    ) {
      const requestId = await this.writeAudit(
        this.localDatabase.requirePool(),
        {
          action: "identity.step-up.approve",
          actorUserId: context.actorId,
          deviceId: context.deviceId,
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
        !(await this.consumeAuthAttempt(
          context.deviceId,
          "step-up",
          context.actorId,
        ))
      ) {
        const requestId = await this.writeAudit(
          this.localDatabase.requirePool(),
          {
            action: candidate.action_name,
            actorUserId: context.actorId,
            deviceId: context.deviceId,
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
          context.deviceId,
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
          deviceId: context.deviceId,
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
          deviceId: context.deviceId,
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
          deviceId: locked.device_id,
          expiresAt: locked.expires_at,
          pharmacyIdentityRevision: BigInt(locked.pharmacy_identity_revision),
          requiredPermission,
          resolved: false,
          roleRevision: BigInt(locked.role_revision),
          sessionId: locked.identity_session_id,
          subjectRevision: BigInt(locked.subject_revision),
        },
        context: fresh,
        currentSubjectRevision: subject.revision,
        now: new Date(),
      });
      if (decision !== "approved") {
        await this.denyChallenge(client, locked.id, decision);
        const requestId = await this.writeAudit(client, {
          action,
          actorUserId: context.actorId,
          deviceId: context.deviceId,
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
      await this.clearAuthAttempts(
        client,
        context.deviceId,
        "step-up",
        context.actorId,
      );
      await this.writeAudit(client, {
        action,
        actorUserId: context.actorId,
        afterState: { challengeStatus: "approved" },
        deviceId: context.deviceId,
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
    if (!input.permissions.every(isPermissionName)) {
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
          deviceId: context.deviceId,
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
      await this.consumeStepUp(client, context, input.challengeId, {
        action: "identity.role.permissions.update",
        subjectId: roleId,
      });
      const before = await this.rolePermissions(client, roleId);
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
        deviceId: context.deviceId,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: roleId,
      });
      const response = identityRoleSchema.parse({
        grants: permissions,
        id: roleId,
        key: role.key,
        revision: updated.rows[0]?.revision ?? "",
      });
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

  public async updateSettings(
    request: Request,
    input: PharmacySettingsUpdateRequest,
  ): Promise<{ attendanceEnabled: boolean; revision: string }> {
    const context = await this.requirePermission(
      request,
      "pharmacy.settings.manage",
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const replay = await this.beginIdempotentCommand(
        client,
        context,
        "pharmacy.settings.update",
        input,
        pharmacySettingsSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      await this.requirePermissionInTransaction(
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
        [context.pharmacyId],
      );
      const previousSettings = before.rows[0];
      if (
        previousSettings === undefined ||
        previousSettings.revision !== input.expectedRevision
      ) {
        return await this.rejectVersionConflict(
          client,
          context,
          "pharmacy.settings.update",
          context.pharmacyId,
        );
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
        [context.pharmacyId, input.attendanceEnabled, context.actorId],
      );
      const settings = result.rows[0];
      if (settings === undefined) {
        throw new Error("The pharmacy settings are missing");
      }
      await this.writeAudit(client, {
        action: "pharmacy.settings.update",
        actorUserId: context.actorId,
        afterState: { attendanceEnabled: settings.attendance_enabled },
        beforeState: {
          attendanceEnabled: previousSettings.attendance_enabled,
        },
        deviceId: context.deviceId,
        identitySessionId: context.sessionId,
        outcome: "succeeded",
        pharmacyId: context.pharmacyId,
        targetId: context.pharmacyId,
      });
      const response = pharmacySettingsSchema.parse({
        attendanceEnabled: settings.attendance_enabled,
        revision: settings.revision,
      });
      await this.recordCommandResult(
        client,
        context,
        "pharmacy.settings.update",
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
          deviceId: context.deviceId,
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
          deviceId: context.deviceId,
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
          deviceId: context.deviceId,
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
           kind, presence_version
         ) values ($1, $2, $3, $4, $5, $6)
         returning id, occurred_at`,
        [
          context.pharmacyId,
          context.actorId,
          context.sessionId,
          context.deviceId,
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
        deviceId: context.deviceId,
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
    const result = await this.localDatabase.requirePool().query<{
      grants: string[];
      id: string;
      key: PharmacyRoleKey;
      revision: string;
    }>(
      `select role.id,
              role.role_key as key,
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
       order by array_position($2::pharmacy_role_key[], role.role_key)`,
      [context.pharmacyId, PHARMACY_ROLE_KEYS],
    );
    return {
      permissions: [...PERMISSION_NAMES],
      roles: result.rows.map((row) => ({
        grants: row.grants.filter(isPermissionName),
        id: row.id,
        key: row.key,
        revision: row.revision,
      })),
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
    const entitlement = await this.licensing.current({
      actorId: row.user_id,
      identitySessionId: row.session_id,
      mainDeviceId: row.device_id,
      now: new Date(),
      pharmacyId: row.pharmacy_id,
    });
    const context: IdentityExecutionContext = {
      actorId: row.user_id,
      authRevision: BigInt(row.auth_revision),
      deviceId: device.deviceId,
      deviceSessionHash: device.deviceSessionHash,
      entitlement,
      permissions,
      pharmacyId: row.pharmacy_id,
      pharmacyIdentityRevision: BigInt(row.pharmacy_identity_revision),
      roleId: row.role_id,
      roleKey: row.role_key,
      roleRevision: BigInt(row.role_revision),
      sessionId: row.session_id,
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
          deviceId: context.deviceId,
          identitySessionId: context.sessionId,
          outcome: "denied",
          pharmacyId: context.pharmacyId,
        },
      );
      throw this.denied(403, "permission-denied", requestId, permission);
    }
    return context;
  }

  public async authorizeLicenceInstallation(
    request: Request,
    challengeId: string,
  ): Promise<IdentityExecutionContext> {
    const context = await this.requirePermission(request, "licensing.manage");
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockIdentity(client, context.pharmacyId);
      const fresh = await this.requirePermissionInTransaction(
        client,
        context,
        "licensing.manage",
      );
      await this.consumeStepUp(client, fresh, challengeId, {
        action: "licensing.licence.install",
        subjectId: fresh.pharmacyId,
      });
      await client.query("commit");
      return fresh;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async authenticatedState(
    row: SessionRow,
  ): Promise<IdentityAuthenticatedState> {
    const permissions = await this.permissions(row.role_id);
    const entitlement = await this.licensing.current({
      actorId: row.user_id,
      identitySessionId: row.session_id,
      mainDeviceId: row.device_id,
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
        role: row.role_key,
        status: row.user_status,
        username: row.username,
      },
    }) as IdentityAuthenticatedState;
  }

  private async latestSession(
    device: VerifiedMainDeviceContext,
  ): Promise<SessionRow | undefined> {
    const result = await this.localDatabase.requirePool().query<SessionRow>(
      `${SESSION_SELECT}
       where session.device_id = $1 and session.device_session_hash = $2
       order by session.created_at desc, session.id desc
       limit 1`,
      [device.deviceId, device.deviceSessionHash],
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

  private async replaceSession(
    client: PoolClient,
    input: {
      readonly device: VerifiedMainDeviceContext;
      readonly pharmacyId: string;
      readonly userId: string;
    },
  ): Promise<string> {
    await client.query(
      `select pg_advisory_xact_lock(
         hashtextextended(encode($1::bytea, 'hex'), 165308858)
       )`,
      [input.device.deviceSessionHash],
    );
    await client.query(
      `update identity_sessions
       set revoked_at = statement_timestamp(), revocation_reason = 'replaced'
       where device_session_hash = $1 and revoked_at is null`,
      [input.device.deviceSessionHash],
    );
    const session = await client.query<{ id: string }>(
      `insert into identity_sessions (
         pharmacy_id, user_id, device_id, device_session_hash, expires_at
       ) values (
         $1, $2, $3, $4,
         statement_timestamp() + make_interval(hours => $5)
       ) returning id`,
      [
        input.pharmacyId,
        input.userId,
        input.device.deviceId,
        input.device.deviceSessionHash,
        SESSION_LIFETIME_HOURS,
      ],
    );
    const sessionId = session.rows[0]?.id;
    if (sessionId === undefined) {
      throw new Error("The identity session was not created");
    }
    return sessionId;
  }

  private async sessionState(
    sessionId: string,
    device: VerifiedMainDeviceContext,
  ): Promise<IdentityState> {
    const result = await this.localDatabase.requirePool().query<SessionRow>(
      `${SESSION_SELECT}
       where session.id = $1
         and session.device_id = $2
         and session.device_session_hash = $3`,
      [sessionId, device.deviceId, device.deviceSessionHash],
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

  private async currentContext(
    client: PoolClient,
    expected: IdentityExecutionContext,
  ): Promise<IdentityExecutionContext> {
    const result = await client.query<SessionRow>(
      `${SESSION_SELECT}
       where session.id = $1
         and session.device_id = $2
         and session.device_session_hash = $3`,
      [expected.sessionId, expected.deviceId, expected.deviceSessionHash],
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
    const entitlement = await this.licensing.current({
      actorId: row.user_id,
      identitySessionId: row.session_id,
      mainDeviceId: row.device_id,
      now: new Date(),
      pharmacyId: row.pharmacy_id,
    });
    return {
      actorId: row.user_id,
      authRevision: BigInt(row.auth_revision),
      deviceId: expected.deviceId,
      deviceSessionHash: expected.deviceSessionHash,
      entitlement,
      permissions: await this.rolePermissions(client, row.role_id),
      pharmacyId: row.pharmacy_id,
      pharmacyIdentityRevision: BigInt(row.pharmacy_identity_revision),
      roleId: row.role_id,
      roleKey: row.role_key,
      roleRevision: BigInt(row.role_revision),
      sessionId: row.session_id,
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
      challenge.device_id !== expected.deviceId ||
      !challenge.device_session_hash.equals(expected.deviceSessionHash) ||
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
        deviceId: challenge.device_id,
        expiresAt: challenge.expires_at,
        pharmacyIdentityRevision: BigInt(challenge.pharmacy_identity_revision),
        requiredPermission,
        resolved: false,
        roleRevision: BigInt(challenge.role_revision),
        sessionId: challenge.identity_session_id,
        subjectRevision: BigInt(challenge.subject_revision),
      },
      context: fresh,
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
    if (action === "licensing.licence.install") {
      if (subjectId !== undefined && subjectId !== context.pharmacyId) {
        throw await this.contextDenial(context, 400, "body-invalid");
      }
      return {
        id: context.pharmacyId,
        revision: context.pharmacyIdentityRevision,
      };
    }
    if (action === "identity.user.create") {
      if (subjectId !== undefined && subjectId !== context.actorId) {
        throw await this.contextDenial(context, 400, "body-invalid");
      }
      return {
        id: context.actorId,
        revision: context.pharmacyIdentityRevision,
      };
    }
    if (subjectId === undefined) {
      throw await this.contextDenial(context, 400, "body-invalid");
    }
    if (action === "identity.user.update") {
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
              device_id, device_session_hash, action_name,
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
    const result = await client.query<UserRow>(
      `${USER_SELECT}
       where identity_user.pharmacy_id = $1 and identity_user.id = $2
       ${lock ? "for update of identity_user" : ""}`,
      [pharmacyId, userId],
    );
    const user = result.rows[0];
    if (user === undefined) {
      throw new Error("The identity user is missing");
    }
    return user;
  }

  private async selectRole(
    client: PoolClient,
    pharmacyId: string,
    roleId: string,
    lock = false,
  ): Promise<
    | {
        readonly id: string;
        readonly key: PharmacyRoleKey;
        readonly revision: string;
      }
    | undefined
  > {
    const result = await client.query<{
      id: string;
      key: PharmacyRoleKey;
      revision: string;
    }>(
      `select id, role_key as key, revision::text
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
      deviceId: context.deviceId,
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
    device: VerifiedMainDeviceContext,
    statusCode: number,
    code: IdentityDenialCode,
    row?: SessionRow,
  ): Promise<IdentityAccessDenied> {
    const requestId = await this.writeAudit(this.localDatabase.requirePool(), {
      action: "identity.session",
      deviceId: device.deviceId,
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
        deviceId: context.deviceId,
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
         idempotency_key, command_name, request_fingerprint, response_body
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        context.pharmacyId,
        context.actorId,
        context.sessionId,
        context.deviceId,
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
      deviceId: context.deviceId,
      identitySessionId: context.sessionId,
      outcome: "version-conflict",
      pharmacyId: context.pharmacyId,
      targetId,
    });
    await client.query("commit");
    throw this.denied(409, "version-conflict", requestId);
  }

  private async consumeAuthAttempt(
    deviceId: string,
    action: "login" | "step-up",
    subject: string,
  ): Promise<boolean> {
    const [deviceKey, subjectKey] = authRateKeys(action, subject);
    const result = await this.localDatabase.requirePool().query<{
      allowed: boolean;
    }>(
      `with clock as (
         select floor(extract(epoch from statement_timestamp()) / $5)::bigint
           as window_number
       ), pruned as (
         delete from identity_auth_rate_windows
         where device_id = $1 and action = $2
           and window_number < (select window_number from clock)
       ), counted as (
         insert into identity_auth_rate_windows (
           device_id, action, subject_key, window_number, request_count
         )
         select $1, $2, subject_key, (select window_number from clock), 1
         from unnest(array[$3::bytea, $4::bytea]) as keys(subject_key)
         on conflict (device_id, action, subject_key, window_number) do update
         set request_count = identity_auth_rate_windows.request_count + 1
         returning request_count
       )
       select bool_and(request_count <= $6) as allowed from counted`,
      [
        deviceId,
        action,
        deviceKey,
        subjectKey,
        AUTH_RATE_WINDOW_SECONDS,
        AUTH_RATE_LIMIT,
      ],
    );
    return result.rows[0]?.allowed === true;
  }

  private async clearAuthAttempts(
    queryable: Queryable,
    deviceId: string,
    action: "login" | "step-up",
    subject: string,
  ): Promise<void> {
    const [deviceKey, subjectKey] = authRateKeys(action, subject);
    await queryable.query(
      `delete from identity_auth_rate_windows
       where device_id = $1 and action = $2
         and subject_key = any(array[$3::bytea, $4::bytea])`,
      [deviceId, action, deviceKey, subjectKey],
    );
  }

  private async writeAudit(
    queryable: Queryable,
    input: {
      readonly action: string;
      readonly actorUserId?: string;
      readonly afterState?: Record<string, unknown>;
      readonly beforeState?: Record<string, unknown>;
      readonly deviceId: string;
      readonly identitySessionId?: string;
      readonly outcome: string;
      readonly pharmacyId?: string;
      readonly targetId?: string;
    },
  ): Promise<string> {
    const result = await queryable.query<{ id: string }>(
      `insert into identity_audit_records (
         pharmacy_id, actor_user_id, identity_session_id, device_id,
         action, outcome, target_id, before_state, after_state
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        input.pharmacyId ?? null,
        input.actorUserId ?? null,
        input.identitySessionId ?? null,
        input.deviceId,
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

const USER_SELECT = `select identity_user.id,
       identity_user.pharmacy_id,
       identity_user.username,
       identity_user.display_name,
       identity_user.status,
       identity_user.password_hash,
       identity_user.auth_revision::text,
       role.id as role_id,
       role.role_key,
       role.revision::text as role_revision
from identity_users identity_user
join pharmacy_roles role on role.id = identity_user.role_id`;

function userView(row: UserRow): UserView {
  return identityUserSchema.parse({
    displayName: row.display_name,
    id: row.id,
    revision: row.auth_revision,
    role: row.role_key,
    status: row.status,
    username: row.username,
  });
}

function userAuditState(
  row: UserRow,
): Record<string, "active" | "locked" | PharmacyRoleKey> {
  return { role: row.role_key, status: row.status };
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

function commandFingerprint(
  commandName: string,
  input: IdentityCommandInput,
): Buffer {
  const safeInput = Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => key !== "password")
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
