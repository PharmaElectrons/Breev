import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { HttpException } from "@nestjs/common";
import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import http from "node:http";
import net from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import https from "node:https";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The published test issuer has no signing key in this repository, and seat
// allocation has to be proven against real signed licences that differ only in
// their permitted device count. The registry is pointed at a run-time issuer;
// the licence parser, the signature check, and the entitlement derivation under
// test are untouched.
vi.mock("../licensing/licence-keys.js", async () => {
  const issuer = await import("./test-helpers/licence-issuer.test.js");
  return {
    OFFLINE_LICENCE_PUBLIC_KEYS: {
      [issuer.TEST_ISSUER_KEY_ID]: issuer.TEST_ISSUER_PUBLIC_KEY_PEM,
    },
  };
});

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import {
  IdentityAccessDenied,
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import {
  LicensingDenied,
  LicensingService,
} from "../licensing/licensing.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import {
  createMainRequestSecurityMiddleware,
  MainDeviceSecurityService,
} from "../main-device/main-device-security.service.js";
import { MainDeviceProofController } from "../main-device/main-device-proof.controller.js";
import { createLanMtlsServer } from "../pharmacy-ca/lan-mtls-server.js";
import { RecoveryController } from "../recovery/recovery.controller.js";
import { RestoreQuarantineService } from "../recovery/restore-quarantine.service.js";
import { createUuidV7 } from "../pharmacy-ca/pharmacy-ca-crypto.js";
import { PharmacyCaService } from "../pharmacy-ca/pharmacy-ca.service.js";
import type { TerminalSocketRegistry } from "../pharmacy-ca/terminal-socket-registry.js";
import { DevicesDenied } from "./devices-audit.js";
import { DevicesService } from "./devices.service.js";
import {
  buildFetchTranscript,
  buildFingerprintTranscript,
  buildJoinTranscript,
  decodePairingInvitation,
  deriveFingerprintDigits,
} from "./pairing-domain.js";
import { createPairingChannelHandler } from "./pairing.routes.js";
import { mintLicence } from "./test-helpers/licence-issuer.test.js";
import {
  BRIDGE_HEADERS,
  buildCertificateRequest,
  createTerminalKeys,
  sendTerminalRequest,
  signTranscript,
  type TerminalKeys,
} from "./test-helpers/terminal-client.test.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const MAIN_DEVICE_ID = "019b0000-0000-7000-8000-0000000006a1";
const OWNER_PASSWORD = "an owner password long enough";
const APPROVER_PASSWORD = "a second owner password too";

interface PairedTerminal {
  readonly certificatePem: string;
  readonly deviceId: string;
  readonly keys: TerminalKeys;
}

interface StartedSession {
  readonly caFingerprint: string;
  readonly joinSecret: string;
  readonly sessionId: string;
}

describe.sequential("terminal pairing persistence seam", () => {
  const terminals: PairedTerminal[] = [];
  /**
   * Every join secret this suite ever minted. The whole ceremony is run against
   * a real database here, so the strongest available statement about the secret
   * is that none of these strings can be found anywhere Breev wrote.
   */
  const mintedSecrets: string[] = [];
  let administrator: Pool;
  let database: LocalDatabaseService;
  let databaseRoles: SeparatedDatabaseRoles;
  let devices: DevicesService;
  let deviceSecret: string;
  let deviceSession: string;
  let identity: IdentityAccessService;
  let licensing: LicensingService;
  let loopbackPort: number;
  let loopbackServer: http.Server;
  let mainApi: express.Express | undefined;
  let pharmacyCa: PharmacyCaService;
  let pharmacyId: string;
  let port: number;
  let postgres: StartedPostgreSqlContainer;
  let registry: TerminalSocketRegistry;
  let security: MainDeviceSecurityService;
  let server: https.Server;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    deviceSecret = randomBytes(32).toString("base64url");
    deviceSession = randomBytes(32).toString("base64url");
    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
    process.env.BREEV_MAIN_DEVICE_ID = MAIN_DEVICE_ID;
    process.env.BREEV_MAIN_DEVICE_SECRET = deviceSecret;
    process.env.BREEV_MAIN_DEVICE_SESSION = deviceSession;

    database = new LocalDatabaseService();
    await database.ensureReady();
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    security = new MainDeviceSecurityService(database);
    pharmacyCa = new PharmacyCaService(database);
    licensing = new LicensingService(database);
    identity = new IdentityAccessService(
      database,
      security,
      licensing,
      new DurableJobsService(database),
    );

    // The endpoint the invitation advertises has to be the address the terminal
    // will actually reach, so the port is reserved before anything is built.
    port = await reservePort();
    loopbackPort = await reservePort();
    devices = new DevicesService(database, identity, pharmacyCa, {
      host: "127.0.0.1",
      port,
    });

    const apiHandler: RequestHandler = (request, response, next) => {
      if (mainApi === undefined) {
        next();
        return;
      }
      mainApi(request, response, next);
    };
    const lan = await createLanMtlsServer({
      apiHandler,
      host: "127.0.0.1",
      pairingHandler: createPairingChannelHandler(devices),
      pharmacyCa,
      security,
    });
    server = lan.server;
    registry = lan.registry;
    devices.useSocketRegistry(registry);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        resolve();
      });
    });

    mainApi = express();
    mainApi.use(
      createMainRequestSecurityMiddleware({
        // This pipeline is mounted for the loopback authority. The LAN
        // authority is an additional one, so every terminal request in this
        // suite is accepted only because the LAN listener marked it as having
        // arrived there — and a caller on loopback presenting the same Host is
        // refused by the test below.
        additionalExpectedHosts: [`127.0.0.1:${String(port)}`],
        expectedHost: `127.0.0.1:${String(loopbackPort)}`,
        security,
      }),
    );
    mainApi.use(
      express.json({ limit: 8 * 1024, strict: true, type: "application/json" }),
    );
    // The routes this suite drives over the wire. Each one answers the way its
    // controller does, so a denial arrives at the terminal with the status the
    // real transport would give it.
    const recovery = new RecoveryController(
      database,
      identity,
      new RestoreQuarantineService(database),
    );
    const proof = new MainDeviceProofController(security, identity);
    mainApi.post("/identity/login", (request, response) => {
      answer(
        response,
        async () => await identity.login(request, request.body as never),
      );
    });
    mainApi.get("/identity/state", (request, response) => {
      answer(response, async () => await identity.state(request));
    });
    mainApi.get("/identity/roles", (request, response) => {
      answer(response, async () => await identity.roles(request));
    });
    mainApi.get("/recovery/status", (request, response) => {
      answer(response, async () => await recovery.getRecoveryStatus(request));
    });
    mainApi.get("/security/device-session-proof", (request, response) => {
      answer(response, async () => await proof.evidence(request));
    });

    loopbackServer = http.createServer(mainApi);
    await new Promise<void>((resolve, reject) => {
      loopbackServer.once("error", reject);
      loopbackServer.listen(loopbackPort, "127.0.0.1", () => {
        resolve();
      });
    });

    const state = await identity.bootstrap(await verifiedMainRequest(), {
      owner: {
        displayName: "Pairing Owner",
        password: OWNER_PASSWORD,
        username: "pairing.owner",
      },
      pharmacyName: "Breev Pairing Test Pharmacy",
    });
    pharmacyId = state.pharmacy.id;
    await installLicence(6);
  }, 240_000);

  afterAll(async () => {
    registry?.destroyAll();
    if (loopbackServer !== undefined) {
      await new Promise<void>((resolve) => {
        loopbackServer.close(() => {
          resolve();
        });
      });
    }
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
    await database?.onApplicationShutdown().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  // ─── Harness ───────────────────────────────────────────────────────────────

  function mainRequest(): Request {
    const headers: Record<string, string> = {
      authorization: `Breev-Device ${deviceSecret}`,
      "x-breev-device-id": MAIN_DEVICE_ID,
      "x-breev-device-session": deviceSession,
    };
    return {
      get: (name: string): string | undefined => headers[name.toLowerCase()],
    } as unknown as Request;
  }

  async function verifiedMainRequest(): Promise<Request> {
    const request = mainRequest();
    const binding = await security.verifyBinding(request);
    expect(binding.status).toBe("verified");
    return request;
  }

  async function ownerId(): Promise<string> {
    const result = await database
      .requirePool()
      .query<{ id: string }>(
        "select id from identity_users where username_key = 'pairing.owner'",
      );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("The pairing owner is missing");
    }
    return id;
  }

  async function installLicence(permittedDeviceCount: number): Promise<void> {
    await licensing.install({
      actorId: await ownerId(),
      encodedLicence: mintLicence({
        licenceId: createUuidV7(),
        mainDeviceId: MAIN_DEVICE_ID,
        permittedDeviceCount,
        pharmacyId,
      }),
      mainDeviceId: MAIN_DEVICE_ID,
      now: new Date(),
      pharmacyId,
    });
  }

  async function approvedStepUp(
    action:
      | "devices.pairing.start"
      | "devices.revoke"
      | "devices.seat.release.request",
    subjectId?: string,
  ): Promise<string> {
    const challenge = await identity.createStepUp(await verifiedMainRequest(), {
      action,
      idempotencyKey: randomUUID(),
      ...(subjectId === undefined ? {} : { subjectId }),
    });
    await identity.approveStepUp(await verifiedMainRequest(), challenge.id, {
      idempotencyKey: randomUUID(),
      password: OWNER_PASSWORD,
    });
    return challenge.id;
  }

  async function startSession(): Promise<StartedSession> {
    const started = await devices.startPairingSession(
      await verifiedMainRequest(),
      {
        idempotencyKey: randomUUID(),
        stepUpChallengeId: await approvedStepUp("devices.pairing.start"),
      },
    );
    // A fresh start always carries the invitation; only a replay omits it.
    if (started.qrUri === undefined) {
      throw new Error("The pairing start did not mint an invitation");
    }
    const invitation = decodePairingInvitation(started.qrUri);
    if (invitation === undefined) {
      throw new Error("The pairing invitation was not readable");
    }
    expect(invitation.sessionId).toBe(started.sessionId);
    expect(invitation.port).toBe(port);
    mintedSecrets.push(invitation.joinSecret);
    return {
      caFingerprint: started.caFingerprint,
      joinSecret: invitation.joinSecret,
      sessionId: started.sessionId,
    };
  }

  async function joinAs(
    keys: TerminalKeys,
    session: StartedSession,
    deviceName: string,
    overrides: { joinSecret?: string } = {},
  ) {
    return await sendTerminalRequest({
      body: {
        csrPem: buildCertificateRequest(keys),
        deviceName,
        joinSecret: overrides.joinSecret ?? session.joinSecret,
        sessionId: session.sessionId,
        transcriptSignature: signTranscript(
          buildJoinTranscript({
            caFingerprint: session.caFingerprint,
            installationId: pharmacyCa.installationId,
            sessionId: session.sessionId,
            spkiDer: keys.spkiDer,
          }),
          keys,
        ),
      },
      caCertPem: pharmacyCa.caCertPem,
      method: "POST",
      path: "/pairing/joins",
      port,
    });
  }

  async function fetchCertificate(keys: TerminalKeys, sessionId: string) {
    return await sendTerminalRequest({
      body: {
        sessionId,
        signature: signTranscript(
          buildFetchTranscript({
            installationId: pharmacyCa.installationId,
            sessionId,
            spkiDer: keys.spkiDer,
          }),
          keys,
        ),
      },
      caCertPem: pharmacyCa.caCertPem,
      method: "POST",
      path: "/pairing/certificates",
      port,
    });
  }

  async function channelState(sessionId: string): Promise<string> {
    const response = await sendTerminalRequest({
      caCertPem: pharmacyCa.caCertPem,
      method: "GET",
      path: `/pairing/sessions/${sessionId}/state`,
      port,
    });
    return String(response.body.state);
  }

  /**
   * The seat usage the Main reports. It is absent only when no valid licence is
   * installed, which every caller here has already ruled out.
   */
  async function seatUsage(): Promise<{
    readonly permitted: number;
    readonly used: number;
  }> {
    const inventory = await devices.inventory(await verifiedMainRequest());
    if (inventory.seatUsage === null) {
      throw new Error("A licensed installation reported no seat usage");
    }
    return inventory.seatUsage;
  }

  async function cancelSession(sessionId: string): Promise<void> {
    await devices.cancelPairingSession(await verifiedMainRequest(), sessionId, {
      idempotencyKey: randomUUID(),
      reason: "user-cancelled",
    });
  }

  /** Runs the whole ceremony and returns the terminal it produced. */
  async function pairTerminal(deviceName: string): Promise<PairedTerminal> {
    const keys = createTerminalKeys();
    const session = await startSession();
    expect(await channelState(session.sessionId)).toBe("open");
    const joined = await joinAs(keys, session, deviceName);
    expect(joined).toMatchObject({
      body: { status: "bound" },
      statusCode: 200,
    });
    expect(await channelState(session.sessionId)).toBe("awaiting-confirmation");

    const view = await devices.currentPairingSession(
      await verifiedMainRequest(),
    );
    if (view.state !== "awaiting-confirmation") {
      throw new Error("The pairing session did not await confirmation");
    }
    expect(view.terminalName).toBe(deviceName);
    // Both sides reduce the same bound facts to the same twelve digits.
    expect(view.fingerprintDigits).toBe(
      deriveFingerprintDigits(
        buildFingerprintTranscript({
          caFingerprint: session.caFingerprint,
          installationId: pharmacyCa.installationId,
          sessionId: session.sessionId,
          spkiDer: keys.spkiDer,
        }),
      ),
    );

    const confirmed = await devices.confirmPairingSession(
      await verifiedMainRequest(),
      session.sessionId,
      { idempotencyKey: randomUUID() },
    );
    expect(await channelState(session.sessionId)).toBe("confirmed");
    const collected = await fetchCertificate(keys, session.sessionId);
    expect(collected.statusCode).toBe(200);
    expect(collected.body.deviceId).toBe(confirmed.deviceId);
    expect(collected.body.installationId).toBe(pharmacyCa.installationId);
    // Delivery is idempotent for the key holder.
    const again = await fetchCertificate(keys, session.sessionId);
    expect(again.body.certificatePem).toBe(collected.body.certificatePem);

    const terminal: PairedTerminal = {
      certificatePem: String(collected.body.certificatePem),
      deviceId: confirmed.deviceId,
      keys,
    };
    terminals.push(terminal);
    return terminal;
  }

  async function loginFrom(terminal: PairedTerminal, agent?: https.Agent) {
    return await sendTerminalRequest({
      ...(agent === undefined ? {} : { agent }),
      body: { password: OWNER_PASSWORD, username: "pairing.owner" },
      caCertPem: pharmacyCa.caCertPem,
      clientCertPem: terminal.certificatePem,
      clientKeyPem: terminal.keys.privateKeyPem,
      headers: BRIDGE_HEADERS,
      method: "POST",
      path: "/identity/login",
      port,
    });
  }

  /**
   * A request the way the mTLS boundary hands one to a handler: no Main device
   * headers, and the verified terminal certificate attached in their place.
   */
  async function terminalRequest(terminal: PairedTerminal): Promise<Request> {
    const stored = await administrator.query<{ cert_fingerprint: string }>(
      "select cert_fingerprint from terminal_devices where id = $1",
      [terminal.deviceId],
    );
    const fingerprint = stored.rows[0]?.cert_fingerprint;
    if (fingerprint === undefined) {
      throw new Error("The terminal device record is missing");
    }
    const request = {
      get: (): string | undefined => undefined,
    } as unknown as Request;
    security.acceptTerminalDevice(request, {
      certFingerprint: Buffer.from(fingerprint, "hex"),
      terminalDeviceId: terminal.deviceId,
    });
    return request;
  }

  /**
   * Nothing Breev wrote may contain a join secret or an invitation that could
   * be replayed into a pairing.
   */
  function expectNoSecret(written: string): void {
    expect(written).not.toContain("breev-pair://");
    for (const secret of mintedSecrets) {
      expect(written).not.toContain(secret);
    }
  }

  /** A plain loopback request, with whatever Host the caller claims. */
  function readFromLoopback(
    path: string,
    host: string,
  ): Promise<{ body: Record<string, unknown>; statusCode: number }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          headers: { host, ...BRIDGE_HEADERS },
          hostname: "127.0.0.1",
          method: "GET",
          path,
          port: loopbackPort,
        },
        (response) => {
          let raw = "";
          response.on("data", (chunk) => {
            raw += String(chunk);
          });
          response.on("end", () => {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              parsed = { raw };
            }
            resolve({ body: parsed, statusCode: response.statusCode ?? 500 });
          });
        },
      );
      request.on("error", reject);
      request.end();
    });
  }

  async function readFrom(
    terminal: PairedTerminal,
    path: string,
  ): Promise<{ body: Record<string, unknown>; statusCode: number }> {
    return await sendTerminalRequest({
      caCertPem: pharmacyCa.caCertPem,
      clientCertPem: terminal.certificatePem,
      clientKeyPem: terminal.keys.privateKeyPem,
      headers: BRIDGE_HEADERS,
      method: "GET",
      path,
      port,
    });
  }

  async function denialOf(
    work: () => Promise<unknown>,
  ): Promise<DevicesDenied> {
    const error = await work().then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DevicesDenied);
    return error as DevicesDenied;
  }

  // ─── The ceremony ──────────────────────────────────────────────────────────

  it("pairs a terminal end to end over the LAN channel and signs a user in", async () => {
    const anchor = await sendTerminalRequest({
      caCertPem: pharmacyCa.caCertPem,
      method: "GET",
      path: "/pairing/ca-certificate",
      port,
    });
    expect(anchor.statusCode).toBe(200);
    expect(anchor.body.installationId).toBe(pharmacyCa.installationId);
    expect(anchor.body.caCertificatePem).toBe(pharmacyCa.caCertPem);

    const terminal = await pairTerminal("Counter 1");

    const login = await loginFrom(terminal);
    expect(login.statusCode).toBe(200);
    expect(login.body).toMatchObject({ state: "authenticated" });
    expect(
      (login.body as { allowedPermissions: string[] }).allowedPermissions,
    ).toContain("devices.pair");

    const sessions = await administrator.query<{ count: string }>(
      `select count(*)::text as count from identity_sessions
       where terminal_device_id = $1 and revoked_at is null`,
      [terminal.deviceId],
    );
    expect(sessions.rows[0]?.count).toBe("1");
  }, 180_000);

  it("keeps exactly one active session per terminal device", async () => {
    const terminal = terminals[0]!;
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    const sessions = await administrator.query<{ count: string }>(
      `select count(*)::text as count from identity_sessions
       where terminal_device_id = $1 and revoked_at is null`,
      [terminal.deviceId],
    );
    expect(sessions.rows[0]?.count).toBe("1");
  }, 120_000);

  it("refuses device administration from a terminal, whatever it may hold", async () => {
    const terminal = terminals[0]!;
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    const request = await terminalRequest(terminal);
    const denial = await denialOf(async () => devices.inventory(request));
    expect(denial.denial.code).toBe("device-not-found");
    const audits = await administrator.query<{ outcome: string }>(
      `select outcome from devices_audit_records
       where action = 'devices.administration'
       order by occurred_at desc limit 1`,
    );
    expect(audits.rows[0]?.outcome).toBe("terminal-not-permitted");
  }, 60_000);

  it("gives state polling its own budget, above what the terminal spends", async () => {
    const session = await startSession();
    const codes: number[] = [];
    for (let attempt = 0; attempt < 91; attempt += 1) {
      const response = await sendTerminalRequest({
        caCertPem: pharmacyCa.caCertPem,
        method: "GET",
        path: `/pairing/sessions/${session.sessionId}/state`,
        port,
      });
      codes.push(response.statusCode);
    }
    // Ninety polls a minute is far more than the shipped client performs while
    // a human walks over and compares digits, and the ninety-first is still
    // refused rather than unbounded.
    expect(codes.filter((code) => code === 200)).toHaveLength(90);
    expect(codes[90]).toBe(429);

    // Spending the polling budget must not spend the budget for the requests
    // that actually claim the session.
    const keys = createTerminalKeys();
    expect((await joinAs(keys, session, "Budget Terminal")).statusCode).toBe(
      200,
    );
    await cancelSession(session.sessionId);
  }, 180_000);

  it("refuses anything but the pairing routes without a client certificate", async () => {
    const denied = await sendTerminalRequest({
      caCertPem: pharmacyCa.caCertPem,
      headers: BRIDGE_HEADERS,
      method: "GET",
      path: "/identity/state",
      port,
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.body).toMatchObject({ code: "mtls-cert-missing" });

    // A path that merely looks like the pairing channel is not part of it.
    const notAllowlisted = await sendTerminalRequest({
      caCertPem: pharmacyCa.caCertPem,
      method: "GET",
      path: "/pairing/sessions",
      port,
    });
    expect(notAllowlisted.statusCode).toBe(401);
    expect(notAllowlisted.body).toMatchObject({ code: "mtls-cert-missing" });

    const malformed = await sendTerminalRequest({
      body: { csrPem: "x", deviceName: "x", joinSecret: "x", sessionId: "x" },
      caCertPem: pharmacyCa.caCertPem,
      method: "POST",
      path: "/pairing/joins",
      port,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).toMatchObject({ code: "body-invalid" });
  }, 60_000);

  it("accepts the LAN authority only from the LAN listener", async () => {
    // The same Host header through the two doors. On the LAN listener it is the
    // address the terminal actually dialled — every terminal request in this
    // suite proves that. On loopback it is a claim a local caller made up, and
    // the boundary must not honour it there.
    const spoofed = await readFromLoopback(
      "/identity/state",
      `127.0.0.1:${String(port)}`,
    );
    expect(spoofed.statusCode).toBe(421);
    expect(spoofed.body).toMatchObject({ code: "host-not-allowed" });

    const honest = await readFromLoopback(
      "/identity/state",
      `127.0.0.1:${String(loopbackPort)}`,
    );
    expect(honest.statusCode).toBe(401);
    expect(honest.body).toMatchObject({ code: "binding-missing" });
  }, 60_000);

  it("refuses a second pairing session while one is open", async () => {
    const session = await startSession();
    const open = await devices.currentPairingSession(
      await verifiedMainRequest(),
    );
    expect(open).toMatchObject({
      caFingerprint: session.caFingerprint,
      sessionId: session.sessionId,
      state: "open",
    });
    if (open.state !== "open") {
      throw new Error("The pairing session was not open");
    }
    // The QR the Main shows is the invitation it minted, and the join secret
    // inside it exists only in this process.
    expect(decodePairingInvitation(open.qrUri)?.joinSecret).toBe(
      session.joinSecret,
    );
    const denial = await denialOf(async () =>
      devices.startPairingSession(await verifiedMainRequest(), {
        idempotencyKey: randomUUID(),
        stepUpChallengeId: await approvedStepUp("devices.pairing.start"),
      }),
    );
    expect(denial.denial.code).toBe("pairing-session-conflict");
    await cancelSession(session.sessionId);
    expect(
      await devices.currentPairingSession(await verifiedMainRequest()),
    ).toMatchObject({ reason: "user-cancelled", state: "cancelled" });
  }, 120_000);

  it("replays a pairing start without handing back the invitation", async () => {
    // The exact same request twice, which is what a client that lost the first
    // response actually sends.
    const input = {
      idempotencyKey: randomUUID(),
      stepUpChallengeId: await approvedStepUp("devices.pairing.start"),
    };
    const started = await devices.startPairingSession(
      await verifiedMainRequest(),
      input,
    );
    const invitation = decodePairingInvitation(started.qrUri ?? "");
    if (invitation === undefined) {
      throw new Error("The pairing start did not mint an invitation");
    }
    mintedSecrets.push(invitation.joinSecret);

    // The retry is answered from the recorded result, which never held the
    // invitation, so the QR comes back from the current-session route instead.
    const replayed = await devices.startPairingSession(
      await verifiedMainRequest(),
      input,
    );
    expect(replayed.sessionId).toBe(started.sessionId);
    expect(replayed.qrUri).toBeUndefined();
    expect(Object.keys(replayed).sort()).toEqual([
      "caFingerprint",
      "expiresAt",
      "sessionId",
    ]);

    const current = await devices.currentPairingSession(
      await verifiedMainRequest(),
    );
    if (current.state !== "open") {
      throw new Error("The replayed session was not still open");
    }
    expect(decodePairingInvitation(current.qrUri)?.joinSecret).toBe(
      invitation.joinSecret,
    );
    await cancelSession(started.sessionId);
  }, 120_000);

  it("counts wrong join secrets, fails the session, and commits the evidence", async () => {
    const session = await startSession();
    const keys = createTerminalKeys();
    const wrong = randomBytes(32).toString("base64url");
    const codes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await joinAs(keys, session, "Counter X", {
        joinSecret: wrong,
      });
      codes.push(String(response.body.code));
    }
    expect(codes.slice(0, 4)).toEqual(Array(4).fill("pairing-session-missing"));
    expect(codes[4]).toBe("pairing-attempts-exceeded");

    const stored = await administrator.query<{
      join_attempt_count: number;
      state: string;
    }>("select state, join_attempt_count from pairing_sessions where id = $1", [
      session.sessionId,
    ]);
    expect(stored.rows[0]).toMatchObject({
      join_attempt_count: 5,
      state: "failed",
    });
    // Even the correct secret is refused once the budget is spent.
    expect((await joinAs(keys, session, "Counter X")).body.code).toBe(
      "pairing-attempts-exceeded",
    );

    const audits = await administrator.query<{ outcome: string }>(
      `select outcome from devices_audit_records
       where pairing_session_id = $1 and action = 'devices.pairing.join'
       order by occurred_at, id`,
      [session.sessionId],
    );
    expect(audits.rows.map((row) => row.outcome)).toEqual([
      "pairing-session-missing",
      "pairing-session-missing",
      "pairing-session-missing",
      "pairing-session-missing",
      "pairing-attempts-exceeded",
      "pairing-attempts-exceeded",
    ]);
  }, 180_000);

  it("fails the session on the attempt that exhausts the budget, whatever spent it", async () => {
    const session = await startSession();
    const keys = createTerminalKeys();
    const codes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // The right secret every time, and a certificate request that cannot be
      // read. The budget is spent all the same.
      const response = await sendTerminalRequest({
        body: {
          csrPem:
            "-----BEGIN CERTIFICATE REQUEST-----\nAA==\n-----END CERTIFICATE REQUEST-----\n",
          deviceName: "Malformed Terminal",
          joinSecret: session.joinSecret,
          sessionId: session.sessionId,
          transcriptSignature: signTranscript(
            buildJoinTranscript({
              caFingerprint: session.caFingerprint,
              installationId: pharmacyCa.installationId,
              sessionId: session.sessionId,
              spkiDer: keys.spkiDer,
            }),
            keys,
          ),
        },
        caCertPem: pharmacyCa.caCertPem,
        method: "POST",
        path: "/pairing/joins",
        port,
      });
      codes.push(String(response.body.code));
    }
    expect(codes).toEqual(Array(5).fill("pairing-signature-invalid"));

    const stored = await administrator.query<{
      failure_reason: string | null;
      join_attempt_count: number;
      state: string;
    }>(
      `select state, join_attempt_count, failure_reason
       from pairing_sessions where id = $1`,
      [session.sessionId],
    );
    expect(stored.rows[0]).toMatchObject({
      failure_reason: "excess-attempts",
      join_attempt_count: 5,
      state: "failed",
    });
    // The Main stops showing a live QR the moment the budget is gone.
    expect(
      await devices.currentPairingSession(await verifiedMainRequest()),
    ).toMatchObject({ reason: "excess-attempts", state: "failed" });
    expect(await channelState(session.sessionId)).toBe("failed");

    // The audit says the budget ran out, and keeps the true reason beside it.
    const audits = await administrator.query<{
      details: Record<string, unknown> | null;
      outcome: string;
    }>(
      `select outcome, details from devices_audit_records
       where pairing_session_id = $1 and action = 'devices.pairing.join'
       order by occurred_at, id`,
      [session.sessionId],
    );
    expect(audits.rows.map((row) => row.outcome)).toEqual([
      "csr-malformed",
      "csr-malformed",
      "csr-malformed",
      "csr-malformed",
      "pairing-attempts-exceeded",
    ]);
    expect(audits.rows[4]?.details).toMatchObject({
      attempts: 5,
      reason: "csr-malformed",
    });
  }, 180_000);

  it("refuses a replayed invitation once a terminal has bound its key", async () => {
    const session = await startSession();
    const first = createTerminalKeys();
    expect((await joinAs(first, session, "Counter 2")).statusCode).toBe(200);

    const impostor = createTerminalKeys();
    const replay = await joinAs(impostor, session, "Impostor");
    expect(replay.body).toMatchObject({ code: "pairing-session-replayed" });

    const bound = await administrator.query<{ bound_spki_der: Buffer }>(
      "select bound_spki_der from pairing_sessions where id = $1",
      [session.sessionId],
    );
    expect(bound.rows[0]?.bound_spki_der).toEqual(first.spkiDer);

    // The operator sees a mismatch and cancels with that reason.
    await devices.cancelPairingSession(
      await verifiedMainRequest(),
      session.sessionId,
      { idempotencyKey: randomUUID(), reason: "fingerprint-mismatch" },
    );
    expect(
      await devices.currentPairingSession(await verifiedMainRequest()),
    ).toMatchObject({ reason: "fingerprint-mismatch", state: "cancelled" });
    // A cancelled session never yields a certificate.
    const collected = await fetchCertificate(first, session.sessionId);
    expect(collected.body).toMatchObject({ code: "pairing-session-conflict" });
  }, 180_000);

  it("denies a session the server clock has already expired", async () => {
    const session = await startSession();
    await administrator.query(
      `update pairing_sessions
       set created_at = statement_timestamp() - interval '10 minutes',
           expires_at = statement_timestamp() - interval '1 second'
       where id = $1`,
      [session.sessionId],
    );
    const keys = createTerminalKeys();
    expect((await joinAs(keys, session, "Late Terminal")).body).toMatchObject({
      code: "pairing-session-expired",
    });
    const stored = await administrator.query<{ state: string }>(
      "select state from pairing_sessions where id = $1",
      [session.sessionId],
    );
    expect(stored.rows[0]?.state).toBe("expired");
  }, 120_000);

  it("refuses a join whose proof of possession does not match its request", async () => {
    const session = await startSession();
    const keys = createTerminalKeys();
    const other = createTerminalKeys();
    const forged = await sendTerminalRequest({
      body: {
        csrPem: buildCertificateRequest(keys),
        deviceName: "Forged Terminal",
        joinSecret: session.joinSecret,
        sessionId: session.sessionId,
        // Signed by a key the request does not carry.
        transcriptSignature: signTranscript(
          buildJoinTranscript({
            caFingerprint: session.caFingerprint,
            installationId: pharmacyCa.installationId,
            sessionId: session.sessionId,
            spkiDer: keys.spkiDer,
          }),
          other,
        ),
      },
      caCertPem: pharmacyCa.caCertPem,
      method: "POST",
      path: "/pairing/joins",
      port,
    });
    expect(forged.body).toMatchObject({ code: "pairing-signature-invalid" });
    expect((await joinAs(keys, session, "Counter 3")).statusCode).toBe(200);
    await cancelSession(session.sessionId);
  }, 180_000);

  it("keeps concurrent joins of one session to a single bound key", async () => {
    const session = await startSession();
    const first = createTerminalKeys();
    const second = createTerminalKeys();
    const [left, right] = await Promise.all([
      joinAs(first, session, "Race A"),
      joinAs(second, session, "Race B"),
    ]);
    expect(
      [left, right].filter((response) => response.statusCode === 200),
    ).toHaveLength(1);
    const bound = await administrator.query<{ bound_spki_der: Buffer }>(
      "select bound_spki_der from pairing_sessions where id = $1",
      [session.sessionId],
    );
    const stored = bound.rows[0]?.bound_spki_der;
    expect(
      stored?.equals(first.spkiDer) === true ||
        stored?.equals(second.spkiDer) === true,
    ).toBe(true);
    await cancelSession(session.sessionId);
  }, 180_000);

  it("keeps concurrent confirmations of one session to a single device", async () => {
    const session = await startSession();
    const keys = createTerminalKeys();
    expect((await joinAs(keys, session, "Counter 4")).statusCode).toBe(200);
    const outcomes = await Promise.allSettled([
      devices.confirmPairingSession(
        await verifiedMainRequest(),
        session.sessionId,
        { idempotencyKey: randomUUID() },
      ),
      devices.confirmPairingSession(
        await verifiedMainRequest(),
        session.sessionId,
        { idempotencyKey: randomUUID() },
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const created = await administrator.query<{ count: string }>(
      `select count(*)::text as count from terminal_devices
       where pairing_session_id = $1`,
      [session.sessionId],
    );
    expect(created.rows[0]?.count).toBe("1");

    const collected = await fetchCertificate(keys, session.sessionId);
    expect(collected.statusCode).toBe(200);
    terminals.push({
      certificatePem: String(collected.body.certificatePem),
      deviceId: String(collected.body.deviceId),
      keys,
    });
  }, 240_000);

  // ─── Seats ─────────────────────────────────────────────────────────────────

  it("refuses a terminal beyond the licence's permitted device count", async () => {
    // A licence permitting three devices, with the Main and two terminals
    // already holding seats, leaves nothing to allocate.
    await installLicence(3);
    expect(await seatUsage()).toEqual({ permitted: 3, used: 3 });

    const session = await startSession();
    const keys = createTerminalKeys();
    expect((await joinAs(keys, session, "Counter 5")).statusCode).toBe(200);
    const denial = await denialOf(async () =>
      devices.confirmPairingSession(
        await verifiedMainRequest(),
        session.sessionId,
        { idempotencyKey: randomUUID() },
      ),
    );
    expect(denial.denial.code).toBe("pairing-seat-unavailable");

    // The very same code accepts the very same terminal once a licence with a
    // higher permitted count is installed. Nothing else changes.
    await installLicence(6);
    const confirmed = await devices.confirmPairingSession(
      await verifiedMainRequest(),
      session.sessionId,
      { idempotencyKey: randomUUID() },
    );
    const collected = await fetchCertificate(keys, session.sessionId);
    expect(collected.statusCode).toBe(200);
    terminals.push({
      certificatePem: String(collected.body.certificatePem),
      deviceId: confirmed.deviceId,
      keys,
    });
    expect(await seatUsage()).toEqual({ permitted: 6, used: 4 });
  }, 240_000);

  it("serves one Main and three terminals at the same time over the LAN", async () => {
    expect(terminals).toHaveLength(3);
    const agents = terminals.map(
      () => new https.Agent({ keepAlive: true, maxSockets: 1 }),
    );
    try {
      const results = await Promise.all([
        ...terminals.map(
          async (terminal, index) => await loginFrom(terminal, agents[index]),
        ),
        (async () => await devices.inventory(await verifiedMainRequest()))(),
      ]);
      for (const response of results.slice(0, 3)) {
        expect(response).toMatchObject({ statusCode: 200 });
      }
      const connected = terminals.filter(
        (terminal) => registry.openSocketCount(terminal.deviceId) > 0,
      );
      expect(connected).toHaveLength(3);
      const inventory = await devices.inventory(await verifiedMainRequest());
      expect(inventory.devices).toHaveLength(3);
      expect(
        inventory.devices.filter((device) => device.connected),
      ).toHaveLength(3);
      expect(inventory.seatUsage).toEqual({ permitted: 6, used: 4 });
    } finally {
      for (const agent of agents) {
        agent.destroy();
      }
    }
  }, 180_000);

  // ─── Working from a terminal ───────────────────────────────────────────────

  it("records an attendance event against the terminal that took it", async () => {
    const terminal = terminals[0]!;
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    await administrator.query(
      `update pharmacy_settings set attendance_enabled = true
       where pharmacy_id = $1`,
      [pharmacyId],
    );
    const presence = await administrator.query<{ version: string }>(
      `select version::text from attendance_presence
       where pharmacy_id = $1 and user_id = $2`,
      [pharmacyId, await ownerId()],
    );
    const command = {
      expectedVersion: presence.rows[0]!.version,
      idempotencyKey: randomUUID(),
      kind: "check-in" as const,
    };

    const event = await identity.recordAttendance(
      await terminalRequest(terminal),
      command,
    );
    expect(event.status).toBe("checked-in");

    // Both writes name the terminal and leave the Main column null, which is
    // what the one-device-kind constraint requires of them.
    const stored = await administrator.query<{
      device_id: string | null;
      terminal_device_id: string | null;
    }>(
      `select device_id, terminal_device_id from attendance_events
       where id = $1`,
      [event.id],
    );
    expect(stored.rows[0]).toEqual({
      device_id: null,
      terminal_device_id: terminal.deviceId,
    });
    const recorded = await administrator.query<{
      device_id: string | null;
      terminal_device_id: string | null;
    }>(
      `select device_id, terminal_device_id from identity_command_results
       where idempotency_key = $1`,
      [command.idempotencyKey],
    );
    expect(recorded.rows[0]).toEqual({
      device_id: null,
      terminal_device_id: terminal.deviceId,
    });

    // The recorded result is what a retry from the same terminal replays.
    expect(
      await identity.recordAttendance(await terminalRequest(terminal), command),
    ).toEqual(event);
  }, 180_000);

  it("commits a role-authorized mutation started from a terminal", async () => {
    const terminal = terminals[0]!;
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    const challenge = await identity.createStepUp(
      await terminalRequest(terminal),
      { action: "identity.user.create", idempotencyKey: randomUUID() },
    );
    await identity.approveStepUp(
      await terminalRequest(terminal),
      challenge.id,
      {
        idempotencyKey: randomUUID(),
        password: OWNER_PASSWORD,
      },
    );
    const idempotencyKey = randomUUID();
    const created = await identity.createUser(await terminalRequest(terminal), {
      challengeId: challenge.id,
      displayName: "Counter Pharmacist",
      idempotencyKey,
      password: "a password typed at the till",
      role: "pharmacist",
      username: "counter.pharmacist",
    });
    expect(created.username).toBe("counter.pharmacist");

    for (const [table, column, value] of [
      ["step_up_challenges", "id", challenge.id],
      ["identity_command_results", "idempotency_key", idempotencyKey],
    ] as const) {
      const stored = await administrator.query<{
        device_id: string | null;
        terminal_device_id: string | null;
      }>(
        `select device_id, terminal_device_id from ${table} where ${column} = $1`,
        [value],
      );
      expect(stored.rows[0]).toEqual({
        device_id: null,
        terminal_device_id: terminal.deviceId,
      });
    }
  }, 180_000);

  it("stops a terminal the moment the licence stops permitting one", async () => {
    const terminal = terminals[0]!;
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    await licensing.deactivate(database.requirePool(), {
      actorId: await ownerId(),
      mainDeviceId: MAIN_DEVICE_ID,
      now: new Date(),
      pharmacyId,
    });

    // The session the terminal already holds stops working on its next
    // request, and it is refused as unlicensed rather than as unauthorized.
    const refused = await identity
      .requirePermission(await terminalRequest(terminal), "attendance.record")
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(LicensingDenied);
    expect((refused as LicensingDenied).denial).toMatchObject({
      code: "entitlement-denied",
      requiredCapability: "additional-device-pos",
    });

    // A fresh login is refused before any session is created.
    const login = await loginFrom(terminal);
    expect(login.statusCode).toBe(403);
    expect(login.body).toMatchObject({
      code: "entitlement-denied",
      requiredCapability: "additional-device-pos",
    });

    const audit = await administrator.query<{
      capability: string | null;
      outcome: string;
      terminal_device_id: string | null;
    }>(
      `select capability, outcome, terminal_device_id
       from licensing_audit_records
       where action = 'capability.authorization'
       order by recorded_at desc, id desc
       limit 1`,
    );
    expect(audit.rows[0]).toMatchObject({
      capability: "additional-device-pos",
      outcome: "denied",
      terminal_device_id: terminal.deviceId,
    });

    // The Main Pharmacy Computer keeps working, and reports no seat usage at
    // all rather than inventing a permitted device count.
    const inventory = await devices.inventory(await verifiedMainRequest());
    expect(inventory.seatUsage).toBeNull();
    expect(inventory.devices).toHaveLength(3);

    // A valid licence restores every paired terminal without re-pairing any of
    // them: the certificates and the device records were never in question.
    await installLicence(6);
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    expect(await seatUsage()).toEqual({ permitted: 6, used: 4 });
  }, 240_000);

  it("refuses every protected route to a terminal with nobody signed in", async () => {
    const terminal = terminals[0]!;
    expect((await loginFrom(terminal)).statusCode).toBe(200);
    await identity.logout(await terminalRequest(terminal));

    for (const path of ["/identity/roles", "/recovery/status"]) {
      const denied = await readFrom(terminal, path);
      expect(denied.statusCode).toBe(401);
      expect(denied.body).toMatchObject({ code: "session-missing" });
    }
    // The Main device proof surface is not a terminal surface at all: a
    // terminal has no Main binding to demonstrate.
    const proof = await readFrom(terminal, "/security/device-session-proof");
    expect(proof.statusCode).toBe(401);
    expect(proof.body).toMatchObject({ code: "binding-invalid" });

    // Reading its own state and signing in again are the only two things left,
    // which is exactly what a paired device without a user may do.
    const state = await readFrom(terminal, "/identity/state");
    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ state: "unauthenticated" });
    expect((await loginFrom(terminal)).statusCode).toBe(200);
  }, 180_000);

  // ─── Revocation and seat release ───────────────────────────────────────────

  it("ends a revoked terminal's sessions and open connections at once", async () => {
    const target = terminals[terminals.length - 1]!;
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
    expect((await loginFrom(target, agent)).statusCode).toBe(200);
    expect(registry.openSocketCount(target.deviceId)).toBeGreaterThanOrEqual(1);

    const revocation = await devices.revokeDevice(
      await verifiedMainRequest(),
      target.deviceId,
      {
        idempotencyKey: randomUUID(),
        reason: "terminal lost",
        stepUpChallengeId: await approvedStepUp(
          "devices.revoke",
          target.deviceId,
        ),
      },
    );
    expect(revocation.revokedAt).toMatch(/^\d{4}-/u);
    expect(registry.openSocketCount(target.deviceId)).toBe(0);

    const sessions = await administrator.query<{
      revocation_reason: string | null;
      revoked_at: Date | null;
    }>(
      `select revoked_at, revocation_reason from identity_sessions
       where terminal_device_id = $1`,
      [target.deviceId],
    );
    expect(sessions.rows.length).toBeGreaterThan(0);
    for (const row of sessions.rows) {
      expect(row.revoked_at).not.toBeNull();
    }
    expect(
      sessions.rows.some((row) => row.revocation_reason === "administrative"),
    ).toBe(true);

    agent.destroy();
    // The certificate is still cryptographically valid; the current device
    // record is what refuses it.
    const afterRevocation = await loginFrom(target);
    expect(afterRevocation.statusCode).toBe(403);
    expect(afterRevocation.body).toMatchObject({ code: "device-revoked" });

    // The other terminals are untouched.
    expect((await loginFrom(terminals[0]!)).statusCode).toBe(200);
    // The seat stays consumed until it is deliberately released.
    expect((await seatUsage()).used).toBe(4);
  }, 240_000);

  it("refuses an in-flight terminal transaction once revocation has committed", async () => {
    const target = terminals[terminals.length - 1]!;
    const sessionRow = await administrator.query<{ id: string }>(
      `select id from identity_sessions
       where terminal_device_id = $1
       order by created_at desc limit 1`,
      [target.deviceId],
    );
    const role = await administrator.query<{ id: string }>(
      "select id from pharmacy_roles where role_key = 'owner'",
    );
    const context: IdentityExecutionContext = {
      actorId: await ownerId(),
      authRevision: 1n,
      deviceId: undefined,
      deviceSessionHash: undefined,
      entitlement: { capabilities: [], licence: null, status: "free-core" },
      licensingDeviceId: MAIN_DEVICE_ID,
      permissions: ["devices.pair"],
      pharmacyId,
      pharmacyIdentityRevision: 1n,
      roleId: role.rows[0]!.id,
      roleKey: "owner",
      roleRevision: 1n,
      sessionId: sessionRow.rows[0]!.id,
      terminalCertFingerprint: Buffer.alloc(32),
      terminalDeviceId: target.deviceId,
    };
    const client = await database.requirePool().connect();
    try {
      await client.query("begin");
      await expect(
        identity.revalidateDeviceAdministration(client, context),
      ).rejects.toMatchObject({ denial: { code: "session-revoked" } });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }, 120_000);

  it("refuses a terminal login that raced its own revocation", async () => {
    // The mTLS boundary refuses a revoked device before a handler runs, so the
    // interleaving this covers is the one it cannot: a request verified a
    // moment before the revocation committed, arriving at login afterwards.
    // Driving login with the already-verified terminal context reproduces
    // exactly that request, and the recheck inside the login transaction is
    // what refuses it.
    const target = terminals[terminals.length - 1]!;
    await expect(
      identity.login(await terminalRequest(target), {
        password: OWNER_PASSWORD,
        username: "pairing.owner",
      }),
    ).rejects.toMatchObject({ denial: { code: "session-revoked" } });
    const sessions = await administrator.query<{ count: string }>(
      `select count(*)::text as count from identity_sessions
       where terminal_device_id = $1 and revoked_at is null`,
      [target.deviceId],
    );
    expect(sessions.rows[0]?.count).toBe("0");
  }, 120_000);

  it("releases a seat only when a different authorized user approves", async () => {
    const target = terminals[terminals.length - 1]!;
    const createChallenge = await identity.createStepUp(
      await verifiedMainRequest(),
      { action: "identity.user.create", idempotencyKey: randomUUID() },
    );
    await identity.approveStepUp(
      await verifiedMainRequest(),
      createChallenge.id,
      { idempotencyKey: randomUUID(), password: OWNER_PASSWORD },
    );
    await identity.createUser(await verifiedMainRequest(), {
      challengeId: createChallenge.id,
      displayName: "Second Owner",
      idempotencyKey: randomUUID(),
      password: APPROVER_PASSWORD,
      role: "owner",
      username: "second.owner",
    });

    const requested = await devices.requestSeatRelease(
      await verifiedMainRequest(),
      {
        deviceId: target.deviceId,
        idempotencyKey: randomUUID(),
        stepUpChallengeId: await approvedStepUp(
          "devices.seat.release.request",
          target.deviceId,
        ),
      },
    );

    const sameUser = await denialOf(async () =>
      devices.approveSeatRelease(
        await verifiedMainRequest(),
        requested.requestId,
        {
          approverPassword: OWNER_PASSWORD,
          approverUsername: "pairing.owner",
          idempotencyKey: randomUUID(),
        },
      ),
    );
    expect(sameUser.denial.code).toBe("seat-release-approver-invalid");

    const wrongPassword = await denialOf(async () =>
      devices.approveSeatRelease(
        await verifiedMainRequest(),
        requested.requestId,
        {
          approverPassword: "not the approver password",
          approverUsername: "second.owner",
          idempotencyKey: randomUUID(),
        },
      ),
    );
    expect(wrongPassword.denial.code).toBe("seat-release-approver-invalid");

    const approvalKey = randomUUID();
    const released = await devices.approveSeatRelease(
      await verifiedMainRequest(),
      requested.requestId,
      {
        approverPassword: APPROVER_PASSWORD,
        approverUsername: "second.owner",
        idempotencyKey: approvalKey,
      },
    );
    expect(released.releasedAt).toMatch(/^\d{4}-/u);
    expect((await seatUsage()).used).toBe(3);

    // The recorded command is identified by what it asked for, never by the
    // credential that authorized it: an honest retry that corrects a mistyped
    // password replays the decision instead of colliding with it, which is only
    // possible because the stored fingerprint never saw the password.
    expect(
      await devices.approveSeatRelease(
        await verifiedMainRequest(),
        requested.requestId,
        {
          approverPassword: "a completely different password",
          approverUsername: "second.owner",
          idempotencyKey: approvalKey,
        },
      ),
    ).toEqual(released);
    // Changing what the command actually asks for still conflicts, so the
    // fingerprint has not simply stopped binding the request.
    await expect(
      devices.approveSeatRelease(
        await verifiedMainRequest(),
        requested.requestId,
        {
          approverPassword: APPROVER_PASSWORD,
          approverUsername: "pairing.owner",
          idempotencyKey: approvalKey,
        },
      ),
    ).rejects.toMatchObject({ denial: { code: "idempotency-conflict" } });

    const stored = await administrator.query<{
      approved_by: string;
      requested_by: string;
      status: string;
    }>(
      "select status, requested_by, approved_by from seat_release_requests where id = $1",
      [requested.requestId],
    );
    expect(stored.rows[0]?.status).toBe("approved");
    expect(stored.rows[0]?.approved_by).not.toBe(stored.rows[0]?.requested_by);
  }, 240_000);

  it("refuses a seat release for a terminal that is still live", async () => {
    const denial = await denialOf(async () =>
      devices.requestSeatRelease(await verifiedMainRequest(), {
        deviceId: terminals[0]!.deviceId,
        idempotencyKey: randomUUID(),
        stepUpChallengeId: await approvedStepUp(
          "devices.seat.release.request",
          terminals[0]!.deviceId,
        ),
      }),
    );
    expect(denial.denial.code).toBe("device-not-revoked");
  }, 120_000);

  it("never writes a secret, a key, or a reusable invitation anywhere", async () => {
    expect(mintedSecrets.length).toBeGreaterThan(0);
    const audits = await administrator.query<{
      details: Record<string, unknown> | null;
    }>("select details from devices_audit_records");
    expect(audits.rows.length).toBeGreaterThan(0);
    const allowedKeys = new Set([
      "attempts",
      "certFingerprint",
      "expiresAt",
      "permitted",
      "reason",
      "spkiSha256",
      "used",
    ]);
    for (const row of audits.rows) {
      expectNoSecret(JSON.stringify(row.details ?? {}));
      for (const [key, value] of Object.entries(row.details ?? {})) {
        expect(allowedKeys.has(key)).toBe(true);
        expect(String(value)).not.toContain("BEGIN ");
      }
    }

    // The recorded command results are ordinary, immutable rows a database
    // reader can see. After a full ceremony none of them holds an invitation,
    // so a stolen backup can never be replayed into a pairing.
    const commands = await administrator.query<{
      command_name: string;
      response_body: Record<string, unknown> | null;
    }>("select command_name, response_body from identity_command_results");
    expect(commands.rows.length).toBeGreaterThan(0);
    for (const row of commands.rows) {
      expectNoSecret(JSON.stringify(row.response_body));
    }
    const starts = commands.rows.filter(
      (row) => row.command_name === "devices.pairing_session.start",
    );
    expect(starts.length).toBeGreaterThan(0);
    for (const row of starts) {
      expect(Object.keys(row.response_body ?? {}).sort()).toEqual([
        "caFingerprint",
        "expiresAt",
        "sessionId",
      ]);
    }

    const sessions = await administrator.query<{ join_secret_hash: Buffer }>(
      "select join_secret_hash from pairing_sessions",
    );
    for (const row of sessions.rows) {
      expect(row.join_secret_hash.length).toBe(32);
    }
    // The table itself refuses a dangerous key even if a writer tried.
    await expect(
      administrator.query(
        `insert into devices_audit_records (installation_id, action, outcome, details)
         values ($1, 'devices.pairing.join', 'bound', $2::jsonb)`,
        [pharmacyCa.installationId, JSON.stringify({ joinSecret: "leaked" })],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      administrator.query("update devices_audit_records set outcome = 'x'"),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.requirePool().query("delete from devices_audit_records"),
    ).rejects.toMatchObject({ code: "42501" });
  }, 120_000);
});

/**
 * Answers one mounted route the way its transport does, so a denial reaches the
 * terminal with the status and body the real API would send rather than a
 * blanket 401.
 */
function answer(response: Response, work: () => Promise<unknown>): void {
  void work()
    .then((body) => {
      response.status(200).json(body);
    })
    .catch((error: unknown) => {
      const denied = denialResponse(error);
      response.status(denied.statusCode).json(denied.body);
    });
}

function denialResponse(error: unknown): {
  readonly body: unknown;
  readonly statusCode: number;
} {
  if (error instanceof HttpException) {
    return { body: error.getResponse(), statusCode: error.getStatus() };
  }
  if (error instanceof IdentityAccessDenied) {
    return { body: error.denial, statusCode: error.statusCode };
  }
  if (error instanceof LicensingDenied) {
    return {
      body: error.denial,
      statusCode: error.denial.code === "idempotency-conflict" ? 409 : 403,
    };
  }
  return { body: { code: "failed" }, statusCode: 500 };
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The probe socket has no port"));
        return;
      }
      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}
