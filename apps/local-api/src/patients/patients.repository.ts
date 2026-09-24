import { Injectable } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import type {
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
} from "@breev/contracts/local-rest";
import { LocalDatabaseService } from "../local-database.service.js";
import {
  patientAuditEvents,
  patients,
  patientWeightMeasurements,
  type patientAuditActionEnum,
  type patientAuditOutcomeEnum,
} from "./patients-schema.js";

type AuditAction = (typeof patientAuditActionEnum.enumValues)[number];
type AuditOutcome = (typeof patientAuditOutcomeEnum.enumValues)[number];

export interface AuditEventPayload {
  readonly patientId: string;
  readonly actorUserId: string;
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly changes?: Record<string, unknown>;
}

function mapPatientRow(row: Record<string, unknown>): PatientProfileResponse {
  const getStr = (key: string): string | null => {
    const val = row[key];
    return typeof val === "string" ? val : null;
  };
  const getArr = (key: string): string[] => {
    const val = row[key];
    return Array.isArray(val) ? (val as string[]) : [];
  };
  const toIso = (val: unknown): string => {
    if (val instanceof Date) return val.toISOString();
    if (typeof val === "string") return new Date(val).toISOString();
    return new Date().toISOString();
  };

  return {
    id: (row.id ?? row["id"]) as string,
    firstName: (row.firstName ?? row["first_name"]) as string,
    lastName: (row.lastName ?? row["last_name"]) as string,
    phone: getStr("phone"),
    dateOfBirth: getStr("dateOfBirth") ?? getStr("date_of_birth"),
    gender: (row.gender ?? row["gender"] ?? null) as "male" | "female" | null,
    heightCm: getStr("heightCm") ?? getStr("height_cm"),
    discountPercent: getStr("discountPercent") ?? getStr("discount_percent"),
    doNotDisturb: Boolean(row.doNotDisturb ?? row["do_not_disturb"] ?? false),
    address: getStr("address"),
    email: getStr("email"),
    chronicConditions:
      getArr("chronicConditions").length > 0
        ? getArr("chronicConditions")
        : getArr("chronic_conditions"),
    chronicMedications:
      getArr("chronicMedications").length > 0
        ? getArr("chronicMedications")
        : getArr("chronic_medications"),
    interests:
      getArr("interests").length > 0
        ? getArr("interests")
        : getArr("interests"),
    allergies: getStr("allergies"),
    smoking: getStr("smoking"),
    sensitivities: getStr("sensitivities"),
    otherNotes: getStr("otherNotes") ?? getStr("other_notes"),
    createdAt: toIso(row.createdAt ?? row["created_at"]),
    updatedAt: toIso(row.updatedAt ?? row["updated_at"]),
    archivedAt:
      row.archivedAt != null || row["archived_at"] != null
        ? toIso(row.archivedAt ?? row["archived_at"])
        : null,
    bmi: getStr("bmi"),
  };
}

function mapWeightRow(
  row: Record<string, unknown>,
): PatientWeightMeasurementResponse {
  const toIso = (val: unknown): string => {
    if (val instanceof Date) return val.toISOString();
    if (typeof val === "string") return new Date(val).toISOString();
    return new Date().toISOString();
  };
  return {
    id: (row.id ?? row["id"]) as string,
    patientId: (row.patientId ?? row["patient_id"]) as string,
    weightKg: (row.weightKg ?? row["weight_kg"]) as string,
    measuredAt: toIso(row.measuredAt ?? row["measured_at"]),
    createdAt: toIso(row.createdAt ?? row["created_at"]),
    createdByUserId: (row.createdByUserId ??
      row["created_by_user_id"]) as string,
  };
}

@Injectable()
export class PatientsRepository {
  public constructor(private readonly localDatabase: LocalDatabaseService) {}

  private getDb(client?: PoolClient | Pool) {
    const pgClient = client ?? this.localDatabase.requirePool();
    return drizzle({ client: pgClient });
  }

  public async getPatientById(
    id: string,
    client?: PoolClient,
  ): Promise<PatientProfileResponse | null> {
    const db = this.getDb(client);

    // We use raw SQL for BMI calculation as defined in D-05
    const query = sql`
      SELECT 
        p.*,
        (
          SELECT (w.weight_kg / ((p.height_cm / 100) ^ 2))::numeric(4,1)
          FROM patient_weight_measurements w
          WHERE w.patient_id = p.id
          ORDER BY w.measured_at DESC, w.id DESC
          LIMIT 1
        ) AS bmi
      FROM patients p
      WHERE p.id = ${id}
    `;

    const result = await db.execute(query);
    if (result.rows.length === 0) return null;
    return mapPatientRow(result.rows[0] as Record<string, unknown>);
  }

  public async searchPatients(
    q: string | undefined,
    limit: number,
    offset: number,
    client?: PoolClient,
  ): Promise<{ items: PatientProfileResponse[]; total: number }> {
    const db = this.getDb(client);

    let whereClause = sql`p.archived_at IS NULL`;
    if (q) {
      const normalizedQuery = q.trim().replace(/\s+/g, " ");
      if (normalizedQuery.length > 0) {
        const likeQuery = `%${normalizedQuery}%`;
        whereClause = sql`p.archived_at IS NULL AND (p.first_name ILIKE ${likeQuery} OR p.last_name ILIKE ${likeQuery} OR p.phone ILIKE ${likeQuery})`;
      }
    }

    const countQuery = sql`SELECT COUNT(*)::int AS count FROM patients p WHERE ${whereClause}`;
    const countResult = await db.execute(countQuery);
    const total = (countResult.rows[0]?.count as number) ?? 0;

    const dataQuery = sql`
      SELECT p.*
      FROM patients p
      WHERE ${whereClause}
      ORDER BY p.last_name ASC, p.first_name ASC, p.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const dataResult = await db.execute(dataQuery);

    return {
      items: (dataResult.rows as Record<string, unknown>[]).map((r) =>
        mapPatientRow(r),
      ),
      total,
    };
  }

  public async createPatient(
    data: Record<string, unknown>,
    client?: PoolClient,
  ): Promise<PatientProfileResponse | null> {
    const db = this.getDb(client);
    const result = await db
      .insert(patients)
      .values(data as typeof patients.$inferInsert)
      .returning();
    const row = result[0];
    return row ? mapPatientRow(row as Record<string, unknown>) : null;
  }

  public async updatePatient(
    id: string,
    data: Record<string, unknown>,
    expectedUpdatedAt: Date | string,
    client?: PoolClient,
  ): Promise<PatientProfileResponse | null> {
    const db = this.getDb(client);
    const fields = { ...data };
    delete fields.updatedAt;
    const expectedIso = new Date(expectedUpdatedAt).toISOString();
    const result = await db
      .update(patients)
      .set({
        ...(fields as Partial<typeof patients.$inferInsert>),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(patients.id, id),
          sql`date_trunc('millisecond', ${patients.updatedAt}) = date_trunc('millisecond', ${expectedIso}::timestamptz)`,
        ),
      )
      .returning();
    const row = result[0];
    return row ? mapPatientRow(row as Record<string, unknown>) : null;
  }

  public async archivePatient(
    id: string,
    expectedUpdatedAt: Date | string,
    client?: PoolClient,
  ): Promise<PatientProfileResponse | null> {
    const db = this.getDb(client);
    const expectedIso = new Date(expectedUpdatedAt).toISOString();
    const result = await db
      .update(patients)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(patients.id, id),
          sql`patients.archived_at IS NULL`,
          sql`date_trunc('millisecond', ${patients.updatedAt}) = date_trunc('millisecond', ${expectedIso}::timestamptz)`,
        ),
      )
      .returning();
    const row = result[0];
    return row ? mapPatientRow(row as Record<string, unknown>) : null;
  }

  public async restorePatient(
    id: string,
    expectedUpdatedAt: Date | string,
    client?: PoolClient,
  ): Promise<PatientProfileResponse | null> {
    const db = this.getDb(client);
    const expectedIso = new Date(expectedUpdatedAt).toISOString();
    const result = await db
      .update(patients)
      .set({
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(patients.id, id),
          sql`patients.archived_at IS NOT NULL`,
          sql`date_trunc('millisecond', ${patients.updatedAt}) = date_trunc('millisecond', ${expectedIso}::timestamptz)`,
        ),
      )
      .returning();
    const row = result[0];
    return row ? mapPatientRow(row as Record<string, unknown>) : null;
  }

  public async insertWeight(
    patientId: string,
    weightKg: string,
    measuredAt: Date | string,
    createdByUserId: string,
    client?: PoolClient,
  ): Promise<PatientWeightMeasurementResponse | null> {
    const db = this.getDb(client);
    const result = await db
      .insert(patientWeightMeasurements)
      .values({
        patientId,
        weightKg,
        measuredAt: new Date(measuredAt),
        createdByUserId,
      })
      .returning();
    const row = result[0];
    return row ? mapWeightRow(row as Record<string, unknown>) : null;
  }

  public async listWeights(
    patientId: string,
    limit: number,
    offset: number,
    client?: PoolClient,
  ): Promise<{
    items: PatientWeightMeasurementResponse[];
    total: number;
    bmi: string | null;
  }> {
    const db = this.getDb(client);

    const countQuery = sql`SELECT COUNT(*)::int AS count FROM patient_weight_measurements WHERE patient_id = ${patientId}`;
    const countResult = await db.execute(countQuery);
    const total = (countResult.rows[0]?.count as number) ?? 0;

    const dataQuery = sql`
      SELECT w.*
      FROM patient_weight_measurements w
      WHERE w.patient_id = ${patientId}
      ORDER BY w.measured_at DESC, w.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const dataResult = await db.execute(dataQuery);

    const patientQuery = sql`SELECT (w.weight_kg / ((p.height_cm / 100) ^ 2))::numeric(4,1) AS bmi
      FROM patients p
      JOIN (
        SELECT weight_kg
        FROM patient_weight_measurements
        WHERE patient_id = ${patientId}
        ORDER BY measured_at DESC, id DESC
        LIMIT 1
      ) w ON true
      WHERE p.id = ${patientId} AND p.height_cm IS NOT NULL AND p.height_cm > 0`;

    const patientResult = await db.execute(patientQuery);
    const bmi =
      patientResult.rows.length > 0
        ? (patientResult.rows[0]?.bmi as string)
        : null;

    return {
      items: (dataResult.rows as Record<string, unknown>[]).map((r) =>
        mapWeightRow(r),
      ),
      total,
      bmi,
    };
  }

  public async insertAuditEvent(event: AuditEventPayload, client?: PoolClient) {
    const db = this.getDb(client);
    await db.insert(patientAuditEvents).values({
      patientId: event.patientId,
      actorUserId: event.actorUserId,
      action: event.action,
      outcome: event.outcome,
      changes: event.changes,
    });
  }
}
