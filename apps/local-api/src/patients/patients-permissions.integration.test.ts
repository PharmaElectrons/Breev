import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUuidV7 } from "../pharmacy-ca/pharmacy-ca-crypto.js";

const { Pool } = pg;
const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../drizzle");

describe("Patients Permissions Integration", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const adminUrl =
      process.env.BREEV_TEST_POSTGRES_ADMIN_URL ??
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/breev_test";

    pool = new Pool({ connectionString: adminUrl });
    const migrationClient = await pool.connect();
    try {
      await migrate(drizzle({ client: migrationClient }), {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: "breev_migrations",
        migrationsTable: "breev_schema_migrations",
      });
    } finally {
      migrationClient.release();
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("enforces append-only strictly for patient_weight_measurements", async () => {
    const userResult = await pool.query<{ id: string }>(
      "SELECT id FROM identity_users LIMIT 1",
    );
    const actorId = userResult.rows[0]?.id;
    if (!actorId) {
      throw new Error("No identity user found for test");
    }

    const client = await pool.connect();
    try {
      await client.query("SET ROLE breev_app");

      const patientId = createUuidV7();
      await client.query(
        "INSERT INTO patients (id, first_name, last_name) VALUES ($1, 'Append', 'Only')",
        [patientId],
      );

      const weightId = createUuidV7();
      // Insert is allowed
      await client.query(
        "INSERT INTO patient_weight_measurements (id, patient_id, weight_kg, measured_at, created_by_user_id) VALUES ($1, $2, '75.0', NOW(), $3)",
        [weightId, patientId, actorId],
      );

      // Update must be denied
      await expect(
        client.query(
          "UPDATE patient_weight_measurements SET weight_kg = '80.0' WHERE id = $1",
          [weightId],
        ),
      ).rejects.toThrow(
        /permission denied for table patient_weight_measurements/,
      );

      // Delete must be denied
      await expect(
        client.query("DELETE FROM patient_weight_measurements WHERE id = $1", [
          weightId,
        ]),
      ).rejects.toThrow(
        /permission denied for table patient_weight_measurements/,
      );
    } finally {
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
    }
  });
});
