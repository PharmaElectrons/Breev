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
import { createHash, randomBytes } from "node:crypto";
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
const SELF_CHANGE_OLD_PASSWORD = "idempotent user password stays private";
const SELF_CHANGE_NEW_PASSWORD = "rotated self password stays private";
const ADMIN_RESET_PASSWORD = "administrator reset password stays private";

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
      user: { role: { key: "owner", kind: "built-in" } },
    });
    const user = success?.body?.user as
      { id: string; username: string } | undefined;
    expect(user).toBeDefined();
    ownerId = user?.id ?? "";
    ownerUsername = user?.username ?? "";
    ownerPassword =
      ownerUsername === "first.owner" ? OWNER_PASSWORD : SECOND_OWNER_PASSWORD;
    // Bootstrap grants the owner only the implemented permissions — the seven
    // that back a live operation today — never the five with no operation
    // behind them yet (draft.price.override, pricing.below_cost,
    // sales.invoice.reverse, sales.return.post, sync.conflict.resolve).
    expect(success?.body?.allowedPermissions).toHaveLength(7);

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
      ).toMatchObject({
        status: 201,
        body: { role: { key: role, kind: "built-in" } },
      });
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
      password: SELF_CHANGE_OLD_PASSWORD,
      roleId: await roleIdFor("support"),
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

  it("keeps the owner administration floor while non-owner grants remain configurable", async () => {
    const adminDevice = await registerDevice();
    await login(ownerUsername, ownerPassword, adminDevice);
    const roles = await request(adminDevice, "GET", "/identity/roles");
    const roleRows = roles.body?.roles as Array<{
      grants: string[];
      id: string;
      key: string;
      revision: string;
    }>;
    const permissions = roles.body?.permissions as string[];
    const ownerRole = roleRows.find(({ key }) => key === "owner");
    const supportRole = roleRows.find(({ key }) => key === "support");
    expect(ownerRole).toBeDefined();
    expect(supportRole).toBeDefined();

    const ownerChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      ownerRole?.id,
      ownerPassword,
      adminDevice,
    );
    const requestedWithoutFloor = permissions.filter(
      (permission) =>
        permission !== "identity.roles.manage" &&
        permission !== "identity.users.manage",
    );
    expect(
      await request(
        adminDevice,
        "PUT",
        `/identity/roles/${ownerRole?.id}/permissions`,
        command({
          challengeId: ownerChallenge,
          expectedRevision: ownerRole?.revision,
          permissions: requestedWithoutFloor,
        }),
      ),
    ).toMatchObject({
      status: 409,
      body: { code: "owner-permission-floor-required" },
    });
    const ownerFloorDenial = await administrator.query<{
      count: string;
    }>(
      `select count(*)::text as count
       from identity_audit_records
       where action = 'identity.role.permissions.update'
         and outcome = 'owner-permission-floor-required'
         and target_id = $1`,
      [ownerRole?.id],
    );
    expect(ownerFloorDenial.rows[0]?.count).toBe("1");

    await expect(
      administrator.query(
        `delete from role_permission_grants grant_row
         using pharmacy_roles role
         where grant_row.role_id = role.id
           and role.role_key = 'owner'
           and grant_row.permission_name = 'identity.users.manage'`,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "owner_role_permission_floor",
    });
    const storedFloor = await administrator.query<{ permission_name: string }>(
      `select grant_row.permission_name
       from role_permission_grants grant_row
       join pharmacy_roles role on role.id = grant_row.role_id
       where role.role_key = 'owner'
         and grant_row.permission_name = any($1::text[])
       order by grant_row.permission_name`,
      [["identity.roles.manage", "identity.users.manage"]],
    );
    expect(
      storedFloor.rows.map(({ permission_name }) => permission_name),
    ).toEqual(["identity.roles.manage", "identity.users.manage"]);

    const grantChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      supportRole?.id,
      ownerPassword,
      adminDevice,
    );
    const granted = await request(
      adminDevice,
      "PUT",
      `/identity/roles/${supportRole?.id}/permissions`,
      command({
        challengeId: grantChallenge,
        expectedRevision: supportRole?.revision,
        permissions: ["attendance.record"],
      }),
    );
    expect(granted).toMatchObject({
      status: 200,
      body: { grants: ["attendance.record"], key: "support" },
    });
    const clearChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      supportRole?.id,
      ownerPassword,
      adminDevice,
    );
    expect(
      await request(
        adminDevice,
        "PUT",
        `/identity/roles/${supportRole?.id}/permissions`,
        command({
          challengeId: clearChallenge,
          expectedRevision: String(granted.body?.revision ?? ""),
          permissions: [],
        }),
      ),
    ).toMatchObject({ status: 200, body: { grants: [], key: "support" } });
  });

  it("changes a user's own password, replaces the acting session, and replays safely", async () => {
    const subject = await administrator.query<{
      auth_revision: string;
      id: string;
    }>(
      `select id, auth_revision::text
       from identity_users where username_key = 'idempotent.user'`,
    );
    const user = subject.rows[0];
    expect(user).toBeDefined();
    const actingDevice = await registerDevice();
    const otherDevice = await registerDevice();
    await login("idempotent.user", SELF_CHANGE_OLD_PASSWORD, actingDevice);
    await login("idempotent.user", SELF_CHANGE_OLD_PASSWORD, otherDevice);
    const beforeState = await request(actingDevice, "GET", "/identity/state");
    const previousSessionId = String(
      (beforeState.body?.session as { id?: string } | undefined)?.id ?? "",
    );
    const idempotencyKey = createUuidV7();
    const changeBody = {
      currentPassword: SELF_CHANGE_OLD_PASSWORD,
      expectedRevision: user?.auth_revision ?? "",
      idempotencyKey,
      newPassword: SELF_CHANGE_NEW_PASSWORD,
    };
    const changed = await request(
      actingDevice,
      "POST",
      "/identity/password-changes",
      changeBody,
    );
    expect(changed).toMatchObject({
      status: 200,
      body: { id: user?.id },
    });
    expect(changed.body).not.toHaveProperty("currentPassword");
    expect(changed.body).not.toHaveProperty("newPassword");
    expect(
      await request(
        actingDevice,
        "POST",
        "/identity/password-changes",
        changeBody,
      ),
    ).toEqual(changed);
    expect(
      await request(actingDevice, "POST", "/identity/password-changes", {
        ...changeBody,
        expectedRevision: String(BigInt(changeBody.expectedRevision) + 1n),
      }),
    ).toMatchObject({
      status: 409,
      body: { code: "idempotency-conflict" },
    });

    const afterState = await request(actingDevice, "GET", "/identity/state");
    expect(afterState).toMatchObject({
      status: 200,
      body: { state: "authenticated", user: { id: user?.id } },
    });
    expect(
      (afterState.body?.session as { id?: string } | undefined)?.id,
    ).not.toBe(previousSessionId);
    expect(await request(otherDevice, "GET", "/identity/state")).toEqual({
      body: { state: "session-revoked" },
      status: 200,
    });
    expect(
      await request(actingDevice, "POST", "/identity/login", {
        password: SELF_CHANGE_OLD_PASSWORD,
        username: "idempotent.user",
      }),
    ).toMatchObject({
      status: 401,
      body: { code: "invalid-credentials" },
    });
    expect(
      await request(actingDevice, "POST", "/identity/login", {
        password: SELF_CHANGE_NEW_PASSWORD,
        username: "idempotent.user",
      }),
    ).toMatchObject({ status: 200 });

    const storedFingerprint = await administrator.query<{
      request_fingerprint: Buffer;
    }>(
      `select request_fingerprint
       from identity_command_results
       where idempotency_key = $1`,
      [idempotencyKey],
    );
    const passwordFreeFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          commandName: "identity.password.change",
          input: {
            expectedRevision: changeBody.expectedRevision,
            idempotencyKey,
          },
        }),
      )
      .digest();
    expect(storedFingerprint.rows[0]?.request_fingerprint).toEqual(
      passwordFreeFingerprint,
    );
  });

  it("counts wrong current passwords and keeps the shared device budget after a success", async () => {
    const changeDevice = await registerDevice();
    await login(ownerUsername, ownerPassword, changeDevice, true);
    const ownerState = await request(changeDevice, "GET", "/identity/state");
    const expectedRevision = String(
      (ownerState.body?.user as { revision?: string } | undefined)?.revision ??
        "",
    );
    // The sign-in above refunds its own charge, so the meter starts empty and
    // the whole allowance is spent on wrong passwords before the limit bites.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        await request(changeDevice, "POST", "/identity/password-changes", {
          currentPassword: "wrong current password",
          expectedRevision,
          idempotencyKey: createUuidV7(),
          newPassword: "unused replacement password",
        }),
      ).toMatchObject({
        status: 401,
        body: { code: "invalid-credentials" },
      });
    }
    expect(
      await request(changeDevice, "POST", "/identity/password-changes", {
        currentPassword: "wrong current password",
        expectedRevision,
        idempotencyKey: createUuidV7(),
        newPassword: "unused replacement password",
      }),
    ).toMatchObject({
      status: 429,
      body: { code: "rate-limit-exceeded" },
    });

    const sharedBudgetDevice = await registerDevice();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        await request(sharedBudgetDevice, "POST", "/identity/login", {
          password: "wrong password",
          username: `unknown.user.${attempt}`,
        }),
      ).toMatchObject({ status: 401, body: { code: "invalid-credentials" } });
    }
    expect(
      await request(sharedBudgetDevice, "POST", "/identity/login", {
        password: ownerPassword,
        username: ownerUsername,
      }),
    ).toMatchObject({ status: 200 });
    // The three earlier failures survive the success. Had the success cleared
    // the device budget — the weakness this guards — the meter would be empty
    // here and no number of further guesses in this window would be refused.
    for (const username of ["another.unknown.user", "one.more.unknown.user"]) {
      expect(
        await request(sharedBudgetDevice, "POST", "/identity/login", {
          password: "wrong password",
          username,
        }),
      ).toMatchObject({ status: 401, body: { code: "invalid-credentials" } });
    }
    expect(
      await request(sharedBudgetDevice, "POST", "/identity/login", {
        password: "wrong password",
        username: "last.unknown.user",
      }),
    ).toMatchObject({
      status: 429,
      body: { code: "rate-limit-exceeded" },
    });
  });

  it("requires one-use Step-Up for an administrator reset and revokes every subject session", async () => {
    const subject = await administrator.query<{
      auth_revision: string;
      id: string;
    }>(
      `select id, auth_revision::text
       from identity_users where username_key = 'role.sales'`,
    );
    const user = subject.rows[0];
    expect(user).toBeDefined();
    const subjectDeviceA = await registerDevice();
    const subjectDeviceB = await registerDevice();
    const oldPassword = "test password for sales_employee user";
    await login("role.sales", oldPassword, subjectDeviceA);
    await login("role.sales", oldPassword, subjectDeviceB);

    const adminDevice = await registerDevice();
    await login(ownerUsername, ownerPassword, adminDevice);
    const challengeId = await createChallenge(
      "identity.user.password.reset",
      user?.id,
      adminDevice,
    );
    expect(
      await request(
        adminDevice,
        "POST",
        `/identity/users/${user?.id}/password-reset`,
        {
          challengeId,
          expectedRevision: user?.auth_revision,
          idempotencyKey: createUuidV7(),
          newPassword: ADMIN_RESET_PASSWORD,
        },
      ),
    ).toMatchObject({
      status: 409,
      body: { code: "step-up-not-approved" },
    });
    expect(
      await approveChallenge(
        challengeId,
        ownerPassword,
        createUuidV7(),
        adminDevice,
      ),
    ).toMatchObject({ status: 200, body: { status: "approved" } });

    const resetBody = {
      challengeId,
      expectedRevision: user?.auth_revision ?? "",
      idempotencyKey: createUuidV7(),
      newPassword: ADMIN_RESET_PASSWORD,
    };
    const reset = await request(
      adminDevice,
      "POST",
      `/identity/users/${user?.id}/password-reset`,
      resetBody,
    );
    expect(reset).toMatchObject({ status: 200, body: { id: user?.id } });
    expect(reset.body).not.toHaveProperty("newPassword");
    expect(
      await request(
        adminDevice,
        "POST",
        `/identity/users/${user?.id}/password-reset`,
        resetBody,
      ),
    ).toEqual(reset);
    expect(
      await request(
        adminDevice,
        "POST",
        `/identity/users/${user?.id}/password-reset`,
        {
          ...resetBody,
          expectedRevision: String(BigInt(resetBody.expectedRevision) + 1n),
        },
      ),
    ).toMatchObject({
      status: 409,
      body: { code: "idempotency-conflict" },
    });
    expect(
      await request(
        adminDevice,
        "POST",
        `/identity/users/${user?.id}/password-reset`,
        {
          ...resetBody,
          expectedRevision: String(reset.body?.revision ?? ""),
          idempotencyKey: createUuidV7(),
        },
      ),
    ).toMatchObject({
      status: 409,
      body: { code: "step-up-reused" },
    });

    for (const subjectDevice of [subjectDeviceA, subjectDeviceB]) {
      expect(await request(subjectDevice, "GET", "/identity/state")).toEqual({
        body: { state: "session-revoked" },
        status: 200,
      });
    }
    expect(
      await request(subjectDeviceB, "POST", "/identity/password-changes", {
        currentPassword: oldPassword,
        expectedRevision: String(reset.body?.revision ?? ""),
        idempotencyKey: createUuidV7(),
        newPassword: "another unused replacement password",
      }),
    ).toMatchObject({
      status: 401,
      body: { code: "session-revoked" },
    });
    expect(
      await request(subjectDeviceA, "POST", "/identity/login", {
        password: oldPassword,
        username: "role.sales",
      }),
    ).toMatchObject({ status: 401, body: { code: "invalid-credentials" } });
    expect(
      await request(subjectDeviceA, "POST", "/identity/login", {
        password: ADMIN_RESET_PASSWORD,
        username: "role.sales",
      }),
    ).toMatchObject({ status: 200 });

    const resetAudit = await administrator.query<{
      after_state: Record<string, unknown>;
      before_state: Record<string, unknown>;
    }>(
      `select before_state, after_state
       from identity_audit_records
       where action = 'identity.user.password.reset'
         and outcome = 'succeeded'
         and target_id = $1`,
      [user?.id],
    );
    expect(resetAudit.rows).toEqual([
      {
        after_state: {
          authRevision: String(BigInt(user?.auth_revision ?? "0") + 1n),
        },
        before_state: { authRevision: user?.auth_revision },
      },
    ]);
    const actionDefinition = await administrator.query<{
      required_permission: string;
    }>(
      `select required_permission
       from step_up_action_definitions
       where name = 'identity.user.password.reset'`,
    );
    expect(actionDefinition.rows[0]?.required_permission).toBe(
      "identity.users.manage",
    );
  });

  it("edits display names, rejects empty updates, and exercises role reassignment", async () => {
    const adminDevice = await registerDevice();
    await login(ownerUsername, ownerPassword, adminDevice);
    const subject = await administrator.query<{
      auth_revision: string;
      display_name: string;
      id: string;
    }>(
      `select id, auth_revision::text, display_name
       from identity_users where username_key = 'idempotent.user'`,
    );
    const user = subject.rows[0];
    expect(user).toBeDefined();
    const displayChallenge = await approvedChallenge(
      "identity.user.update",
      user?.id,
      ownerPassword,
      adminDevice,
    );
    const displayUpdate = await request(
      adminDevice,
      "PATCH",
      `/identity/users/${user?.id}`,
      {
        challengeId: displayChallenge,
        displayName: "Renamed Idempotent User",
        expectedRevision: user?.auth_revision,
        idempotencyKey: createUuidV7(),
      },
    );
    expect(displayUpdate).toMatchObject({
      status: 200,
      body: { displayName: "Renamed Idempotent User" },
    });
    expect(
      await request(adminDevice, "PATCH", `/identity/users/${user?.id}`, {
        challengeId: createUuidV7(),
        expectedRevision: String(displayUpdate.body?.revision ?? ""),
        idempotencyKey: createUuidV7(),
      }),
    ).toMatchObject({ status: 400, body: { code: "body-invalid" } });

    const roleChallenge = await approvedChallenge(
      "identity.user.update",
      user?.id,
      ownerPassword,
      adminDevice,
    );
    expect(
      await request(adminDevice, "PATCH", `/identity/users/${user?.id}`, {
        challengeId: roleChallenge,
        expectedRevision: String(displayUpdate.body?.revision ?? ""),
        idempotencyKey: createUuidV7(),
        roleId: await roleIdFor("pharmacist"),
      }),
    ).toMatchObject({
      status: 200,
      body: { role: { key: "pharmacist", kind: "built-in" } },
    });

    const displayAudit = await administrator.query<{
      after_state: Record<string, unknown>;
      before_state: Record<string, unknown>;
    }>(
      `select before_state, after_state
       from identity_audit_records
       where action = 'identity.user.update'
         and outcome = 'succeeded'
         and target_id = $1
         and after_state ->> 'displayName' = 'Renamed Idempotent User'
       order by occurred_at
       limit 1`,
      [user?.id],
    );
    expect(displayAudit.rows[0]).toMatchObject({
      before_state: { displayName: user?.display_name },
      after_state: { displayName: "Renamed Idempotent User" },
    });
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
    // The built-in support role carries no grant at all. (The manager role
    // is no longer the example: it is seeded with identity.roles.manage.)
    await login("role.support", "test password for support user");

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
        roleId: createUuidV7(),
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
        "POST",
        `/identity/users/${ownerId}/password-reset`,
        {
          challengeId: arbitraryChallenge,
          expectedRevision: "1",
          idempotencyKey: createUuidV7(),
          newPassword: "denied reset password stays private",
        },
      ),
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
    // The roles endpoint lists only the implemented permissions — the ones
    // that back a live operation — never a name a future slice has not yet
    // landed the operation for.
    const permissionNames = roles.body?.permissions as string[];
    expect(permissionNames).toHaveLength(7);

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

  it("lists only implemented permissions, refuses granting a future name, and filters a future grant seeded directly in PostgreSQL", async () => {
    await login(ownerUsername, ownerPassword);
    const roles = await request(credentials, "GET", "/identity/roles");
    expect(roles.status, failureContext([roles])).toBe(200);
    // (a) The roles endpoint lists exactly the implemented names — never a
    // name whose operation has not landed yet.
    const permissionNames = roles.body?.permissions as string[];
    expect(permissionNames).toEqual([
      "attendance.record",
      "catalog.item.manage",
      "devices.pair",
      "identity.roles.manage",
      "identity.users.manage",
      "licensing.manage",
      "pharmacy.settings.manage",
    ]);
    const roleRows = roles.body?.roles as {
      grants: string[];
      id: string;
      key: string;
      revision: string;
    }[];
    for (const role of roleRows) {
      expect(
        role.grants.every((grant) => permissionNames.includes(grant)),
        `${role.key}: ${JSON.stringify(role.grants)}`,
      ).toBe(true);
    }
    const supportRole = roleRows.find(({ key }) => key === "support");
    expect(supportRole).toBeDefined();

    // (b) Granting a future name is refused server-side, even to the owner
    // holding identity.roles.manage — the UI is never the boundary for what a
    // role can be granted.
    const challenge = await approvedChallenge(
      "identity.role.permissions.update",
      supportRole?.id,
      ownerPassword,
    );
    const refused = await request(
      credentials,
      "PUT",
      `/identity/roles/${supportRole?.id}/permissions`,
      command({
        challengeId: challenge,
        expectedRevision: supportRole?.revision,
        permissions: ["sales.return.post"],
      }),
    );
    expect(refused, failureContext([refused])).toMatchObject({
      status: 400,
      body: { code: "body-invalid" },
    });
    const requestId = refused.body?.requestId as string | undefined;
    expect(requestId).toBeDefined();
    const audited = await administrator.query<{ outcome: string }>(
      "select outcome from identity_audit_records where id = $1",
      [requestId],
    );
    expect(audited.rows[0]?.outcome).toBe("body-invalid");
    const afterRefusal = await request(credentials, "GET", "/identity/roles");
    const supportAfterRefusal = (
      afterRefusal.body?.roles as { grants: string[]; key: string }[]
    ).find(({ key }) => key === "support");
    expect(supportAfterRefusal?.grants).toEqual(supportRole?.grants);

    // (c) A role row seeded with a future grant directly in PostgreSQL still
    // round-trips the endpoint without that grant appearing, and the owner
    // floor is unaffected — the floor concerns only identity.roles.manage and
    // identity.users.manage, both implemented permissions.
    const supportPharmacy = await administrator.query<{
      pharmacy_id: string;
    }>("select pharmacy_id from pharmacy_roles where id = $1", [
      supportRole?.id,
    ]);
    await administrator.query(
      `insert into role_permission_grants
         (pharmacy_id, role_id, permission_name, granted_by)
       values ($1, $2, 'sync.conflict.resolve', $3)`,
      [supportPharmacy.rows[0]?.pharmacy_id, supportRole?.id, ownerId],
    );
    const roundTripped = await request(credentials, "GET", "/identity/roles");
    expect(roundTripped.status, failureContext([roundTripped])).toBe(200);
    const seededSupport = (
      roundTripped.body?.roles as { grants: string[]; key: string }[]
    ).find(({ key }) => key === "support");
    expect(seededSupport?.grants).not.toContain("sync.conflict.resolve");
    expect(roundTripped.body?.permissions).not.toContain(
      "sync.conflict.resolve",
    );
    const ownerFloor = await administrator.query<{ permission_name: string }>(
      `select grant_row.permission_name
       from role_permission_grants grant_row
       join pharmacy_roles role on role.id = grant_row.role_id
       where role.role_key = 'owner'
         and grant_row.permission_name = any($1::text[])
       order by grant_row.permission_name`,
      [["identity.roles.manage", "identity.users.manage"]],
    );
    expect(
      ownerFloor.rows.map(({ permission_name }) => permission_name),
    ).toEqual(["identity.roles.manage", "identity.users.manage"]);
  });

  it("creates, renames, grants, and assigns a custom role under Step-Up, audit, and idempotency", async () => {
    await login(ownerUsername, ownerPassword);
    const catalogue = await request(credentials, "GET", "/identity/roles");
    const builtInCount = (catalogue.body?.roles as unknown[]).length;

    // A reserved or unimplemented request is refused before the challenge is
    // spent, so the same challenge still creates the role afterwards.
    const createChallengeId = await approvedChallenge(
      "identity.role.create",
      undefined,
      ownerPassword,
    );
    expect(
      await request(
        credentials,
        "POST",
        "/identity/roles",
        command({
          challengeId: createChallengeId,
          name: "Sales-Employee",
          permissions: [],
        }),
      ),
    ).toMatchObject({ status: 400, body: { code: "role-name-reserved" } });
    expect(
      await request(
        credentials,
        "POST",
        "/identity/roles",
        command({
          challengeId: createChallengeId,
          name: "Senior cashier",
          permissions: ["sales.return.post"],
        }),
      ),
    ).toMatchObject({ status: 400, body: { code: "body-invalid" } });

    const createBody = {
      challengeId: createChallengeId,
      idempotencyKey: createUuidV7(),
      name: "Senior cashier",
      permissions: ["catalog.item.manage", "attendance.record"],
    };
    const created = await request(
      credentials,
      "POST",
      "/identity/roles",
      createBody,
    );
    expect(created, failureContext([created])).toMatchObject({
      status: 201,
      body: {
        grants: ["attendance.record", "catalog.item.manage"],
        kind: "custom",
        name: "Senior cashier",
        revision: "1",
      },
    });
    const customRoleId = String(created.body?.id ?? "");
    expect(
      await request(credentials, "POST", "/identity/roles", createBody),
    ).toEqual(created);
    expect(
      await request(credentials, "POST", "/identity/roles", {
        ...createBody,
        name: "Other name",
      }),
    ).toMatchObject({ status: 409, body: { code: "idempotency-conflict" } });
    const createAudits = await administrator.query<{ count: string }>(
      `select count(*)::text as count from identity_audit_records
       where action = 'identity.role.create'
         and outcome = 'succeeded'
         and target_id = $1`,
      [customRoleId],
    );
    expect(createAudits.rows[0]?.count).toBe("1");

    // Listed after the built-ins, and offered to user managers as a reference.
    const listed = await request(credentials, "GET", "/identity/roles");
    const listedRoles = listed.body?.roles as {
      id: string;
      kind: string;
      name?: string;
    }[];
    expect(listedRoles).toHaveLength(builtInCount + 1);
    expect(listedRoles.at(-1)).toMatchObject({
      id: customRoleId,
      kind: "custom",
      name: "Senior cashier",
    });
    const usersList = await request(credentials, "GET", "/identity/users");
    expect(usersList.body?.roles).toEqual(
      expect.arrayContaining([
        { id: customRoleId, kind: "custom", name: "Senior cashier" },
      ]),
    );

    // A name that differs only by case and spacing is the same name.
    const duplicateChallenge = await approvedChallenge(
      "identity.role.create",
      undefined,
      ownerPassword,
    );
    expect(
      await request(
        credentials,
        "POST",
        "/identity/roles",
        command({
          challengeId: duplicateChallenge,
          name: "senior   CASHIER",
          permissions: [],
        }),
      ),
    ).toMatchObject({ status: 409, body: { code: "role-name-taken" } });

    // Rename: never a built-in role; a custom role under its revision.
    const builtInRename = await approvedChallenge(
      "identity.role.rename",
      managerRoleId,
      ownerPassword,
    );
    expect(
      await request(
        credentials,
        "PATCH",
        `/identity/roles/${managerRoleId}`,
        command({
          challengeId: builtInRename,
          expectedRevision: await currentRoleRevision(managerRoleId),
          name: "Shift lead",
        }),
      ),
    ).toMatchObject({ status: 409, body: { code: "role-not-custom" } });
    const renameChallenge = await approvedChallenge(
      "identity.role.rename",
      customRoleId,
      ownerPassword,
    );
    expect(
      await request(
        credentials,
        "PATCH",
        `/identity/roles/${customRoleId}`,
        command({
          challengeId: renameChallenge,
          expectedRevision: "1",
          name: "Senior cashier (evening)",
        }),
      ),
    ).toMatchObject({
      status: 200,
      body: {
        grants: ["attendance.record", "catalog.item.manage"],
        kind: "custom",
        name: "Senior cashier (evening)",
        revision: "2",
      },
    });
    const staleRename = await approvedChallenge(
      "identity.role.rename",
      customRoleId,
      ownerPassword,
    );
    expect(
      await request(
        credentials,
        "PATCH",
        `/identity/roles/${customRoleId}`,
        command({
          challengeId: staleRename,
          expectedRevision: "1",
          name: "Stale name",
        }),
      ),
    ).toMatchObject({ status: 409, body: { code: "version-conflict" } });

    // Assignment is by id. An id that is not a role of this pharmacy is a
    // not-found that leaves the challenge usable; the custom role assigns.
    const assignChallenge = await approvedChallenge(
      "identity.user.create",
      undefined,
      ownerPassword,
    );
    const cashierPassword = "custom role password stays in this test";
    expect(
      await request(
        credentials,
        "POST",
        "/identity/users",
        command({
          challengeId: assignChallenge,
          displayName: "Nobody",
          password: cashierPassword,
          roleId: createUuidV7(),
          username: "custom.nobody",
        }),
      ),
    ).toMatchObject({
      status: 404,
      body: { code: "identity-resource-not-found" },
    });
    const cashier = await request(
      credentials,
      "POST",
      "/identity/users",
      command({
        challengeId: assignChallenge,
        displayName: "Custom Cashier",
        password: cashierPassword,
        roleId: customRoleId,
        username: "custom.cashier",
      }),
    );
    expect(cashier, failureContext([cashier])).toMatchObject({
      status: 201,
      body: {
        role: {
          id: customRoleId,
          kind: "custom",
          name: "Senior cashier (evening)",
        },
      },
    });
    const cashierId = String(cashier.body?.id ?? "");

    // The assigned user carries exactly the role's grants, and a change to
    // the role reaches them on their next request. The change also moves the
    // pharmacy identity revision, so a challenge approved before it is stale.
    await login("custom.cashier", cashierPassword);
    expect(await request(credentials, "GET", "/identity/state")).toMatchObject({
      status: 200,
      body: {
        allowedPermissions: ["attendance.record", "catalog.item.manage"],
        user: { role: { kind: "custom", name: "Senior cashier (evening)" } },
      },
    });
    await login(ownerUsername, ownerPassword);
    const staleUserChallenge = await approvedChallenge(
      "identity.user.update",
      cashierId,
      ownerPassword,
    );
    const grantChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      customRoleId,
      ownerPassword,
    );
    expect(
      await request(
        credentials,
        "PUT",
        `/identity/roles/${customRoleId}/permissions`,
        command({
          challengeId: grantChallenge,
          expectedRevision: "2",
          permissions: ["catalog.item.manage"],
        }),
      ),
    ).toMatchObject({
      status: 200,
      body: { grants: ["catalog.item.manage"], kind: "custom", revision: "3" },
    });
    expect(
      await request(
        credentials,
        "PATCH",
        `/identity/users/${cashierId}`,
        command({
          challengeId: staleUserChallenge,
          displayName: "Stale Cashier",
          expectedRevision: await currentUserRevision(cashierId),
        }),
      ),
    ).toMatchObject({ status: 403, body: { code: "step-up-stale" } });
    await login("custom.cashier", cashierPassword);
    expect(await request(credentials, "GET", "/identity/state")).toMatchObject({
      status: 200,
      body: { allowedPermissions: ["catalog.item.manage"] },
    });

    // Reassignment to a built-in role by id, audited with both references.
    await login(ownerUsername, ownerPassword);
    const reassign = await approvedChallenge(
      "identity.user.update",
      cashierId,
      ownerPassword,
    );
    expect(
      await request(
        credentials,
        "PATCH",
        `/identity/users/${cashierId}`,
        command({
          challengeId: reassign,
          expectedRevision: await currentUserRevision(cashierId),
          roleId: await roleIdFor("support"),
        }),
      ),
    ).toMatchObject({
      status: 200,
      body: { role: { key: "support", kind: "built-in" } },
    });
    const reassignAudit = await administrator.query<{
      after_state: Record<string, unknown>;
      before_state: Record<string, unknown>;
    }>(
      `select before_state, after_state from identity_audit_records
       where action = 'identity.user.update'
         and outcome = 'succeeded'
         and target_id = $1
       order by occurred_at desc
       limit 1`,
      [cashierId],
    );
    expect(reassignAudit.rows[0]).toMatchObject({
      after_state: { role: { key: "support", kind: "built-in" } },
      before_state: {
        role: { kind: "custom", name: "Senior cashier (evening)" },
      },
    });
  });

  it("keeps roles the only source of authority: shared grants, strict bodies, denied creation, manager administration, and rollback", async () => {
    await login("role.support", "test password for support user");
    const missingStepUp = await request(
      credentials,
      "POST",
      "/identity/step-up-challenges",
      command({ action: "identity.role.create" }),
    );
    expect(missingStepUp, failureContext([missingStepUp])).toMatchObject({
      status: 403,
      body: { code: "step-up-missing-permission" },
    });
    const deniedCreation = await request(
      credentials,
      "POST",
      "/identity/roles",
      command({
        challengeId: createUuidV7(),
        name: "Denied custom role",
        permissions: [],
      }),
    );
    expect(deniedCreation, failureContext([deniedCreation])).toMatchObject({
      status: 403,
      body: { code: "permission-denied" },
    });
    const supportUser = await administrator.query<{ id: string }>(
      "select id from identity_users where username_key = 'role.support'",
    );
    const authorizationAudit = await administrator.query<{
      action: string;
      actor_user_id: string;
      outcome: string;
      required_permission: string;
    }>(
      `select action, actor_user_id, outcome,
              after_state ->> 'requiredPermission' as required_permission
       from identity_audit_records
       where id = $1`,
      [deniedCreation.body?.requestId],
    );
    expect(authorizationAudit.rows).toEqual([
      {
        action: "identity.authorization",
        actor_user_id: supportUser.rows[0]?.id,
        outcome: "denied",
        required_permission: "identity.roles.manage",
      },
    ]);

    await login("pharmacy.manager", MANAGER_PASSWORD);
    const managerCreateChallenge = await approvedChallenge(
      "identity.role.create",
      undefined,
      MANAGER_PASSWORD,
    );
    const managerCreated = await request(
      credentials,
      "POST",
      "/identity/roles",
      command({
        challengeId: managerCreateChallenge,
        name: "Evening supervisor",
        permissions: ["attendance.record"],
      }),
    );
    expect(managerCreated, failureContext([managerCreated])).toMatchObject({
      status: 201,
      body: {
        grants: ["attendance.record"],
        kind: "custom",
        name: "Evening supervisor",
        revision: "1",
      },
    });
    const eveningRoleId = String(managerCreated.body?.id ?? "");
    const managerGrantChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      eveningRoleId,
      MANAGER_PASSWORD,
    );
    const managerGranted = await request(
      credentials,
      "PUT",
      `/identity/roles/${eveningRoleId}/permissions`,
      command({
        challengeId: managerGrantChallenge,
        expectedRevision: "1",
        permissions: ["attendance.record", "catalog.item.manage"],
      }),
    );
    expect(managerGranted, failureContext([managerGranted])).toMatchObject({
      status: 200,
      body: {
        grants: ["attendance.record", "catalog.item.manage"],
        revision: "2",
      },
    });
    const managerRenameChallenge = await approvedChallenge(
      "identity.role.rename",
      eveningRoleId,
      MANAGER_PASSWORD,
    );
    const managerRenamed = await request(
      credentials,
      "PATCH",
      `/identity/roles/${eveningRoleId}`,
      command({
        challengeId: managerRenameChallenge,
        expectedRevision: "2",
        name: "Evening lead",
      }),
    );
    expect(managerRenamed, failureContext([managerRenamed])).toMatchObject({
      status: 200,
      body: { name: "Evening lead", revision: "3" },
    });
    const managerUsers = await request(credentials, "GET", "/identity/users");
    expect(managerUsers, failureContext([managerUsers])).toMatchObject({
      status: 403,
      body: { code: "permission-denied" },
    });

    await login(ownerUsername, ownerPassword);
    const sharedUsers = [
      {
        displayName: "Evening User One",
        password: "evening user one password stays private",
        username: "evening.user.one",
      },
      {
        displayName: "Evening User Two",
        password: "evening user two password stays private",
        username: "evening.user.two",
      },
    ];
    const sharedUserIds: string[] = [];
    for (const sharedUser of sharedUsers) {
      const challengeId = await approvedChallenge(
        "identity.user.create",
        undefined,
        ownerPassword,
      );
      const created = await request(
        credentials,
        "POST",
        "/identity/users",
        command({
          challengeId,
          displayName: sharedUser.displayName,
          password: sharedUser.password,
          roleId: eveningRoleId,
          username: sharedUser.username,
        }),
      );
      expect(created, failureContext([created])).toMatchObject({
        status: 201,
        body: { role: { id: eveningRoleId, name: "Evening lead" } },
      });
      sharedUserIds.push(String(created.body?.id ?? ""));
    }

    const initialSharedPermissions: string[][] = [];
    for (const sharedUser of sharedUsers) {
      await login(sharedUser.username, sharedUser.password);
      const state = await request(credentials, "GET", "/identity/state");
      expect(state, failureContext([state])).toMatchObject({ status: 200 });
      initialSharedPermissions.push(
        (state.body?.allowedPermissions as string[] | undefined) ?? [],
      );
    }
    expect(initialSharedPermissions[0]).toEqual(initialSharedPermissions[1]);
    expect(initialSharedPermissions[0]).toEqual([
      "attendance.record",
      "catalog.item.manage",
    ]);

    await login(ownerUsername, ownerPassword);
    const ownerGrantChallenge = await approvedChallenge(
      "identity.role.permissions.update",
      eveningRoleId,
      ownerPassword,
    );
    const ownerGranted = await request(
      credentials,
      "PUT",
      `/identity/roles/${eveningRoleId}/permissions`,
      command({
        challengeId: ownerGrantChallenge,
        expectedRevision: "3",
        permissions: ["catalog.item.manage"],
      }),
    );
    expect(ownerGranted, failureContext([ownerGranted])).toMatchObject({
      status: 200,
      body: { grants: ["catalog.item.manage"], revision: "4" },
    });
    const updatedSharedPermissions: string[][] = [];
    for (const sharedUser of sharedUsers) {
      await login(sharedUser.username, sharedUser.password);
      const state = await request(credentials, "GET", "/identity/state");
      expect(state, failureContext([state])).toMatchObject({ status: 200 });
      updatedSharedPermissions.push(
        (state.body?.allowedPermissions as string[] | undefined) ?? [],
      );
    }
    expect(updatedSharedPermissions[0]).toEqual(updatedSharedPermissions[1]);
    expect(updatedSharedPermissions[0]).toEqual(["catalog.item.manage"]);

    await login(ownerUsername, ownerPassword);
    const createWithGrants = await request(
      credentials,
      "POST",
      "/identity/users",
      command({
        challengeId: createUuidV7(),
        displayName: "Per-user Grant Attempt",
        grants: ["devices.pair"],
        password: "per-user grant password is never stored",
        roleId: eveningRoleId,
        username: "per.user.grant",
      }),
    );
    expect(createWithGrants, failureContext([createWithGrants])).toMatchObject({
      status: 400,
      body: { code: "body-invalid" },
    });
    const updateWithPermissions = await request(
      credentials,
      "PATCH",
      `/identity/users/${sharedUserIds[0]}`,
      command({
        challengeId: createUuidV7(),
        expectedRevision: "1",
        permissions: ["devices.pair"],
      }),
    );
    expect(
      updateWithPermissions,
      failureContext([updateWithPermissions]),
    ).toMatchObject({
      status: 400,
      body: { code: "body-invalid" },
    });
    const grantTables = await administrator.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_name = 'user_permission_grants'`,
    );
    expect(grantTables.rows).toEqual([]);
    const grantColumns = await administrator.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_name = 'identity_users'
         and (column_name ilike '%grant%' or column_name ilike '%permission%')`,
    );
    expect(grantColumns.rows).toEqual([]);

    const failureChallenge = await approvedChallenge(
      "identity.role.create",
      undefined,
      ownerPassword,
    );
    const failureIdempotencyKey = createUuidV7();
    const beforeFailure = await administrator.query<{
      identity_revision: string;
    }>("select identity_revision::text from pharmacies");
    try {
      await administrator.query(
        `create function w2_injected_role_permission_failure()
         returns trigger
         language plpgsql
         as $$
         begin
           if exists (
             select 1 from pharmacy_roles
             where id = new.role_id
               and custom_name_key = 'injected failure'
           ) then
             raise exception 'injected failure' using errcode = 'P0001';
           end if;
           return new;
         end;
         $$`,
      );
      await administrator.query(
        `create trigger w2_injected_role_permission_failure
         before insert on role_permission_grants
         for each row execute function w2_injected_role_permission_failure()`,
      );
      const failed = await request(credentials, "POST", "/identity/roles", {
        challengeId: failureChallenge,
        idempotencyKey: failureIdempotencyKey,
        name: "Injected failure",
        permissions: ["attendance.record"],
      });
      expect(failed.status, failureContext([failed])).toBe(500);

      const rollbackFacts = await administrator.query<{
        commands: string;
        grants: string;
        identity_revision: string;
        roles: string;
        success_audits: string;
      }>(
        `select
           (select count(*)::text from pharmacy_roles
            where custom_name_key = 'injected failure') as roles,
           (select count(*)::text from role_permission_grants
            where role_id in (
              select id from pharmacy_roles
              where custom_name_key = 'injected failure'
            )) as grants,
           (select count(*)::text from identity_audit_records
            where action = 'identity.role.create'
              and outcome = 'succeeded'
              and after_state ->> 'name' = 'Injected failure') as success_audits,
           (select count(*)::text from identity_command_results
            where idempotency_key = $1) as commands,
           (select identity_revision::text from pharmacies) as identity_revision`,
        [failureIdempotencyKey],
      );
      expect(rollbackFacts.rows[0]).toEqual({
        commands: "0",
        grants: "0",
        identity_revision: beforeFailure.rows[0]?.identity_revision,
        roles: "0",
        success_audits: "0",
      });
    } finally {
      try {
        await administrator.query(
          `drop trigger if exists w2_injected_role_permission_failure
           on role_permission_grants`,
        );
      } finally {
        await administrator.query(
          "drop function if exists w2_injected_role_permission_failure()",
        );
      }
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
          // An implemented permission, not the future
          // "sales.return.post": granting a name with no operation behind it
          // is refused server-side (proven elsewhere), so this end-to-end
          // grant flow has to use a name that can actually be granted.
          permissions: ["catalog.item.manage"],
        }),
      ),
    ).toMatchObject({
      status: 200,
      body: { grants: ["catalog.item.manage"], key: "pharmacist" },
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
    // Scoped to the device under test. The invariant being proved is that one
    // device binding keeps exactly one live session however many logins race on
    // it. Other devices registered by other cases in this file each legitimately
    // hold their own session, so a global count would measure their bookkeeping
    // rather than this invariant.
    const activeSessions = await administrator.query<{ count: string }>(
      `select count(*)::text as count from identity_sessions
       where revoked_at is null and device_id = $1`,
      [credentials.deviceId],
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
      expect(audit.state).not.toContain(SELF_CHANGE_OLD_PASSWORD);
      expect(audit.state).not.toContain(SELF_CHANGE_NEW_PASSWORD);
      expect(audit.state).not.toContain(ADMIN_RESET_PASSWORD);
      expect(audit.state.toLowerCase()).not.toContain("password_hash");
    }
    expect(apiOutput).not.toContain(OWNER_PASSWORD);
    expect(apiOutput).not.toContain(SECOND_OWNER_PASSWORD);
    expect(apiOutput).not.toContain(MANAGER_PASSWORD);
    expect(apiOutput).not.toContain(SELF_CHANGE_OLD_PASSWORD);
    expect(apiOutput).not.toContain(SELF_CHANGE_NEW_PASSWORD);
    expect(apiOutput).not.toContain(ADMIN_RESET_PASSWORD);

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
    const commandResults = await administrator.query<{
      id: string;
      response_body: string;
    }>(
      `select id, response_body::text
       from identity_command_results order by created_at`,
    );
    for (const commandResult of commandResults.rows) {
      // Both known secrets are checked against the whole recorded body, with
      // nothing exempted.
      expect(commandResult.response_body).not.toContain(
        SELF_CHANGE_NEW_PASSWORD,
      );
      expect(commandResult.response_body).not.toContain(ADMIN_RESET_PASSWORD);

      // The blunt sweep for the word itself stays, because it catches a
      // credential arriving through a field nobody thought to name. One field
      // is exempt: `action` carries the command name, and
      // `identity.user.password.reset` describes a command rather than
      // exposing anything. Exempting the name is not the same as exempting a
      // value, so every other field is still swept.
      const recorded = JSON.parse(commandResult.response_body) as Record<
        string,
        unknown
      >;
      delete recorded.action;
      expect(JSON.stringify(recorded).toLowerCase()).not.toContain("password");
    }
    await expect(
      administrator.query(
        "update identity_command_results set command_name = 'identity.changed' where id = $1",
        [commandResults.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        "delete from identity_command_results where id = $1",
        [commandResults.rows[0]?.id],
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

  async function login(
    username: string,
    password: string,
    binding = credentials,
    preserveDeviceBudget = false,
  ): Promise<void> {
    const response = await request(binding, "POST", "/identity/login", {
      password,
      username,
    });
    expect(response.status, failureContext([response])).toBe(200);
    // Most scenarios use login only to arrange their actor. Isolate those
    // setups from the one test that proves a successful login cannot reset the
    // shared device budget; that test sends its login requests directly.
    if (!preserveDeviceBudget) {
      await administrator.query(
        `delete from identity_auth_rate_windows
         where device_id = $1 and action = 'login' and subject_key = $2`,
        [
          binding.deviceId,
          createHash("sha256").update("device:login").digest(),
        ],
      );
    }
  }

  async function createChallenge(
    action: StepUpAction,
    subjectId?: string,
    binding = credentials,
  ): Promise<string> {
    const response = await request(
      binding,
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
    binding = credentials,
  ): Promise<ApiResponse> {
    return await request(
      binding,
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey, password },
    );
  }

  async function approvedChallenge(
    action: StepUpAction,
    subjectId: string | undefined,
    password: string,
    binding = credentials,
  ): Promise<string> {
    const challengeId = await createChallenge(action, subjectId, binding);
    const approval = await approveChallenge(
      challengeId,
      password,
      createUuidV7(),
      binding,
    );
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
      roleId: await roleIdFor(role),
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

  /**
   * The id of a built-in role, read straight from PostgreSQL so a scenario
   * can assign a role without needing identity.roles.manage itself.
   */
  async function roleIdFor(key: string): Promise<string> {
    const role = await administrator.query<{ id: string }>(
      "select id from pharmacy_roles where role_key = $1",
      [key],
    );
    return role.rows[0]?.id ?? "";
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
