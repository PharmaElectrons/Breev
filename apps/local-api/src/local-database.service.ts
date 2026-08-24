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

import {
  hashMainDeviceSecret,
  readMainDeviceProvisioning,
  type MainDeviceProvisioning,
} from "./main-device/main-device-binding.js";

const APPLICATION_DATABASE_ROLE = "breev_app";
const MIGRATION_LOCK_ID = 165_308_855;

interface DatabaseConfiguration {
  readonly applicationUrl: string;
  readonly migrationUrl: string;
}

@Injectable()
export class LocalDatabaseService
  implements OnModuleInit, OnApplicationShutdown
{
  private migrationUrl: string | undefined;
  private readonly pool: Pool | undefined;
  private readonly provisioning: MainDeviceProvisioning | undefined;

  public constructor() {
    const configuration = readDatabaseConfiguration(process.env);
    this.provisioning = readMainDeviceProvisioning(process.env);
    if (configuration === undefined) {
      return;
    }

    this.migrationUrl = configuration.migrationUrl;
    delete process.env.DATABASE_MIGRATION_URL;
    this.pool = createPool(configuration.applicationUrl);
  }

  public async onModuleInit(): Promise<void> {
    if (this.pool === undefined || this.migrationUrl === undefined) {
      return;
    }

    const migrationUrl = this.migrationUrl;
    this.migrationUrl = undefined;
    await runMigrations(this.pool, migrationUrl);
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
  const applicationUrl = environment.DATABASE_URL;
  const migrationUrl = environment.DATABASE_MIGRATION_URL;
  if (applicationUrl === undefined && migrationUrl === undefined) {
    return undefined;
  }
  if (
    applicationUrl === undefined ||
    applicationUrl.length === 0 ||
    migrationUrl === undefined ||
    migrationUrl.length === 0
  ) {
    throw new Error(
      "DATABASE_URL and DATABASE_MIGRATION_URL must be configured together",
    );
  }
  return { applicationUrl, migrationUrl };
}
