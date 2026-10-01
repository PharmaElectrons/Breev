import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

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

export async function createSeparatedDatabaseRolesFromUrl(
  administratorUrl: string,
): Promise<SeparatedDatabaseRoles> {
  const url = new URL(administratorUrl);
  const databaseName = url.pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/u.test(databaseName)) {
    throw new Error("The PostgreSQL test database name is unsafe");
  }
  const applicationPassword = randomBytes(24).toString("hex");
  const migrationPassword = randomBytes(24).toString("hex");
  const administrator = new Pool({ connectionString: administratorUrl });
  try {
    await administrator.query(
      `drop schema if exists public cascade;
       create schema public;
       drop schema if exists breev_migrations cascade;
       drop schema if exists pgboss cascade;
       revoke create on schema public from public;
       do $$
       begin
         if not exists (select from pg_roles where rolname = 'breev_schema_owner') then
           create role breev_schema_owner login password '${migrationPassword}';
         else
           alter role breev_schema_owner login password '${migrationPassword}';
         end if;
         if not exists (select from pg_roles where rolname = 'breev_app') then
           create role breev_app login password '${applicationPassword}';
         else
           alter role breev_app login password '${applicationPassword}';
         end if;
       end
       $$;
       grant create on database "${databaseName}" to breev_schema_owner;
       grant usage, create on schema public to breev_schema_owner;
       grant usage on schema public to breev_app;`,
    );
  } finally {
    await administrator.end();
  }
  return {
    applicationUrl: connectionUrlFromAdministrator(
      url,
      "breev_app",
      applicationPassword,
    ),
    migrationUrl: connectionUrlFromAdministrator(
      url,
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

function connectionUrlFromAdministrator(
  administratorUrl: URL,
  username: string,
  password: string,
): string {
  const url = new URL(administratorUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}
