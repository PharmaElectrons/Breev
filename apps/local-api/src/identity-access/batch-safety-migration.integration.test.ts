import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { seedOwnerRoleWithFloor } from "../../test/owner-floor-fixture.js";
import { runMigrations } from "../database-migrations.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../drizzle");
const PRE_UPGRADE_MIGRATION_INDEX = 21;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

describe.sequential("migration 0022: batch safety", () => {
  let administrator: Pool;
  let application: Pool;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let preUpgradeFolder: string;

  const pharmacyId = createUuidV7();
  const ownerRoleId = createUuidV7();
  const ownerId = createUuidV7();
  const managerRoleId = createUuidV7();
  const pharmacistRoleId = createUuidV7();
  const productId = createUuidV7();
  const batchId = createUuidV7();
  const unitId = createUuidV7();
  const deviceId = createUuidV7();
  const sessionId = createUuidV7();
  const challengeId = createUuidV7();

  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    application = new Pool({ connectionString: databaseRoles.applicationUrl });

    preUpgradeFolder = await mkdtemp(path.join(tmpdir(), "breev-pre-0022-"));
    const journal = JSON.parse(
      await readFile(
        path.join(MIGRATIONS_FOLDER, "meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: JournalEntry[] };
    const entries = journal.entries.filter(
      (entry) => entry.idx <= PRE_UPGRADE_MIGRATION_INDEX,
    );
    await mkdir(path.join(preUpgradeFolder, "meta"), { recursive: true });
    await writeFile(
      path.join(preUpgradeFolder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries) {
      await copyFile(
        path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
        path.join(preUpgradeFolder, `${entry.tag}.sql`),
      );
    }
    const migrationClient = await administrator.connect();
    try {
      await migrate(drizzle({ client: migrationClient }), {
        migrationsFolder: preUpgradeFolder,
        migrationsSchema: "breev_migrations",
        migrationsTable: "breev_schema_migrations",
      });
    } finally {
      migrationClient.release();
    }

    await application.query(
      "insert into pharmacies (id, name) values ($1, 'Batch Safety Pharmacy')",
      [pharmacyId],
    );
    await seedOwnerRoleWithFloor(application, {
      actorId: ownerId,
      displayName: "Batch Safety Owner",
      pharmacyId,
      roleId: ownerRoleId,
      username: "batch-safety.owner",
    });
    await application.query(
      `insert into pharmacy_roles (id, pharmacy_id, role_key)
       values ($1, $2, 'manager'), ($3, $2, 'pharmacist')`,
      [managerRoleId, pharmacyId, pharmacistRoleId],
    );
    await seedFacts();
  }, 120_000);

  afterAll(async () => {
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    if (preUpgradeFolder !== undefined) {
      await rm(preUpgradeFolder, { force: true, recursive: true });
    }
  });

  it("adds grants and revisions once, then remains idempotent", async () => {
    const before = await snapshot();
    await runMigrations(application, databaseRoles.migrationUrl);
    await seedChallenge();
    const after = await snapshot();

    expect(after.grants).toEqual([
      ["manager", "inventory.batch_safety.manage"],
      ["owner", "inventory.batch_safety.manage"],
      ["pharmacist", "inventory.batch_safety.manage"],
    ]);
    expect(after.revisions).toEqual({
      manager: String(BigInt(before.revisions.manager ?? "0") + 1n),
      owner: String(BigInt(before.revisions.owner ?? "0") + 1n),
      pharmacist: String(BigInt(before.revisions.pharmacist ?? "0") + 1n),
    });
    expect(after.pharmacyRevision).toBe(
      String(BigInt(before.pharmacyRevision) + 1n),
    );

    await runMigrations(application, databaseRoles.migrationUrl);
    expect(await snapshot()).toEqual(after);
  }, 120_000);

  it("keeps the three safety facts append-only and privilege-separated", async () => {
    await application.query(
      `insert into inventory_batch_status_events (
         pharmacy_id, batch_id, product_id, sequence, kind, source,
         reason, evidence, business_date, created_by, device_id
       ) values ($1, $2, $3, 1, 'recalled', 'user', 'Recall test',
                 'Supplier notice', current_date, $4, $5)`,
      [pharmacyId, batchId, productId, ownerId, deviceId],
    );
    await application.query(
      `insert into inventory_batch_safety_runs (
         pharmacy_id, business_date, trigger, evaluated_batch_count,
         newly_expired_count, near_expiry_count
       ) values ($1, '2026-09-11', 'manual', 1, 0, 0)`,
      [pharmacyId],
    );
    await application.query(
      `insert into inventory_batch_expiry_amendments (
         pharmacy_id, batch_id, product_id, sequence, original_expiry_date,
         corrected_expiry_date, reason, evidence, business_date, created_by,
         device_id, approval_challenge_id
       ) values ($1, $2, $3, 1, '2026-09-01', '2026-09-30', 'Correction',
                 'Correction test', '2026-09-11', $4, $5, $6)`,
      [pharmacyId, batchId, productId, ownerId, deviceId, challengeId],
    );

    for (const table of [
      "inventory_batch_status_events",
      "inventory_batch_expiry_amendments",
      "inventory_batch_safety_runs",
    ]) {
      await expect(
        administrator.query(
          `update ${table} set business_date = business_date`,
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        administrator.query(`delete from ${table}`),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        application.query(`truncate ${table}`),
      ).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        application.query(`alter table ${table} disable trigger all`),
      ).rejects.toMatchObject({ code: "42501" });
    }
  }, 120_000);

  async function snapshot(): Promise<{
    readonly grants: string[][];
    readonly pharmacyRevision: string;
    readonly revisions: Record<string, string>;
  }> {
    const grants = await application.query<{
      permission_name: string;
      role_key: string;
    }>(
      `select role.role_key, grant_row.permission_name
       from role_permission_grants grant_row
       join pharmacy_roles role on role.id = grant_row.role_id
       where grant_row.pharmacy_id = $1
         and grant_row.permission_name = 'inventory.batch_safety.manage'
       order by role.role_key::text, grant_row.permission_name`,
      [pharmacyId],
    );
    const revisions = await application.query<{
      revision: string;
      role_key: string;
    }>(
      `select role_key, revision::text
       from pharmacy_roles where pharmacy_id = $1 order by role_key`,
      [pharmacyId],
    );
    const pharmacy = await application.query<{ revision: string }>(
      "select identity_revision::text as revision from pharmacies where id = $1",
      [pharmacyId],
    );
    return {
      grants: grants.rows.map((row) => [row.role_key, row.permission_name]),
      pharmacyRevision: pharmacy.rows[0]?.revision ?? "",
      revisions: Object.fromEntries(
        revisions.rows.map((row) => [row.role_key, row.revision]),
      ),
    };
  }

  async function seedFacts(): Promise<void> {
    const client = await administrator.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into catalog_products (
           id, pharmacy_id, definition_mode, medication_trade_name,
           display_name, name_template_version, externally_visible,
           ai_sharing_allowed, cold_storage_required,
           count_default_unit_id, purchase_default_unit_id, sale_default_unit_id,
           pricing_method, retail_price_fils, created_by, updated_by
         ) values ($1, $2, 'medication', 'Safety Fixture', 'Safety Fixture', 1,
                   false, false, false, $3, $3, $3, 'by-price', 0, $4, $4)`,
        [productId, pharmacyId, unitId, ownerId],
      );
      await client.query(
        `insert into catalog_product_units (
           id, pharmacy_id, product_id, kind, name, ordinal
         ) values ($1, $2, $3, 'inventory', 'Unit', 0)`,
        [unitId, pharmacyId, productId],
      );
      await client.query(
        `insert into inventory_batches (
           id, pharmacy_id, product_id, expiry_date, quantity, created_by
         ) values ($1, $2, $3, '2026-09-30', 1, $4)`,
        [batchId, pharmacyId, productId, ownerId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function seedChallenge(): Promise<void> {
    await administrator.query(
      "insert into main_devices (id, credential_hash) values ($1, $2)",
      [deviceId, Buffer.alloc(32, 1)],
    );
    await administrator.query(
      "insert into main_device_sessions (token_hash, device_id) values ($1, $2)",
      [Buffer.alloc(32, 2), deviceId],
    );
    await administrator.query(
      `insert into identity_sessions (
         id, pharmacy_id, user_id, device_id, device_session_hash, expires_at
       ) values ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
      [sessionId, pharmacyId, ownerId, deviceId, Buffer.alloc(32, 2)],
    );
    await administrator.query(
      `insert into step_up_challenges (
         id, pharmacy_id, actor_user_id, identity_session_id, device_id,
         device_session_hash, action_name, required_permission, subject_id,
         subject_revision, pharmacy_identity_revision, actor_auth_revision,
         role_revision, expires_at, status, resolved_at
       ) values ($1, $2, $3, $4, $5, $6,
                 'inventory.batch_expiry.correct',
                 'inventory.batch_safety.manage', $7, 1, 1, 1, 1,
                 now() + interval '1 hour', 'approved', now())`,
      [
        challengeId,
        pharmacyId,
        ownerId,
        sessionId,
        deviceId,
        Buffer.alloc(32, 2),
        batchId,
      ],
    );
  }
});

function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
