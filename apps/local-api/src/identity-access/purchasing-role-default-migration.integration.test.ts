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
const PRE_UPGRADE_MIGRATION_INDEX = 15;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

describe.sequential("purchasing role default migrations", () => {
  let administrator: Pool;
  let application: Pool;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let preUpgradeFolder: string;

  const pharmacyId = createUuidV7();
  const ownerRoleId = createUuidV7();
  const ownerId = createUuidV7();
  const purchasingRoleId = createUuidV7();

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

    preUpgradeFolder = await mkdtemp(path.join(tmpdir(), "breev-pre-0016-"));
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
      "insert into pharmacies (id, name) values ($1, 'Pre-0016 Pharmacy')",
      [pharmacyId],
    );
    await seedOwnerRoleWithFloor(application, {
      actorId: ownerId,
      displayName: "Upgrade Owner",
      pharmacyId,
      roleId: ownerRoleId,
      username: "upgrade.owner",
    });
    await application.query(
      `insert into pharmacy_roles (id, pharmacy_id, role_key)
       values ($1, $2, 'purchasing_employee')`,
      [purchasingRoleId, pharmacyId],
    );
    await application.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) values
         ($1, $2, 'catalog.item.search', $3),
         ($1, $2, 'suppliers.manage', $3)`,
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

  it("preserves a customized role and advances an untouched old default once", async () => {
    await runMigrations(application, databaseRoles.migrationUrl);

    expect(await purchasingGrants()).toEqual([
      "catalog.item.search",
      "suppliers.manage",
    ]);
    // 0018, 0019, 0020, 0021, 0022, and 0023 each advance the pharmacy identity revision
    // when their new permission is granted to the owner. This customized
    // purchasing role remains untouched by every default migration.
    expect(await revisions()).toEqual({ pharmacy: "7", role: "1" });

    // Recreate the exact legacy default and execute the migration body to
    // prove the eligible path independently of Drizzle's migration journal.
    await application.query(
      `delete from role_permission_grants
       where role_id = $1 and permission_name = 'suppliers.manage'`,
      [purchasingRoleId],
    );
    const migrationSql = await readFile(
      path.join(MIGRATIONS_FOLDER, "0016_purchasing_role_default.sql"),
      "utf8",
    );
    await administrator.query(migrationSql);

    expect(await purchasingGrants()).toEqual([
      "catalog.item.search",
      "purchases.drafts.manage",
    ]);
    expect(await revisions()).toEqual({ pharmacy: "8", role: "2" });

    const reviewMigrationSql = await readFile(
      path.join(MIGRATIONS_FOLDER, "0018_review_posted_purchases.sql"),
      "utf8",
    );
    await administrator.query(reviewMigrationSql);
    expect(await purchasingGrants()).toEqual([
      "catalog.item.search",
      "purchases.costs.view",
      "purchases.drafts.manage",
      "purchases.posted.view",
    ]);
    expect(await revisions()).toEqual({ pharmacy: "9", role: "3" });

    // Replaying the previous migration must not add duplicate grants or
    // advance either revision.
    await administrator.query(reviewMigrationSql);
    expect(await purchasingGrants()).toEqual([
      "catalog.item.search",
      "purchases.costs.view",
      "purchases.drafts.manage",
      "purchases.posted.view",
    ]);
    expect(await revisions()).toEqual({ pharmacy: "9", role: "3" });
  }, 120_000);

  async function purchasingGrants(): Promise<string[]> {
    const result = await application.query<{ permission_name: string }>(
      `select permission_name
       from role_permission_grants
       where role_id = $1
       order by permission_name`,
      [purchasingRoleId],
    );
    return result.rows.map(({ permission_name }) => permission_name);
  }

  async function revisions(): Promise<{ pharmacy: string; role: string }> {
    const result = await application.query<{
      pharmacy_revision: string;
      role_revision: string;
    }>(
      `select pharmacy_row.identity_revision::text as pharmacy_revision,
              role_row.revision::text as role_revision
       from pharmacies pharmacy_row
       join pharmacy_roles role_row
         on role_row.pharmacy_id = pharmacy_row.id
       where pharmacy_row.id = $1 and role_row.id = $2`,
      [pharmacyId, purchasingRoleId],
    );
    return {
      pharmacy: result.rows[0]?.pharmacy_revision ?? "",
      role: result.rows[0]?.role_revision ?? "",
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
