import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  createPatientContract,
  getPatientContract,
  identityCreateUserContract,
  identityDenialSchema,
  identityLoginContract,
  identityStepUpApproveContract,
  identityStepUpApprovePath,
  identityStepUpCreateContract,
  listPatientWeightsContract,
  localSecurityDenialSchema,
  patientNotFoundSchema,
  patientProfileResponseSchema,
  patientValidationFailureSchema,
  patientVersionConflictSchema,
  productCreateContract,
  purchaseDraftCreateContract,
  purchaseDraftPostingsPath,
  purchaseDraftRowCommitContract,
  purchaseDraftRowsPath,
  purchasePostContract,
  saleDraftCreateContract,
  saleDraftPath,
  saleDraftReadContract,
  searchPatientsContract,
  supplierCreateContract,
  updatePatientProfileContract,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import { IdentityAccessService } from "../identity-access/identity-access.service.js";
import { LicensingService } from "../licensing/licensing.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { MainDeviceSecurityService } from "../main-device/main-device-security.service.js";
import { PatientsController } from "./patients.controller.js";
import { PatientsService } from "./patients.service.js";
import { PatientsRepository } from "./patients.repository.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "patients.owner";
const OWNER_PASSWORD = "patient profile owner password remains in this test";
const POISONED_PROXY = "http://127.0.0.1:1";

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface IdentitySeed {
  readonly actorId: string;
  readonly pharmacyId: string;
  readonly roleId: string;
}

describe.sequential("Patients HTTP and PostgreSQL boundary", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOutput = "";
  let apiOrigin: string;
  let apiPort: number;
  let credentials: MainDeviceCredentials;
  let freeCorePatientId: string | undefined;
  let databaseRoles: SeparatedDatabaseRoles;
  let identity: IdentitySeed;
  let postgres: StartedPostgreSqlContainer | undefined;

  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }

    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput, api);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });

    const bootstrapped = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Patients Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Patients Test Pharmacy",
    });
    expect(bootstrapped.status, failureContext([bootstrapped])).toBe(201);
    const bootBody = objectBody(bootstrapped);
    const actorId = objectBodyValue(bootBody.user).id;
    if (typeof actorId !== "string") {
      throw new Error("Bootstrap did not return the owner user id");
    }
    identity = {
      actorId,
      pharmacyId: "",
      roleId: "",
    };
    const loggedIn = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(loggedIn.status, failureContext([loggedIn])).toBe(200);

    const owner = await administrator.query<{
      pharmacy_id: string;
      role_id: string;
    }>("select pharmacy_id, role_id from identity_users where id = $1", [
      identity.actorId,
    ]);
    const ownerRow = owner.rows[0];
    if (ownerRow === undefined) {
      throw new Error("Bootstrap did not create the owner identity row");
    }
    identity = {
      actorId: identity.actorId,
      pharmacyId: ownerRow.pharmacy_id,
      roleId: ownerRow.role_id,
    };
  }, 120_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("creates a Sale Draft before any patient exists and leaves patients empty", async () => {
    expect(
      await scalarCount("select count(*)::text as count from patients", []),
    ).toBe(0);

    const body = saleDraftCreateContract.request.body.parse({
      idempotencyKey: uuidV7(),
    });
    const created = await request(
      saleDraftCreateContract.method,
      saleDraftCreateContract.path,
      body,
    );
    expect(created.status, failureContext([created])).toBe(201);
    const draft = saleDraftCreateContract.responses[201].parse(created.body);
    expect(draft).not.toHaveProperty("patientId");
    expect(
      await scalarCount("select count(*)::text as count from patients", []),
    ).toBe(0);
  });

  it("allows all patient operations on Free Core and keeps the HTTP contract honest", async () => {
    const identityState = await request("GET", "/identity/state");
    expect(identityState.status, failureContext([identityState])).toBe(200);
    const state = objectBody(identityState);
    expect(objectBodyValue(state.entitlement).status).toBe("free-core");
    expect(apiEnvironment().HTTP_PROXY).toBe(POISONED_PROXY);
    expect(apiEnvironment().HTTPS_PROXY).toBe(POISONED_PROXY);

    const created = await request("POST", createPatientContract.path, {
      firstName: "Free Core",
      heightCm: "170.0",
      idempotencyKey: uuidV7(),
      lastName: "Boundary",
    });
    expect(created.status, failureContext([created])).toBe(201);
    const profile = createPatientContract.responses[201].parse(created.body);
    freeCorePatientId = profile.id;

    const searched = await request(
      "GET",
      "/patients?q=Free%20Core%20Boundary&page=1&limit=20",
    );
    expect(searched.status, failureContext([searched])).toBe(200);
    expect(
      searchPatientsContract.responses[200]
        .parse(searched.body)
        .items.map(({ id }) => id),
    ).toContain(profile.id);

    const detail = await request("GET", `/patients/${profile.id}`);
    expect(detail.status, failureContext([detail])).toBe(200);
    expect(getPatientContract.responses[200].parse(detail.body).id).toBe(
      profile.id,
    );

    const weights = await request(
      "GET",
      `/patients/${profile.id}/weights?page=1&limit=20`,
    );
    expect(weights.status, failureContext([weights])).toBe(200);
    expect(
      listPatientWeightsContract.responses[200].parse(weights.body).total,
    ).toBe(0);

    const updated = await request("PUT", `/patients/${profile.id}`, {
      address: "Free Core update",
      expectedRevision: profile.revision,
      idempotencyKey: uuidV7(),
    });
    expect(updated.status, failureContext([updated])).toBe(200);
    expect(
      updatePatientProfileContract.responses[200].parse(updated.body),
    ).toMatchObject({ address: "Free Core update", revision: "2" });

    const invalid = await request("POST", "/patients", {
      firstName: "Invalid",
      heightCm: "999.9",
      idempotencyKey: uuidV7(),
      lastName: "Height",
    });
    expect(invalid.status, failureContext([invalid])).toBe(400);
    patientValidationFailureSchema.parse(invalid.body);

    const unknownPatient = await request("GET", `/patients/${uuidV7()}`);
    expect(unknownPatient.status, failureContext([unknownPatient])).toBe(404);
    patientNotFoundSchema.parse(unknownPatient.body);

    const callerChosenPharmacy = await request(
      "GET",
      `/patients?pharmacyId=${identity.pharmacyId}`,
    );
    expect(callerChosenPharmacy.status).toBe(400);
    patientValidationFailureSchema.parse(callerChosenPharmacy.body);
  });

  it("applies the shared terminal entitlement denial before patient authorization", async () => {
    const mainSession = await administrator.query<{ id: string }>(
      `select id from identity_sessions
       where pharmacy_id = $1 and user_id = $2 and device_id = $3
         and terminal_device_id is null and revoked_at is null
       order by created_at desc, id desc limit 1`,
      [identity.pharmacyId, identity.actorId, credentials.deviceId],
    );
    const mainSessionId = mainSession.rows[0]?.id;
    if (mainSessionId === undefined) {
      throw new Error("The owner Main-device session is missing");
    }

    const terminalDeviceId = uuidV7();
    const installationId = uuidV7();
    const licenceId = uuidV7();
    const pairingSessionId = uuidV7();
    const terminalFingerprint = randomBytes(32).toString("hex");
    const now = new Date();

    // The terminal must reference an installation; the real deactivation below
    // leaves the terminal context at Free Core.
    await administrator.query(
      `insert into licence_installations (
         licence_id, pharmacy_id, main_device_id, key_id, format_version,
         plan, features, founder_override_grants, permitted_device_count,
         issued_at, expires_at, grace_ends_at, encoded_licence, installed_by
       ) values (
         $1, $2, $3, 'patients-boundary-test', 1, 'free-core', '{}', '{}', 1,
         $4, $5, $6, 'unused test bytes', $7
       )`,
      [
        licenceId,
        identity.pharmacyId,
        credentials.deviceId,
        new Date(now.getTime() - 60_000),
        new Date(now.getTime() + 86_400_000),
        new Date(now.getTime() + 172_800_000),
        identity.actorId,
      ],
    );
    await administrator.query(
      `insert into pairing_sessions (
         id, pharmacy_id, installation_id, started_by_user_id,
         started_device_id, identity_session_id, state, join_secret_hash,
         max_join_attempts, bound_spki_der, bound_device_name, bound_at,
         confirmed_at, consumed_at, expires_at
       ) values (
         $1, $2, $3, $4, $5, $6, 'confirmed', $7, 3, $8,
         'Patient Boundary Terminal', statement_timestamp(),
         statement_timestamp(), statement_timestamp(),
         statement_timestamp() + interval '5 minutes'
       )`,
      [
        pairingSessionId,
        identity.pharmacyId,
        installationId,
        identity.actorId,
        credentials.deviceId,
        mainSessionId,
        randomBytes(32),
        randomBytes(32),
      ],
    );
    await administrator.query(
      `insert into terminal_devices (
         id, installation_id, cert_fingerprint, cert_serial,
         cert_not_before, cert_not_after, pharmacy_id, display_name,
         licence_id, cert_pem, paired_by, pairing_session_id
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'Patient Boundary Terminal',
         $8, 'test certificate placeholder', $9, $10
       )`,
      [
        terminalDeviceId,
        installationId,
        terminalFingerprint,
        randomBytes(8).toString("hex"),
        new Date(now.getTime() - 60_000),
        new Date(now.getTime() + 86_400_000),
        identity.pharmacyId,
        licenceId,
        identity.actorId,
        pairingSessionId,
      ],
    );
    await administrator.query(
      "update pairing_sessions set terminal_device_id = $1 where id = $2",
      [terminalDeviceId, pairingSessionId],
    );
    await administrator.query(
      `insert into identity_sessions (
         pharmacy_id, user_id, device_id, device_session_hash,
         terminal_device_id, terminal_cert_fingerprint, expires_at
       ) values ($1, $2, null, null, $3, $4, statement_timestamp() + interval '8 hours')`,
      [
        identity.pharmacyId,
        identity.actorId,
        terminalDeviceId,
        Buffer.from(terminalFingerprint, "hex"),
      ],
    );
    await administrator.query(
      `insert into licence_state_events (
         pharmacy_id, main_device_id, event_kind, licence_id,
         actor_user_id, identity_session_id
       ) values ($1, $2, 'deactivated', null, $3, $4)`,
      [
        identity.pharmacyId,
        credentials.deviceId,
        identity.actorId,
        mainSessionId,
      ],
    );

    const environmentKeys = [
      "DATABASE_URL",
      "DATABASE_MIGRATION_URL",
      "BREEV_MAIN_DEVICE_ID",
      "BREEV_MAIN_DEVICE_SECRET",
      "BREEV_MAIN_DEVICE_SESSION",
    ] as const;
    const originalEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    let localDatabase: LocalDatabaseService | undefined;
    try {
      process.env.DATABASE_URL = databaseRoles.applicationUrl;
      delete process.env.DATABASE_MIGRATION_URL;
      process.env.BREEV_MAIN_DEVICE_ID = credentials.deviceId;
      process.env.BREEV_MAIN_DEVICE_SECRET = credentials.deviceSecret;
      process.env.BREEV_MAIN_DEVICE_SESSION = credentials.sessionToken;

      localDatabase = new LocalDatabaseService();
      await localDatabase.ensureReady();
      const security = new MainDeviceSecurityService(localDatabase);
      const licensing = new LicensingService(localDatabase);
      const identityAccess = new IdentityAccessService(
        localDatabase,
        security,
        licensing,
        new DurableJobsService(localDatabase),
      );
      const patientService = new PatientsService(
        localDatabase,
        new PatientsRepository(),
        identityAccess,
      );
      const patientsController = new PatientsController(
        patientService,
        identityAccess,
      );
      const request = {} as Request;
      security.acceptTerminalDevice(request, {
        certFingerprint: Buffer.from(terminalFingerprint, "hex"),
        terminalDeviceId,
      });

      let denial: HttpException | undefined;
      try {
        await patientsController.searchPatients(request, {});
      } catch (error) {
        if (error instanceof HttpException) denial = error;
        else throw error;
      }
      expect(denial?.getStatus()).toBe(403);
      const denialBody = denial?.getResponse();
      expect(denialBody).toMatchObject({
        code: "entitlement-denied",
        requiredCapability: "additional-device-pos",
        status: "denied",
      });
      const requestId = objectBodyValue(denialBody).requestId;
      expect(typeof requestId).toBe("string");
      const audit = await administrator.query<{
        capability: string;
        outcome: string;
        terminal_device_id: string;
      }>(
        `select capability, outcome, terminal_device_id
         from licensing_audit_records where id = $1`,
        [requestId],
      );
      expect(audit.rows[0]).toEqual({
        capability: "additional-device-pos",
        outcome: "denied",
        terminal_device_id: terminalDeviceId,
      });
    } finally {
      await localDatabase?.onApplicationShutdown();
      for (const key of environmentKeys) {
        const original = originalEnvironment[key];
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }
  });

  it("denies every patient operation to an authenticated alternate user and audits each denial", async () => {
    const patientId = freeCorePatientId;
    if (patientId === undefined)
      throw new Error("Free Core patient is missing");

    const salesRole = await administrator.query<{ id: string }>(
      `select id from pharmacy_roles
       where pharmacy_id = $1 and role_key = 'sales_employee'`,
      [identity.pharmacyId],
    );
    const salesRoleId = salesRole.rows[0]?.id;
    if (salesRoleId === undefined) throw new Error("Sales role is missing");
    expect(
      await scalarCount(
        `select count(*)::text as count from role_permission_grants
         where role_id = $1 and permission_name like 'patients.%'`,
        [salesRoleId],
      ),
    ).toBe(0);

    const challengeResponse = await request(
      identityStepUpCreateContract.method,
      identityStepUpCreateContract.path,
      {
        action: "identity.user.create",
        idempotencyKey: uuidV7(),
      },
    );
    expect(challengeResponse.status, failureContext([challengeResponse])).toBe(
      201,
    );
    const challenge = identityStepUpCreateContract.responses[201].parse(
      challengeResponse.body,
    );
    const approved = await request(
      identityStepUpApproveContract.method,
      identityStepUpApprovePath(challenge.id),
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approved.status, failureContext([approved])).toBe(200);
    expect(
      identityStepUpApproveContract.responses[200].parse(approved.body).status,
    ).toBe("approved");

    const alternateUsername = "patients.no-permissions";
    const alternatePassword = "Patient boundary alternate password";
    const alternateCreated = await request(
      identityCreateUserContract.method,
      identityCreateUserContract.path,
      {
        challengeId: challenge.id,
        displayName: "Patients Without Permission",
        idempotencyKey: uuidV7(),
        password: alternatePassword,
        roleId: salesRoleId,
        username: alternateUsername,
      },
    );
    expect(alternateCreated.status, failureContext([alternateCreated])).toBe(
      201,
    );
    const alternateUser = identityCreateUserContract.responses[201].parse(
      alternateCreated.body,
    );
    const ownProfile = await request("GET", `/patients/${patientId}`);
    const currentProfile = getPatientContract.responses[200].parse(
      ownProfile.body,
    );

    try {
      const login = await request("POST", identityLoginContract.path, {
        password: alternatePassword,
        username: alternateUsername,
      });
      expect(login.status, failureContext([login])).toBe(200);
      expect(
        identityLoginContract.responses[200].parse(login.body).user.id,
      ).toBe(alternateUser.id);

      const requests = [
        {
          method: "GET" as const,
          route: "/patients?page=1&limit=20",
          permission: "patients.view",
        },
        {
          method: "GET" as const,
          route: `/patients/${patientId}`,
          permission: "patients.view",
        },
        {
          method: "GET" as const,
          route: `/patients/${patientId}/weights?page=1&limit=20`,
          permission: "patients.view",
        },
        {
          body: {
            firstName: "Denied",
            idempotencyKey: uuidV7(),
            lastName: "Create",
          },
          method: "POST" as const,
          route: createPatientContract.path,
          permission: "patients.manage",
        },
        {
          body: {
            address: "Denied update",
            expectedRevision: currentProfile.revision,
            idempotencyKey: uuidV7(),
          },
          method: "PUT" as const,
          route: `/patients/${patientId}`,
          permission: "patients.manage",
        },
      ];
      const deniedResponses = await Promise.all(
        requests.map(({ body, method, route }) => request(method, route, body)),
      );
      const denials = deniedResponses.map((response, index) => {
        expect(response.status, failureContext([response])).toBe(403);
        const denial = identityDenialSchema.parse(response.body);
        expect(denial).toMatchObject({
          code: "permission-denied",
          requiredPermission: requests[index]?.permission,
          status: "denied",
        });
        return denial;
      });
      const audit = await administrator.query<{
        action: string;
        actor_user_id: string;
        after_state: Record<string, unknown>;
        id: string;
        outcome: string;
      }>(
        `select id, action, actor_user_id, after_state, outcome
         from identity_audit_records where id = any($1::uuid[])
         order by occurred_at, id`,
        [denials.map(({ requestId }) => requestId)],
      );
      expect(audit.rows).toHaveLength(requests.length);
      expect(
        audit.rows
          .map(({ after_state }) => after_state.requiredPermission)
          .sort(),
      ).toEqual(requests.map(({ permission }) => permission).sort());
      for (const row of audit.rows) {
        expect(row).toMatchObject({
          action: "identity.authorization",
          actor_user_id: alternateUser.id,
          outcome: "denied",
        });
      }
    } finally {
      const restored = await request("POST", identityLoginContract.path, {
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      });
      expect(restored.status, failureContext([restored])).toBe(200);
      expect(
        identityLoginContract.responses[200].parse(restored.body).user.id,
      ).toBe(identity.actorId);
    }
  });

  it("cannot read or list a patient belonging to another real pharmacy", async () => {
    const otherPostgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    let otherAdministrator: Pool | undefined;
    let otherApi: ChildProcessWithoutNullStreams | undefined;
    let otherApiOutput = "";
    try {
      const otherDatabaseRoles =
        await createSeparatedDatabaseRoles(otherPostgres);
      otherAdministrator = new Pool({
        connectionString: otherDatabaseRoles.migrationUrl,
      });
      const otherCredentials = createMainDeviceCredentials();
      const otherPort = await reservePort();
      const otherOrigin = `http://127.0.0.1:${otherPort}`;
      otherApi = startApiAt(
        otherCredentials,
        otherDatabaseRoles,
        otherPort,
        (chunk) => {
          otherApiOutput += chunk.toString();
        },
      );
      await waitForHealth(otherOrigin, () => otherApiOutput, otherApi);

      const bootstrap = await requestAt(
        otherOrigin,
        otherCredentials,
        "POST",
        "/identity/bootstrap",
        {
          owner: {
            displayName: "Other Pharmacy Owner",
            password: OWNER_PASSWORD,
            username: OWNER_USERNAME,
          },
          pharmacyName: "Breev Other Pharmacy Test",
        },
      );
      expect(bootstrap.status, otherApiOutput).toBe(201);
      const login = await requestAt(
        otherOrigin,
        otherCredentials,
        "POST",
        identityLoginContract.path,
        { password: OWNER_PASSWORD, username: OWNER_USERNAME },
      );
      expect(login.status, otherApiOutput).toBe(200);

      const created = await requestAt(
        otherOrigin,
        otherCredentials,
        "POST",
        createPatientContract.path,
        {
          firstName: "Other Pharmacy",
          idempotencyKey: uuidV7(),
          lastName: "Boundary Patient",
        },
      );
      expect(created.status, otherApiOutput).toBe(201);
      const foreignPatient = createPatientContract.responses[201].parse(
        created.body,
      );
      const foreignRecord = await otherAdministrator.query<{
        id: string;
        pharmacy_id: string;
      }>("select id, pharmacy_id from patients where id = $1", [
        foreignPatient.id,
      ]);
      expect(foreignRecord.rows).toHaveLength(1);
      expect(foreignRecord.rows[0]?.pharmacy_id).not.toBe(identity.pharmacyId);
      expect(
        await scalarCount(
          "select count(*)::text as count from patients where id = $1",
          [foreignPatient.id],
        ),
      ).toBe(0);

      const detail = await request("GET", `/patients/${foreignPatient.id}`);
      expect(detail.status, failureContext([detail])).toBe(404);
      patientNotFoundSchema.parse(detail.body);
      const weights = await request(
        "GET",
        `/patients/${foreignPatient.id}/weights?page=1&limit=20`,
      );
      expect(weights.status, failureContext([weights])).toBe(404);
      patientNotFoundSchema.parse(weights.body);
      const search = await request(
        "GET",
        "/patients?q=Other%20Pharmacy%20Boundary%20Patient&page=1&limit=20",
      );
      expect(search.status, failureContext([search])).toBe(200);
      const ownResults = searchPatientsContract.responses[200].parse(
        search.body,
      );
      expect(ownResults.total).toBe(0);
      expect(ownResults.items).toEqual([]);
    } finally {
      await stopProcess(otherApi);
      await otherAdministrator?.end().catch(() => undefined);
      await otherPostgres.stop().catch(() => undefined);
    }
  }, 120_000);

  it("seeds the patient permissions for owner, manager, and pharmacist", async () => {
    const result = await administrator.query<{
      permission_name: string;
      role_key: string;
    }>(
      `select role.role_key::text as role_key, grant_row.permission_name
       from pharmacy_roles role
       join role_permission_grants grant_row on grant_row.role_id = role.id
       where role.pharmacy_id = $1
         and role.role_key in ('owner', 'manager', 'pharmacist')
         and grant_row.permission_name like 'patients.%'
       order by role.role_key, grant_row.permission_name`,
      [identity.pharmacyId],
    );
    const expectedPermissions = [
      "patients.discounts.manage",
      "patients.manage",
      "patients.notes.manage",
      "patients.notes.view",
      "patients.view",
    ];
    expect(result.rows).toEqual(
      ["owner", "manager", "pharmacist"].flatMap((roleKey) =>
        expectedPermissions.map((permission_name) => ({
          permission_name,
          role_key: roleKey,
        })),
      ),
    );
  });

  it("saves a profile and first measurement atomically, audits access, and replays once", async () => {
    const requestBody = {
      allergies: "Penicillin",
      chronicConditions: ["Asthma"],
      chronicMedications: ["Inhaler"],
      firstName: "Maha",
      heightCm: "180.0",
      idempotencyKey: uuidV7(),
      lastName: "Hassan",
      otherNotes: "Prefers evening visits",
      phone: "01012345678",
      weightMeasurement: {
        measuredAt: "2025-01-01T10:00:00.000Z",
        weightKg: "80.0",
      },
    };
    const created = await request("POST", "/patients", requestBody);
    expect(created.status, failureContext([created])).toBe(201);
    const patient = createPatientContract.responses[201].parse(created.body);
    expect(patient).toMatchObject({
      allergies: "Penicillin",
      bmi: "24.7",
      chronicConditions: ["Asthma"],
      chronicMedications: ["Inhaler"],
      firstName: "Maha",
      heightCm: "180.0",
      lastName: "Hassan",
      otherNotes: "Prefers evening visits",
      phone: "01012345678",
      revision: "1",
    });
    expect(patient.createdAt).toBe(patient.updatedAt);

    const replay = await request("POST", "/patients", requestBody);
    expect(replay).toEqual(created);
    expect(
      await scalarCount(
        "select count(*)::text as count from patients where id = $1",
        [patient.id],
      ),
    ).toBe(1);
    expect(
      await scalarCount(
        "select count(*)::text as count from patient_weight_measurements where patient_id = $1",
        [patient.id],
      ),
    ).toBe(1);

    const command = await administrator.query<{
      actor_user_id: string;
      command_name: string;
      identity_session_id: string;
      main_device_id: string;
      recorded_at: Date;
      response_body: Record<string, unknown>;
      response_status: number;
    }>(
      `select actor_user_id, command_name, identity_session_id, main_device_id,
              recorded_at, response_body, response_status
       from posting_command_results where idempotency_key = $1`,
      [requestBody.idempotencyKey],
    );
    expect(command.rows).toHaveLength(1);
    expect(command.rows[0]).toMatchObject({
      actor_user_id: identity.actorId,
      command_name: "patients.create",
      main_device_id: credentials.deviceId,
      response_body: patient,
      response_status: 201,
    });
    expect(command.rows[0]?.identity_session_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(command.rows[0]?.recorded_at).toBeInstanceOf(Date);

    const mutationAudit = await administrator.query<{
      action: string;
      actor_user_id: string;
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
      correlation_id: string;
      device_id: string;
      identity_session_id: string;
      occurred_at: Date;
      outcome: string;
      pharmacy_id: string;
      target_id: string;
    }>(
      `select action, actor_user_id, before_state, after_state, correlation_id, device_id,
              identity_session_id, occurred_at, outcome, pharmacy_id, target_id
       from posting_audit_records
       where correlation_id = $1 and action = 'patients.create'`,
      [requestBody.idempotencyKey],
    );
    expect(mutationAudit.rows).toHaveLength(1);
    expect(mutationAudit.rows[0]).toMatchObject({
      action: "patients.create",
      actor_user_id: identity.actorId,
      correlation_id: requestBody.idempotencyKey,
      device_id: credentials.deviceId,
      outcome: "committed",
      pharmacy_id: identity.pharmacyId,
      target_id: patient.id,
    });
    expect(mutationAudit.rows[0]?.occurred_at).toBeInstanceOf(Date);
    expect(mutationAudit.rows[0]?.before_state).toEqual({
      fields: [
        "firstName",
        "lastName",
        "phone",
        "heightCm",
        "chronicConditions",
        "chronicMedications",
        "allergies",
        "otherNotes",
        "weightMeasurement",
      ],
    });
    expect(mutationAudit.rows[0]?.after_state).toEqual({
      revision: "1",
    });
    expect(JSON.stringify(mutationAudit.rows[0]?.after_state)).not.toContain(
      "Penicillin",
    );
    expect(JSON.stringify(mutationAudit.rows[0]?.before_state)).not.toContain(
      "Penicillin",
    );
    expect(JSON.stringify(mutationAudit.rows[0]?.before_state)).not.toContain(
      "Prefers evening visits",
    );

    const replayAudit = await administrator.query<{
      action: string;
      actor_user_id: string;
      after_state: Record<string, unknown>;
      correlation_id: string;
      device_id: string;
      identity_session_id: string;
      occurred_at: Date;
      outcome: string;
      pharmacy_id: string;
      target_id: string;
    }>(
      `select action, actor_user_id, after_state, correlation_id, device_id,
              identity_session_id, occurred_at, outcome, pharmacy_id, target_id
       from posting_audit_records
       where correlation_id = $1 and action = 'patients.profile.replay'`,
      [requestBody.idempotencyKey],
    );
    expect(replayAudit.rows).toHaveLength(1);
    expect(replayAudit.rows[0]).toMatchObject({
      action: "patients.profile.replay",
      actor_user_id: identity.actorId,
      after_state: {
        commandName: "patients.create",
        fields: [
          "firstName",
          "lastName",
          "phone",
          "heightCm",
          "chronicConditions",
          "chronicMedications",
          "allergies",
          "otherNotes",
          "weightMeasurement",
        ],
        notesIncluded: true,
      },
      correlation_id: requestBody.idempotencyKey,
      device_id: credentials.deviceId,
      outcome: "allowed",
      pharmacy_id: identity.pharmacyId,
      target_id: patient.id,
    });
    expect(replayAudit.rows[0]?.identity_session_id).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(replayAudit.rows[0]?.occurred_at).toBeInstanceOf(Date);
    expect(JSON.stringify(replayAudit.rows[0]?.after_state)).not.toContain(
      "Penicillin",
    );

    const fullNameSearch = await request(
      "GET",
      "/patients?q=Maha%20Hassan&page=1&limit=20",
    );
    expect(fullNameSearch.status, failureContext([fullNameSearch])).toBe(200);
    const searched = searchPatientsContract.responses[200].parse(
      fullNameSearch.body,
    );
    expect(searched.items.map(({ id }) => id)).toContain(patient.id);

    const read = await request("GET", `/patients/${patient.id}`);
    expect(read.status, failureContext([read])).toBe(200);
    getPatientContract.responses[200].parse(read.body);

    const searchAudit = await administrator.query<{
      action: string;
      actor_user_id: string;
      after_state: Record<string, unknown>;
      device_id: string;
      identity_session_id: string;
      occurred_at: Date;
      pharmacy_id: string;
      target_id: string | null;
    }>(
      `select action, actor_user_id, after_state, device_id,
              identity_session_id, occurred_at, pharmacy_id, target_id
       from posting_audit_records
       where action = 'patients.search' and actor_user_id = $1
       order by occurred_at desc limit 1`,
      [identity.actorId],
    );
    expect(searchAudit.rows[0]).toMatchObject({
      action: "patients.search",
      actor_user_id: identity.actorId,
      device_id: credentials.deviceId,
      pharmacy_id: identity.pharmacyId,
      target_id: null,
    });
    expect(searchAudit.rows[0]?.identity_session_id).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(searchAudit.rows[0]?.occurred_at).toBeInstanceOf(Date);
    expect(searchAudit.rows[0]?.after_state).toEqual({
      page: 1,
      queryPresent: true,
      resultCount: 1,
      total: 1,
    });

    const profileReadAudit = await administrator.query<{
      action: string;
      actor_user_id: string;
      after_state: Record<string, unknown>;
      device_id: string;
      identity_session_id: string;
      occurred_at: Date;
      outcome: string;
      pharmacy_id: string;
      target_id: string;
    }>(
      `select action, actor_user_id, after_state, device_id,
              identity_session_id, occurred_at, outcome, pharmacy_id, target_id
       from posting_audit_records
       where action = 'patients.profile.read' and target_id = $1
       order by occurred_at desc limit 1`,
      [patient.id],
    );
    expect(profileReadAudit.rows).toHaveLength(1);
    expect(profileReadAudit.rows[0]).toMatchObject({
      action: "patients.profile.read",
      actor_user_id: identity.actorId,
      after_state: { notesIncluded: true },
      device_id: credentials.deviceId,
      outcome: "allowed",
      pharmacy_id: identity.pharmacyId,
      target_id: patient.id,
    });
    expect(profileReadAudit.rows[0]?.identity_session_id).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(profileReadAudit.rows[0]?.occurred_at).toBeInstanceOf(Date);
  });

  it("keeps duplicate-looking profiles separate, exact BMI, and paginated append-only history", async () => {
    const duplicateBody = {
      firstName: "Maha",
      idempotencyKey: uuidV7(),
      lastName: "Hassan",
      phone: "01012345678",
    };
    const duplicate = await request("POST", "/patients", duplicateBody);
    expect(duplicate.status, failureContext([duplicate])).toBe(201);
    const duplicatePatient = patientProfileResponseSchema.parse(duplicate.body);
    const originalSearch = await request(
      "GET",
      "/patients?q=01012345678&page=1&limit=20",
    );
    const samePhone = searchPatientsContract.responses[200].parse(
      originalSearch.body,
    );
    const matchingProfiles = samePhone.items.filter(
      (item) => item.firstName === "Maha" && item.lastName === "Hassan",
    );
    expect(matchingProfiles).toHaveLength(2);
    expect(new Set(matchingProfiles.map(({ id }) => id)).size).toBe(2);

    const profileResponse = await request("GET", "/patients?q=Maha%20Hassan");
    const profiles = searchPatientsContract.responses[200].parse(
      profileResponse.body,
    );
    const original = profiles.items.find(
      (item) => item.id !== duplicatePatient.id,
    );
    if (original === undefined)
      throw new Error("Original profile was not found");

    let revision = original.revision;
    const measurementCommandIds: string[] = [];
    const measuredDates = [
      "2025-01-02T10:00:00.000Z",
      "2025-01-03T10:00:00.000Z",
    ];
    for (const [index, measuredAt] of measuredDates.entries()) {
      const idempotencyKey = uuidV7();
      measurementCommandIds.push(idempotencyKey);
      const saved = await request("PUT", `/patients/${original.id}`, {
        expectedRevision: revision,
        idempotencyKey,
        weightMeasurement: {
          measuredAt,
          weightKg: index === 0 ? "81.0" : "82.0",
        },
      });
      expect(saved.status, failureContext([saved])).toBe(200);
      const patient = updatePatientProfileContract.responses[200].parse(
        saved.body,
      );
      expect(patient.createdAt).toBe(original.createdAt);
      revision = patient.revision;
    }

    const pageOne = await request(
      "GET",
      `/patients/${original.id}/weights?page=1&limit=2`,
    );
    expect(pageOne.status, failureContext([pageOne])).toBe(200);
    const firstPage = listPatientWeightsContract.responses[200].parse(
      pageOne.body,
    );
    expect(firstPage).toMatchObject({
      bmi: "25.3",
      businessTimeZone: "Asia/Baghdad",
      limit: 2,
      page: 1,
      total: 3,
      totalPages: 2,
    });
    expect(firstPage.items.map((item) => item.weightKg)).toEqual([
      "82.0",
      "81.0",
    ]);
    expect(firstPage.items[0]?.measuredAt).toBe(measuredDates[1]);
    expect(firstPage.items[0]?.createdByUserId).toBe(identity.actorId);

    const pageTwo = await request(
      "GET",
      `/patients/${original.id}/weights?page=2&limit=2`,
    );
    const secondPage = listPatientWeightsContract.responses[200].parse(
      pageTwo.body,
    );
    expect(secondPage.items.map((item) => item.weightKg)).toEqual(["80.0"]);

    const weightReadAudits = await administrator.query<{
      action: string;
      actor_user_id: string;
      after_state: Record<string, unknown>;
      device_id: string;
      identity_session_id: string;
      occurred_at: Date;
      outcome: string;
      pharmacy_id: string;
      target_id: string;
    }>(
      `select action, actor_user_id, after_state, device_id,
              identity_session_id, occurred_at, outcome, pharmacy_id, target_id
       from posting_audit_records
       where action = 'patients.weights.read' and target_id = $1
       order by occurred_at asc`,
      [original.id],
    );
    expect(weightReadAudits.rows).toHaveLength(2);
    expect(weightReadAudits.rows.map(({ after_state }) => after_state)).toEqual(
      [
        { page: 1, resultCount: 2, total: 3 },
        { page: 2, resultCount: 1, total: 3 },
      ],
    );
    for (const audit of weightReadAudits.rows) {
      expect(audit).toMatchObject({
        action: "patients.weights.read",
        actor_user_id: identity.actorId,
        device_id: credentials.deviceId,
        outcome: "allowed",
        pharmacy_id: identity.pharmacyId,
        target_id: original.id,
      });
      expect(audit.identity_session_id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(audit.occurred_at).toBeInstanceOf(Date);
    }

    const measurementAudits = await administrator.query<{
      action: string;
      actor_user_id: string;
      after_state: Record<string, unknown>;
      before_state: Record<string, unknown>;
      correlation_id: string;
      device_id: string;
      identity_session_id: string;
      occurred_at: Date;
      outcome: string;
      pharmacy_id: string;
      target_id: string;
    }>(
      `select action, actor_user_id, after_state, before_state, correlation_id,
              device_id, identity_session_id, occurred_at, outcome,
              pharmacy_id, target_id
       from posting_audit_records
       where action = 'patients.save'
         and correlation_id = any($1::uuid[])
         and target_id = $2
       order by occurred_at asc`,
      [measurementCommandIds, original.id],
    );
    expect(measurementAudits.rows).toHaveLength(2);
    for (const audit of measurementAudits.rows) {
      expect(audit).toMatchObject({
        action: "patients.save",
        actor_user_id: identity.actorId,
        after_state: { fields: ["weightMeasurement"] },
        device_id: credentials.deviceId,
        outcome: "committed",
        pharmacy_id: identity.pharmacyId,
        target_id: original.id,
      });
      expect(measurementCommandIds).toContain(audit.correlation_id);
      expect(audit.before_state).toHaveProperty("revision");
      expect(audit.identity_session_id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(audit.occurred_at).toBeInstanceOf(Date);
      expect(JSON.stringify(audit.before_state)).not.toContain("82.0");
      expect(JSON.stringify(audit.after_state)).not.toContain("82.0");
    }

    const noHeight = await request("POST", "/patients", {
      firstName: "No",
      idempotencyKey: uuidV7(),
      lastName: "Height",
      weightMeasurement: {
        measuredAt: "2025-02-01T00:00:00.000Z",
        weightKg: "75.0",
      },
    });
    const noHeightProfile = createPatientContract.responses[201].parse(
      noHeight.body,
    );
    expect(noHeightProfile).toMatchObject({ bmi: null, bmiCategory: null });

    const bmiMaximum = await request("POST", "/patients", {
      firstName: "Valid",
      heightCm: "0.1",
      idempotencyKey: uuidV7(),
      lastName: "Range",
      weightMeasurement: {
        measuredAt: "2025-02-02T00:00:00.000Z",
        weightKg: "700.0",
      },
    });
    expect(bmiMaximum.status, failureContext([bmiMaximum])).toBe(201);
    const maximumProfile = createPatientContract.responses[201].parse(
      bmiMaximum.body,
    );
    expect(maximumProfile.bmi).toBe("700000000.0");

    const bmiMinimum = await request("POST", "/patients", {
      firstName: "Small",
      heightCm: "300.0",
      idempotencyKey: uuidV7(),
      lastName: "Range",
      weightMeasurement: {
        measuredAt: "2025-02-03T00:00:00.000Z",
        weightKg: "0.1",
      },
    });
    expect(bmiMinimum.status, failureContext([bmiMinimum])).toBe(201);
    const minimumProfile = createPatientContract.responses[201].parse(
      bmiMinimum.body,
    );
    expect(minimumProfile.bmi).toBe("0.0");
  });

  it("leaves the existing Sale Draft unchanged after a patient profile edit", async () => {
    const draftResponse = await request("POST", saleDraftCreateContract.path, {
      idempotencyKey: uuidV7(),
    });
    expect(draftResponse.status, failureContext([draftResponse])).toBe(201);
    const draft = saleDraftCreateContract.responses[201].parse(
      draftResponse.body,
    );
    const beforeRead = await request("GET", saleDraftPath(draft.id));
    expect(beforeRead.status, failureContext([beforeRead])).toBe(200);
    const before = saleDraftReadContract.responses[200].parse(beforeRead.body);

    const created = await request("POST", "/patients", {
      firstName: "Snapshot",
      idempotencyKey: uuidV7(),
      lastName: "Independent",
    });
    const profile = patientProfileResponseSchema.parse(created.body);
    const saved = await request("PUT", `/patients/${profile.id}`, {
      address: "Changed while a sale draft exists",
      expectedRevision: profile.revision,
      idempotencyKey: uuidV7(),
    });
    expect(saved.status, failureContext([saved])).toBe(200);
    expect(patientProfileResponseSchema.parse(saved.body).address).toBe(
      "Changed while a sale draft exists",
    );

    const afterRead = await request("GET", saleDraftPath(draft.id));
    expect(afterRead.status, failureContext([afterRead])).toBe(200);
    expect(saleDraftReadContract.responses[200].parse(afterRead.body)).toEqual(
      before,
    );
  });

  it("leaves an immutable posted purchase snapshot unchanged after a patient edit", async () => {
    const supplierResponse = await request("POST", "/suppliers", {
      allowanceEffectiveFrom: "2026-01-01",
      defaultAllowancePercentage: "10",
      idempotencyKey: uuidV7(),
      name: "Patient Snapshot Supplier",
      terms: "Net 30",
    });
    expect(supplierResponse.status, failureContext([supplierResponse])).toBe(
      201,
    );
    const supplier = supplierCreateContract.responses[201].parse(
      supplierResponse.body,
    );

    const productResponse = await request("POST", productCreateContract.path, {
      arabicSearchName: "دواء اختبار",
      barcodes: [
        {
          kind: "product",
          value: randomBytes(6).toString("hex").padStart(13, "0").slice(0, 13),
        },
      ],
      category: "Pain relief",
      definition: {
        fields: {
          dosageForm: "tablet",
          manufacturer: "GSK",
          strength: "500 mg",
          tradeName: "Patient Snapshot Product",
        },
        mode: "medication",
      },
      idempotencyKey: uuidV7(),
      instructions: {
        foodTiming: "after-food",
        usesPerDay: 3,
        usesPerMonth: null,
        usesPerWeek: null,
      },
      packaging: {
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "inventory-unit" },
          sale: { kind: "inventory-unit" },
        },
        inventoryUnitName: "Strip",
        packageUnits: [],
        thirdUnit: null,
      },
      pricing: {
        method: "by-price",
        retailPriceFils: "100000",
        wholesalePriceFils: "90000",
      },
      scientificName: "Paracetamol",
      sharing: { aiSharingAllowed: false, externallyVisible: true },
      stateColours: { coldStorageRequired: false, manual: "blue" },
      stockLevels: {
        maximumLevel: null,
        minimumLevel: null,
        reorderPoint: null,
      },
    });
    expect(productResponse.status, failureContext([productResponse])).toBe(201);
    const product = productCreateContract.responses[201].parse(
      productResponse.body,
    );

    const draftResponse = await request(
      "POST",
      purchaseDraftCreateContract.path,
      {
        idempotencyKey: uuidV7(),
        invoiceDate: "2026-06-15",
        invoiceOffer: { mode: "none", value: "0" },
        settlementContext: "debt",
        supplierId: supplier.id,
        supplierInvoiceNumber: "PATIENT-SNAPSHOT-1",
      },
    );
    expect(draftResponse.status, failureContext([draftResponse])).toBe(201);
    let draft = purchaseDraftCreateContract.responses[201].parse(
      draftResponse.body,
    ).draft;
    const rowResponse = await request("POST", purchaseDraftRowsPath(draft.id), {
      costFils: "1000",
      enteredQuantity: "10",
      expectedVersion: draft.version,
      expiryDate: "2029-12-31",
      idempotencyKey: uuidV7(),
      itemId: product.id,
      lotNumber: null,
      notes: null,
      pricing: { method: "by-price", retailPriceFils: "999999" },
      unit: { kind: "inventory-unit" },
    });
    expect(rowResponse.status, failureContext([rowResponse])).toBe(201);
    draft = purchaseDraftRowCommitContract.responses[201].parse(
      rowResponse.body,
    ).draft;

    const postedResponse = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      { expectedVersion: draft.version, idempotencyKey: uuidV7() },
    );
    expect(postedResponse.status, failureContext([postedResponse])).toBe(201);
    const postedPurchase = purchasePostContract.responses[201].parse(
      postedResponse.body,
    ).posted;
    const snapshotBeforeEdit = await immutablePostedPurchaseSnapshot(
      postedPurchase.id,
    );
    expect(snapshotBeforeEdit).toBeDefined();

    const created = await request("POST", "/patients", {
      firstName: "Posted Snapshot",
      idempotencyKey: uuidV7(),
      lastName: "Independent",
    });
    const profile = patientProfileResponseSchema.parse(created.body);
    const saved = await request("PUT", `/patients/${profile.id}`, {
      address: "Changed after purchase posting",
      expectedRevision: profile.revision,
      idempotencyKey: uuidV7(),
    });
    expect(saved.status, failureContext([saved])).toBe(200);
    expect(patientProfileResponseSchema.parse(saved.body).address).toBe(
      "Changed after purchase posting",
    );

    expect(await immutablePostedPurchaseSnapshot(postedPurchase.id)).toEqual(
      snapshotBeforeEdit,
    );
  });

  it("serializes concurrent saves by revision and returns a runtime conflict", async () => {
    const created = await request("POST", "/patients", {
      firstName: "Concurrent",
      idempotencyKey: uuidV7(),
      lastName: "Save",
    });
    const profile = patientProfileResponseSchema.parse(created.body);
    const attempts = await Promise.all([
      request("PUT", `/patients/${profile.id}`, {
        address: "First address",
        expectedRevision: profile.revision,
        idempotencyKey: uuidV7(),
      }),
      request("PUT", `/patients/${profile.id}`, {
        address: "Second address",
        expectedRevision: profile.revision,
        idempotencyKey: uuidV7(),
      }),
    ]);
    expect(
      attempts
        .map((attempt) => attempt.status)
        .sort((left, right) => left - right),
      failureContext(attempts),
    ).toEqual([200, 409]);
    const conflict = attempts.find((attempt) => attempt.status === 409);
    expect(conflict).toBeDefined();
    patientVersionConflictSchema.parse(conflict?.body);
  });

  it("rolls back profile, measurement, audit, and idempotency facts together", async () => {
    const existing = await request("POST", "/patients", {
      firstName: "Rollback",
      idempotencyKey: uuidV7(),
      lastName: "Target",
      phone: "111",
    });
    const profile = patientProfileResponseSchema.parse(existing.body);
    const createKey = uuidV7();
    const updateKey = uuidV7();
    const triggerName = `patient_fail_${randomBytes(6).toString("hex")}`;
    const functionName = `${triggerName}_fn`;
    await administrator.query(
      `create function ${functionName}() returns trigger language plpgsql
       as $patient_failure$
       begin
         raise exception 'injected patient weight write failure'
           using errcode = '55000';
       end;
       $patient_failure$`,
    );
    await administrator.query(
      `create trigger ${triggerName} before insert
       on patient_weight_measurements for each row
       execute function ${functionName}()`,
    );
    try {
      const failedCreate = await request("POST", "/patients", {
        firstName: "Must Roll Back",
        idempotencyKey: createKey,
        lastName: "Profile",
        weightMeasurement: {
          measuredAt: "2025-03-01T00:00:00.000Z",
          weightKg: "77.0",
        },
      });
      expect(failedCreate.status).toBeGreaterThanOrEqual(500);
      expect(
        await scalarCount(
          "select count(*)::text as count from patients where first_name = $1 and last_name = $2",
          ["Must Roll Back", "Profile"],
        ),
      ).toBe(0);

      const failedSave = await request("PUT", `/patients/${profile.id}`, {
        expectedRevision: profile.revision,
        idempotencyKey: updateKey,
        phone: "222",
        weightMeasurement: {
          measuredAt: "2025-03-02T00:00:00.000Z",
          weightKg: "78.0",
        },
      });
      expect(failedSave.status).toBeGreaterThanOrEqual(500);
      const afterFailure = await request("GET", `/patients/${profile.id}`);
      const unchanged = patientProfileResponseSchema.parse(afterFailure.body);
      expect(unchanged).toMatchObject({
        phone: "111",
        revision: profile.revision,
      });

      for (const key of [createKey, updateKey]) {
        expect(
          await scalarCount(
            "select count(*)::text as count from posting_command_results where idempotency_key = $1",
            [key],
          ),
        ).toBe(0);
        expect(
          await scalarCount(
            "select count(*)::text as count from posting_audit_records where correlation_id = $1",
            [key],
          ),
        ).toBe(0);
      }
      expect(
        await scalarCount(
          "select count(*)::text as count from patient_weight_measurements where patient_id = $1",
          [profile.id],
        ),
      ).toBe(0);
    } finally {
      await administrator.query(
        `drop trigger if exists ${triggerName} on patient_weight_measurements`,
      );
      await administrator.query(`drop function if exists ${functionName}()`);
    }
  });

  it("replays the shared idempotency result after an API restart", async () => {
    const body = {
      firstName: "Restart",
      idempotencyKey: uuidV7(),
      lastName: "Replay",
      phone: "replay-1",
    };
    const first = await request("POST", "/patients", body);
    expect(first.status, failureContext([first])).toBe(201);
    const child = api;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
      } else {
        child.once("exit", () => resolve());
      }
    });
    child.kill("SIGKILL");
    await exited;

    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput, api);
    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.status, failureContext([login])).toBe(200);
    const replay = await request("POST", "/patients", body);
    expect(replay).toEqual(first);
    const created = patientProfileResponseSchema.parse(first.body);
    expect(
      await scalarCount(
        "select count(*)::text as count from patients where id = $1",
        [created.id],
      ),
    ).toBe(1);
    expect(
      await scalarCount(
        "select count(*)::text as count from posting_audit_records where correlation_id = $1",
        [body.idempotencyKey],
      ),
    ).toBe(2);
  }, 120_000);

  it("allows append-only measurement inserts as breev_app and denies update/delete", async () => {
    const created = await request("POST", "/patients", {
      firstName: "Restricted",
      idempotencyKey: uuidV7(),
      lastName: "Role",
    });
    const profile = patientProfileResponseSchema.parse(created.body);
    const application = new Pool({
      connectionString: databaseRoles.applicationUrl,
    });
    const weightId = uuidV7();
    try {
      const role = await application.query<{ current_user: string }>(
        "select current_user",
      );
      expect(role.rows[0]?.current_user).toBe("breev_app");
      await application.query(
        `insert into patient_weight_measurements (
           id, pharmacy_id, patient_id, created_by_user_id, weight_kg, measured_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          weightId,
          identity.pharmacyId,
          profile.id,
          identity.actorId,
          "75.0",
          "2025-04-01T00:00:00.000Z",
        ],
      );
      await expect(
        application.query(
          "update patient_weight_measurements set weight_kg = '76.0' where id = $1",
          [weightId],
        ),
      ).rejects.toThrow(/permission denied/u);
      await expect(
        application.query(
          "delete from patient_weight_measurements where id = $1",
          [weightId],
        ),
      ).rejects.toThrow(/permission denied/u);
      expect(
        await scalarCount(
          "select count(*)::text as count from patient_weight_measurements where id = $1 and weight_kg = '75.0'",
          [weightId],
        ),
      ).toBe(1);
    } finally {
      await application.end();
    }
  });

  it("enforces notes and discount permissions and reprojects idempotent responses", async () => {
    const created = await request("POST", "/patients", {
      allergies: "Known allergy",
      address: "Original address",
      chronicConditions: ["Sensitive condition"],
      chronicMedications: ["Sensitive medication"],
      firstName: "Protected",
      idempotencyKey: uuidV7(),
      interests: ["Skin care"],
      lastName: "Fields",
      otherNotes: "Private note",
      phone: "07701234567",
    });
    expect(created.status, failureContext([created])).toBe(201);
    const profile = patientProfileResponseSchema.parse(created.body);

    await setPatientSensitivePermissions({
      notesManage: false,
      notesView: true,
    });
    const forbiddenSensitiveCreate = await request("POST", "/patients", {
      allergies: "Unauthorized allergy",
      chronicConditions: ["Unauthorized condition"],
      chronicMedications: ["Unauthorized medication"],
      firstName: "No",
      idempotencyKey: uuidV7(),
      lastName: "SensitiveCreatePermission",
      otherNotes: "Unauthorized note",
    });
    expect(forbiddenSensitiveCreate.status).toBe(403);
    expect(
      identityDenialSchema.parse(forbiddenSensitiveCreate.body),
    ).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.notes.manage",
      status: "denied",
    });

    const saveBody = {
      address: "New address",
      expectedRevision: profile.revision,
      idempotencyKey: uuidV7(),
    };
    const savedWithNotesView = await request(
      "PUT",
      `/patients/${profile.id}`,
      saveBody,
    );
    expect(
      savedWithNotesView.status,
      failureContext([savedWithNotesView]),
    ).toBe(200);
    expect(
      patientProfileResponseSchema.parse(savedWithNotesView.body).otherNotes,
    ).toBe("Private note");
    const readWithNotesView = await request("GET", `/patients/${profile.id}`);
    expect(
      getPatientContract.responses[200].parse(readWithNotesView.body)
        .otherNotes,
    ).toBe("Private note");

    const forbiddenNotes = await request("PUT", `/patients/${profile.id}`, {
      expectedRevision: "2",
      idempotencyKey: uuidV7(),
      otherNotes: "Unauthorized change",
    });
    expect(forbiddenNotes.status).toBe(403);
    expect(identityDenialSchema.parse(forbiddenNotes.body)).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.notes.manage",
      status: "denied",
    });

    const forbiddenDiscount = await request("POST", "/patients", {
      discountPercent: "10.00",
      firstName: "No",
      idempotencyKey: uuidV7(),
      lastName: "DiscountPermission",
    });
    expect(forbiddenDiscount.status).toBe(403);
    expect(identityDenialSchema.parse(forbiddenDiscount.body)).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.discounts.manage",
      status: "denied",
    });
    const forbiddenDiscountUpdate = await request(
      "PUT",
      `/patients/${profile.id}`,
      {
        discountPercent: "10.00",
        expectedRevision: "2",
        idempotencyKey: uuidV7(),
      },
    );
    expect(forbiddenDiscountUpdate.status).toBe(403);
    expect(
      identityDenialSchema.parse(forbiddenDiscountUpdate.body),
    ).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.discounts.manage",
      status: "denied",
    });
    const unchangedDiscount = await request("GET", `/patients/${profile.id}`);
    expect(
      getPatientContract.responses[200].parse(unchangedDiscount.body),
    ).toMatchObject({
      discountPercent: null,
      revision: "2",
    });

    await setPatientSensitivePermissions({
      notesManage: false,
      notesView: false,
    });
    const detail = await request("GET", `/patients/${profile.id}`);
    expect(detail.status).toBe(200);
    const hiddenDetail = getPatientContract.responses[200].parse(detail.body);
    expect(hiddenDetail).not.toHaveProperty("allergies");
    expect(hiddenDetail).not.toHaveProperty("otherNotes");
    expect(hiddenDetail).not.toHaveProperty("chronicConditions");
    expect(hiddenDetail).not.toHaveProperty("chronicMedications");
    expect(hiddenDetail).toMatchObject({
      address: "New address",
      interests: ["Skin care"],
      phone: "07701234567",
    });

    const hiddenSearch = await request(
      "GET",
      "/patients?q=Protected%20Fields&page=1&limit=20",
    );
    const hiddenResults = searchPatientsContract.responses[200].parse(
      hiddenSearch.body,
    );
    expect(hiddenResults.items[0]).not.toHaveProperty("allergies");
    expect(hiddenResults.items[0]).not.toHaveProperty("otherNotes");
    expect(hiddenResults.items[0]).not.toHaveProperty("chronicConditions");
    expect(hiddenResults.items[0]).not.toHaveProperty("chronicMedications");
    expect(hiddenResults.items[0]).toMatchObject({
      address: "New address",
      interests: ["Skin care"],
      phone: "07701234567",
    });

    const hiddenWeights = await request(
      "GET",
      `/patients/${profile.id}/weights?page=1&limit=20`,
    );
    expect(hiddenWeights.status).toBe(200);
    const weightPage = listPatientWeightsContract.responses[200].parse(
      hiddenWeights.body,
    );
    expect(weightPage).not.toHaveProperty("allergies");
    expect(weightPage).not.toHaveProperty("chronicConditions");
    expect(weightPage).not.toHaveProperty("chronicMedications");
    expect(weightPage).not.toHaveProperty("otherNotes");
    expect(JSON.stringify(weightPage)).not.toContain("Known allergy");
    expect(JSON.stringify(weightPage)).not.toContain("Sensitive condition");
    expect(JSON.stringify(weightPage)).not.toContain("Private note");

    const replayWithoutNotesView = await request(
      "PUT",
      `/patients/${profile.id}`,
      saveBody,
    );
    expect(replayWithoutNotesView.status).toBe(200);
    const replayedProfile = updatePatientProfileContract.responses[200].parse(
      replayWithoutNotesView.body,
    );
    expect(replayedProfile).not.toHaveProperty("allergies");
    expect(replayedProfile).not.toHaveProperty("otherNotes");
    expect(replayedProfile).not.toHaveProperty("chronicConditions");
    expect(replayedProfile).not.toHaveProperty("chronicMedications");
    expect(JSON.stringify(replayedProfile)).not.toContain("Known allergy");
    expect(JSON.stringify(replayedProfile)).not.toContain("Private note");
    expect(replayedProfile).toMatchObject({
      address: "New address",
      interests: ["Skin care"],
      phone: "07701234567",
    });

    const replayAudit = await administrator.query<{
      action: string;
      actor_user_id: string;
      after_state: Record<string, unknown>;
      correlation_id: string;
      device_id: string;
      identity_session_id: string;
      occurred_at: Date;
      outcome: string;
      pharmacy_id: string;
      target_id: string;
    }>(
      `select action, actor_user_id, after_state, correlation_id, device_id,
              identity_session_id, occurred_at, outcome, pharmacy_id, target_id
       from posting_audit_records
       where correlation_id = $1 and action = 'patients.profile.replay'`,
      [saveBody.idempotencyKey],
    );
    expect(replayAudit.rows).toHaveLength(1);
    expect(replayAudit.rows[0]).toMatchObject({
      action: "patients.profile.replay",
      actor_user_id: identity.actorId,
      after_state: {
        commandName: "patients.save",
        fields: ["address"],
        notesIncluded: false,
      },
      correlation_id: saveBody.idempotencyKey,
      device_id: credentials.deviceId,
      outcome: "allowed",
      pharmacy_id: identity.pharmacyId,
      target_id: profile.id,
    });
    expect(replayAudit.rows[0]?.identity_session_id).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(replayAudit.rows[0]?.occurred_at).toBeInstanceOf(Date);
    expect(JSON.stringify(replayAudit.rows[0]?.after_state)).not.toContain(
      "Private note",
    );

    const unchanged = await request("GET", `/patients/${profile.id}`);
    const unchangedProfile = patientProfileResponseSchema.parse(unchanged.body);
    expect(unchangedProfile).toMatchObject({
      address: "New address",
      revision: "2",
    });
    const denial = await administrator.query<{
      action: string;
      actor_user_id: string;
      after_state: Record<string, unknown>;
      device_id: string;
      occurred_at: Date;
    }>(
      `select action, actor_user_id, after_state, device_id, occurred_at
       from identity_audit_records
       where action = 'identity.authorization' and outcome = 'denied'
         and actor_user_id = $1
       order by occurred_at desc limit 1`,
      [identity.actorId],
    );
    expect(denial.rows[0]).toMatchObject({
      action: "identity.authorization",
      actor_user_id: identity.actorId,
      after_state: { requiredPermission: "patients.discounts.manage" },
      device_id: credentials.deviceId,
    });
    expect(denial.rows[0]?.occurred_at).toBeInstanceOf(Date);

    await setPatientSensitivePermissions({
      notesManage: false,
      notesView: false,
      patientsView: false,
    });
    const deniedSearch = await request(
      "GET",
      "/patients?q=Protected%20Fields&page=1&limit=20",
    );
    expect(deniedSearch.status).toBe(403);
    expect(identityDenialSchema.parse(deniedSearch.body)).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.view",
      status: "denied",
    });
    const deniedDetail = await request("GET", `/patients/${profile.id}`);
    expect(deniedDetail.status).toBe(403);
    expect(identityDenialSchema.parse(deniedDetail.body)).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.view",
      status: "denied",
    });
    const deniedWeights = await request(
      "GET",
      `/patients/${profile.id}/weights?page=1&limit=20`,
    );
    expect(deniedWeights.status).toBe(403);
    expect(identityDenialSchema.parse(deniedWeights.body)).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.view",
      status: "denied",
    });

    await setPatientSensitivePermissions({
      notesManage: false,
      notesView: false,
      patientsView: false,
      patientsManage: false,
    });
    const deniedCreate = await request("POST", "/patients", {
      firstName: "Denied",
      idempotencyKey: uuidV7(),
      lastName: "Create",
    });
    expect(deniedCreate.status).toBe(403);
    expect(identityDenialSchema.parse(deniedCreate.body)).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.manage",
      status: "denied",
    });
    const deniedUpdate = await request("PUT", `/patients/${profile.id}`, {
      address: "Unauthorized address",
      expectedRevision: "2",
      idempotencyKey: uuidV7(),
    });
    expect(deniedUpdate.status).toBe(403);
    expect(identityDenialSchema.parse(deniedUpdate.body)).toMatchObject({
      code: "permission-denied",
      requiredPermission: "patients.manage",
      status: "denied",
    });
  });

  it("uses the shared device security boundary for invalid device sessions", async () => {
    const invalidDeviceSession = {
      ...credentials,
      sessionToken: randomBytes(32).toString("base64url"),
    };
    const patientId = freeCorePatientId;
    if (patientId === undefined)
      throw new Error("Free Core patient is missing");
    const denialCountBefore = await scalarCount(
      `select count(*)::text as count from main_device_recent_denials
       where device_id is null and code = 'session-binding-invalid'`,
      [],
    );
    const requests = [
      { method: "GET" as const, route: "/patients?q=Protected" },
      { method: "GET" as const, route: `/patients/${patientId}` },
      {
        method: "GET" as const,
        route: `/patients/${patientId}/weights?page=1&limit=20`,
      },
      {
        body: {
          firstName: "Invalid device",
          idempotencyKey: uuidV7(),
          lastName: "Create",
        },
        method: "POST" as const,
        route: createPatientContract.path,
      },
      {
        body: {
          address: "Invalid device update",
          expectedRevision: "2",
          idempotencyKey: uuidV7(),
        },
        method: "PUT" as const,
        route: `/patients/${patientId}`,
      },
    ];
    for (const { body, method, route } of requests) {
      const denied = await requestWith(
        invalidDeviceSession,
        method,
        route,
        body,
      );
      expect(denied.status).toBe(401);
      expect(localSecurityDenialSchema.parse(denied.body)).toMatchObject({
        code: "session-binding-invalid",
        status: "denied",
      });
    }
    expect(
      await scalarCount(
        `select count(*)::text as count from main_device_recent_denials
         where device_id is null and code = 'session-binding-invalid'`,
        [],
      ),
    ).toBe(denialCountBefore + requests.length);
  });

  it("grants patient permissions once to existing built-in roles without touching custom roles", async () => {
    const customRole = await administrator.query<{
      id: string;
      revision: string;
    }>(
      `insert into pharmacy_roles (pharmacy_id, custom_name, custom_name_key)
       values ($1, 'Patient grant isolation', 'patient grant isolation')
       returning id, revision::text`,
      [identity.pharmacyId],
    );
    const customRoleId = customRole.rows[0]?.id;
    const customRoleRevision = customRole.rows[0]?.revision;
    if (customRoleId === undefined || customRoleRevision === undefined) {
      throw new Error("Could not create the custom migration test role");
    }

    await administrator.query(
      `delete from role_permission_grants
       where pharmacy_id = $1
         and permission_name like 'patients.%'
         and role_id in (
           select id from pharmacy_roles
           where pharmacy_id = $1
             and role_key in ('owner', 'manager', 'pharmacist')
         )`,
      [identity.pharmacyId],
    );
    const before = await patientRoleRevisionSnapshot();
    const migrationSql = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../drizzle/0031_patient_permissions.sql",
      ),
      "utf8",
    );

    await administrator.query(migrationSql);

    const after = await patientRoleRevisionSnapshot();
    for (const [roleKey, revision] of Object.entries(before.roles)) {
      expect(after.roles[roleKey]).toBe(String(BigInt(revision) + 1n));
    }
    expect(after.pharmacy).toBe(String(BigInt(before.pharmacy) + 1n));
    const expectedPermissions = [
      "patients.discounts.manage",
      "patients.manage",
      "patients.notes.manage",
      "patients.notes.view",
      "patients.view",
    ];
    const grants = await administrator.query<{
      permission_name: string;
      role_key: string;
    }>(
      `select role.role_key::text as role_key, grant_row.permission_name
       from pharmacy_roles role
       join role_permission_grants grant_row on grant_row.role_id = role.id
       where role.pharmacy_id = $1
         and role.role_key in ('owner', 'manager', 'pharmacist')
         and grant_row.permission_name like 'patients.%'
       order by role.role_key::text, grant_row.permission_name`,
      [identity.pharmacyId],
    );
    expect(grants.rows).toEqual(
      ["manager", "owner", "pharmacist"].flatMap((roleKey) =>
        expectedPermissions.map((permission_name) => ({
          permission_name,
          role_key: roleKey,
        })),
      ),
    );
    const customRoleAfter = await administrator.query<{
      revision: string;
    }>("select revision::text from pharmacy_roles where id = $1", [
      customRoleId,
    ]);
    expect(customRoleAfter.rows[0]?.revision).toBe(customRoleRevision);
    expect(
      await scalarCount(
        `select count(*)::text as count from role_permission_grants
         where role_id = $1 and permission_name like 'patients.%'`,
        [customRoleId],
      ),
    ).toBe(0);

    await administrator.query(migrationSql);
    expect(await patientRoleRevisionSnapshot()).toEqual(after);
    expect(
      await scalarCount(
        `select count(*)::text as count from role_permission_grants
         where role_id = $1 and permission_name like 'patients.%'`,
        [customRoleId],
      ),
    ).toBe(0);
  });

  async function setPatientSensitivePermissions(input: {
    readonly notesManage: boolean;
    readonly notesView: boolean;
    readonly patientsView?: boolean;
    readonly patientsManage?: boolean;
  }): Promise<void> {
    const client = await administrator.connect();
    try {
      await client.query("begin");
      if (!input.notesManage) {
        await client.query(
          `delete from role_permission_grants
           where role_id = $1 and permission_name = 'patients.notes.manage'`,
          [identity.roleId],
        );
        await client.query(
          `delete from role_permission_grants
           where role_id = $1 and permission_name = 'patients.discounts.manage'`,
          [identity.roleId],
        );
      }
      if (!input.notesView) {
        await client.query(
          `delete from role_permission_grants
           where role_id = $1 and permission_name = 'patients.notes.view'`,
          [identity.roleId],
        );
      }
      if (input.patientsView === false) {
        await client.query(
          `delete from role_permission_grants
           where role_id = $1 and permission_name = 'patients.view'`,
          [identity.roleId],
        );
      }
      if (input.patientsManage === false) {
        await client.query(
          `delete from role_permission_grants
           where role_id = $1 and permission_name = 'patients.manage'`,
          [identity.roleId],
        );
      }
      await client.query(
        "update pharmacy_roles set revision = revision + 1 where id = $1",
        [identity.roleId],
      );
      await client.query(
        "update pharmacies set identity_revision = identity_revision + 1 where id = $1",
        [identity.pharmacyId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function scalarCount(
    query: string,
    values: unknown[],
  ): Promise<number> {
    const result = await administrator.query<{ count: string }>(query, values);
    return Number(result.rows[0]?.count ?? "-1");
  }

  async function patientRoleRevisionSnapshot(): Promise<{
    pharmacy: string;
    roles: Record<string, string>;
  }> {
    const result = await administrator.query<{
      pharmacy_revision: string;
      role_key: string;
      role_revision: string;
    }>(
      `select pharmacy_row.identity_revision::text as pharmacy_revision,
              role.role_key::text as role_key, role.revision::text as role_revision
       from pharmacy_roles role
       join pharmacies pharmacy_row on pharmacy_row.id = role.pharmacy_id
       where role.pharmacy_id = $1
         and role.role_key in ('owner', 'manager', 'pharmacist')
       order by role.role_key::text`,
      [identity.pharmacyId],
    );
    return {
      pharmacy: result.rows[0]?.pharmacy_revision ?? "",
      roles: Object.fromEntries(
        result.rows.map(({ role_key, role_revision }) => [
          role_key,
          role_revision,
        ]),
      ),
    };
  }

  async function immutablePostedPurchaseSnapshot(
    purchaseId: string,
  ): Promise<unknown> {
    const result = await administrator.query<{ bytes: unknown }>(
      `select jsonb_build_object(
         'header', to_jsonb(posted),
         'rows', (select jsonb_agg(to_jsonb(snapshot) order by snapshot.ordinal)
                  from posted_purchase_rows snapshot
                  where snapshot.pharmacy_id = posted.pharmacy_id
                    and snapshot.posted_purchase_id = posted.id)
       ) as bytes
       from posted_purchases posted
       where posted.pharmacy_id = $1 and posted.id = $2`,
      [identity.pharmacyId, purchaseId],
    );
    return result.rows[0]?.bytes;
  }

  function apiEnvironment(
    targetCredentials: MainDeviceCredentials = credentials,
    targetDatabaseRoles: SeparatedDatabaseRoles = databaseRoles,
    targetPort = apiPort,
  ): Record<string, string> {
    return {
      API_HOST: "127.0.0.1",
      API_PORT: String(targetPort),
      BREEV_MAIN_DEVICE_ID: targetCredentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: targetCredentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: targetCredentials.sessionToken,
      DATABASE_MIGRATION_URL: targetDatabaseRoles.migrationUrl,
      DATABASE_URL: targetDatabaseRoles.applicationUrl,
      HTTPS_PROXY: POISONED_PROXY,
      HTTP_PROXY: POISONED_PROXY,
    };
  }

  function startApi(): ChildProcessWithoutNullStreams {
    return startApiAt(credentials, databaseRoles, apiPort, (output) => {
      apiOutput += output;
    });
  }

  function startApiAt(
    targetCredentials: MainDeviceCredentials,
    targetDatabaseRoles: SeparatedDatabaseRoles,
    targetPort: number,
    collectOutput: (output: string) => void,
  ): ChildProcessWithoutNullStreams {
    const child = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../dist/main.js")],
      {
        env: {
          ...process.env,
          ...apiEnvironment(targetCredentials, targetDatabaseRoles, targetPort),
        },
      },
    );
    child.stdout.on("data", (chunk: Buffer) => collectOutput(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => collectOutput(chunk.toString()));
    child.on("error", (error) => {
      collectOutput(`\nAPI child process error: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      collectOutput(
        `\nAPI child exited with code ${String(code)} and signal ${String(signal)}`,
      );
    });
    return child;
  }

  async function request(
    method: "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    return await requestWith(credentials, method, route, body);
  }

  async function requestWith(
    device: MainDeviceCredentials,
    method: "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    return await requestAt(apiOrigin, device, method, route, body);
  }

  async function requestAt(
    origin: string,
    device: MainDeviceCredentials,
    method: "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${origin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Authorization: `Breev-Device ${device.deviceSecret}`,
        [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
        [LOCAL_DEVICE_ID_HEADER]: device.deviceId,
        [LOCAL_DEVICE_SESSION_HEADER]: device.sessionToken,
        Origin: "breev://app",
      },
      method,
    });
    const text = await response.text();
    return {
      body: text.length === 0 ? undefined : (JSON.parse(text) as unknown),
      status: response.status,
    };
  }

  function failureContext(responses: readonly ApiResponse[]): string {
    return `${apiOutput}\n${JSON.stringify(responses)}`;
  }
});

function objectBody(response: ApiResponse): Record<string, unknown> {
  if (typeof response.body !== "object" || response.body === null) {
    throw new Error("Expected an object response body");
  }
  return response.body as Record<string, unknown>;
}

function objectBodyValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected an object value in the response");
  }
  return value as Record<string, unknown>;
}

function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: uuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function uuidV7(): string {
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
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Local API exited before health became available\n${diagnostics()}`,
      );
    }
    try {
      if ((await fetch(`${origin}/health`)).status === 200) return;
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
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
