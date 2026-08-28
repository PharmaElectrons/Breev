import { Pool } from "pg";

import {
  readDatabaseConnectionString,
  readDatabaseMigrationConnectionString,
} from "./database-connection.js";
import { runMigrations } from "./database-migrations.js";

async function main(): Promise<void> {
  const applicationUrl = readDatabaseConnectionString(process.env);
  const migrationUrl = readDatabaseMigrationConnectionString(process.env);
  delete process.env.DATABASE_MIGRATION_URL;
  delete process.env.DATABASE_MIGRATION_URL_FILE;

  if (applicationUrl === undefined || migrationUrl === undefined) {
    process.stderr.write(
      "Database migration requires application and schema-owner connection strings.\n",
    );
    process.exitCode = 1;
    return;
  }

  const applicationPool = new Pool({
    connectionString: applicationUrl,
    connectionTimeoutMillis: 1_000,
    idleTimeoutMillis: 1_000,
    max: 1,
  });
  applicationPool.on("error", () => undefined);
  try {
    await runMigrations(applicationPool, migrationUrl);
  } finally {
    await applicationPool.end();
  }
}

void main().catch(() => {
  process.stderr.write("Privileged database migrations failed.\n");
  process.exitCode = 1;
});
