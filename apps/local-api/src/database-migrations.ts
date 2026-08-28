import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { PgBoss } from "pg-boss";

const APPLICATION_DATABASE_ROLE = "breev_app";
const MIGRATION_LOCK_ID = 165_308_855;

export async function runMigrations(
  applicationPool: Pool,
  migrationUrl: string,
): Promise<void> {
  const migrationPool = createMigrationPool(migrationUrl);
  try {
    const migrationClient = await migrationPool.connect();
    try {
      await assertSeparatedDatabaseRoles(applicationPool, migrationClient);
      await migrationClient.query("select pg_advisory_lock($1)", [
        MIGRATION_LOCK_ID,
      ]);
      try {
        await migrate(drizzle({ client: migrationClient }), {
          migrationsFolder: path.resolve(import.meta.dirname, "../drizzle"),
          migrationsSchema: "breev_migrations",
          migrationsTable: "breev_schema_migrations",
        });
        await migratePgBoss(migrationUrl, migrationClient);
      } finally {
        await migrationClient.query("select pg_advisory_unlock($1)", [
          MIGRATION_LOCK_ID,
        ]);
      }
    } finally {
      migrationClient.release();
    }
  } finally {
    await migrationPool.end();
  }
}

async function migratePgBoss(
  migrationUrl: string,
  migrationClient: PoolClient,
): Promise<void> {
  const boss = new PgBoss({
    connectionString: migrationUrl,
    createSchema: true,
    migrate: true,
    schedule: false,
    schema: "pgboss",
    supervise: false,
  });
  await boss.start();
  await boss.stop({ graceful: false });

  await migrationClient.query(`
    grant usage on schema pgboss to breev_app;
    grant select, insert, update, delete on all tables in schema pgboss to breev_app;
    grant usage, select, update on all sequences in schema pgboss to breev_app;
    grant execute on all functions in schema pgboss to breev_app;
    alter default privileges in schema pgboss grant select, insert, update, delete on tables to breev_app;
    alter default privileges in schema pgboss grant usage, select, update on sequences to breev_app;
    alter default privileges in schema pgboss grant execute on functions to breev_app;
  `);
}

async function assertSeparatedDatabaseRoles(
  applicationPool: Pool,
  migrationClient: PoolClient,
): Promise<void> {
  const application = await applicationPool.query<{
    can_create_schema: boolean;
    role_name: string;
    rolsuper: boolean;
  }>(
    `select current_user as role_name,
            rolsuper,
            has_schema_privilege(current_user, 'public', 'create')
              as can_create_schema
     from pg_roles
     where rolname = current_user`,
  );
  const migration = await migrationClient.query<{
    role_name: string;
    rolsuper: boolean;
  }>(
    `select current_user as role_name, rolsuper
     from pg_roles
     where rolname = current_user`,
  );
  const applicationRole = application.rows[0];
  const migrationRole = migration.rows[0];
  if (
    applicationRole === undefined ||
    migrationRole === undefined ||
    applicationRole.role_name !== APPLICATION_DATABASE_ROLE ||
    applicationRole.role_name === migrationRole.role_name ||
    applicationRole.rolsuper ||
    applicationRole.can_create_schema ||
    migrationRole.rolsuper
  ) {
    throw new Error(
      "Breev requires separate least-privilege application and schema-owner database roles",
    );
  }
}

function createMigrationPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 1_000,
    idleTimeoutMillis: 1_000,
    max: 5,
  });
  pool.on("error", () => undefined);
  return pool;
}
