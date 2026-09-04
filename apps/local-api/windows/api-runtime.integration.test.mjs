import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { buildApiRuntime } from "./build-api-runtime.mjs";

const execute = promisify(execFile);
const apiRoot = path.resolve(import.meta.dirname, "..");
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !/^(BREEV_|DATABASE_|API_|NODE_|PG)/i.test(name),
  ),
);
let root;
let runtime;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "breev-126-runtime-"));
  runtime = path.join(root, "payload with spaces", "local-api");
  await buildApiRuntime(runtime, process.platform, process.arch);
}, 120_000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function runEntry(name, variables = {}) {
  try {
    const result = await execute(
      process.execPath,
      [path.join(runtime, "dist", `${name}.cjs`)],
      {
        cwd: root,
        env: { ...cleanEnvironment, ...variables },
        timeout: 30_000,
      },
    );
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startApi(variables = {}) {
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(runtime, "dist/main.cjs")], {
    cwd: root,
    env: {
      ...cleanEnvironment,
      ...variables,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
    },
  });
  let output = "";
  child.stdout.on("data", (value) => {
    output += value;
  });
  child.stderr.on("data", (value) => {
    output += value;
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null)
        throw new Error(`Bundled API exited: ${output}`);
      try {
        const response = await fetch(`${url}/health`);
        return { url, response, stop };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Bundled API failed to bind: ${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
}

describe.sequential(
  "isolated bundled API without development dependencies",
  () => {
    it("ships exact SQL bytes, metadata, legal notices and the native addon without node_modules", async () => {
      const entries = await readdir(runtime, { recursive: true });
      expect(entries.some((entry) => entry.includes("node_modules"))).toBe(
        false,
      );
      expect(entries.some((entry) => entry.endsWith(".node"))).toBe(true);
      expect(
        await readFile(path.join(runtime, "THIRD_PARTY_NOTICES.txt"), "utf8"),
      ).toContain("argon2@");
      const journal = JSON.parse(
        await readFile(
          path.join(runtime, "drizzle/meta/_journal.json"),
          "utf8",
        ),
      );
      for (const { tag } of journal.entries) {
        expect(
          await readFile(path.join(runtime, "drizzle", `${tag}.sql`)),
        ).toEqual(await readFile(path.join(apiRoot, "drizzle", `${tag}.sql`)));
      }
      const main = await readFile(path.join(runtime, "dist/main.cjs"), "utf8");
      expect(main).toContain('"design:paramtypes"');
      expect(main).not.toContain("import_meta.dirname");
    });

    it("executes the standalone migration runner and denies forced pg-native", async () => {
      const missing = await runEntry("migrate");
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain(
        "Database migration requires application and schema-owner connection strings",
      );
      const forcedNative = await runEntry("main", {
        NODE_PG_FORCE_NATIVE: "1",
      });
      expect(forcedNative.code).toBe(1);
      expect(forcedNative.stderr).toContain(
        "Breev requires the JavaScript PostgreSQL driver",
      );
    });

    it("resolves the full Nest dependency graph and reports degraded without a database", async () => {
      const api = await startApi();
      try {
        expect(api.response.status).toBe(503);
        expect(await api.response.json()).toMatchObject({
          status: "degraded",
          database: "unavailable",
        });
      } finally {
        await api.stop();
      }
    });
  },
);

describe.sequential("bundled runtime on real PostgreSQL", () => {
  let container;
  let nativeBin;
  let data;
  let admin;
  let owner;
  let app;
  let variables;
  let adminEnvironment;
  let nativeStarted = false;

  beforeAll(async () => {
    let administratorUrl;
    if (process.platform === "win32") {
      // Only this disposable test cluster is started: never use an installed service.
      nativeBin = path.resolve(
        process.env.BREEV_TEST_POSTGRES_BIN ??
          path.join(apiRoot, "../../artifacts/windows/payload/postgresql/bin"),
      );
      data = path.join(root, "postgres-data");
      const password = randomBytes(24).toString("hex");
      const passwordFile = path.join(root, "bootstrap-password");
      await writeFile(passwordFile, password, { mode: 0o600 });
      const port = await reservePort();
      adminEnvironment = {
        ...cleanEnvironment,
        PGPASSWORD: password,
        PGHOST: "127.0.0.1",
        PGPORT: String(port),
        PGUSER: "fixture_admin",
        PGDATABASE: "postgres",
      };
      await execute(
        path.join(nativeBin, "initdb.exe"),
        [
          "-D",
          data,
          "--username=fixture_admin",
          `--pwfile=${passwordFile}`,
          "--encoding=UTF8",
          "--locale=C",
          "--auth=scram-sha-256",
          "--data-checksums",
        ],
        { env: cleanEnvironment, timeout: 120_000 },
      );
      // pg_ctl may leave child pipe handles open: use file-backed output and -l.
      const log = await open(path.join(root, "pgctl.log"), "w");
      try {
        const child = spawn(
          path.join(nativeBin, "pg_ctl.exe"),
          [
            "-D",
            data,
            "-l",
            path.join(root, "postgres.log"),
            "-o",
            `-h 127.0.0.1 -p ${port}`,
            "-w",
            "start",
          ],
          { env: cleanEnvironment, stdio: ["ignore", log.fd, log.fd] },
        );
        const [code] = await once(child, "exit");
        expect(code).toBe(0);
        nativeStarted = true;
      } finally {
        await log.close();
      }
      administratorUrl = `postgresql://fixture_admin:${password}@127.0.0.1:${port}/postgres`;
    } else {
      container = await new PostgreSqlContainer(
        "postgres:18.6-bookworm",
      ).start();
      administratorUrl = container.getConnectionUri();
    }
    admin = new Pool({ connectionString: administratorUrl });
    const ownerPassword = randomBytes(24).toString("hex");
    const appPassword = randomBytes(24).toString("hex");
    await admin.query(`create role breev_bootstrap nologin`);
    const bootstrap = (
      await readFile(path.join(import.meta.dirname, "bootstrap.sql"), "utf8")
    )
      .replaceAll("__SCHEMA_OWNER_PASSWORD__", ownerPassword)
      .replaceAll("__APP_PASSWORD__", appPassword);
    // Execute the same bootstrap SQL, splitting only psql's database switch.
    const [clusterSql, databaseSql] = bootstrap
      .replace("\\set ON_ERROR_STOP on", "")
      .split("\\connect breev");
    for (const statement of clusterSql.split(";").filter((text) => text.trim()))
      await admin.query(statement);
    const dbUrl = new URL(administratorUrl);
    dbUrl.pathname = "/breev";
    const databaseAdmin = new Pool({ connectionString: dbUrl.href });
    try {
      await databaseAdmin.query(databaseSql);
    } finally {
      await databaseAdmin.end();
    }
    dbUrl.username = "breev_schema_owner";
    dbUrl.password = ownerPassword;
    owner = new Pool({ connectionString: dbUrl.href });
    const ownerFile = path.join(root, "owner-url");
    await writeFile(ownerFile, dbUrl.href, { mode: 0o600 });
    dbUrl.username = "breev_app";
    dbUrl.password = appPassword;
    app = new Pool({ connectionString: dbUrl.href });
    const appFile = path.join(root, "app-url");
    await writeFile(appFile, dbUrl.href, { mode: 0o600 });
    variables = {
      DATABASE_URL_FILE: appFile,
      DATABASE_MIGRATION_URL_FILE: ownerFile,
      BREEV_BACKUP_DIRECTORY: path.join(root, "backups"),
    };
  }, 180_000);

  afterAll(async () => {
    await Promise.all([app?.end(), owner?.end(), admin?.end()]);
    if (nativeStarted)
      await execute(
        path.join(nativeBin, "pg_ctl.exe"),
        ["-D", data, "-m", "fast", "-w", "stop"],
        { env: cleanEnvironment, timeout: 60_000 },
      );
    if (container) await container.stop();
  }, 90_000);

  it("runs concurrent and repeated shipped migrations with least-privilege roles", async () => {
    const results = await Promise.all([
      runEntry("migrate", variables),
      runEntry("migrate", variables),
    ]);
    for (const result of results) expect(result.code, result.stderr).toBe(0);
    expect((await runEntry("migrate", variables)).code).toBe(0);
    const journal = JSON.parse(
      await readFile(path.join(runtime, "drizzle/meta/_journal.json"), "utf8"),
    );
    expect(
      (
        await owner.query(
          "select count(*)::int as count from breev_migrations.breev_schema_migrations",
        )
      ).rows[0].count,
    ).toBe(journal.entries.length);
    expect(
      (await app.query("select is_quarantined from system_quarantine_state"))
        .rows[0].is_quarantined,
    ).toBe(false);
    await expect(
      app.query("create table public.forbidden_runtime_ddl(id int)"),
    ).rejects.toThrow();
    expect(
      (
        await runEntry("migrate", {
          ...variables,
          DATABASE_MIGRATION_URL_FILE: variables.DATABASE_URL_FILE,
        })
      ).code,
    ).toBe(1);
  });

  it("preserves Arabic UTF-8, ICU, PL/pgSQL and rollback", async () => {
    await owner.query("create table public.payload_unicode(value text)");
    await owner.query(
      "create collation public.payload_arabic(provider=icu, locale='ar-IQ')",
    );
    await owner.query(
      "create function public.payload_echo(v text) returns text language plpgsql as $$ begin return v; end $$",
    );
    await owner.query("insert into public.payload_unicode values($1)", [
      "صيدلية بريف",
    ]);
    const result = await owner.query(
      "select public.payload_echo(value) as value, encode(convert_to(value,'UTF8'),'hex') as hex from public.payload_unicode order by value collate public.payload_arabic",
    );
    expect(result.rows).toEqual([
      {
        value: "صيدلية بريف",
        hex: "d8b5d98ad8afd984d98ad8a920d8a8d8b1d98ad981",
      },
    ]);
    const client = await app.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into public.payload_unicode values('rolled back')",
      );
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(
      (
        await owner.query(
          "select count(*)::int as count from public.payload_unicode",
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("serves healthy through the bundled Nest API without migration credentials", async () => {
    const { DATABASE_MIGRATION_URL_FILE: ignored, ...serviceVariables } =
      variables;
    expect(ignored).toBeTruthy();
    const credentials = {
      deviceId: "019d0000-0000-7000-8000-000000000126",
      deviceSecret: randomBytes(32).toString("base64url"),
      sessionToken: randomBytes(32).toString("base64url"),
    };
    const bindingFile = path.join(root, "main-device.json");
    await writeFile(bindingFile, JSON.stringify(credentials), { mode: 0o600 });
    serviceVariables.BREEV_MAIN_DEVICE_FILE = bindingFile;
    const headers = {
      "Content-Type": "application/json",
      Origin: "breev://app",
      Authorization: `Breev-Device ${credentials.deviceSecret}`,
      "X-Breev-CSRF": "1",
      "X-Breev-Device-Id": credentials.deviceId,
      "X-Breev-Device-Session": credentials.sessionToken,
    };
    const password = "bundled runtime correct horse battery staple";
    const api = await startApi(serviceVariables);
    try {
      expect(api.response.status).toBe(200);
      expect(await api.response.json()).toMatchObject({
        status: "healthy",
        database: "available",
      });
      const denied = await fetch(`${api.url}/identity/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(denied.status).toBe(403);
      const bootstrap = await fetch(`${api.url}/identity/bootstrap`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pharmacyName: "صيدلية بريف",
          owner: {
            displayName: "Bundled Owner",
            username: "bundle.owner",
            password,
          },
        }),
      });
      expect(bootstrap.status, await bootstrap.clone().text()).toBe(201);
      expect(await bootstrap.json()).toMatchObject({
        state: "authenticated",
        entitlement: { status: "free-core" },
      });
      const logout = await fetch(`${api.url}/identity/logout`, {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(logout.status).toBe(204);
      const wrong = await fetch(`${api.url}/identity/login`, {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "bundle.owner", password: "wrong" }),
      });
      expect(wrong.status).toBe(401);
    } finally {
      await api.stop();
    }
    const restarted = await startApi(serviceVariables);
    try {
      const login = await fetch(`${restarted.url}/identity/login`, {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "bundle.owner", password }),
      });
      expect(login.status, await login.clone().text()).toBe(200);
      expect(await login.json()).toMatchObject({
        state: "authenticated",
        user: { username: "bundle.owner" },
      });
    } finally {
      await restarted.stop();
    }
  });

  it.skipIf(process.platform !== "win32")(
    "dumps/restores and verifies physical backup using only the pruned binaries",
    async () => {
      const dump = path.join(root, "unicode.dump");
      const env = { ...adminEnvironment, PGDATABASE: "breev" };
      await execute(path.join(nativeBin, "pg_dump.exe"), ["-Fc", "-f", dump], {
        env,
        timeout: 60_000,
      });
      await admin.query("create database payload_restore");
      await execute(
        path.join(nativeBin, "pg_restore.exe"),
        ["--exit-on-error", "--dbname=payload_restore", dump],
        { env, timeout: 60_000 },
      );
      const restoreUrl = new URL(admin.options.connectionString);
      restoreUrl.pathname = "/payload_restore";
      const restored = new Pool({ connectionString: restoreUrl.href });
      try {
        expect(
          (await restored.query("select value from public.payload_unicode"))
            .rows,
        ).toEqual([{ value: "صيدلية بريف" }]);
      } finally {
        await restored.end();
      }
      const backup = path.join(root, "basebackup");
      await execute(
        path.join(nativeBin, "pg_basebackup.exe"),
        [
          "-D",
          backup,
          "--format=plain",
          "--wal-method=stream",
          "--checkpoint=fast",
        ],
        { env: adminEnvironment, timeout: 120_000 },
      );
      const result = await execute(
        path.join(nativeBin, "pg_verifybackup.exe"),
        [backup],
        { env: cleanEnvironment, timeout: 60_000 },
      );
      expect(result.stdout).toContain("backup successfully verified");
    },
    180_000,
  );
});
