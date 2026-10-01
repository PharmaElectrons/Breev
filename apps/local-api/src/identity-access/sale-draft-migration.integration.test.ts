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
const PRE_UPGRADE_MIGRATION_INDEX = 24;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

describe.sequential("migration 0025: Sale Drafts", () => {
  let administrator: Pool;
  let application: Pool;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let preUpgradeFolder: string;

  const pharmacyId = createUuidV7();
  const ownerRoleId = createUuidV7();
  const ownerId = createUuidV7();
  const managerRoleId = createUuidV7();
  const managerId = createUuidV7();
  const pharmacistRoleId = createUuidV7();
  const salesRoleId = createUuidV7();

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

    preUpgradeFolder = await mkdtemp(path.join(tmpdir(), "breev-pre-0025-"));
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
    const client = await administrator.connect();
    try {
      await migrate(drizzle({ client }), {
        migrationsFolder: preUpgradeFolder,
        migrationsSchema: "breev_migrations",
        migrationsTable: "breev_schema_migrations",
      });
    } finally {
      client.release();
    }

    await application.query(
      "insert into pharmacies (id, name) values ($1, 'Sale Draft Pharmacy')",
      [pharmacyId],
    );
    await seedOwnerRoleWithFloor(application, {
      actorId: ownerId,
      displayName: "Sale Draft Owner",
      pharmacyId,
      roleId: ownerRoleId,
      username: "sale-draft.owner",
    });
    await application.query(
      `insert into pharmacy_roles (id, pharmacy_id, role_key)
       values ($1, $2, 'manager'), ($3, $2, 'pharmacist'),
              ($4, $2, 'sales_employee')`,
      [managerRoleId, pharmacyId, pharmacistRoleId, salesRoleId],
    );
    await application.query(
      `insert into identity_users (
         id, pharmacy_id, username, username_key, display_name, role_id,
         password_hash, password_algorithm, password_version,
         password_memory_kib, password_iterations, password_parallelism
       ) values ($1, $2, 'sale-draft.manager', 'sale-draft.manager',
                 'Sale Draft Manager', $3, $4, 'argon2id', 19, 19456, 2, 1)`,
      [managerId, pharmacyId, managerRoleId, randomBytes(64)],
    );
  }, 120_000);

  afterAll(async () => {
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    if (preUpgradeFolder !== undefined) {
      await rm(preUpgradeFolder, { force: true, recursive: true });
    }
  });

  it("upgrades the minimal draft with lines, lifecycle states, permission, and default grants", async () => {
    const roleRevisionsBefore = await roleRevisions();
    const pharmacyRevisionBefore = await pharmacyRevision();

    await runMigrations(application, databaseRoles.migrationUrl);

    const columns = await application.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'sale_drafts'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "pharmacy_id",
      "status",
      "version",
      "created_at",
      "created_by",
      "updated_at",
      "updated_by",
      "device_id",
      "invoice_discount_fils",
    ]);
    const constraints = await application.query<{ conname: string }>(
      `select conname from pg_constraint
       where conrelid = 'sale_drafts'::regclass order by conname`,
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        "sale_drafts_id_uuidv7",
        "sale_drafts_time_order",
        "sale_drafts_version_positive",
      ]),
    );
    const statuses = await application.query<{ status: string }>(
      "select unnest(enum_range(null::sale_draft_status))::text as status",
    );
    expect(statuses.rows.map((row) => row.status)).toEqual([
      "active",
      "suspended",
      "discarded",
    ]);
    const lineColumns = await application.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'sale_draft_lines'
       order by ordinal_position`,
    );
    expect(lineColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        "draft_id",
        "product_id",
        "unit_id",
        "quantity",
        "unit_price_fils",
        "line_discount_percentage",
        "price_version",
        "price_captured_at",
      ]),
    );
    const permission = await application.query<{ name: string }>(
      "select name from permission_definitions where name = 'sales.drafts.manage'",
    );
    expect(permission.rows).toEqual([{ name: "sales.drafts.manage" }]);
    const grants = await application.query<{
      permission_name: string;
      role_key: string;
    }>(
      `select role.role_key, grant_row.permission_name
       from role_permission_grants grant_row
       join pharmacy_roles role on role.id = grant_row.role_id
       where grant_row.pharmacy_id = $1
         and grant_row.permission_name = 'sales.drafts.manage'
       order by role.role_key::text`,
      [pharmacyId],
    );
    expect(grants.rows).toEqual([
      { permission_name: "sales.drafts.manage", role_key: "manager" },
      { permission_name: "sales.drafts.manage", role_key: "owner" },
      { permission_name: "sales.drafts.manage", role_key: "pharmacist" },
      { permission_name: "sales.drafts.manage", role_key: "sales_employee" },
    ]);
    expect(await roleRevisions()).toEqual(
      Object.fromEntries(
        Object.entries(roleRevisionsBefore).map(([roleKey, revision]) => [
          roleKey,
          ["manager", "owner"].includes(roleKey)
            ? String(BigInt(revision) + 4n)
            : ["pharmacist", "sales_employee"].includes(roleKey)
              ? String(BigInt(revision) + 1n)
              : revision,
        ]),
      ),
    );
    expect(await pharmacyRevision()).toBe(
      String(BigInt(pharmacyRevisionBefore) + 4n),
    );

    await runMigrations(application, databaseRoles.migrationUrl);
    expect(await roleRevisions()).toEqual(await roleRevisions());
  }, 120_000);

  it("guards Sale Drafts against direct deletion and immutable-fact mutation", async () => {
    const draft = await application.query<{ id: string }>(
      `insert into sale_drafts (
         pharmacy_id, created_by, updated_by, device_id
       ) values ($1, $2, $2, $3)
       returning id`,
      [pharmacyId, ownerId, createUuidV7()],
    );
    const draftId = draft.rows[0]?.id;
    if (draftId === undefined) throw new Error("Sale Draft was not inserted");

    const mutations: (() => Promise<unknown>)[] = [
      () =>
        administrator.query(
          "delete from sale_drafts where pharmacy_id = $1 and id = $2",
          [pharmacyId, draftId],
        ),
      () =>
        administrator.query(
          `update sale_drafts set version = version + 2
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, draftId],
        ),
      () =>
        administrator.query(
          `update sale_drafts set created_by = $3
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, draftId, managerId],
        ),
    ];
    for (const mutation of mutations) {
      await expect(mutation()).rejects.toMatchObject({ code: "55000" });
    }
  });

  async function roleRevisions(): Promise<Record<string, string>> {
    const result = await application.query<{
      revision: string;
      role_key: string;
    }>(
      `select role_key, revision::text
       from pharmacy_roles where pharmacy_id = $1 order by role_key`,
      [pharmacyId],
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.role_key, row.revision]),
    );
  }

  async function pharmacyRevision(): Promise<string> {
    const result = await application.query<{ identity_revision: string }>(
      "select identity_revision::text from pharmacies where id = $1",
      [pharmacyId],
    );
    return result.rows[0]?.identity_revision ?? "";
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
