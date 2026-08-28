import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  type StepUpAction,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { hashMainDeviceSecret } from "../main-device/main-device-binding.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_PASSWORD = "correct horse battery staple";
const SECOND_OWNER_PASSWORD = "another correct horse battery staple";
const MANAGER_PASSWORD = "manager password stays only in this test";
const ACCOUNTANT_PASSWORD = "test password for accountant user";

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: Record<string, unknown> | undefined;
  readonly status: number;
}

describe.sequential("identity/access PostgreSQL seam", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOutput = "";
  let apiOrigin: string;
  let apiPort: number;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let managerId = "";
  let managerRoleId = "";
  let ownerId = "";
  let ownerPassword = "";
  let ownerUsername = "";
  let pharmacistId = "";
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
  }, 60_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("commits exactly one pharmacy and owner under a concurrent bootstrap race", async () => {
    const attempts = await Promise.all([
      request(credentials, "POST", "/identity/bootstrap", {
        owner: {
          displayName: "First Owner",
          password: OWNER_PASSWORD,
          username: "first.owner",
        },
        pharmacyName: "Breev Test Pharmacy A",
      }),
      request(credentials, "POST", "/identity/bootstrap", {
        owner: {
          displayName: "Second Owner",
          password: SECOND_OWNER_PASSWORD,
          username: "second.owner",
        },
        pharmacyName: "Breev Test Pharmacy B",
      }),
    ]);

    expect(
      attempts.map((attempt) => attempt.status).sort(),
      failureContext(attempts),
    ).toEqual([201, 409]);
    const success = attempts.find((attempt) => attempt.status === 201);
    expect(success?.body).toMatchObject({
      entitlement: {
        capabilities: expect.arrayContaining(["local-sales", "renewal"]),
        licence: null,
        status: "free-core",
      },
      state: "authenticated",
      user: { role: "owner" },
    });
    const user = success?.body?.user as
      { id: string; username: string } | undefined;
    expect(user).toBeDefined();
    ownerId = user?.id ?? "";
    ownerUsername = user?.username ?? "";
    ownerPassword =
      ownerUsername === "first.owner" ? OWNER_PASSWORD : SECOND_OWNER_PASSWORD;
    expect(success?.body?.allowedPermissions).toHaveLength(11);

    const roles = await request(credentials, "GET", "/identity/roles");
    expect(roles.status, failureContext([roles])).toBe(200);
    expect(roles.body?.roles as unknown[] | undefined).toHaveLength(8);
    const databaseState = await administrator.query<{
      pharmacy_count: string;
      role_count: string;
      user_count: string;
    }>(
      `select
         (select count(*)::text from pharmacies) as pharmacy_count,
         (select count(*)::text from pharmacy_roles) as role_count,
         (select count(*)::text from identity_users) as user_count`,
    );
    expect(databaseState.rows[0]).toEqual({
      pharmacy_count: "1",
      role_count: "8",
      user_count: "1",
    });

    const retry = await request(credentials, "POST", "/identity/bootstrap", {
      owner: {
        displayName: "Later Owner",
        password: "yet another correct horse battery staple",
        username: "later.owner",
      },
      pharmacyName: "Breev Test Pharmacy C",
    });
    expect(retry).toMatchObject({
      status: 409,
      body: { code: "bootstrap-already-complete", status: "denied" },
    });
  });

  it("denies unlicensed API use and makes licence administration recoverable", async () => {
    expect(
      await request(credentials, "POST", "/licensing/capability-proof", {
        capability: "one-way-cloud-sync",
      }),
    ).toMatchObject({
      status: 403,
      body: { code: "entitlement-denied", status: "denied" },
    });

    expect(
      await request(credentials, "POST", "/licensing/licences", {
        challengeId: createUuidV7(),
        encodedLicence: "{}",
        idempotencyKey: createUuidV7(),
      }),
    ).toMatchObject({
      status: 403,
      body: { code: "licence-invalid", status: "denied" },
    });

    const challengeId = await approvedChallenge(
      "licensing.licence.install",
      undefined,
      ownerPassword,
    );
    expect(
      await request(credentials, "POST", "/licensing/licences", {
        challengeId,
        encodedLicence: "{}",
        idempotencyKey: createUuidV7(),
      }),
    ).toMatchObject({
      status: 403,
      body: { code: "licence-invalid", status: "denied" },
    });
    const unusedChallenge = await administrator.query<{
      consumed_at: Date | null;
    }>("select consumed_at from step_up_challenges where id = $1", [
      challengeId,
    ]);
    expect(unusedChallenge.rows[0]?.consumed_at).toBeNull();

    expect(
      await request(credentials, "POST", "/licensing/licence-deactivations", {
        challengeId: createUuidV7(),
        idempotencyKey: createUuidV7(),
      }),
    ).toMatchObject({
      status: 404,
      body: { code: "identity-resource-not-found", status: "denied" },
    });
    const deactivationChallengeId = await approvedChallenge(
      "licensing.licence.deactivate",
      undefined,
      ownerPassword,
    );
    const deactivationBody = {
      challengeId: deactivationChallengeId,
      idempotencyKey: createUuidV7(),
    };
    const deactivated = await request(
      credentials,
      "POST",
      "/licensing/licence-deactivations",
      deactivationBody,
    );
    expect(deactivated).toMatchObject({
      status: 201,
      body: { licence: null, status: "free-core" },
    });
    expect(
      await request(
        credentials,
        "POST",
        "/licensing/licence-deactivations",
        deactivationBody,
      ),
    ).toEqual(deactivated);
    const deactivationFacts = await administrator.query<{
      commands: string;
      events: string;
    }>(
      `select
         (select count(*)::text from licensing_command_results
          where command_name = 'licence.deactivate') as commands,
         (select count(*)::text from licence_state_events
          where event_kind = 'deactivated') as events`,
    );
    expect(deactivationFacts.rows[0]).toEqual({ commands: "1", events: "1" });
    const state = await request(credentials, "GET", "/identity/state");
    expect(state.body?.entitlement).toMatchObject({
      licence: null,
      status: "free-core",
    });
    expect(state.body?.user).toMatchObject({ id: ownerId, status: "active" });
    expect(state.body?.settings).toMatchObject({ attendanceEnabled: false });
    expect(await request(credentials, "GET", "/identity/users")).toMatchObject({
      status: 200,
      body: {
        users: expect.arrayContaining([
          expect.objectContaining({ id: ownerId }),
        ]),
      },
    });
  });

  it("requires individual credentials and denies unauthenticated state changes", async () => {
    const wrongPassword = await request(
      credentials,
      "POST",
      "/identity/login",
      { password: "not the right password", username: ownerUsername },
    );
    expect(wrongPassword).toMatchObject({
      status: 401,
      body: { code: "invalid-credentials", status: "denied" },
    });
    const unknownUser = await request(credentials, "POST", "/identity/login", {
      password: "not the right password",
      username: "unknown.user",
    });
    expect(unknownUser).toMatchObject({
      status: 401,
      body: { code: "invalid-credentials", status: "denied" },
    });

    expect(
      await request(credentials, "POST", "/identity/logout", {}),
    ).toMatchObject({ status: 204 });
    expect(await request(credentials, "GET", "/identity/state")).toEqual({
      body: { state: "unauthenticated" },
      status: 200,
    });
    const unauthenticatedMutation = await request(
      credentials,
      "PATCH",
      "/pharmacy/settings",
      command({ attendanceEnabled: true, expectedRevision: "1" }),
    );
    expect(unauthenticatedMutation).toMatchObject({
      status: 401,
      body: { code: "session-missing", status: "denied" },
    });
    expect(
      await request(credentials, "POST", "/security/device-session-proof", {
        increment: 1,
      }),
    ).toMatchObject({
      status: 401,
      body: { code: "session-missing", status: "denied" },
    });
    await login(ownerUsername, ownerPassword);
    expect(
      await request(credentials, "POST", "/security/device-session-proof", {
        increment: 1,
      }),
    ).toMatchObject({ status: 201, body: { status: "committed" } });
  });

  it("rate-limits password guessing per verified device", async () => {
    const loginDevice = await registerDevice();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        await request(loginDevice, "POST", "/identity/login", {
          password: "wrong password",
          username: ownerUsername,
        }),
      ).toMatchObject({ status: 401, body: { code: "invalid-credentials" } });
    }
    expect(
      await request(loginDevice, "POST", "/identity/login", {
        password: "wrong password",
        username: ownerUsername,
      }),
    ).toMatchObject({ status: 429, body: { code: "rate-limit-exceeded" } });

    const stepUpDevice = await registerDevice();
    expect(
      await request(stepUpDevice, "POST", "/identity/login", {
        password: ownerPassword,
        username: ownerUsername,
      }),
    ).toMatchObject({ status: 200 });
    const challenge = await request(
      stepUpDevice,
      "POST",
      "/identity/step-up-challenges",
      command({ action: "identity.user.create" }),
    );
    const challengeId = String(challenge.body?.id ?? "");
    expect(challenge.status).toBe(201);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        await request(
          stepUpDevice,
          "POST",
          `/identity/step-up-challenges/${challengeId}/approve`,
          command({ password: "wrong password" }),
        ),
      ).toMatchObject({
        status: 401,
        body: { code: "step-up-wrong-password" },
      });
    }
    expect(
      await request(
        stepUpDevice,
        "POST",
        `/identity/step-up-challenges/${challengeId}/approve`,
        command({ password: ownerPassword }),
      ),
    ).toMatchObject({ status: 429, body: { code: "rate-limit-exceeded" } });
    expect(
      await request(stepUpDevice, "POST", "/identity/logout", {}),
    ).toMatchObject({ status: 204 });
  });

  it("binds Step-Up to permission, password, lifetime, subject, and one use", async () => {
    const pending = await createChallenge("identity.user.create");
    const unapproved = await createUser(pending, "pending.user");
    expect(unapproved).toMatchObject({
      status: 409,
      body: { code: "step-up-not-approved" },
    });
    const wrongPassword = await approveChallenge(pending, "incorrect password");
    expect(wrongPassword).toMatchObject({
      status: 401,
      body: { code: "step-up-wrong-password" },
    });
    expect(await approveChallenge(pending, ownerPassword)).toMatchObject({
      status: 200,
      body: { status: "approved" },
    });

    const expired = await createChallenge("identity.user.create");
    await administrator.query(
      `update step_up_challenges
       set expires_at = created_at + interval '1 millisecond'
       where id = $1`,
      [expired],
    );
    expect(await approveChallenge(expired, ownerPassword)).toMatchObject({
      status: 409,
      body: { code: "step-up-expired" },
    });

    const managerChallenge = await approvedChallenge(
      "identity.user.create",
      undefined,
      ownerPassword,
    );
    const manager = await createUser(
      managerChallenge,
      "pharmacy.manager",
      "Pharmacy Manager",
      "manager",
      MANAGER_PASSWORD,
    );
    expect(manager.status, failureContext([manager])).toBe(201);
    managerId = String(manager.body?.id ?? "");
    expect(manager.body).not.toHaveProperty("password");
    expect(manager.body).not.toHaveProperty("passwordHash");
    expect(await createUser(managerChallenge, "challenge.reuse")).toMatchObject(
      {
        status: 409,
        body: { code: "step-up-reused" },
      },
    );

    const roles = await request(credentials, "GET", "/identity/roles");
    const roleRows = roles.body?.roles as
      { id: string; key: string }[] | undefined;
    managerRoleId = roleRows?.find((role) => role.key === "manager")?.id ?? "";
    expect(managerRoleId).not.toBe("");

    const stale = await createChallenge(
      "identity.role.permissions.update",
      managerRoleId,
    );
    const identityChange = await approvedChallenge(
      "identity.user.create",
      undefined,
      ownerPassword,
    );
    expect(await createUser(identityChange, "revision.changer")).toMatchObject({
      status: 201,
    });
    expect(await approveChallenge(stale, ownerPassword)).toMatchObject({
      status: 403,
      body: { code: "step-up-stale" },
    });

    const ownerUpdate = await approvedChallenge(
      "identity.user.update",
      ownerId,
      ownerPassword,
    );
    expect(
      await request(credentials, "PATCH", `/identity/users/${ownerId}`, {
        challengeId: ownerUpdate,
        expectedRevision: await currentUserRevision(ownerId),
        idempotencyKey: createUuidV7(),
        status: "locked",
      }),
    ).toMatchObject({
      status: 409,
      body: { code: "last-owner-required" },
    });

    for (const [role, username] of [
      ["sales_employee", "role.sales"],
      ["purchasing_employee", "role.purchasing"],
      ["inventory_employee", "role.inventory"],
      ["accountant", "role.accountant"],
      ["support", "role.support"],
    ] as const) {
      const challenge = await approvedChallenge(
        "identity.user.create",
        undefined,
        ownerPassword,
      );
      expect(
        await createUser(
          challenge,
          username,
          `User ${role}`,
          role,
          `test password for ${role} user`,
        ),
      ).toMatchObject({ status: 201, body: { role } });
    }
    const representedRoles = await administrator.query<{
      role_key: string;
      user_count: string;
    }>(
      `select role.role_key::text, count(identity_user.id)::text as user_count
       from pharmacy_roles role
       left join identity_users identity_user on identity_user.role_id = role.id
       group by role.id
       order by role.role_key`,
    );
    expect(representedRoles.rows).toHaveLength(8);
    expect(
      representedRoles.rows.every(({ user_count }) => Number(user_count) > 0),
    ).toBe(true);
  });

  it("replays committed commands and rejects stale versions or changed reuse", async () => {
    await login(ownerUsername, ownerPassword);
    const challenge = await createChallenge("identity.user.create");
    const approvalKey = createUuidV7();
    const approval = await approveChallenge(
      challenge,
      ownerPassword,
      approvalKey,
    );
    expect(approval).toMatchObject({
      status: 200,
      body: { status: "approved" },
    });
    expect(
      await approveChallenge(challenge, ownerPassword, approvalKey),
    ).toEqual(approval);

    const createKey = createUuidV7();
    const createBody = {
      challengeId: challenge,
      displayName: "Idempotent User",
      idempotencyKey: createKey,
      password: "idempotent user password stays private",
      role: "support",
      username: "idempotent.user",
    };
    const created = await request(
      credentials,
      "POST",
      "/identity/users",
      createBody,
    );
    expect(created.status).toBe(201);
    expect(
      await request(credentials, "POST", "/identity/users", createBody),
    ).toEqual(created);
    expect(
      await request(credentials, "POST", "/identity/users", {
        ...createBody,
        username: "changed.idempotent.user",
      }),
    ).toMatchObject({
      status: 409,
      body: { code: "idempotency-conflict" },
    });
    const userCount = await administrator.query<{ count: string }>(
      "select count(*)::text as count from identity_users where username_key = 'idempotent.user'",
    );
    expect(userCount.rows[0]?.count).toBe("1");

    const expectedRevision = await currentSettingsRevision();
    const settingsKey = createUuidV7();
    const settingsBody = {
      attendanceEnabled: false,
      expectedRevision,
      idempotencyKey: settingsKey,
    };
    const updated = await request(
      credentials,
      "PATCH",
      "/pharmacy/settings",
      settingsBody,
    );
    expect(updated.status).toBe(200);
    expect(
      await request(credentials, "PATCH", "/pharmacy/settings", settingsBody),
    ).toEqual(updated);
    expect(
      await request(
        credentials,
        "PATCH",
        "/pharmacy/settings",
        command({ attendanceEnabled: true, expectedRevision }),
      ),
    ).toMatchObject({ status: 409, body: { code: "version-conflict" } });

    // Settings is a posting command now: its idempotency lives in the posting
    // store, scoped to the pharmacy and the command kind rather than to the
    // actor, and the identity-scoped store it used to share with the other
    // identity commands no longer sees it at all.
    const settingsStores = await administrator.query<{
      identity: string;
      posting: string;
    }>(
      `select
         (select count(*)::text from identity_command_results
          where command_name = 'pharmacy.settings.update') as identity,
         (select count(*)::text from posting_command_results
          where idempotency_key = $1 and response_status = 200) as posting`,
      [settingsKey],
    );
    expect(settingsStores.rows[0]).toEqual({ identity: "0", posting: "1" });
  });

  it("enforces user, role, and permission constraints in PostgreSQL", async () => {
    await expect(
      administrator.query(
        "insert into permission_definitions (name) values ('Invalid Permission')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      administrator.query(
        `insert into pharmacy_roles (pharmacy_id, role_key)
         select id, 'owner' from pharmacies`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      administrator.query(
        `insert into identity_users (
           pharmacy_id, username, username_key, display_name, role_id,
           password_hash, password_algorithm, password_version,
           password_memory_kib, password_iterations, password_parallelism
         )
         select pharmacy_id, 'invalid.algorithm', 'invalid.algorithm',
                'Invalid Algorithm', role_id, password_hash, 'bcrypt',
                password_version, password_memory_kib, password_iterations,
                password_parallelism
         from identity_users limit 1`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      administrator.query(
        `insert into identity_users (
           pharmacy_id, username, username_key, display_name, role_id,
           password_hash, password_algorithm, password_version,
           password_memory_kib, password_iterations, password_parallelism
         )
         select $1, 'cross.context', 'cross.context', 'Cross Context', role_id,
                password_hash, password_algorithm, password_version,
                password_memory_kib, password_iterations, password_parallelism
         from identity_users limit 1`,
        [createUuidV7()],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      administrator.query(
        `insert into role_permission_grants (
           pharmacy_id, role_id, permission_name, granted_by
         )
         select $1, role.id, 'attendance.record', identity_user.id
         from pharmacy_roles role
         cross join lateral (select id from identity_users limit 1) identity_user
         where role.role_key = 'support'
         limit 1`,
        [createUuidV7()],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("denies every protected API operation for a role without explicit grants", async () => {
    const ownerChallenge = await createChallenge("identity.user.create");
    await login("pharmacy.manager", MANAGER_PASSWORD);

    expect(await approveChallenge(ownerChallenge, ownerPassword)).toMatchObject(
      {
        status: 403,
        body: { code: "step-up-context-mismatch" },
      },
    );

    const arbitraryChallenge = createUuidV7();
    const deniedRequests = await Promise.all([
      request(credentials, "GET", "/identity/roles"),
      request(credentials, "GET", "/identity/users"),
      request(credentials, "POST", "/identity/step-up-challenges", {
        action: "identity.user.create",
        idempotencyKey: createUuidV7(),
      }),
      request(credentials, "POST", "/identity/users", {
        challengeId: arbitraryChallenge,
        displayName: "Denied User",
        idempotencyKey: createUuidV7(),
        password: "denied password is never stored",
        role: "pharmacist",
        username: "denied.user",
      }),
      request(credentials, "PATCH", `/identity/users/${managerId}`, {
        challengeId: arbitraryChallenge,
        expectedRevision: "1",
        idempotencyKey: createUuidV7(),
        status: "locked",
      }),
      request(
        credentials,
        "PUT",
        `/identity/roles/${managerRoleId}/permissions`,
        command({
          challengeId: arbitraryChallenge,
          expectedRevision: "1",
          permissions: [],
        }),
      ),
      request(credentials, "PATCH", "/pharmacy/settings", {
        attendanceEnabled: true,
        expectedRevision: "1",
        idempotencyKey: createUuidV7(),
      }),
      request(credentials, "POST", "/attendance/events", {
        expectedVersion: "1",
        idempotencyKey: createUuidV7(),
        kind: "check-in",
      }),
      request(credentials, "POST", "/licensing/capability-proof", {
        capability: "one-way-cloud-sync",
      }),
      request(credentials, "POST", "/licensing/licences", {
        challengeId: arbitraryChallenge,
        encodedLicence: "{}",
        idempotencyKey: createUuidV7(),
      }),
      request(credentials, "POST", "/licensing/licence-deactivations", {
        challengeId: arbitraryChallenge,
        idempotencyKey: createUuidV7(),
      }),
    ]);
    expect(
      deniedRequests.map(({ body, status }) => ({
        code: body?.code,
        status,
      })),
      failureContext(deniedRequests),
    ).toEqual([
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "step-up-missing-permission", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
      { code: "permission-denied", status: 403 },
    ]);

    const callerClaims = await request(
      credentials,
      "PATCH",
      "/pharmacy/settings",
      {
        actorId: ownerId,
        attendanceEnabled: true,
        expectedRevision: "1",
        idempotencyKey: createUuidV7(),
        permissions: ["pharmacy.settings.manage"],
        role: "owner",
      },
    );
    expect(callerClaims).toMatchObject({
      status: 400,
      body: { code: "body-invalid" },
    });
    const settings = await administrator.query<{
      attendance_enabled: boolean;
    }>("select attendance_enabled from pharmacy_settings");
    expect(settings.rows[0]?.attendance_enabled).toBe(false);
  });

  it("derives every named permission from explicit PostgreSQL grants", async () => {
    await login(ownerUsername, ownerPassword);
    const roles = await request(credentials, "GET", "/identity/roles");
    const roleRows = roles.body?.roles as
      { id: string; key: string; revision: string }[] | undefined;
    const accountantRoleId =
      roleRows?.find((role) => role.key === "accountant")?.id ?? "";
    const permissionNames = roles.body?.permissions as string[];
    expect(permissionNames).toHaveLength(11);

    for (const permission of permissionNames) {
      const challenge = await approvedChallenge(
        "identity.role.permissions.update",
        accountantRoleId,
        ownerPassword,
      );
      const update = await request(
        credentials,
        "PUT",
        `/identity/roles/${accountantRoleId}/permissions`,
        command({
          challengeId: challenge,
          expectedRevision: await currentRoleRevision(accountantRoleId),
          permissions: [permission],
        }),
      );
      expect(update).toMatchObject({
        status: 200,
        body: { grants: [permission] },
      });
      await login("role.accountant", ACCOUNTANT_PASSWORD);
      expect(
        await request(credentials, "GET", "/identity/state"),
      ).toMatchObject({
        status: 200,
        body: { allowedPermissions: [permission] },
      });
      await login(ownerUsername, ownerPassword);
    }
  });

  it("applies explicit role grants and typed attendance settings end to end", async () => {
    await login(ownerUsername, ownerPassword);
    const grants = [
      "attendance.record",
      "identity.roles.manage",
      "identity.users.manage",
      "pharmacy.settings.manage",
    ];
    const grantChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      managerRoleId,
      ownerPassword,
    );
    const updatedRole = await request(
      credentials,
      "PUT",
      `/identity/roles/${managerRoleId}/permissions`,
      command({
        challengeId: grantChallenge,
        expectedRevision: await currentRoleRevision(managerRoleId),
        permissions: grants,
      }),
    );
    expect(updatedRole).toMatchObject({
      status: 200,
      body: { grants, key: "manager" },
    });

    await login("pharmacy.manager", MANAGER_PASSWORD);
    expect(await request(credentials, "GET", "/identity/roles")).toMatchObject({
      status: 200,
    });
    expect(await request(credentials, "GET", "/identity/users")).toMatchObject({
      status: 200,
    });
    expect(await request(credentials, "GET", "/identity/state")).toMatchObject({
      status: 200,
      body: { attendance: null, settings: { attendanceEnabled: false } },
    });
    expect(
      await request(credentials, "POST", "/attendance/events", {
        expectedVersion: await currentAttendanceVersion(),
        idempotencyKey: createUuidV7(),
        kind: "check-in",
      }),
    ).toMatchObject({
      status: 403,
      body: { code: "attendance-disabled" },
    });

    expect(
      await request(credentials, "PATCH", "/pharmacy/settings", {
        attendanceEnabled: true,
        expectedRevision: await currentSettingsRevision(),
        idempotencyKey: createUuidV7(),
      }),
    ).toMatchObject({
      status: 200,
      body: { attendanceEnabled: true },
    });
    expect(await request(credentials, "GET", "/identity/state")).toMatchObject({
      status: 200,
      body: { attendance: { status: "checked-out" } },
    });
    expect(
      await request(credentials, "POST", "/attendance/events", {
        expectedVersion: await currentAttendanceVersion(),
        idempotencyKey: createUuidV7(),
        kind: "check-in",
      }),
    ).toMatchObject({
      status: 201,
      body: { kind: "check-in", status: "checked-in" },
    });
    expect(
      await request(credentials, "POST", "/attendance/events", {
        expectedVersion: await currentAttendanceVersion(),
        idempotencyKey: createUuidV7(),
        kind: "check-in",
      }),
    ).toMatchObject({
      status: 409,
      body: { code: "attendance-already-checked-in" },
    });
    expect(
      await request(credentials, "POST", "/attendance/events", {
        expectedVersion: await currentAttendanceVersion(),
        idempotencyKey: createUuidV7(),
        kind: "check-out",
      }),
    ).toMatchObject({
      status: 201,
      body: { kind: "check-out", status: "checked-out" },
    });

    const roles = await request(credentials, "GET", "/identity/roles");
    const pharmacistRoleId = (
      roles.body?.roles as { id: string; key: string }[]
    ).find((role) => role.key === "pharmacist")?.id;
    expect(pharmacistRoleId).toBeDefined();
    const roleChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      pharmacistRoleId,
      MANAGER_PASSWORD,
    );
    expect(
      await request(
        credentials,
        "PUT",
        `/identity/roles/${pharmacistRoleId}/permissions`,
        command({
          challengeId: roleChallenge,
          expectedRevision: await currentRoleRevision(pharmacistRoleId ?? ""),
          permissions: ["sales.return.post"],
        }),
      ),
    ).toMatchObject({
      status: 200,
      body: { grants: ["sales.return.post"], key: "pharmacist" },
    });

    const userChallenge = await approvedChallenge(
      "identity.user.create",
      undefined,
      MANAGER_PASSWORD,
    );
    const pharmacist = await createUser(
      userChallenge,
      "locked.pharmacist",
      "Locked Pharmacist",
      "pharmacist",
      "pharmacist password stays in this test",
    );
    expect(pharmacist.status).toBe(201);
    pharmacistId = String(pharmacist.body?.id ?? "");
    const lockChallenge = await approvedChallenge(
      "identity.user.update",
      pharmacistId,
      MANAGER_PASSWORD,
    );
    expect(
      await request(credentials, "PATCH", `/identity/users/${pharmacistId}`, {
        challengeId: lockChallenge,
        expectedRevision: await currentUserRevision(pharmacistId),
        idempotencyKey: createUuidV7(),
        status: "locked",
      }),
    ).toMatchObject({
      status: 200,
      body: { status: "locked" },
    });
    expect(
      await request(credentials, "POST", "/identity/login", {
        password: "pharmacist password stays in this test",
        username: "locked.pharmacist",
      }),
    ).toMatchObject({
      status: 401,
      body: { code: "invalid-credentials" },
    });

    expect(
      await request(credentials, "PATCH", "/pharmacy/settings", {
        attendanceEnabled: false,
        expectedRevision: await currentSettingsRevision(),
        idempotencyKey: createUuidV7(),
      }),
    ).toMatchObject({ status: 200 });
    expect(await request(credentials, "GET", "/identity/state")).toMatchObject({
      body: { attendance: null, settings: { attendanceEnabled: false } },
    });
  });

  it("survives restart and rejects expired, revoked, and wrong-device sessions", async () => {
    await stopProcess(api);
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    expect(await request(credentials, "GET", "/identity/state")).toMatchObject({
      status: 200,
      body: { state: "authenticated", user: { id: managerId } },
    });

    const concurrentLogins = await Promise.all([
      request(credentials, "POST", "/identity/login", {
        password: MANAGER_PASSWORD,
        username: "pharmacy.manager",
      }),
      request(credentials, "POST", "/identity/login", {
        password: MANAGER_PASSWORD,
        username: "pharmacy.manager",
      }),
    ]);
    expect(
      concurrentLogins.some(({ status }) => status === 200),
      failureContext(concurrentLogins),
    ).toBe(true);
    expect(
      concurrentLogins.every(({ status }) => status === 200 || status === 401),
      failureContext(concurrentLogins),
    ).toBe(true);
    const activeSessions = await administrator.query<{ count: string }>(
      `select count(*)::text as count from identity_sessions
       where revoked_at is null`,
    );
    expect(activeSessions.rows[0]?.count).toBe("1");

    await administrator.query(
      `update identity_sessions
       set expires_at = created_at + interval '1 millisecond'
       where revoked_at is null`,
    );
    expect(await request(credentials, "GET", "/identity/state")).toEqual({
      body: { state: "session-expired" },
      status: 200,
    });
    expect(await request(credentials, "GET", "/identity/users")).toMatchObject({
      status: 401,
      body: { code: "session-expired" },
    });
    await login("pharmacy.manager", MANAGER_PASSWORD);
    await administrator.query(
      `update identity_sessions
       set revoked_at = statement_timestamp(), revocation_reason = 'administrative'
       where revoked_at is null`,
    );
    expect(await request(credentials, "GET", "/identity/state")).toEqual({
      body: { state: "session-revoked" },
      status: 200,
    });
    await login("pharmacy.manager", MANAGER_PASSWORD);

    const secondDevice = createMainDeviceCredentials();
    await administrator.query(
      "insert into main_devices (id, credential_hash) values ($1, $2)",
      [secondDevice.deviceId, hashMainDeviceSecret(secondDevice.deviceSecret)],
    );
    await administrator.query(
      `insert into main_device_sessions (device_id, token_hash)
       values ($1, $2)`,
      [secondDevice.deviceId, hashMainDeviceSecret(secondDevice.sessionToken)],
    );
    expect(await request(secondDevice, "GET", "/identity/state")).toEqual({
      body: { state: "unauthenticated" },
      status: 200,
    });
    expect(
      await request(secondDevice, "PATCH", "/pharmacy/settings", {
        attendanceEnabled: true,
        expectedRevision: "1",
        idempotencyKey: createUuidV7(),
      }),
    ).toMatchObject({
      status: 401,
      body: { code: "session-missing" },
    });
    expect(
      await request(
        { ...secondDevice, sessionToken: credentials.sessionToken },
        "GET",
        "/identity/state",
      ),
    ).toMatchObject({
      status: 401,
      body: { code: "session-binding-invalid" },
    });
  });

  it("keeps password material out of responses, logs, and immutable audits", async () => {
    const stored = await administrator.query<{
      password_algorithm: string;
      password_hash: Buffer;
      password_iterations: number;
      password_memory_kib: number;
      password_parallelism: number;
      password_version: number;
    }>(
      `select password_algorithm, password_hash, password_iterations,
              password_memory_kib, password_parallelism, password_version
       from identity_users where id = $1`,
      [ownerId],
    );
    expect(stored.rows[0]).toMatchObject({
      password_algorithm: "argon2id",
      password_iterations: 2,
      password_memory_kib: 19_456,
      password_parallelism: 1,
      password_version: 19,
    });
    expect(stored.rows[0]?.password_hash.toString("utf8")).toMatch(
      /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/u,
    );

    const audits = await administrator.query<{
      id: string;
      state: string;
    }>(
      `select id, concat_ws(' ', before_state::text, after_state::text) as state
       from identity_audit_records`,
    );
    expect(audits.rowCount).toBeGreaterThan(20);
    for (const audit of audits.rows) {
      expect(audit.state).not.toContain(OWNER_PASSWORD);
      expect(audit.state).not.toContain(SECOND_OWNER_PASSWORD);
      expect(audit.state).not.toContain(MANAGER_PASSWORD);
      expect(audit.state.toLowerCase()).not.toContain("password_hash");
    }
    expect(apiOutput).not.toContain(OWNER_PASSWORD);
    expect(apiOutput).not.toContain(SECOND_OWNER_PASSWORD);
    expect(apiOutput).not.toContain(MANAGER_PASSWORD);

    const auditId = audits.rows[0]?.id;
    expect(auditId).toBeDefined();
    await expect(
      administrator.query(
        "update identity_audit_records set outcome = 'changed' where id = $1",
        [auditId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query("delete from identity_audit_records where id = $1", [
        auditId,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    const attendanceId = await administrator.query<{ id: string }>(
      "select id from attendance_events limit 1",
    );
    await expect(
      administrator.query("delete from attendance_events where id = $1", [
        attendanceId.rows[0]?.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    const commandResult = await administrator.query<{
      id: string;
      response_body: string;
    }>(
      `select id, response_body::text
       from identity_command_results order by created_at limit 1`,
    );
    expect(commandResult.rows[0]?.response_body.toLowerCase()).not.toContain(
      "password",
    );
    await expect(
      administrator.query(
        "update identity_command_results set command_name = 'identity.changed' where id = $1",
        [commandResult.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        "delete from identity_command_results where id = $1",
        [commandResult.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  function startApi(): ChildProcessWithoutNullStreams {
    const child = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../dist/main.js")],
      {
        env: {
          ...process.env,
          API_HOST: "127.0.0.1",
          API_PORT: String(apiPort),
          BREEV_MAIN_DEVICE_ID: credentials.deviceId,
          BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
          BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
          DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
          DATABASE_URL: databaseRoles.applicationUrl,
          HTTPS_PROXY: "http://127.0.0.1:1",
          HTTP_PROXY: "http://127.0.0.1:1",
        },
      },
    );
    child.stdout.on("data", collectOutput);
    child.stderr.on("data", collectOutput);
    return child;
  }

  function collectOutput(chunk: Buffer): void {
    apiOutput += chunk.toString();
  }

  async function registerDevice(): Promise<MainDeviceCredentials> {
    const device = createMainDeviceCredentials();
    await administrator.query(
      "insert into main_devices (id, credential_hash) values ($1, $2)",
      [device.deviceId, hashMainDeviceSecret(device.deviceSecret)],
    );
    await administrator.query(
      `insert into main_device_sessions (device_id, token_hash)
       values ($1, $2)`,
      [device.deviceId, hashMainDeviceSecret(device.sessionToken)],
    );
    return device;
  }

  async function login(username: string, password: string): Promise<void> {
    const response = await request(credentials, "POST", "/identity/login", {
      password,
      username,
    });
    expect(response.status, failureContext([response])).toBe(200);
  }

  async function createChallenge(
    action: StepUpAction,
    subjectId?: string,
  ): Promise<string> {
    const response = await request(
      credentials,
      "POST",
      "/identity/step-up-challenges",
      command({ action, ...(subjectId === undefined ? {} : { subjectId }) }),
    );
    expect(response.status, failureContext([response])).toBe(201);
    return String(response.body?.id ?? "");
  }

  async function approveChallenge(
    challengeId: string,
    password: string,
    idempotencyKey = createUuidV7(),
  ): Promise<ApiResponse> {
    return await request(
      credentials,
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey, password },
    );
  }

  async function approvedChallenge(
    action: StepUpAction,
    subjectId: string | undefined,
    password: string,
  ): Promise<string> {
    const challengeId = await createChallenge(action, subjectId);
    const approval = await approveChallenge(challengeId, password);
    expect(approval, failureContext([approval])).toMatchObject({
      status: 200,
      body: { status: "approved" },
    });
    return challengeId;
  }

  async function createUser(
    challengeId: string,
    username: string,
    displayName = "Test User",
    role = "pharmacist",
    password = "test user password stays in this test",
  ): Promise<ApiResponse> {
    return await request(credentials, "POST", "/identity/users", {
      challengeId,
      displayName,
      idempotencyKey: createUuidV7(),
      password,
      role,
      username,
    });
  }

  async function currentSettingsRevision(): Promise<string> {
    const state = await request(credentials, "GET", "/identity/state");
    return String(
      (state.body?.settings as { revision?: string } | undefined)?.revision ??
        "",
    );
  }

  async function currentAttendanceVersion(): Promise<string> {
    const state = await request(credentials, "GET", "/identity/state");
    return String(
      (state.body?.attendance as { version?: string } | null | undefined)
        ?.version ?? "1",
    );
  }

  async function currentRoleRevision(roleId: string): Promise<string> {
    const roles = await request(credentials, "GET", "/identity/roles");
    const role = (roles.body?.roles as { id: string; revision: string }[]).find(
      (candidate) => candidate.id === roleId,
    );
    return role?.revision ?? "";
  }

  async function currentUserRevision(userId: string): Promise<string> {
    const users = await request(credentials, "GET", "/identity/users");
    const user = (users.body?.users as { id: string; revision: string }[]).find(
      (candidate) => candidate.id === userId,
    );
    return user?.revision ?? "";
  }

  function command<T extends Record<string, unknown>>(
    body: T,
  ): T & { idempotencyKey: string } {
    return { ...body, idempotencyKey: createUuidV7() };
  }

  function failureContext(responses: readonly ApiResponse[]): string {
    return `${apiOutput}\n${JSON.stringify(responses)}`;
  }

  async function request(
    binding: MainDeviceCredentials,
    method: "GET" | "PATCH" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: requestHeaders(binding, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body:
        text.length === 0
          ? undefined
          : (JSON.parse(text) as Record<string, unknown>),
      status: response.status,
    };
  }
});

function requestHeaders(
  credentials: MainDeviceCredentials,
  json: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Breev-Device ${credentials.deviceSecret}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
    Origin: "breev://app",
  };
}

function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: createUuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function waitForHealth(
  origin: string,
  diagnostics: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).status === 200) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Local API did not start at ${origin}\n${diagnostics()}`);
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
