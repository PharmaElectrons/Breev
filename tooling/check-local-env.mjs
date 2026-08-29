import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const files = {
  desktop: path.join(root, "apps/desktop/.env"),
  localApi: path.join(root, "apps/local-api/.env"),
  root: path.join(root, ".env"),
};
const errors = [];

const environments = Object.fromEntries(
  Object.entries(files).map(([name, file]) => {
    try {
      return [name, parseEnv(readFileSync(file, "utf8"))];
    } catch (error) {
      errors.push(
        `${relative(file)} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [name, {}];
    }
  }),
);

// An Additional POS Terminal has no Main device credential and no loopback
// API of its own: it reaches the Main installation through the bridge the
// desktop main process opens once it holds a device certificate.
const desktopRole = readDeviceRole("desktop");

const requiredKeys = {
  desktop:
    desktopRole === "terminal"
      ? ["BREEV_DEVICE_ROLE", "BREEV_TERMINAL_STATE_DIR"]
      : [
          "BREEV_LOCAL_API_URL",
          "BREEV_MAIN_DEVICE_ID",
          "BREEV_MAIN_DEVICE_SECRET",
          "BREEV_MAIN_DEVICE_SESSION",
        ],
  localApi: [
    "API_HOST",
    "API_PORT",
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "BREEV_MAIN_DEVICE_ID",
    "BREEV_MAIN_DEVICE_SECRET",
    "BREEV_MAIN_DEVICE_SESSION",
  ],
  root: [
    "API_HOST",
    "API_PORT",
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "BREEV_LOCAL_API_URL",
    "BREEV_MAIN_DEVICE_ID",
    "BREEV_MAIN_DEVICE_SECRET",
    "BREEV_MAIN_DEVICE_SESSION",
  ],
};

for (const [name, keys] of Object.entries(requiredKeys)) {
  for (const key of keys) {
    if (!environments[name][key]?.trim()) {
      errors.push(`${relative(files[name])} is missing ${key}`);
    }
  }
}

validateApi(environments.root, relative(files.root));
validateApi(environments.localApi, relative(files.localApi));
validateDesktop(environments.root, relative(files.root));
validateDesktop(environments.desktop, relative(files.desktop));
validateBinding(environments.root, relative(files.root));
validateBinding(environments.localApi, relative(files.localApi));
validateDatabasePair(environments.root, relative(files.root));
validateDatabasePair(environments.localApi, relative(files.localApi));
validateTerminal(environments.desktop, relative(files.desktop));
validateTerminal(environments.root, relative(files.root));

compare("root", "localApi", [
  "API_HOST",
  "API_PORT",
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "BREEV_MAIN_DEVICE_ID",
  "BREEV_MAIN_DEVICE_SECRET",
  "BREEV_MAIN_DEVICE_SESSION",
]);
if (desktopRole === "terminal") {
  validateTerminalDirectory(environments.desktop, relative(files.desktop));
} else {
  validateBinding(environments.desktop, relative(files.desktop));
  compare("root", "desktop", [
    "BREEV_LOCAL_API_URL",
    "BREEV_MAIN_DEVICE_ID",
    "BREEV_MAIN_DEVICE_SECRET",
    "BREEV_MAIN_DEVICE_SESSION",
  ]);
}

if (errors.length > 0) {
  console.error("Local environment check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    "Local environment is valid. The three files agree on all shared values.",
  );
}

function validateApi(environment, file) {
  if (environment.API_HOST && environment.API_HOST !== "127.0.0.1") {
    errors.push(`${file} must set API_HOST to 127.0.0.1`);
  }
  if (
    environment.API_PORT &&
    (!/^\d+$/u.test(environment.API_PORT) ||
      Number(environment.API_PORT) < 1 ||
      Number(environment.API_PORT) > 65_535)
  ) {
    errors.push(`${file} has an invalid API_PORT`);
  }
}

function validateDesktop(environment, file) {
  const value = environment.BREEV_LOCAL_API_URL;
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      errors.push(`${file} has an invalid BREEV_LOCAL_API_URL`);
    }
    if (environment.API_PORT && url.port !== environment.API_PORT) {
      errors.push(
        `${file} uses different ports in API_PORT and BREEV_LOCAL_API_URL`,
      );
    }
  } catch {
    errors.push(`${file} has an invalid BREEV_LOCAL_API_URL`);
  }
}

function readDeviceRole(name) {
  const value = environments[name].BREEV_DEVICE_ROLE?.trim();
  return value === undefined || value.length === 0 ? "main" : value;
}

function validateTerminal(environment, file) {
  const role = environment.BREEV_DEVICE_ROLE?.trim();
  if (
    role !== undefined &&
    role !== "" &&
    role !== "main" &&
    role !== "terminal"
  ) {
    errors.push(`${file} must set BREEV_DEVICE_ROLE to main or terminal`);
  }
  const directory = environment.BREEV_TERMINAL_STATE_DIR?.trim();
  if (directory && !path.isAbsolute(directory)) {
    errors.push(`${file} must set an absolute BREEV_TERMINAL_STATE_DIR`);
  }
}

function validateTerminalDirectory(environment, file) {
  if (
    environment.BREEV_MAIN_DEVICE_SECRET ||
    environment.BREEV_MAIN_DEVICE_SESSION
  ) {
    errors.push(
      `${file} must not carry a Main device credential in the terminal role`,
    );
  }
}

function validateBinding(environment, file) {
  const deviceId = environment.BREEV_MAIN_DEVICE_ID;
  const deviceSecret = environment.BREEV_MAIN_DEVICE_SECRET;
  const session = environment.BREEV_MAIN_DEVICE_SESSION;
  if (
    deviceId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      deviceId,
    )
  ) {
    errors.push(`${file} has an invalid BREEV_MAIN_DEVICE_ID`);
  }
  for (const [key, value] of [
    ["BREEV_MAIN_DEVICE_SECRET", deviceSecret],
    ["BREEV_MAIN_DEVICE_SESSION", session],
  ]) {
    if (
      value &&
      (!/^[A-Za-z0-9_-]{43}$/u.test(value) ||
        Buffer.from(value, "base64url").length !== 32)
    ) {
      errors.push(`${file} has an invalid ${key}`);
    }
  }
  if (deviceSecret && session && deviceSecret === session) {
    errors.push(`${file} must use different device and session secrets`);
  }
}

function validateDatabasePair(environment, file) {
  const runtime = parseDatabaseUrl(
    environment.DATABASE_URL,
    file,
    "DATABASE_URL",
  );
  const migration = parseDatabaseUrl(
    environment.DATABASE_MIGRATION_URL,
    file,
    "DATABASE_MIGRATION_URL",
  );
  if (runtime && runtime.username !== "breev_app") {
    errors.push(`${file} DATABASE_URL must use the breev_app role`);
  }
  if (migration && migration.username !== "breev_schema_owner") {
    errors.push(
      `${file} DATABASE_MIGRATION_URL must use the breev_schema_owner role`,
    );
  }
  if (
    runtime &&
    migration &&
    [runtime.hostname, runtime.port, runtime.pathname].join("|") !==
      [migration.hostname, migration.port, migration.pathname].join("|")
  ) {
    errors.push(`${file} database URLs must target the same database`);
  }
}

function parseDatabaseUrl(value, file, key) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.username ||
      !url.password ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.pathname === "/" ||
      url.search ||
      url.hash
    ) {
      errors.push(`${file} has an invalid ${key}`);
    }
    return url;
  } catch {
    errors.push(`${file} has an invalid ${key}`);
    return undefined;
  }
}

function compare(leftName, rightName, keys) {
  for (const key of keys) {
    const left = environments[leftName][key];
    const right = environments[rightName][key];
    if (left && right && left !== right) {
      errors.push(
        `${relative(files[leftName])} and ${relative(files[rightName])} disagree on ${key}`,
      );
    }
  }
}

function relative(file) {
  return path.relative(root, file) || ".";
}
