import { describe, expect, it, vi } from "vitest";

import {
  readDatabaseConnectionString,
  readDatabaseMigrationConnectionString,
} from "./database-connection.js";

describe("database connection configuration", () => {
  it("uses a direct connection string for development and tests", () => {
    expect(
      readDatabaseConnectionString({
        DATABASE_URL: "postgresql://runtime:secret@127.0.0.1/breev",
      }),
    ).toBe("postgresql://runtime:secret@127.0.0.1/breev");
  });

  it("reads the service connection string from the configured secret file", () => {
    const readFile = vi.fn(
      () => "postgresql://runtime:secret@127.0.0.1/breev\r\n",
    );

    expect(
      readDatabaseConnectionString(
        { DATABASE_URL_FILE: "C:\\ProgramData\\Breev\\config\\database-url" },
        readFile,
      ),
    ).toBe("postgresql://runtime:secret@127.0.0.1/breev");
    expect(readFile).toHaveBeenCalledWith(
      "C:\\ProgramData\\Breev\\config\\database-url",
    );
  });

  it("rejects ambiguous configuration", () => {
    expect(() =>
      readDatabaseConnectionString(
        {
          DATABASE_URL: "postgresql://direct",
          DATABASE_URL_FILE: "C:\\database-url",
        },
        () => "postgresql://file",
      ),
    ).toThrow("Configure DATABASE_URL or DATABASE_URL_FILE, not both");
  });

  it("rejects an empty or multiline secret file without exposing its value", () => {
    expect(() =>
      readDatabaseConnectionString(
        { DATABASE_URL_FILE: "C:\\database-url" },
        () => "postgresql://first\npostgresql://second",
      ),
    ).toThrow("DATABASE_URL_FILE must contain one non-empty line");

    expect(() =>
      readDatabaseConnectionString(
        { DATABASE_URL_FILE: "C:\\database-url" },
        () => "   \r\n",
      ),
    ).toThrow("DATABASE_URL_FILE must contain one non-empty line");
  });

  it("uses a direct migration connection string", () => {
    expect(
      readDatabaseMigrationConnectionString({
        DATABASE_MIGRATION_URL:
          "postgresql://schema-owner:secret@127.0.0.1/breev",
      }),
    ).toBe("postgresql://schema-owner:secret@127.0.0.1/breev");
  });

  it("reads the migration connection string from the configured secret file", () => {
    const readFile = vi.fn(
      () => "postgresql://schema-owner:secret@127.0.0.1/breev\r\n",
    );

    expect(
      readDatabaseMigrationConnectionString(
        {
          DATABASE_MIGRATION_URL_FILE:
            "C:\\ProgramData\\Breev\\config\\schema-owner-url",
        },
        readFile,
      ),
    ).toBe("postgresql://schema-owner:secret@127.0.0.1/breev");
    expect(readFile).toHaveBeenCalledWith(
      "C:\\ProgramData\\Breev\\config\\schema-owner-url",
    );
  });

  it("rejects ambiguous migration configuration", () => {
    expect(() =>
      readDatabaseMigrationConnectionString(
        {
          DATABASE_MIGRATION_URL: "postgresql://direct",
          DATABASE_MIGRATION_URL_FILE: "C:\\schema-owner-url",
        },
        () => "postgresql://file",
      ),
    ).toThrow(
      "Configure DATABASE_MIGRATION_URL or DATABASE_MIGRATION_URL_FILE, not both",
    );
  });

  it("rejects a multiline migration secret file without exposing its value", () => {
    expect(() =>
      readDatabaseMigrationConnectionString(
        { DATABASE_MIGRATION_URL_FILE: "C:\\schema-owner-url" },
        () => "postgresql://first\npostgresql://second",
      ),
    ).toThrow("DATABASE_MIGRATION_URL_FILE must contain one non-empty line");
  });

  it("rejects an empty migration secret file without exposing its value", () => {
    expect(() =>
      readDatabaseMigrationConnectionString(
        { DATABASE_MIGRATION_URL_FILE: "C:\\schema-owner-url" },
        () => " \t\r\n",
      ),
    ).toThrow("DATABASE_MIGRATION_URL_FILE must contain one non-empty line");
  });
});
