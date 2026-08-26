import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { PgBoss } from "pg-boss";

import { readDatabaseConnectionString } from "./database-connection.js";
import {
  hashMainDeviceSecret,
  readMainDeviceProvisioning,
  type MainDeviceProvisioning,
} from "./main-device/main-device-binding.js";

const APPLICATION_DATABASE_ROLE = "breev_app";
const MIGRATION_LOCK_ID = 165_308_855;

interface DatabaseConfiguration {
  readonly applicationUrl: string;
  readonly migrationUrl?: string;
}

@Injectable()
export class LocalDatabaseService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly applicationUrl: string | undefined;
  private migrationUrl: string | undefined;
  private readonly pool: Pool | undefined;
  private readonly provisioning: MainDeviceProvisioning | undefined;

  public constructor() {
    const configuration = readDatabaseConfiguration(process.env);
    this.provisioning = readMainDeviceProvisioning(process.env);
    if (configuration === undefined) {
      return;
    }

    this.applicationUrl = configuration.applicationUrl;
    this.migrationUrl = configuration.migrationUrl;
    delete process.env.DATABASE_MIGRATION_URL;
    this.pool = createPool(configuration.applicationUrl);
  }

  public async onModuleInit(): Promise<void> {
    if (this.pool === undefined) {
      return;
    }

    const migrationUrl = this.migrationUrl;
    this.migrationUrl = undefined;
    if (migrationUrl !== undefined) {
      await runMigrations(this.pool, migrationUrl);
    }
    if (this.provisioning === undefined) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await provisionMainDevice(client, this.provisioning);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  public getApplicationUrl(): string | undefined {
    return this.applicationUrl;
  }

  public async isAvailable(): Promise<boolean> {
    if (this.pool === undefined) {
      return false;
    }

    try {
      await this.pool.query("select 1 as breev_health");
      return true;
    } catch {
      return false;
    }
  }

  public requirePool(): Pool {
    if (this.pool === undefined) {
      throw new Error("The Breev local database is unavailable");
    }
    return this.pool;
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}

async function runMigrations(
  applicationPool: Pool,
  migrationUrl: string,
): Promise<void> {
  const migrationPool = createPool(migrationUrl);
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
    await migrationPool.end();
  }
}

async function migratePgBoss(
  migrationUrl: string,
  migrationClient: PoolClient,
): Promise<void> {
  const versionCheck = await migrationClient.query<{ exists: boolean }>(
    `select exists(
       select 1 from information_schema.tables
       where table_schema = 'pgboss' and table_name = 'version'
     ) as exists`,
  );

  if (!versionCheck.rows[0]?.exists) {
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

async function provisionMainDevice(
  client: PoolClient,
  provisioning: MainDeviceProvisioning,
): Promise<void> {
  const credentialHash = hashMainDeviceSecret(provisioning.deviceSecret);
  const sessionHash = hashMainDeviceSecret(provisioning.sessionToken);

  await client.query(
    `insert into main_devices (id, credential_hash)
     values ($1, $2)
     on conflict (id) do nothing`,
    [provisioning.deviceId, credentialHash],
  );
  const device = await client.query<{ credential_hash: Buffer }>(
    "select credential_hash from main_devices where id = $1",
    [provisioning.deviceId],
  );
  const storedCredential = device.rows[0]?.credential_hash;
  if (
    storedCredential === undefined ||
    storedCredential.length !== credentialHash.length ||
    !timingSafeEqual(storedCredential, credentialHash)
  ) {
    throw new Error("The configured Main device credential does not match");
  }

  await client.query(
    `insert into main_device_sessions (token_hash, device_id)
     values ($1, $2)
     on conflict (token_hash) do nothing`,
    [sessionHash, provisioning.deviceId],
  );
  const session = await client.query<{ device_id: string }>(
    "select device_id from main_device_sessions where token_hash = $1",
    [sessionHash],
  );
  if (session.rows[0]?.device_id !== provisioning.deviceId) {
    throw new Error("The configured Main session belongs to another device");
  }
}

function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 1_000,
    idleTimeoutMillis: 1_000,
    max: 5,
  });
  pool.on("error", () => undefined);
  return pool;
}

function readDatabaseConfiguration(
  environment: NodeJS.ProcessEnv,
): DatabaseConfiguration | undefined {
  const applicationUrl = readDatabaseConnectionString(environment);
  const migrationUrl = environment.DATABASE_MIGRATION_URL?.trim();
  if (applicationUrl === undefined && migrationUrl === undefined) {
    return undefined;
  }
  if (applicationUrl === undefined) {
    throw new Error(
      "DATABASE_URL or DATABASE_URL_FILE is required when DATABASE_MIGRATION_URL is configured",
    );
  }
  if (migrationUrl === "") {
    throw new Error("DATABASE_MIGRATION_URL must not be empty");
  }
  return migrationUrl === undefined
    ? { applicationUrl }
    : { applicationUrl, migrationUrl };
}
