import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";

export interface SeparatedDatabaseRoles {
  readonly applicationUrl: string;
  readonly migrationUrl: string;
}

export async function createSeparatedDatabaseRoles(
  postgres: StartedPostgreSqlContainer,
): Promise<SeparatedDatabaseRoles> {
  const databaseName = postgres.getDatabase();
  if (!/^[a-z_][a-z0-9_]*$/u.test(databaseName)) {
    throw new Error("The PostgreSQL test database name is unsafe");
  }
  const applicationPassword = randomBytes(24).toString("hex");
  const migrationPassword = randomBytes(24).toString("hex");
  const result = await postgres.exec([
    "psql",
    "--username",
    postgres.getUsername(),
    "--dbname",
    postgres.getDatabase(),
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    `revoke create on schema public from public;
     create role breev_schema_owner login password '${migrationPassword}';
     create role breev_app login password '${applicationPassword}';
     grant create on database "${databaseName}" to breev_schema_owner;
     grant usage, create on schema public to breev_schema_owner;
     grant usage on schema public to breev_app;`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not create separated database roles: ${result.stderr}`,
    );
  }

  return {
    applicationUrl: connectionUrl(postgres, "breev_app", applicationPassword),
    migrationUrl: connectionUrl(
      postgres,
      "breev_schema_owner",
      migrationPassword,
    ),
  };
}

function connectionUrl(
  postgres: StartedPostgreSqlContainer,
  username: string,
  password: string,
): string {
  const url = new URL(postgres.getConnectionUri());
  url.username = username;
  url.password = password;
  return url.toString();
}
