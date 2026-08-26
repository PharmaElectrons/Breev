import { Pool } from "pg";

export interface ExternalEffectRecord {
  readonly id: number;
  readonly idempotency_key: string;
  readonly effect_payload: Record<string, unknown> | null;
  readonly executed_at: Date;
}

export interface JobOutcomeRecord {
  readonly id: number;
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly queue_name: string;
  readonly result: string;
  readonly created_at: Date;
}

export async function setupCrashTestTables(
  migrationUrl: string,
  applicationRole = "breev_app",
): Promise<void> {
  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _test_external_effects (
        id SERIAL PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        effect_payload JSONB,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS _test_job_outcomes (
        id SERIAL PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        queue_name TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      `GRANT ALL ON TABLE _test_external_effects TO ${applicationRole};`,
    );
    await client.query(
      `GRANT ALL ON TABLE _test_job_outcomes TO ${applicationRole};`,
    );
    await client.query(
      `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${applicationRole};`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

export async function clearCrashTestTables(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM _test_job_outcomes; DELETE FROM _test_external_effects;",
  );
}

export async function getExternalEffects(
  pool: Pool,
  idempotencyKey?: string,
): Promise<ExternalEffectRecord[]> {
  const query = idempotencyKey
    ? "SELECT id, idempotency_key, effect_payload, executed_at FROM _test_external_effects WHERE idempotency_key = $1 ORDER BY id ASC"
    : "SELECT id, idempotency_key, effect_payload, executed_at FROM _test_external_effects ORDER BY id ASC";
  const params = idempotencyKey ? [idempotencyKey] : [];
  const result = await pool.query<ExternalEffectRecord>(query, params);
  return result.rows;
}

export async function getJobOutcomes(
  pool: Pool,
  idempotencyKey?: string,
): Promise<JobOutcomeRecord[]> {
  const query = idempotencyKey
    ? "SELECT id, job_id, idempotency_key, queue_name, result, created_at FROM _test_job_outcomes WHERE idempotency_key = $1 ORDER BY id ASC"
    : "SELECT id, job_id, idempotency_key, queue_name, result, created_at FROM _test_job_outcomes ORDER BY id ASC";
  const params = idempotencyKey ? [idempotencyKey] : [];
  const result = await pool.query<JobOutcomeRecord>(query, params);
  return result.rows;
}
