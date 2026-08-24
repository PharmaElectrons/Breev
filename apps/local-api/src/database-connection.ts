import { readFileSync } from "node:fs";

interface DatabaseConnectionEnvironment {
  readonly DATABASE_URL?: string;
  readonly DATABASE_URL_FILE?: string;
}

export function readDatabaseConnectionString(
  environment: DatabaseConnectionEnvironment,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const directValue = normalizeValue(environment.DATABASE_URL);
  const filePath = normalizeValue(environment.DATABASE_URL_FILE);

  if (directValue !== undefined && filePath !== undefined) {
    throw new Error("Configure DATABASE_URL or DATABASE_URL_FILE, not both");
  }

  if (filePath === undefined) {
    return directValue;
  }

  const fileValue = normalizeValue(readFile(filePath));
  if (fileValue === undefined || /[\r\n]/u.test(fileValue)) {
    throw new Error("DATABASE_URL_FILE must contain one non-empty line");
  }

  return fileValue;
}

function normalizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
