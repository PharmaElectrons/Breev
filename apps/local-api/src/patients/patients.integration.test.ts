import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createUuidV7 } from "../pharmacy-ca/pharmacy-ca-crypto.js";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedOwnerRoleWithFloor } from "../../test/owner-floor-fixture.js";
import { sql } from "drizzle-orm";
import { PatientsRepository } from "./patients.repository.js";
import { PatientsService } from "./patients.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import type { PatientAuthorizationPort } from "./patient-auth.port.js";

const { Pool } = pg;
const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../drizzle");

describe("Patients Integration", () => {
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle>;
  let localDatabase: LocalDatabaseService;
  let repository: PatientsRepository;
  let testActorId: string;

  beforeAll(async () => {
    const adminUrl =
      process.env.BREEV_TEST_POSTGRES_ADMIN_URL ??
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/breev_test";

    pool = new Pool({ connectionString: adminUrl });
    const migrationClient = await pool.connect();
    try {
      await migrate(drizzle({ client: migrationClient }), {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: "breev_migrations",
        migrationsTable: "breev_schema_migrations",
      });
    } finally {
      migrationClient.release();
    }

    db = drizzle({ client: pool });
    localDatabase = {
      requirePool: () => pool,
    } as unknown as LocalDatabaseService;

    repository = new PatientsRepository(localDatabase);

    const existingPharmacy = await pool.query<{ id: string }>(
      "SELECT id FROM pharmacies LIMIT 1",
    );
    let pharmacyId: string;
    if (existingPharmacy.rows.length > 0 && existingPharmacy.rows[0]) {
      pharmacyId = existingPharmacy.rows[0].id;
    } else {
      pharmacyId = createUuidV7();
      await pool.query(
        "insert into pharmacies (id, name) values ($1, 'Patients Test Pharmacy')",
        [pharmacyId],
      );
    }

    const existingUser = await pool.query<{ id: string }>(
      "SELECT id FROM identity_users WHERE pharmacy_id = $1 LIMIT 1",
      [pharmacyId],
    );
    if (existingUser.rows.length > 0 && existingUser.rows[0]) {
      testActorId = existingUser.rows[0].id;
    } else {
      const ownerRoleId = createUuidV7();
      testActorId = createUuidV7();
      await seedOwnerRoleWithFloor(pool, {
        actorId: testActorId,
        displayName: "Patients Test Owner",
        pharmacyId,
        roleId: ownerRoleId,
        username: `patients.test.owner.${testActorId.slice(0, 8)}`,
      });
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  describe("Transactions and Audit Rollback", () => {
    it("should rollback patient creation if audit insert fails", async () => {
      // Mock auth port that grants access
      const authPort: PatientAuthorizationPort = {
        check: () => ({ allowed: true, actorUserId: testActorId }),
      };

      // We will override insertAuditEvent to throw an error
      const buggyRepository = new PatientsRepository(localDatabase);
      buggyRepository.insertAuditEvent = async () => {
        throw new Error("Audit event insertion failed");
      };

      const service = new PatientsService(
        localDatabase,
        buggyRepository,
        authPort,
      );

      // We need an actor
      const actor = { deviceId: createUuidV7(), userId: testActorId };

      const patientData = {
        firstName: "Rollback",
        lastName: "Test",
        phone: "12345",
      };

      await expect(service.createPatient(actor, patientData)).rejects.toThrow(
        "Audit event insertion failed",
      );

      // Verify the patient was not created
      const searchResult = await db.execute(
        sql`SELECT * FROM patients WHERE first_name = 'Rollback' AND last_name = 'Test'`,
      );
      expect(searchResult.rows).toHaveLength(0);
    });

    it("should successfully create a patient and an audit event in one transaction", async () => {
      const actorId = testActorId;
      const authPort: PatientAuthorizationPort = {
        check: () => ({ allowed: true, actorUserId: actorId }),
      };

      const service = new PatientsService(localDatabase, repository, authPort);

      const patient = await service.createPatient(
        { deviceId: createUuidV7(), userId: actorId },
        { firstName: "Success", lastName: "Test", phone: "555" },
      );

      expect(patient).toBeDefined();
      expect(patient.id).toBeDefined();

      // Verify audit event
      const auditEvents = await db.execute(
        sql`SELECT * FROM patient_audit_events WHERE patient_id = ${patient.id}`,
      );
      expect(auditEvents.rows).toHaveLength(1);
      expect(auditEvents.rows[0]!.action).toBe("create");
    });

    it("should audit a denied mutation (PatientAuthorizationError)", async () => {
      const actorId = testActorId;
      const authPort: PatientAuthorizationPort = {
        check: () => ({
          allowed: false,
          reason: "Permission denied",
        }),
      };

      // We need an existing patient to attempt mutation on
      const patientId = createUuidV7();
      await db.execute(sql`
        INSERT INTO patients (id, first_name, last_name)
        VALUES (${patientId}, 'Denial', 'Victim')
      `);

      const service = new PatientsService(localDatabase, repository, authPort);

      const actor = { deviceId: createUuidV7(), userId: actorId };

      await expect(
        service.updatePatientNotes(actor, patientId, {
          allergies: null,
          smoking: null,
          sensitivities: null,
          otherNotes: "hack",
          updatedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("Permission denied");

      // Verify audit event was still written for the denial
      const auditEvents = await db.execute(
        sql`SELECT * FROM patient_audit_events WHERE patient_id = ${patientId} AND outcome = 'denied'`,
      );
      expect(auditEvents.rows).toHaveLength(1);
      expect(auditEvents.rows[0]!.action).toBe("edit-notes");
    });
  });

  describe("Search Security", () => {
    it("returns empty list without leaking information on search denial", async () => {
      const authPort: PatientAuthorizationPort = {
        check: () => ({ allowed: false, reason: "Permission denied" }),
      };
      const service = new PatientsService(localDatabase, repository, authPort);

      const actor = { deviceId: createUuidV7(), userId: testActorId };

      const result = await service.searchPatients(actor, "Anything", 1, 10);

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });
    });

    it("throws 403 on direct profile access denial", async () => {
      const authPort: PatientAuthorizationPort = {
        check: () => ({
          allowed: false,
          reason: "Permission denied",
        }),
      };
      const service = new PatientsService(localDatabase, repository, authPort);

      const actor = { deviceId: createUuidV7(), userId: testActorId };

      await expect(
        service.getPatientById(actor, createUuidV7()),
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("BMI Source of Truth", () => {
    it("computes exact BMI from latest weight and height, returning null if missing", async () => {
      const actorId = testActorId;
      const authPort: PatientAuthorizationPort = {
        check: () => ({ allowed: true, actorUserId: actorId }),
      };
      const service = new PatientsService(localDatabase, repository, authPort);

      const actor = { deviceId: createUuidV7(), userId: actorId };

      // 1. Missing height -> BMI null
      const p1 = await service.createPatient(actor, {
        firstName: "No",
        lastName: "Height",
      });
      await service.addWeight(actor, p1.id, {
        weightKg: "80.0",
        measuredAt: new Date().toISOString(),
      });
      const r1 = await service.getPatientById(actor, p1.id);
      expect(r1.bmi).toBeNull();

      // 2. Missing weight -> BMI null
      const p2 = await service.createPatient(actor, {
        firstName: "No",
        lastName: "Weight",
      });
      await service.updatePatientProfile(actor, p2.id, {
        heightCm: "180.0",
        phone: "1",
        updatedAt: p2.updatedAt,
      });
      const r2 = await service.getPatientById(actor, p2.id);
      expect(r2.bmi).toBeNull();

      // 3. Both present -> Exact computation
      const p3 = await service.createPatient(actor, {
        firstName: "Has",
        lastName: "Both",
      });
      await service.updatePatientProfile(actor, p3.id, {
        heightCm: "180.0",
        phone: "1",
        updatedAt: p3.updatedAt,
      });
      // Insert old weight
      await service.addWeight(actor, p3.id, {
        weightKg: "100.0",
        measuredAt: "2020-01-01T00:00:00Z",
      });
      // Insert new weight
      await service.addWeight(actor, p3.id, {
        weightKg: "81.0",
        measuredAt: new Date().toISOString(),
      });

      const r3 = await service.getPatientById(actor, p3.id);
      // 81 / (1.8 * 1.8) = 81 / 3.24 = 25.0
      expect(r3.bmi).toBe("25.0");
    });
  });

  describe("Patient Soft-Delete (Archive & Restore)", () => {
    it("archives a patient and excludes them from search results, recording audit event", async () => {
      const actorId = testActorId;
      const authPort: PatientAuthorizationPort = {
        check: () => ({ allowed: true, actorUserId: actorId }),
      };
      const service = new PatientsService(localDatabase, repository, authPort);
      const actor = { deviceId: createUuidV7(), userId: actorId };

      const p = await service.createPatient(actor, {
        firstName: "ArchiveMe",
        lastName: "Patient",
        phone: "999888",
      });

      // Search should find the patient initially
      const searchBefore = await service.searchPatients(
        actor,
        "ArchiveMe",
        1,
        10,
      );
      expect(searchBefore.items.map((item) => item.id)).toContain(p.id);

      // Archive the patient
      const archived = await service.archivePatient(actor, p.id, p.updatedAt);
      expect(archived.archivedAt).not.toBeNull();

      // Search should now exclude the archived patient
      const searchAfter = await service.searchPatients(
        actor,
        "ArchiveMe",
        1,
        10,
      );
      expect(searchAfter.items.map((item) => item.id)).not.toContain(p.id);

      // Directly fetching by ID still returns the archived patient with archivedAt populated
      const fetched = await service.getPatientById(actor, p.id);
      expect(fetched.archivedAt).not.toBeNull();

      // Verify audit event for archive
      const auditEvents = await db.execute(
        sql`SELECT * FROM patient_audit_events WHERE patient_id = ${p.id} AND action = 'archive'`,
      );
      expect(auditEvents.rows).toHaveLength(1);
      expect(auditEvents.rows[0]!.outcome).toBe("allowed");

      // Restore the patient
      const restored = await service.restorePatient(
        actor,
        p.id,
        archived.updatedAt,
      );
      expect(restored.archivedAt).toBeNull();

      // Search should include the restored patient again
      const searchRestored = await service.searchPatients(
        actor,
        "ArchiveMe",
        1,
        10,
      );
      expect(searchRestored.items.map((item) => item.id)).toContain(p.id);

      // Verify audit event for restore
      const restoreAuditEvents = await db.execute(
        sql`SELECT * FROM patient_audit_events WHERE patient_id = ${p.id} AND action = 'restore'`,
      );
      expect(restoreAuditEvents.rows).toHaveLength(1);
      expect(restoreAuditEvents.rows[0]!.outcome).toBe("allowed");
    });
  });
});
