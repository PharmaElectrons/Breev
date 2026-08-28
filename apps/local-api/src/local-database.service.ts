import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { readDatabaseConnectionString } from "./database-connection.js";
import { runMigrations } from "./database-migrations.js";
import {
  hashMainDeviceSecret,
  readMainDeviceProvisioning,
  type MainDeviceProvisioning,
} from "./main-device/main-device-binding.js";

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
  private readyPromise: Promise<void> | undefined;

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

  public async ensureReady(): Promise<void> {
    if (this.readyPromise === undefined) {
      this.readyPromise = this.initialize();
    }
    return this.readyPromise;
  }

  public async onModuleInit(): Promise<void> {
    await this.ensureReady();
  }

  private async initialize(): Promise<void> {
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

async function provisionMainDevice(
  client: PoolClient,
  provisioning: MainDeviceProvisioning,
): Promise<void> {
  const credentialHash = hashMainDeviceSecret(provisioning.deviceSecret);
  const sessionHash = hashMainDeviceSecret(provisioning.sessionToken);

  // A configuration naming an unknown device while another Main device is
  // provisioned would silently mint a second standing authority, so it is
  // rejected instead: recovering from a lost credential is a repair decision,
  // never an incidental boot operation. A device the database already knows
  // reprovisions normally regardless of what else exists.
  const deviceState = await client.query<{ known: boolean; others: boolean }>(
    `select exists(select 1 from main_devices where id = $1) as known,
            exists(select 1 from main_devices where id <> $1) as others`,
    [provisioning.deviceId],
  );
  if (deviceState.rows[0]?.known === false && deviceState.rows[0].others) {
    throw new Error(
      "Another Main device is already provisioned for this database",
    );
  }

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
