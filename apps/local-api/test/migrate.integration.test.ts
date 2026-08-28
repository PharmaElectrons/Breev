import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "./database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

interface MigrationJournal {
  readonly entries: readonly unknown[];
}

interface SpawnResult {
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

describe.sequential("standalone privileged database migrations", () => {
  let applicationUrlPath: string;
  let databaseRoles: SeparatedDatabaseRoles;
  let migrationUrlPath: string;
  let postgres: StartedPostgreSqlContainer;
  let temporaryRoot: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "breev-migration-entrypoint-"),
    );
    applicationUrlPath = path.join(temporaryRoot, "database-url");
    migrationUrlPath = path.join(temporaryRoot, "schema-owner-url");
    await writeFile(applicationUrlPath, `${databaseRoles.applicationUrl}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(migrationUrlPath, `${databaseRoles.migrationUrl}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  });

  afterAll(async () => {
    if (postgres !== undefined) {
      await postgres.stop().catch(() => undefined);
    }
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("migrates the database through connection files and preserves application least privilege", async () => {
    const result = await runMigration({
      DATABASE_MIGRATION_URL_FILE: migrationUrlPath,
      DATABASE_URL_FILE: applicationUrlPath,
    });
    expect(result.code, result.stderr).toBe(0);

    const applicationPool = new Pool({
      connectionString: databaseRoles.applicationUrl,
      max: 1,
    });
    const migrationPool = new Pool({
      connectionString: databaseRoles.migrationUrl,
      max: 1,
    });
    try {
      const journal = JSON.parse(
        await readFile(
          path.resolve(import.meta.dirname, "../drizzle/meta/_journal.json"),
          "utf8",
        ),
      ) as MigrationJournal;
      const migrationCount = await migrationPool.query<{ count: string }>(
        "select count(*)::text as count from breev_migrations.breev_schema_migrations",
      );
      expect(migrationCount.rows[0]?.count).toBe(
        String(journal.entries.length),
      );

      const quarantine = await applicationPool.query<{
        is_quarantined: boolean;
        singleton: boolean;
      }>("select singleton, is_quarantined from system_quarantine_state");
      expect(quarantine.rows).toEqual([
        { is_quarantined: false, singleton: true },
      ]);

      const pgBossTables = await applicationPool.query<{ table_name: string }>(
        `select table_name
         from information_schema.tables
         where table_schema = 'pgboss'
           and table_name in ('job', 'version', 'queue')`,
      );
      expect(pgBossTables.rows.map((row) => row.table_name).sort()).toEqual([
        "job",
        "queue",
        "version",
      ]);

      await expect(
        applicationPool.query(
          "create table forbidden_migration_entrypoint_ddl (id integer)",
        ),
      ).rejects.toThrow();
    } finally {
      await applicationPool.end();
      await migrationPool.end();
    }
  });

  it("runs idempotently against an already migrated database", async () => {
    const result = await runMigration({
      DATABASE_MIGRATION_URL_FILE: migrationUrlPath,
      DATABASE_URL_FILE: applicationUrlPath,
    });

    expect(result.code, result.stderr).toBe(0);
  });

  it("rejects an application role used as the schema owner without exposing its password", async () => {
    const result = await runMigration({
      DATABASE_MIGRATION_URL_FILE: applicationUrlPath,
      DATABASE_URL_FILE: applicationUrlPath,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Privileged database migrations failed.\n");
    expect(result.stderr).not.toContain(
      new URL(databaseRoles.applicationUrl).password,
    );
  });

  it("reports missing migration credentials without exposing connection details", async () => {
    const result = await runMigration({
      DATABASE_URL_FILE: applicationUrlPath,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "Database migration requires application and schema-owner connection strings.\n",
    );
  });
});

async function runMigration(
  variables: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.DATABASE_MIGRATION_URL;
  delete environment.DATABASE_MIGRATION_URL_FILE;
  delete environment.DATABASE_URL;
  delete environment.DATABASE_URL_FILE;
  delete environment.NODE_OPTIONS;
  Object.assign(environment, variables);

  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../dist/migrate.js")],
      { env: environment },
    );
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The migration entrypoint did not exit in time"));
    }, 25_000);
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      resolve({ code, stderr, stdout });
    });
  });
}
