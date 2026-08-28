import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { SETTINGS_POST_COMMIT_QUEUE } from "./settings-post-commit.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "settings.owner";
const OWNER_PASSWORD = "settings posting owner password stays here";
const SETTINGS_COMMAND_NAME = "pharmacy.settings.update";
const SETTINGS_EVENT_TYPE = "pharmacy.settings.changed";

/**
 * The API child is spawned with proxies pointing at a closed loopback port, so
 * any outbound HTTP attempt fails immediately. Every case below therefore runs
 * with no route to the internet.
 */
const POISONED_PROXY = "http://127.0.0.1:1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: Record<string, unknown> | undefined;
  readonly status: number;
}

interface SettingsView {
  readonly attendanceEnabled: boolean;
  readonly revision: string;
}

interface SettingsRequestBody {
  readonly attendanceEnabled: boolean;
  readonly expectedRevision: string;
  readonly idempotencyKey: string;
}

interface CommandFactCounts {
  readonly audits: number;
  readonly outbox: number;
  readonly results: number;
}

/**
 * A temporary database rule that refuses one specific write. Injecting the
 * failure at the database rather than in the service is what makes the
 * roll-back-together proof real: the command has no idea it is about to fail.
 */
interface FailureInjection {
  /**
   * A SQL boolean over the `new` row that recognizes the request under test,
   * built from the marker that request carries into this table.
   */
  readonly condition: (key: string) => string;
  readonly name: string;
  readonly table: string;
  readonly timing: "before insert" | "before update";
}

describe.sequential("pharmacy settings posting pipeline", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOutput = "";
  let apiOrigin: string;
  let apiPort: number;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let jobTable: string;
  let pharmacyId: string;
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });

    const bootstrapped = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Settings Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Settings Posting Pharmacy",
    });
    expect(bootstrapped.status, failureContext([bootstrapped])).toBe(201);
    const loggedIn = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(loggedIn.status, failureContext([loggedIn])).toBe(200);

    const pharmacy = await administrator.query<{ id: string }>(
      "select id from pharmacies",
    );
    pharmacyId = pharmacy.rows[0]?.id ?? "";
    expect(pharmacyId).toMatch(UUID_PATTERN);
    jobTable = await resolveJobTable();
  }, 120_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("posts the settings change, its audit, its event, and one durable outcome", async () => {
    const before = await currentSettings();
    const key = createUuidV7();
    const body: SettingsRequestBody = {
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    };
    const nextRevision = increment(before.revision);

    const posted = await patchSettings(body);
    expect(posted.status, failureContext([posted])).toBe(200);
    expect(posted.body).toEqual({
      attendanceEnabled: body.attendanceEnabled,
      revision: nextRevision,
    });
    expect(await currentSettings()).toEqual({
      attendanceEnabled: body.attendanceEnabled,
      revision: nextRevision,
    });

    const results = await administrator.query<{
      actor_user_id: string;
      command_name: string;
      main_device_id: string;
      response_body: unknown;
      response_status: number;
    }>(
      `select actor_user_id, command_name, main_device_id,
              response_body, response_status
       from posting_command_results where idempotency_key = $1`,
      [key],
    );
    expect(results.rows).toHaveLength(1);
    expect(results.rows[0]).toMatchObject({
      command_name: SETTINGS_COMMAND_NAME,
      main_device_id: credentials.deviceId,
      response_body: {
        attendanceEnabled: body.attendanceEnabled,
        revision: nextRevision,
      },
      response_status: 200,
    });

    const audits = await administrator.query<{
      action: string;
      after_state: unknown;
      before_state: unknown;
      correlation_id: string;
      outcome: string;
      target_id: string;
    }>(
      `select action, after_state, before_state, correlation_id, outcome,
              target_id
       from posting_audit_records where correlation_id = $1`,
      [key],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]).toMatchObject({
      action: SETTINGS_COMMAND_NAME,
      after_state: { attendanceEnabled: body.attendanceEnabled },
      before_state: { attendanceEnabled: before.attendanceEnabled },
      correlation_id: key,
      outcome: "succeeded",
      target_id: pharmacyId,
    });

    const outbox = await administrator.query<{
      correlation_id: string;
      envelope_version: number;
      event_type: string;
      id: string;
      payload: unknown;
      pharmacy_id: string;
    }>(
      `select correlation_id, envelope_version, event_type, id, payload,
              pharmacy_id
       from posting_outbox_entries where correlation_id = $1`,
      [key],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({
      correlation_id: key,
      envelope_version: 1,
      event_type: SETTINGS_EVENT_TYPE,
      payload: {
        attendanceEnabled: body.attendanceEnabled,
        revision: nextRevision,
      },
      pharmacy_id: pharmacyId,
    });
    const outboxEntryId = outbox.rows[0]?.id ?? "";
    expect(outboxEntryId).toMatch(UUID_PATTERN);

    // The job carries only the identity of the envelope, so a retry resumes the
    // same envelope instead of recreating anything.
    const jobs = await jobsFor(outboxEntryId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: SETTINGS_POST_COMMIT_QUEUE,
      pharmacy_id: pharmacyId,
    });

    // The worker can only see an envelope the posting transaction committed, so
    // an outcome recorded after the envelope's own clock proves the job ran
    // after the commit and not before it.
    const outcome = await waitForOutcome(key);
    expect(outcome).toEqual({ count: 1, recordedAfterEnvelope: true });
  }, 60_000);

  it("replays the committed result for the same key and body", async () => {
    const before = await currentSettings();
    const key = createUuidV7();
    const body: SettingsRequestBody = {
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    };

    const posted = await patchSettings(body);
    expect(posted.status, failureContext([posted])).toBe(200);
    await waitForOutcome(key);
    const afterFirst = await currentSettings();

    const replayed = await patchSettings(body);
    expect(replayed).toEqual(posted);
    expect(await currentSettings()).toEqual(afterFirst);
    expect(await factCounts(key)).toEqual({
      audits: 1,
      outbox: 1,
      results: 1,
    });
    expect(await outcomeCount(key)).toBe(1);
  }, 60_000);

  it("refuses a reused key that carries a different request", async () => {
    const before = await currentSettings();
    const key = createUuidV7();
    const body: SettingsRequestBody = {
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    };
    const posted = await patchSettings(body);
    expect(posted.status, failureContext([posted])).toBe(200);
    const afterPost = await currentSettings();

    const changed = await patchSettings({
      ...body,
      attendanceEnabled: !body.attendanceEnabled,
    });
    expect(changed.status, failureContext([changed])).toBe(409);
    expect(changed.body).toMatchObject({
      code: "idempotency-conflict",
      status: "denied",
    });

    // The denial fact is committed evidence, and the original result stays the
    // authority on what was actually posted.
    const denials = await administrator.query<{ id: string }>(
      `select id from posting_audit_records
       where correlation_id = $1 and outcome = 'idempotency-conflict'`,
      [key],
    );
    expect(denials.rows).toHaveLength(1);
    expect(changed.body?.requestId).toBe(denials.rows[0]?.id);

    const results = await administrator.query<{
      response_body: unknown;
      response_status: number;
    }>(
      `select response_body, response_status from posting_command_results
       where idempotency_key = $1`,
      [key],
    );
    expect(results.rows).toHaveLength(1);
    expect(results.rows[0]).toMatchObject({
      response_body: posted.body,
      response_status: 200,
    });
    expect(await currentSettings()).toEqual(afterPost);
    expect(await factCounts(key)).toEqual({
      audits: 2,
      outbox: 1,
      results: 1,
    });
  }, 60_000);

  it("records a stale expected revision and replays it without re-executing", async () => {
    const before = await currentSettings();
    const key = createUuidV7();
    const body: SettingsRequestBody = {
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: "1",
      idempotencyKey: key,
    };
    expect(body.expectedRevision).not.toBe(before.revision);

    const rejected = await patchSettings(body);
    expect(rejected.status, failureContext([rejected])).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "version-conflict",
      status: "denied",
    });
    expect(await factCounts(key)).toEqual({
      audits: 1,
      outbox: 0,
      results: 1,
    });

    // A recorded terminal rejection is replayed with its stored status and its
    // stored body: an identical request id proves the second call read the
    // recorded decision instead of making a new one.
    const replayed = await patchSettings(body);
    expect(replayed).toEqual(rejected);
    expect(await factCounts(key)).toEqual({
      audits: 1,
      outbox: 0,
      results: 1,
    });
    expect(await currentSettings()).toEqual(before);

    const stored = await administrator.query<{ response_status: number }>(
      "select response_status from posting_command_results where idempotency_key = $1",
      [key],
    );
    expect(stored.rows[0]?.response_status).toBe(409);
  }, 60_000);

  it("commits once when two identical requests arrive together", async () => {
    const before = await currentSettings();
    const key = createUuidV7();
    const body: SettingsRequestBody = {
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    };

    const attempts = await Promise.all([
      patchSettings(body),
      patchSettings(body),
    ]);
    expect(
      attempts.map(({ status }) => status),
      failureContext(attempts),
    ).toEqual([200, 200]);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(await currentSettings()).toEqual({
      attendanceEnabled: body.attendanceEnabled,
      revision: increment(before.revision),
    });
    expect(await factCounts(key)).toEqual({
      audits: 1,
      outbox: 1,
      results: 1,
    });
    expect(await waitForOutcome(key)).toEqual({
      count: 1,
      recordedAfterEnvelope: true,
    });
  }, 60_000);

  it("rolls every written record back together when any write is refused", async () => {
    const before = await currentSettings();
    const attendanceEnabled = !before.attendanceEnabled;

    for (const injection of [
      {
        // The settings row carries no correlation, so the marker is the value
        // only this request writes: the flipped attendance switch.
        condition: () =>
          `new.attendance_enabled = ${String(attendanceEnabled)}`,
        name: "pharmacy_settings",
        table: "pharmacy_settings",
        timing: "before update",
      },
      {
        condition: (key) => `new.correlation_id = '${key}'::uuid`,
        name: "posting_audit_records",
        table: "posting_audit_records",
        timing: "before insert",
      },
      {
        condition: (key) => `new.correlation_id = '${key}'::uuid`,
        name: "posting_outbox_entries",
        table: "posting_outbox_entries",
        timing: "before insert",
      },
      {
        condition: (key) => `new.idempotency_key = '${key}'::uuid`,
        name: "posting_command_results",
        table: "posting_command_results",
        timing: "before insert",
      },
      {
        // The job payload names the envelope this pharmacy just produced, which
        // is the only marker that reaches pg-boss.
        condition: () => `new.data->>'pharmacyId' = '${pharmacyId}'`,
        name: "pgboss job",
        table: `pgboss.${jobTable}`,
        timing: "before insert",
      },
    ] satisfies readonly FailureInjection[]) {
      const key = createUuidV7();
      const since = await databaseClock();
      const refused = await withInjectedFailure(injection, key, async () =>
        patchSettings({
          attendanceEnabled,
          expectedRevision: before.revision,
          idempotencyKey: key,
        }),
      );

      expect(
        refused.status,
        `${injection.name}: ${failureContext([refused])}`,
      ).toBeGreaterThanOrEqual(400);
      expect(await currentSettings(), injection.name).toEqual(before);
      expect(await factCounts(key), injection.name).toEqual({
        audits: 0,
        outbox: 0,
        results: 0,
      });
      expect(await outcomeCount(key), injection.name).toBe(0);
      expect(await jobsCreatedSince(since), injection.name).toBe(0);
    }

    // The command still works once the injected rules are gone, which proves
    // the failures above were the injection and not a broken pipeline.
    const key = createUuidV7();
    const recovered = await patchSettings({
      attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    });
    expect(recovered.status, failureContext([recovered])).toBe(200);
    expect(await waitForOutcome(key)).toEqual({
      count: 1,
      recordedAfterEnvelope: true,
    });
  }, 120_000);

  it("runs the whole path with no route to the internet", async () => {
    expect(apiEnvironment().HTTP_PROXY).toBe(POISONED_PROXY);
    expect(apiEnvironment().HTTPS_PROXY).toBe(POISONED_PROXY);

    const before = await currentSettings();
    const key = createUuidV7();
    const posted = await patchSettings({
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    });
    expect(posted.status, failureContext([posted])).toBe(200);
    expect(await factCounts(key)).toEqual({
      audits: 1,
      outbox: 1,
      results: 1,
    });
    expect(await waitForOutcome(key)).toEqual({
      count: 1,
      recordedAfterEnvelope: true,
    });
  }, 60_000);

  it("returns the one committed outcome after a killed service restarts", async () => {
    const before = await currentSettings();
    const key = createUuidV7();
    const body: SettingsRequestBody = {
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    };
    const posted = await patchSettings(body);
    expect(posted.status, failureContext([posted])).toBe(200);
    await waitForOutcome(key);
    const afterPost = await currentSettings();

    api.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      api.once("exit", () => resolve());
    });
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);

    const relogin = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(relogin.status, failureContext([relogin])).toBe(200);

    const replayed = await patchSettings(body);
    expect(replayed).toEqual(posted);
    expect(await currentSettings()).toEqual(afterPost);
    expect(await factCounts(key)).toEqual({
      audits: 1,
      outbox: 1,
      results: 1,
    });
    // The job is never replayed into a second business change: the outcome row
    // stays single and the settings revision is untouched by the restart.
    expect(await outcomeCount(key)).toBe(1);
  }, 120_000);

  function apiEnvironment(): Record<string, string> {
    return {
      API_HOST: "127.0.0.1",
      API_PORT: String(apiPort),
      BREEV_MAIN_DEVICE_ID: credentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
      DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
      DATABASE_URL: databaseRoles.applicationUrl,
      HTTPS_PROXY: POISONED_PROXY,
      HTTP_PROXY: POISONED_PROXY,
    };
  }

  function startApi(): ChildProcessWithoutNullStreams {
    const child = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../dist/main.js")],
      { env: { ...process.env, ...apiEnvironment() } },
    );
    child.stdout.on("data", collectOutput);
    child.stderr.on("data", collectOutput);
    return child;
  }

  function collectOutput(chunk: Buffer): void {
    apiOutput += chunk.toString();
  }

  async function resolveJobTable(): Promise<string> {
    const queue = await administrator.query<{ table_name: string }>(
      "select table_name from pgboss.queue where name = $1",
      [SETTINGS_POST_COMMIT_QUEUE],
    );
    const table = queue.rows[0]?.table_name ?? "";
    if (!/^[a-z_][a-z0-9_]*$/u.test(table)) {
      throw new Error(
        `pg-boss did not report a usable job table for ${SETTINGS_POST_COMMIT_QUEUE}`,
      );
    }
    return table;
  }

  async function withInjectedFailure<T>(
    injection: FailureInjection,
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const rule = `breev_injected_${randomBytes(8).toString("hex")}`;
    await administrator.query(
      `create function ${rule}() returns trigger language plpgsql as $rule$
       begin
         if ${injection.condition(key)} then
           raise exception 'injected failure on ${injection.name}'
             using errcode = '55000';
         end if;
         return new;
       end;
       $rule$`,
    );
    await administrator.query(
      `create trigger ${rule} ${injection.timing} on ${injection.table}
       for each row execute function ${rule}()`,
    );
    try {
      return await work();
    } finally {
      await administrator.query(
        `drop trigger if exists ${rule} on ${injection.table}`,
      );
      await administrator.query(`drop function if exists ${rule}()`);
    }
  }

  async function databaseClock(): Promise<Date> {
    const now = await administrator.query<{ now: Date }>(
      "select statement_timestamp() as now",
    );
    const clock = now.rows[0]?.now;
    if (clock === undefined) {
      throw new Error("PostgreSQL did not report its clock");
    }
    return clock;
  }

  async function jobsCreatedSince(since: Date): Promise<number> {
    const jobs = await administrator.query<{ count: string }>(
      `select count(*)::text as count from pgboss.job
       where name = $1 and created_on >= $2`,
      [SETTINGS_POST_COMMIT_QUEUE, since],
    );
    return Number(jobs.rows[0]?.count ?? "-1");
  }

  async function jobsFor(
    outboxEntryId: string,
  ): Promise<{ name: string; pharmacy_id: string | null }[]> {
    const jobs = await administrator.query<{
      name: string;
      pharmacy_id: string | null;
    }>(
      `select name, data->>'pharmacyId' as pharmacy_id from pgboss.job
       where name = $1 and data->>'outboxEntryId' = $2`,
      [SETTINGS_POST_COMMIT_QUEUE, outboxEntryId],
    );
    return jobs.rows;
  }

  async function factCounts(key: string): Promise<CommandFactCounts> {
    const counts = await administrator.query<{
      audits: string;
      outbox: string;
      results: string;
    }>(
      `select
         (select count(*)::text from posting_audit_records
          where correlation_id = $1) as audits,
         (select count(*)::text from posting_outbox_entries
          where correlation_id = $1) as outbox,
         (select count(*)::text from posting_command_results
          where idempotency_key = $1) as results`,
      [key],
    );
    const row = counts.rows[0];
    return {
      audits: Number(row?.audits ?? "-1"),
      outbox: Number(row?.outbox ?? "-1"),
      results: Number(row?.results ?? "-1"),
    };
  }

  async function outcomeCount(key: string): Promise<number> {
    return (await outcomeState(key)).count;
  }

  async function outcomeState(key: string): Promise<{
    count: number;
    recordedAfterEnvelope: boolean;
  }> {
    const outcomes = await administrator.query<{
      after_envelope: boolean | null;
      count: string;
    }>(
      `select count(*)::text as count,
              bool_and(outcome.recorded_at > entry.recorded_at) as after_envelope
       from posting_post_commit_outcomes outcome
       join posting_outbox_entries entry on entry.id = outcome.outbox_entry_id
       where entry.correlation_id = $1`,
      [key],
    );
    const row = outcomes.rows[0];
    return {
      count: Number(row?.count ?? "-1"),
      recordedAfterEnvelope: row?.after_envelope === true,
    };
  }

  async function waitForOutcome(key: string): Promise<{
    count: number;
    recordedAfterEnvelope: boolean;
  }> {
    const deadline = Date.now() + 30_000;
    let state = await outcomeState(key);
    while (state.count === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await outcomeState(key);
    }
    expect(
      state.count,
      `no post-commit outcome for ${key}\n${apiOutput}`,
    ).toBeGreaterThan(0);
    return state;
  }

  async function currentSettings(): Promise<SettingsView> {
    const state = await request("GET", "/identity/state");
    const settings = state.body?.settings as SettingsView | undefined;
    if (settings === undefined) {
      throw new Error(`The identity state carries no settings\n${apiOutput}`);
    }
    return {
      attendanceEnabled: settings.attendanceEnabled,
      revision: settings.revision,
    };
  }

  async function patchSettings(
    body: SettingsRequestBody,
  ): Promise<ApiResponse> {
    return await request("PATCH", "/pharmacy/settings", body);
  }

  function failureContext(responses: readonly ApiResponse[]): string {
    return `${apiOutput}\n${JSON.stringify(responses)}`;
  }

  async function request(
    method: "GET" | "PATCH" | "POST",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: requestHeaders(credentials, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body:
        text.length === 0
          ? undefined
          : (JSON.parse(text) as Record<string, unknown>),
      status: response.status,
    };
  }
});

function increment(revision: string): string {
  return (BigInt(revision) + 1n).toString();
}

function requestHeaders(
  credentials: MainDeviceCredentials,
  json: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Breev-Device ${credentials.deviceSecret}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
    Origin: "breev://app",
  };
}

function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: createUuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function waitForHealth(
  origin: string,
  diagnostics: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).status === 200) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Local API did not start at ${origin}\n${diagnostics()}`);
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
