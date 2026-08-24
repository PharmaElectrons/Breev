import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const MAIN_DEVICE_MIGRATION = `
  create table if not exists breev_schema_migrations (
    version integer primary key,
    applied_at timestamptz not null default statement_timestamp()
  );

  create table if not exists main_devices (
    id uuid primary key,
    credential_hash bytea not null unique,
    created_at timestamptz not null default statement_timestamp()
  );

  create table if not exists main_device_sessions (
    token_hash bytea primary key,
    device_id uuid not null references main_devices(id),
    created_at timestamptz not null default statement_timestamp()
  );

  create table if not exists main_device_proof_state (
    singleton boolean primary key default true check (singleton),
    mutation_count bigint not null default 0 check (mutation_count >= 0)
  );

  insert into main_device_proof_state (singleton, mutation_count)
  values (true, 0)
  on conflict (singleton) do nothing;

  create table if not exists main_device_denial_totals (
    code varchar(40) primary key,
    denial_count bigint not null default 0 check (denial_count >= 0),
    last_denied_at timestamptz not null
  );

  create table if not exists main_device_recent_denials (
    id uuid primary key default uuidv7(),
    denied_at timestamptz not null default statement_timestamp(),
    code varchar(40) not null,
    request_class varchar(32) not null,
    device_context varchar(16) not null
  );

  create table if not exists main_device_rate_windows (
    device_id uuid not null references main_devices(id),
    action varchar(32) not null,
    window_number bigint not null,
    request_count integer not null check (request_count > 0),
    primary key (device_id, action, window_number)
  );
`;

export interface MainDeviceProvisioning {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

@Injectable()
export class LocalDatabaseService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly pool: Pool | undefined;
  private readonly provisioning: MainDeviceProvisioning | undefined;

  public constructor() {
    this.provisioning = readMainDeviceProvisioning(process.env);
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      return;
    }

    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 1_000,
      idleTimeoutMillis: 1_000,
      max: 5,
    });
    this.pool.on("error", () => undefined);
  }

  public async onModuleInit(): Promise<void> {
    if (this.pool === undefined) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(165308855)");
      await client.query(MAIN_DEVICE_MIGRATION);
      await client.query(
        "insert into breev_schema_migrations (version) values (1) on conflict (version) do nothing",
      );
      if (this.provisioning !== undefined) {
        await provisionMainDevice(client, this.provisioning);
      }
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

async function provisionMainDevice(
  client: PoolClient,
  provisioning: MainDeviceProvisioning,
): Promise<void> {
  const credentialHash = hashSecret(provisioning.deviceSecret);
  const sessionHash = hashSecret(provisioning.sessionToken);

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

export function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function readMainDeviceProvisioning(
  environment: NodeJS.ProcessEnv,
): MainDeviceProvisioning | undefined {
  const values = {
    deviceId: environment.BREEV_MAIN_DEVICE_ID,
    deviceSecret: environment.BREEV_MAIN_DEVICE_SECRET,
    sessionToken: environment.BREEV_MAIN_DEVICE_SESSION,
  };
  const presentCount = Object.values(values).filter(
    (value) => value !== undefined,
  ).length;
  if (presentCount === 0) {
    return undefined;
  }
  if (presentCount !== 3) {
    throw new Error(
      "Main device provisioning requires an ID, credential, and session",
    );
  }

  if (!isUuid(values.deviceId)) {
    throw new Error("BREEV_MAIN_DEVICE_ID must be a UUID");
  }
  if (!isHighEntropySecret(values.deviceSecret)) {
    throw new Error(
      "BREEV_MAIN_DEVICE_SECRET must be a 32-byte base64url value",
    );
  }
  if (!isHighEntropySecret(values.sessionToken)) {
    throw new Error(
      "BREEV_MAIN_DEVICE_SESSION must be a 32-byte base64url value",
    );
  }

  return {
    deviceId: values.deviceId,
    deviceSecret: values.deviceSecret,
    sessionToken: values.sessionToken,
  };
}

function isUuid(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isHighEntropySecret(value: string | undefined): value is string {
  if (value === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64url").length === 32;
}
