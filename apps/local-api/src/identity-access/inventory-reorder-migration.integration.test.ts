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
const PRE_UPGRADE_MIGRATION_INDEX = 23;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface DatabaseSnapshot {
  readonly grants: readonly (readonly [string, string])[];
  readonly pharmacyRevision: string;
  readonly revisions: Readonly<Record<string, string>>;
}

describe.sequential("migration 0024: inventory reorder basket", () => {
  let administrator: Pool;
  let application: Pool;
  let secondaryAdministrator: Pool;
  let secondaryApplication: Pool;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let preUpgradeFolder: string;
  let secondaryDatabaseName: string;
  let rootDatabaseUrl: string;

  const pharmacyId = createUuidV7();
  const ownerRoleId = createUuidV7();
  const ownerId = createUuidV7();
  const managerRoleId = createUuidV7();
  const pharmacistRoleId = createUuidV7();
  const inventoryRoleId = createUuidV7();
  const purchasingRoleId = createUuidV7();
  const salesRoleId = createUuidV7();
  const secondaryPharmacyId = createUuidV7();
  const secondaryOwnerRoleId = createUuidV7();
  const secondaryOwnerId = createUuidV7();
  const secondaryPurchasingRoleId = createUuidV7();

  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      rootDatabaseUrl = postgres.getConnectionUri();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      rootDatabaseUrl = administratorUrl;
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    application = new Pool({ connectionString: databaseRoles.applicationUrl });

    secondaryDatabaseName = `breev_reorder_${randomBytes(8).toString("hex")}`;
    await createSecondaryDatabase(rootDatabaseUrl, secondaryDatabaseName);
    const secondaryMigrationUrl = databaseUrl(
      databaseRoles.migrationUrl,
      secondaryDatabaseName,
    );
    const secondaryApplicationUrl = databaseUrl(
      databaseRoles.applicationUrl,
      secondaryDatabaseName,
    );
    secondaryAdministrator = new Pool({
      connectionString: secondaryMigrationUrl,
    });
    secondaryApplication = new Pool({
      connectionString: secondaryApplicationUrl,
    });

    preUpgradeFolder = await mkdtemp(path.join(tmpdir(), "breev-pre-0024-"));
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
    await migrateToBaseline(administrator);
    await migrateToBaseline(secondaryAdministrator);

    await application.query(
      "insert into pharmacies (id, name) values ($1, 'Inventory Reorder Pharmacy')",
      [pharmacyId],
    );
    await seedOwnerRoleWithFloor(application, {
      actorId: ownerId,
      displayName: "Inventory Reorder Owner",
      pharmacyId,
      roleId: ownerRoleId,
      username: "inventory-reorder.owner",
    });
    await application.query(
      `insert into pharmacy_roles (id, pharmacy_id, role_key)
       values ($1, $2, 'manager'), ($3, $2, 'pharmacist'),
              ($4, $2, 'inventory_employee'), ($5, $2, 'purchasing_employee'),
              ($6, $2, 'sales_employee')`,
      [
        managerRoleId,
        pharmacyId,
        pharmacistRoleId,
        inventoryRoleId,
        purchasingRoleId,
        salesRoleId,
      ],
    );
    await application.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) values
         ($1, $2, 'catalog.item.search', $3),
         ($1, $2, 'inventory.review', $3),
         ($1, $2, 'purchases.costs.view', $3),
         ($1, $2, 'purchases.drafts.manage', $3),
         ($1, $2, 'purchases.posted.view', $3)`,
      [pharmacyId, purchasingRoleId, ownerId],
    );

    await secondaryApplication.query(
      "insert into pharmacies (id, name) values ($1, 'Customized Reorder Pharmacy')",
      [secondaryPharmacyId],
    );
    await seedOwnerRoleWithFloor(secondaryApplication, {
      actorId: secondaryOwnerId,
      displayName: "Customized Reorder Owner",
      pharmacyId: secondaryPharmacyId,
      roleId: secondaryOwnerRoleId,
      username: "customized-reorder.owner",
    });
    await secondaryApplication.query(
      `insert into pharmacy_roles (id, pharmacy_id, role_key)
       values ($1, $2, 'purchasing_employee')`,
      [secondaryPurchasingRoleId, secondaryPharmacyId],
    );
    await secondaryApplication.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) values
         ($1, $2, 'catalog.item.search', $3),
         ($1, $2, 'suppliers.manage', $3)`,
      [secondaryPharmacyId, secondaryPurchasingRoleId, secondaryOwnerId],
    );
  }, 120_000);

  afterAll(async () => {
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await secondaryApplication?.end().catch(() => undefined);
    await secondaryAdministrator?.end().catch(() => undefined);
    if (secondaryDatabaseName !== undefined && rootDatabaseUrl !== undefined) {
      const root = new Pool({ connectionString: rootDatabaseUrl });
      await root
        .query(
          `drop database if exists "${secondaryDatabaseName}" with (force)`,
        )
        .catch(() => undefined);
      await root.end().catch(() => undefined);
    }
    await postgres?.stop().catch(() => undefined);
    if (preUpgradeFolder !== undefined) {
      await rm(preUpgradeFolder, { force: true, recursive: true });
    }
  });

  it("grants the reorder permissions once and preserves customized roles", async () => {
    const before = await snapshot(application, pharmacyId);
    const secondaryBefore = await snapshot(
      secondaryApplication,
      secondaryPharmacyId,
    );
    const defaultBefore = await purchasingGrants(application, purchasingRoleId);
    const customizedBefore = await purchasingGrants(
      secondaryApplication,
      secondaryPurchasingRoleId,
    );

    await runMigrations(application, databaseRoles.migrationUrl);
    await runMigrations(
      secondaryApplication,
      databaseUrl(databaseRoles.migrationUrl, secondaryDatabaseName),
    );

    const after = await snapshot(application, pharmacyId);
    const secondaryAfter = await snapshot(
      secondaryApplication,
      secondaryPharmacyId,
    );
    expect(after.grants).toEqual([
      ["inventory_employee", "inventory.reorder.manage"],
      ["manager", "inventory.reorder.confirm"],
      ["manager", "inventory.reorder.manage"],
      ["owner", "inventory.reorder.confirm"],
      ["owner", "inventory.reorder.manage"],
      ["pharmacist", "inventory.reorder.manage"],
      ["purchasing_employee", "inventory.reorder.confirm"],
      ["purchasing_employee", "inventory.reorder.manage"],
      ["sales_employee", "inventory.reorder.manage"],
    ]);
    expect(secondaryAfter.grants).toEqual([
      ["owner", "inventory.reorder.confirm"],
      ["owner", "inventory.reorder.manage"],
    ]);
    expect(defaultBefore).toEqual([
      "catalog.item.search",
      "inventory.review",
      "purchases.costs.view",
      "purchases.drafts.manage",
      "purchases.posted.view",
    ]);
    expect(await purchasingGrants(application, purchasingRoleId)).toEqual(
      [
        ...defaultBefore,
        "inventory.reorder.confirm",
        "inventory.reorder.manage",
      ].sort(),
    );

    expectRevisionDelta(before, after, new Set(Object.keys(before.revisions)));
    expectRevisionDelta(secondaryBefore, secondaryAfter, new Set(["owner"]));
    expect(
      await purchasingGrants(secondaryApplication, secondaryPurchasingRoleId),
    ).toEqual(customizedBefore);

    await runMigrations(application, databaseRoles.migrationUrl);
    await runMigrations(
      secondaryApplication,
      databaseUrl(databaseRoles.migrationUrl, secondaryDatabaseName),
    );
    expect(await snapshot(application, pharmacyId)).toEqual(after);
    expect(await snapshot(secondaryApplication, secondaryPharmacyId)).toEqual(
      secondaryAfter,
    );
  }, 120_000);

  async function migrateToBaseline(pool: Pool): Promise<void> {
    const migrationClient = await pool.connect();
    try {
      await migrate(drizzle({ client: migrationClient }), {
        migrationsFolder: preUpgradeFolder,
        migrationsSchema: "breev_migrations",
        migrationsTable: "breev_schema_migrations",
      });
    } finally {
      migrationClient.release();
    }
  }

  async function snapshot(
    pool: Pool,
    targetPharmacyId: string,
  ): Promise<DatabaseSnapshot> {
    const grants = await pool.query<{
      permission_name: string;
      role_key: string;
    }>(
      `select role.role_key, grant_row.permission_name
       from role_permission_grants grant_row
       join pharmacy_roles role on role.id = grant_row.role_id
       where grant_row.pharmacy_id = $1
         and grant_row.permission_name in (
           'inventory.reorder.confirm', 'inventory.reorder.manage'
         )
       order by role.role_key::text, grant_row.permission_name`,
      [targetPharmacyId],
    );
    const revisions = await pool.query<{
      revision: string;
      role_key: string;
    }>(
      `select role_key, revision::text
       from pharmacy_roles where pharmacy_id = $1 order by role_key`,
      [targetPharmacyId],
    );
    const pharmacy = await pool.query<{ revision: string }>(
      "select identity_revision::text as revision from pharmacies where id = $1",
      [targetPharmacyId],
    );
    return {
      grants: grants.rows.map(
        (row) => [row.role_key, row.permission_name] as const,
      ),
      pharmacyRevision: pharmacy.rows[0]?.revision ?? "",
      revisions: Object.fromEntries(
        revisions.rows.map((row) => [row.role_key, row.revision]),
      ),
    };
  }

  async function purchasingGrants(
    pool: Pool,
    roleId: string,
  ): Promise<string[]> {
    const result = await pool.query<{ permission_name: string }>(
      `select permission_name from role_permission_grants
       where role_id = $1 order by permission_name`,
      [roleId],
    );
    return result.rows.map(({ permission_name }) => permission_name);
  }
});

function expectRevisionDelta(
  before: DatabaseSnapshot,
  after: DatabaseSnapshot,
  touchedRoles: ReadonlySet<string>,
): void {
  const expected = Object.fromEntries(
    Object.entries(before.revisions).map(([roleKey, revision]) => [
      roleKey,
      touchedRoles.has(roleKey) ? String(BigInt(revision) + 1n) : revision,
    ]),
  );
  expect(after.revisions).toEqual(expected);
  expect(after.pharmacyRevision).toBe(
    String(BigInt(before.pharmacyRevision) + 1n),
  );
}

async function createSecondaryDatabase(
  rootDatabaseUrl: string,
  databaseName: string,
): Promise<void> {
  const root = new Pool({ connectionString: rootDatabaseUrl });
  try {
    await root.query(`create database "${databaseName}"`);
  } finally {
    await root.end();
  }
  const secondaryRootUrl = databaseUrl(rootDatabaseUrl, databaseName);
  const secondaryRoot = new Pool({ connectionString: secondaryRootUrl });
  try {
    await secondaryRoot.query(
      `grant create on database "${databaseName}" to breev_schema_owner;
       revoke create on schema public from public;
       grant usage, create on schema public to breev_schema_owner;
       grant usage on schema public to breev_app;`,
    );
  } finally {
    await secondaryRoot.end();
  }
}

function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
