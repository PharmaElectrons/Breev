import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// C3's test for a licence far above the retired 10,000 device ceiling needs
// a licence signed by a key this suite controls (Breev ships verification
// keys only, and no signing key for the published test issuer exists in
// this repository — by design; see devices.integration.test.ts for the
// same substitution). The registry keeps the real keys the other fixtures
// below are signed with and adds the run-time test issuer alongside them.
vi.mock("./licence-keys.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./licence-keys.js")>();
  const issuer = await import("../devices/test-helpers/licence-issuer.test.js");
  return {
    OFFLINE_LICENCE_PUBLIC_KEYS: {
      ...actual.OFFLINE_LICENCE_PUBLIC_KEYS,
      [issuer.TEST_ISSUER_KEY_ID]: issuer.TEST_ISSUER_PUBLIC_KEY_PEM,
    },
  };
});

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { seedOwnerRoleWithFloor } from "../../test/owner-floor-fixture.js";
import { mintLicence } from "../devices/test-helpers/licence-issuer.test.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { createUuidV7 } from "../pharmacy-ca/pharmacy-ca-crypto.js";
import { FREE_CORE_CAPABILITIES } from "./entitlement.js";
import {
  TEST_MAIN_DEVICE_ID,
  TEST_PAID_LICENCE,
  TEST_PHARMACY_ID,
  TEST_RENEWED_LICENCE,
} from "./licence-fixtures.test.js";
import {
  LicensingCommandConflict,
  LicensingDenied,
  LicensingService,
} from "./licensing.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const ACTOR_ID = "019b0000-0000-7000-8000-000000000107";
const OWNER_ROLE_ID = "019b0000-0000-7000-8000-000000000108";

describe.sequential("licensing PostgreSQL seam", () => {
  let administrator: Pool;
  let database: LocalDatabaseService;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer;
  let licensing: LicensingService;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
    process.env.BREEV_MAIN_DEVICE_ID = TEST_MAIN_DEVICE_ID;
    process.env.BREEV_MAIN_DEVICE_SECRET =
      randomBytes(32).toString("base64url");
    process.env.BREEV_MAIN_DEVICE_SESSION =
      randomBytes(32).toString("base64url");
    database = new LocalDatabaseService();
    await database.ensureReady();
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    await database
      .requirePool()
      .query(
        "insert into pharmacies (id, name) values ($1, 'Breev Licence Test Pharmacy')",
        [TEST_PHARMACY_ID],
      );
    await seedOwnerRoleWithFloor(database.requirePool(), {
      actorId: ACTOR_ID,
      displayName: "Licence Actor",
      pharmacyId: TEST_PHARMACY_ID,
      roleId: OWNER_ROLE_ID,
      username: "licence.actor",
    });
    licensing = new LicensingService(database);
  }, 60_000);

  afterAll(async () => {
    await database?.onApplicationShutdown().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("keeps Free Core usable with no licence, invalid paid state, and rollback", async () => {
    const missing = await currentAt("2026-01-01T00:00:00.000Z");
    expect(missing).toEqual({
      status: "free-core",
      capabilities: FREE_CORE_CAPABILITIES,
      licence: null,
    });

    await licensing.install({
      actorId: ACTOR_ID,
      encodedLicence: TEST_PAID_LICENCE,
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date("2026-01-01T00:00:00.000Z"),
      pharmacyId: TEST_PHARMACY_ID,
    });
    const paid = await currentAt("2026-01-01T00:00:00.000Z");
    expect(paid).toMatchObject({
      status: "licensed",
      licence: { permittedDeviceCount: 3, plan: "professional" },
    });
    expect(paid.capabilities).toContain("one-way-cloud-sync");
    expect(paid.capabilities).toContain("purchase-invoice-ocr");

    licensing = new LicensingService(database);
    expect(await currentAt("2026-01-01T00:00:00.000Z")).toMatchObject({
      status: "licensed",
    });

    // The paid term ended and the signed grace end (2027-01-08) has not: paid
    // work continues, the licence stays visible, and the status says so. The
    // grace-end boundary itself is proven by the last case in this file, at
    // instants later than every other case, so Trusted Breev Time never has
    // to roll back.
    const grace = await currentAt("2027-01-01T00:00:00.000Z");
    expect(grace).toMatchObject({
      status: "grace",
      licence: { permittedDeviceCount: 3, plan: "professional" },
    });
    expect(grace.capabilities).toContain("one-way-cloud-sync");

    await licensing.install({
      actorId: ACTOR_ID,
      encodedLicence: TEST_RENEWED_LICENCE,
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date("2027-01-01T00:00:00.000Z"),
      pharmacyId: TEST_PHARMACY_ID,
    });
    const renewed = await currentAt("2027-01-01T00:00:00.000Z");
    expect(renewed.status).toBe("licensed");
    expect(renewed.capabilities).toContain("crm-advanced-reports");

    const pharmacyDataBefore = await pharmacyOwnedData();
    const deactivated = await deactivateAt("2027-01-01T00:00:01.000Z");
    expect(deactivated).toEqual({
      status: "free-core",
      capabilities: FREE_CORE_CAPABILITIES,
      licence: null,
    });
    expect(await currentAt("2027-01-01T00:00:01.000Z")).toEqual(deactivated);
    expect(await pharmacyOwnedData()).toEqual(pharmacyDataBefore);

    await licensing.install({
      actorId: ACTOR_ID,
      encodedLicence: TEST_RENEWED_LICENCE,
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date("2027-01-01T00:00:02.000Z"),
      pharmacyId: TEST_PHARMACY_ID,
    });
    expect(
      (await currentAt("2027-01-01T00:00:02.000Z")).capabilities,
    ).toContain("crm-advanced-reports");

    const rollback = await currentAt("2026-12-31T23:59:59.999Z");
    expect(rollback.status).toBe("clock-rollback");
    expect(rollback.capabilities).toEqual(FREE_CORE_CAPABILITIES);
    const audit = await administrator.query<{ outcome: string }>(
      `select outcome from licensing_audit_records
       where action = 'trusted-time.rollback'`,
    );
    expect(audit.rows).toEqual([{ outcome: "detected" }]);
  });

  it("persists exact signed documents and immutable monotonic time facts", async () => {
    const stored = await administrator.query<{ encoded_licence: string }>(
      "select encoded_licence from licence_installations order by installed_at, licence_id",
    );
    expect(stored.rows.map((row) => row.encoded_licence)).toEqual([
      TEST_PAID_LICENCE,
      TEST_RENEWED_LICENCE,
    ]);

    const marksBefore = await administrator.query<{ count: string }>(
      "select count(*)::text as count from trusted_breev_time_marks",
    );
    await currentAt("2027-01-01T00:30:00.000Z");
    const marksAfter = await administrator.query<{ count: string }>(
      "select count(*)::text as count from trusted_breev_time_marks",
    );
    expect(marksAfter.rows[0]?.count).toBe(marksBefore.rows[0]?.count);

    await expect(
      administrator.query(
        "update licence_installations set plan = 'changed' where licence_id = $1",
        ["019b0000-0000-7000-8000-000000000103"],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query("delete from trusted_breev_time_marks"),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query("delete from licence_state_events"),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        "update licensing_audit_records set outcome = 'denied'",
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.requirePool().query("delete from licence_installations"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("replays one persisted command result and rejects key reuse", async () => {
    const response = await currentAt("2027-01-01T00:30:00.000Z");
    const idempotencyKey = "019b0000-0000-7000-8000-000000000109";
    const fingerprint = licensing.fingerprint(
      "licence.install",
      TEST_RENEWED_LICENCE,
    );
    await licensing.recordCommandResult(database.requirePool(), {
      actorId: ACTOR_ID,
      command: "licence.install",
      fingerprint,
      idempotencyKey,
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date("2027-01-01T00:30:00.000Z"),
      pharmacyId: TEST_PHARMACY_ID,
      response,
    });
    await expect(
      licensing.replayCommand(database.requirePool(), {
        command: "licence.install",
        fingerprint,
        idempotencyKey,
        pharmacyId: TEST_PHARMACY_ID,
      }),
    ).resolves.toEqual(response);
    await expect(
      licensing.replayCommand(database.requirePool(), {
        command: "licence.install",
        fingerprint: licensing.fingerprint("licence.install", "different"),
        idempotencyKey,
        pharmacyId: TEST_PHARMACY_ID,
      }),
    ).rejects.toBeInstanceOf(LicensingCommandConflict);
    await expect(
      administrator.query(
        "update licensing_command_results set response_body = '{}'::jsonb",
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("allows only signed capabilities and audits both outcomes", async () => {
    const now = new Date("2027-01-01T00:31:00.000Z");
    await expect(
      licensing.requireCapability({
        actorId: ACTOR_ID,
        capability: "one-way-cloud-sync",
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        now,
        pharmacyId: TEST_PHARMACY_ID,
      }),
    ).resolves.toBeUndefined();
    const denied = await licensing
      .requireCapability({
        actorId: ACTOR_ID,
        capability: "purchase-invoice-ocr",
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        now,
        pharmacyId: TEST_PHARMACY_ID,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(denied).toBeInstanceOf(LicensingDenied);
    expect(denied).toMatchObject({
      denial: {
        code: "entitlement-denied",
        requiredCapability: "purchase-invoice-ocr",
        status: "denied",
      },
    });
    const decisions = await administrator.query<{
      capability: string;
      outcome: string;
    }>(
      `select capability, outcome from licensing_audit_records
       where action = 'capability.authorization'
       order by recorded_at, id`,
    );
    expect(decisions.rows).toEqual([
      { capability: "one-way-cloud-sync", outcome: "allowed" },
      { capability: "purchase-invoice-ocr", outcome: "denied" },
    ]);
  });

  it("serializes concurrent high-water advances across service instances", async () => {
    const first = new LicensingService(database);
    const second = new LicensingService(database);
    const rollbackAuditsBefore = await rollbackAuditCount();
    const results = await Promise.all([
      first.current({
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        now: new Date("2028-01-01T00:00:00.000Z"),
        pharmacyId: TEST_PHARMACY_ID,
      }),
      second.current({
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        now: new Date("2028-01-01T00:00:00.001Z"),
        pharmacyId: TEST_PHARMACY_ID,
      }),
    ]);
    expect(results.every((result) => result.status === "licensed")).toBe(true);
    const marks = await administrator.query<{ count: string }>(
      `select count(*)::text as count from trusted_breev_time_marks
       where lower_bound >= '2028-01-01T00:00:00.000Z'
         and lower_bound < '2028-01-01T01:00:00.000Z'`,
    );
    expect(marks.rows[0]?.count).toBe("1");
    expect(await rollbackAuditCount()).toBe(rollbackAuditsBefore);
  });

  it("leaves a caller transaction usable when a concurrent advance wins", async () => {
    const blocker = await administrator.connect();
    const caller = await database.requirePool().connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${TEST_PHARMACY_ID}:${TEST_MAIN_DEVICE_ID}`],
      );
      await caller.query("begin");
      const pending = licensing.current(
        {
          actorId: ACTOR_ID,
          mainDeviceId: TEST_MAIN_DEVICE_ID,
          now: new Date("2029-01-01T00:00:00.000Z"),
          pharmacyId: TEST_PHARMACY_ID,
        },
        caller,
      );
      await waitForBlockedAdvance();
      await blocker.query(
        `insert into trusted_breev_time_marks (
           pharmacy_id, main_device_id, lower_bound
         ) values ($1, $2, '2029-01-01T00:00:00.000Z')`,
        [TEST_PHARMACY_ID, TEST_MAIN_DEVICE_ID],
      );
      await blocker.query("commit");
      expect((await pending).status).toBe("licensed");
      await expect(caller.query("select 1 as ok")).resolves.toMatchObject({
        rowCount: 1,
      });
      await caller.query("commit");
    } finally {
      await caller.query("rollback").catch(() => undefined);
      caller.release();
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
    }
    const marks = await administrator.query<{ count: string }>(
      `select count(*)::text as count from trusted_breev_time_marks
       where lower_bound >= '2029-01-01T00:00:00.000Z'`,
    );
    expect(marks.rows[0]?.count).toBe("1");
  });

  // C3: permittedDeviceCount is licensing data, never a hard-coded software
  // limit. A licence far above the retired 10,000 commercial ceiling must
  // still parse, install (which persists it past the licence_installations
  // check constraint), and round-trip back out through a fresh query.
  it("installs and round-trips a licence permitting far more than 10,000 devices", async () => {
    const largeDeviceCount = 250_000;
    const encodedLicence = mintLicence({
      expiresAt: "2030-06-01T00:00:00.000Z",
      graceEndsAt: "2030-06-08T00:00:00.000Z",
      issuedAt: "2030-01-01T00:00:00.000Z",
      licenceId: createUuidV7(),
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      permittedDeviceCount: largeDeviceCount,
      pharmacyId: TEST_PHARMACY_ID,
    });

    const installed = await licensing.install({
      actorId: ACTOR_ID,
      encodedLicence,
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date("2030-01-01T00:30:00.000Z"),
      pharmacyId: TEST_PHARMACY_ID,
    });
    expect(installed).toMatchObject({
      status: "licensed",
      licence: { permittedDeviceCount: largeDeviceCount },
    });

    const requeried = await currentAt("2030-03-01T00:00:00.000Z");
    expect(requeried).toMatchObject({
      status: "licensed",
      licence: { permittedDeviceCount: largeDeviceCount },
    });

    const stored = await administrator.query<{
      permitted_device_count: number;
    }>(
      `select permitted_device_count from licence_installations
       where pharmacy_id = $1 and main_device_id = $2
       order by installed_at desc
       limit 1`,
      [TEST_PHARMACY_ID, TEST_MAIN_DEVICE_ID],
    );
    expect(stored.rows[0]?.permitted_device_count).toBe(largeDeviceCount);
  });

  // The grace rule, end to end through the stored document and Trusted Breev
  // Time: the signed expiry opens grace with every paid capability intact,
  // and the signed grace end closes it to Free Core. Every instant here is
  // later than any instant above, because the high-water mark only advances.
  it("honours the signed grace end: paid work continues after expiry and stops at graceEndsAt", async () => {
    await licensing.install({
      actorId: ACTOR_ID,
      encodedLicence: mintLicence({
        expiresAt: "2031-01-01T00:00:00.000Z",
        graceEndsAt: "2031-01-08T00:00:00.000Z",
        issuedAt: "2030-07-01T00:00:00.000Z",
        licenceId: createUuidV7(),
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        permittedDeviceCount: 3,
        pharmacyId: TEST_PHARMACY_ID,
      }),
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date("2030-07-01T00:00:00.000Z"),
      pharmacyId: TEST_PHARMACY_ID,
    });
    expect((await currentAt("2030-12-31T23:59:59.999Z")).status).toBe(
      "licensed",
    );

    const grace = await currentAt("2031-01-01T00:00:00.000Z");
    expect(grace).toMatchObject({
      status: "grace",
      licence: { permittedDeviceCount: 3 },
    });
    expect(grace.capabilities).toContain("additional-device-pos");
    expect((await currentAt("2031-01-07T23:59:59.999Z")).status).toBe("grace");

    expect(await currentAt("2031-01-08T00:00:00.000Z")).toEqual({
      status: "expired",
      capabilities: FREE_CORE_CAPABILITIES,
      licence: null,
    });
  });

  async function waitForBlockedAdvance(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const waiting = await administrator.query<{ count: string }>(
        `select count(*)::text as count from pg_locks
         where locktype = 'advisory' and not granted`,
      );
      if (waiting.rows[0]?.count !== "0") return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("The concurrent trusted-time advance never blocked");
  }

  async function currentAt(value: string) {
    return await licensing.current({
      actorId: ACTOR_ID,
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date(value),
      pharmacyId: TEST_PHARMACY_ID,
    });
  }

  async function deactivateAt(value: string) {
    const client = await database.requirePool().connect();
    try {
      await client.query("begin");
      const result = await licensing.deactivate(client, {
        actorId: ACTOR_ID,
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        now: new Date(value),
        pharmacyId: TEST_PHARMACY_ID,
      });
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function rollbackAuditCount(): Promise<string | undefined> {
    const result = await administrator.query<{ count: string }>(
      `select count(*)::text as count from licensing_audit_records
       where action = 'trusted-time.rollback'`,
    );
    return result.rows[0]?.count;
  }

  async function pharmacyOwnedData() {
    const result = await database.requirePool().query<{
      licence_count: string;
      name: string;
      role_count: string;
      user_count: string;
    }>(
      `select pharmacy.name,
              (select count(*)::text from pharmacy_roles role
               where role.pharmacy_id = pharmacy.id) as role_count,
              (select count(*)::text from identity_users identity_user
               where identity_user.pharmacy_id = pharmacy.id) as user_count,
              (select count(*)::text from licence_installations installation
               where installation.pharmacy_id = pharmacy.id) as licence_count
       from pharmacies pharmacy
       where pharmacy.id = $1`,
      [TEST_PHARMACY_ID],
    );
    return result.rows;
  }
});
