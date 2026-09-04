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
/** The last migration before custom roles; the upgrade under test is 0011. */
const PRE_UPGRADE_MIGRATION_INDEX = 10;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface RoleSnapshot {
  readonly id: string;
  readonly revision: string;
  readonly role_key: string | null;
}

/**
 * A pharmacy that bootstrapped before 0011, upgraded through it.
 *
 * The migrations must keep every role id and user assignment exactly as they
 * found them. The built-in manager receives role administration in 0011 and
 * the owner receives the two live purchasing permissions in 0012, with each
 * touched role revision advanced once.
 */
describe.sequential("migration 0011: custom roles upgrade", () => {
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
  const supportRoleId = createUuidV7();

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

    // Migrate to the state a pre-0011 installation is in: the same files, the
    // same migration schema and table, a journal cut off before 0011.
    preUpgradeFolder = await mkdtemp(path.join(tmpdir(), "breev-pre-0011-"));
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

    // Live pharmacy data as bootstrap and administration would have left it.
    await application.query(
      "insert into pharmacies (id, name) values ($1, 'Pre-upgrade Pharmacy')",
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
       values ($1, $2, 'manager'), ($3, $2, 'support')`,
      [managerRoleId, pharmacyId, supportRoleId],
    );
    await application.query(
      `insert into identity_users (
         id, pharmacy_id, username, username_key, display_name, role_id,
         password_hash, password_algorithm, password_version,
         password_memory_kib, password_iterations, password_parallelism
       ) values ($1, $2, 'upgrade.manager', 'upgrade.manager', 'Upgrade Manager',
                 $3, $4, 'argon2id', 19, 19456, 2, 1)`,
      [managerId, pharmacyId, managerRoleId, randomBytes(64)],
    );
    await application.query(
      `insert into permission_definitions (name)
       values ('attendance.record') on conflict (name) do nothing`,
    );
    await application.query(
      `insert into role_permission_grants
         (pharmacy_id, role_id, permission_name, granted_by)
       values ($1, $2, 'attendance.record', $3)`,
      [pharmacyId, supportRoleId, ownerId],
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

  it("preserves identities while granting manager and owner permissions once", async () => {
    const rolesBefore = await snapshotRoles();
    const grantsBefore = await snapshotGrants();
    const usersBefore = await snapshotUsers();
    const revisionBefore = await pharmacyRevision();
    expect(rolesBefore.map((role) => role.role_key).sort()).toEqual([
      "manager",
      "owner",
      "support",
    ]);

    await runMigrations(application, databaseRoles.migrationUrl);

    const rolesAfter = await snapshotRoles();
    expect(rolesAfter.map(({ id, role_key }) => ({ id, role_key }))).toEqual(
      rolesBefore.map(({ id, role_key }) => ({ id, role_key })),
    );
    for (const before of rolesBefore) {
      const after = rolesAfter.find((role) => role.id === before.id);
      expect(after?.revision, before.role_key ?? before.id).toBe(
        before.role_key === "manager" || before.role_key === "owner"
          ? String(BigInt(before.revision) + 1n)
          : before.revision,
      );
    }
    expect(await snapshotUsers()).toEqual(usersBefore);
    expect(await snapshotGrants()).toEqual(
      [
        ...grantsBefore,
        {
          granted_by: ownerId,
          permission_name: "identity.roles.manage",
          role_id: managerRoleId,
        },
        {
          granted_by: ownerId,
          permission_name: "purchases.drafts.manage",
          role_id: ownerRoleId,
        },
        {
          granted_by: ownerId,
          permission_name: "suppliers.manage",
          role_id: ownerRoleId,
        },
      ].sort(compareGrants),
    );
    expect(await pharmacyRevision()).toBe(String(BigInt(revisionBefore) + 2n));

    const actions = await application.query<{ name: string }>(
      `select name from step_up_action_definitions
       where name in ('identity.role.create', 'identity.role.rename')
       order by name`,
    );
    expect(actions.rows.map(({ name }) => name)).toEqual([
      "identity.role.create",
      "identity.role.rename",
    ]);

    // Running the migrations again changes nothing more.
    await runMigrations(application, databaseRoles.migrationUrl);
    expect(await snapshotRoles()).toEqual(rolesAfter);
    expect(await pharmacyRevision()).toBe(String(BigInt(revisionBefore) + 2n));
  }, 120_000);

  it("enforces one identity per role, unique custom names, and the owner floor in PostgreSQL", async () => {
    await expect(
      application.query(
        `insert into pharmacy_roles (pharmacy_id, role_key, custom_name, custom_name_key)
         values ($1, 'pharmacist', 'Both', 'both')`,
        [pharmacyId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      application.query(
        "insert into pharmacy_roles (pharmacy_id) values ($1)",
        [pharmacyId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      application.query(
        `insert into pharmacy_roles (pharmacy_id, custom_name, custom_name_key)
         values ($1, ' Padded ', 'padded')`,
        [pharmacyId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await application.query(
      `insert into pharmacy_roles (pharmacy_id, custom_name, custom_name_key)
       values ($1, 'Senior cashier', 'senior cashier')`,
      [pharmacyId],
    );
    await expect(
      application.query(
        `insert into pharmacy_roles (pharmacy_id, custom_name, custom_name_key)
         values ($1, 'SENIOR CASHIER', 'senior cashier')`,
        [pharmacyId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      application.query(
        `insert into pharmacy_roles (pharmacy_id, role_key)
         values ($1, 'manager')`,
        [pharmacyId],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      administrator.query(
        `delete from role_permission_grants
         where role_id = $1 and permission_name = 'identity.users.manage'`,
        [ownerRoleId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "owner_role_permission_floor",
    });
  });

  async function snapshotRoles(): Promise<RoleSnapshot[]> {
    const result = await application.query<RoleSnapshot>(
      `select id, role_key::text, revision::text
       from pharmacy_roles where pharmacy_id = $1 order by id`,
      [pharmacyId],
    );
    return result.rows;
  }

  async function snapshotGrants(): Promise<
    { granted_by: string; permission_name: string; role_id: string }[]
  > {
    const result = await application.query<{
      granted_by: string;
      permission_name: string;
      role_id: string;
    }>(
      `select role_id, permission_name, granted_by
       from role_permission_grants where pharmacy_id = $1`,
      [pharmacyId],
    );
    return result.rows.sort(compareGrants);
  }

  async function snapshotUsers(): Promise<{ id: string; role_id: string }[]> {
    const result = await application.query<{ id: string; role_id: string }>(
      `select id, role_id from identity_users
       where pharmacy_id = $1 order by id`,
      [pharmacyId],
    );
    return result.rows;
  }

  async function pharmacyRevision(): Promise<string> {
    const result = await application.query<{ identity_revision: string }>(
      "select identity_revision::text from pharmacies where id = $1",
      [pharmacyId],
    );
    return result.rows[0]?.identity_revision ?? "";
  }
});

function compareGrants(
  left: { permission_name: string; role_id: string },
  right: { permission_name: string; role_id: string },
): number {
  return (
    left.role_id.localeCompare(right.role_id) ||
    left.permission_name.localeCompare(right.permission_name)
  );
}

function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
