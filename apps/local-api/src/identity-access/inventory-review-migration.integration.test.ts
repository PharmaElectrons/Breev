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
const PRE_UPGRADE_MIGRATION_INDEX = 18;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

describe.sequential("migration 0021: inventory review", () => {
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
  const inventoryRoleId = createUuidV7();
  const purchasingRoleId = createUuidV7();
  const accountantRoleId = createUuidV7();

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

    preUpgradeFolder = await mkdtemp(path.join(tmpdir(), "breev-pre-0021-"));
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
      "insert into pharmacies (id, name) values ($1, 'Inventory Review Pharmacy')",
      [pharmacyId],
    );
    await seedOwnerRoleWithFloor(application, {
      actorId: ownerId,
      displayName: "Inventory Owner",
      pharmacyId,
      roleId: ownerRoleId,
      username: "inventory.owner",
    });
    await application.query(
      `insert into pharmacy_roles (id, pharmacy_id, role_key)
       values ($1, $2, 'manager'), ($3, $2, 'pharmacist'),
              ($4, $2, 'inventory_employee'), ($5, $2, 'purchasing_employee'),
              ($6, $2, 'accountant')`,
      [
        managerRoleId,
        pharmacyId,
        pharmacistRoleId,
        inventoryRoleId,
        purchasingRoleId,
        accountantRoleId,
      ],
    );
    await application.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) values
         ($1, $2, 'catalog.item.search', $3),
         ($1, $2, 'purchases.costs.view', $3),
         ($1, $2, 'purchases.drafts.manage', $3),
         ($1, $2, 'purchases.posted.view', $3)`,
      [pharmacyId, purchasingRoleId, ownerId],
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

  it("adds the inventory grants, advances each touched role once, and is idempotent", async () => {
    await runMigrations(application, databaseRoles.migrationUrl);
    const first = await snapshot();
    expect(first.grants).toEqual([
      ["accountant", "inventory.valuation.view"],
      ["inventory_employee", "inventory.review"],
      ["manager", "inventory.review"],
      ["manager", "inventory.valuation.view"],
      ["owner", "inventory.review"],
      ["owner", "inventory.valuation.view"],
      ["pharmacist", "inventory.review"],
      ["purchasing_employee", "inventory.review"],
    ]);
    expect(first.revisions).toEqual({
      accountant: "2",
      inventory_employee: "2",
      manager: "2",
      owner: "4",
      pharmacist: "2",
      purchasing_employee: "4",
    });
    expect(first.pharmacyRevision).toBe("4");

    await runMigrations(application, databaseRoles.migrationUrl);
    expect(await snapshot()).toEqual(first);
  }, 120_000);

  async function snapshot(): Promise<{
    readonly grants: string[][];
    readonly pharmacyRevision: string;
    readonly revisions: Record<string, string>;
  }> {
    const grants = await application.query<{
      role_key: string;
      permission_name: string;
    }>(
      `select role.role_key, grant_row.permission_name
       from role_permission_grants grant_row
       join pharmacy_roles role on role.id = grant_row.role_id
       where grant_row.pharmacy_id = $1
         and grant_row.permission_name in (
           'inventory.review', 'inventory.valuation.view'
         )
       order by role.role_key, grant_row.permission_name`,
      [pharmacyId],
    );
    const revisions = await application.query<{
      role_key: string;
      revision: string;
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
      grants: grants.rows
        .map((row) => [row.role_key, row.permission_name] as [string, string])
        .sort(([leftRole, leftPermission], [rightRole, rightPermission]) =>
          leftRole === rightRole
            ? leftPermission.localeCompare(rightPermission)
            : leftRole.localeCompare(rightRole),
        ),
      pharmacyRevision: pharmacy.rows[0]?.revision ?? "",
      revisions: Object.fromEntries(
        revisions.rows.map((row) => [row.role_key, row.revision]),
      ),
    };
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
