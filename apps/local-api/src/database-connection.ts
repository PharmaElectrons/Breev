import { readFileSync } from "node:fs";

interface DatabaseConnectionEnvironment {
  readonly DATABASE_MIGRATION_URL?: string;
  readonly DATABASE_MIGRATION_URL_FILE?: string;
  readonly DATABASE_URL?: string;
  readonly DATABASE_URL_FILE?: string;
}

export function readDatabaseConnectionString(
  environment: DatabaseConnectionEnvironment,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  return readConnectionValue(
    environment.DATABASE_URL,
    environment.DATABASE_URL_FILE,
    "DATABASE_URL",
    "DATABASE_URL_FILE",
    readFile,
  );
}

export function readDatabaseMigrationConnectionString(
  environment: DatabaseConnectionEnvironment,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  return readConnectionValue(
    environment.DATABASE_MIGRATION_URL,
    environment.DATABASE_MIGRATION_URL_FILE,
    "DATABASE_MIGRATION_URL",
    "DATABASE_MIGRATION_URL_FILE",
    readFile,
  );
}

function readConnectionValue(
  directValue: string | undefined,
  filePath: string | undefined,
  directName: string,
  fileName: string,
  readFile: (path: string) => string,
): string | undefined {
  const normalizedDirectValue = normalizeValue(directValue);
  const normalizedFilePath = normalizeValue(filePath);

  if (normalizedDirectValue !== undefined && normalizedFilePath !== undefined) {
    throw new Error(`Configure ${directName} or ${fileName}, not both`);
  }

  if (normalizedFilePath === undefined) {
    return normalizedDirectValue;
  }

  const fileValue = normalizeValue(readFile(normalizedFilePath));
  if (fileValue === undefined || /[\r\n]/u.test(fileValue)) {
    throw new Error(`${fileName} must contain one non-empty line`);
  }

  return fileValue;
}

function normalizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
