import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { FREE_CORE_CAPABILITIES } from "./entitlement.js";
import {
  TEST_MAIN_DEVICE_ID,
  TEST_PAID_LICENCE,
  TEST_PHARMACY_ID,
  TEST_RENEWED_LICENCE,
} from "./licence-fixtures.test.js";
import { LicensingService } from "./licensing.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const ACTOR_ID = "019b0000-0000-7000-8000-000000000107";

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

    const expired = await currentAt("2027-01-01T00:00:00.000Z");
    expect(expired.status).toBe("expired");
    expect(expired.capabilities).toEqual(FREE_CORE_CAPABILITIES);

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
      administrator.query(
        "update licensing_audit_records set outcome = 'denied'",
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.requirePool().query("delete from licence_installations"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("serializes concurrent high-water advances across service instances", async () => {
    const first = new LicensingService(database);
    const second = new LicensingService(database);
    const results = await Promise.all([
      first.current({
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        now: new Date("2028-01-01T00:00:00.000Z"),
        pharmacyId: TEST_PHARMACY_ID,
      }),
      second.current({
        mainDeviceId: TEST_MAIN_DEVICE_ID,
        now: new Date("2028-01-01T00:00:00.000Z"),
        pharmacyId: TEST_PHARMACY_ID,
      }),
    ]);
    expect(results.every((result) => result.status === "licensed")).toBe(true);
    const marks = await administrator.query<{ count: string }>(
      `select count(*)::text as count from trusted_breev_time_marks
       where lower_bound = '2028-01-01T00:00:00.000Z'`,
    );
    expect(marks.rows[0]?.count).toBe("1");
  });

  async function currentAt(value: string) {
    return await licensing.current({
      actorId: ACTOR_ID,
      mainDeviceId: TEST_MAIN_DEVICE_ID,
      now: new Date(value),
      pharmacyId: TEST_PHARMACY_ID,
    });
  }
});
