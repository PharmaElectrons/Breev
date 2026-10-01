import type {
  CreatePatientRequest,
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
  UpdatePatientRequest,
} from "@breev/contracts/local-rest";
import type { PoolClient } from "pg";

interface PatientRow extends Record<string, unknown> {
  readonly id: string;
  readonly pharmacy_id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly revision: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly bmi: string | null;
}

interface WeightRow extends Record<string, unknown> {
  readonly id: string;
  readonly pharmacy_id: string;
  readonly patient_id: string;
  readonly weight_kg: string;
  readonly measured_at: Date | string;
  readonly created_at: Date | string;
  readonly created_by_user_id: string;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function isoInstant(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Patient timestamp is invalid");
  }
  return date.toISOString();
}

function mapPatient(row: PatientRow): PatientProfileResponse {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: nullableString(row.phone),
    dateOfBirth: nullableString(row.date_of_birth),
    gender: (row.gender as "male" | "female" | null) ?? null,
    heightCm: nullableString(row.height_cm),
    discountPercent: nullableString(row.discount_percent),
    doNotDisturb: Boolean(row.do_not_disturb),
    address: nullableString(row.address),
    email: nullableString(row.email),
    chronicConditions: Array.isArray(row.chronic_conditions)
      ? (row.chronic_conditions as string[])
      : [],
    chronicMedications: Array.isArray(row.chronic_medications)
      ? (row.chronic_medications as string[])
      : [],
    interests: Array.isArray(row.interests) ? (row.interests as string[]) : [],
    allergies: nullableString(row.allergies),
    smoking: nullableString(row.smoking),
    sensitivities: nullableString(row.sensitivities),
    otherNotes: nullableString(row.other_notes),
    revision: String(row.revision),
    createdAt: isoInstant(row.created_at),
    updatedAt: isoInstant(row.updated_at),
    bmi: nullableString(row.bmi),
    bmiCategory: null,
  };
}

function mapWeight(row: WeightRow): PatientWeightMeasurementResponse {
  return {
    id: row.id,
    patientId: row.patient_id,
    weightKg: row.weight_kg,
    measuredAt: isoInstant(row.measured_at),
    createdAt: isoInstant(row.created_at),
    createdByUserId: row.created_by_user_id,
  };
}

const patientReadSql = `
  select p.*,
         (
           select round(w.weight_kg * 10000 / (p.height_cm * p.height_cm), 1)::text
           from patient_weight_measurements w
           where w.pharmacy_id = p.pharmacy_id
             and w.patient_id = p.id
           order by w.measured_at desc, w.id desc
           limit 1
         ) as bmi
  from patients p
  where p.pharmacy_id = $1 and p.id = $2`;

export class PatientsRepository {
  public async getPatientById(
    client: PoolClient,
    pharmacyId: string,
    id: string,
    lock = false,
  ): Promise<PatientProfileResponse | null> {
    const result = await client.query<PatientRow>(
      `${patientReadSql}${lock ? " for update of p" : ""}`,
      [pharmacyId, id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPatient(row);
  }

  public async searchPatients(
    client: PoolClient,
    pharmacyId: string,
    query: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{
    readonly items: PatientProfileResponse[];
    readonly total: number;
  }> {
    const result = await client.query<{ readonly count: string }>(
      `select count(*)::text as count from patients p
       where p.pharmacy_id = $1 and (
         $2::text is null or
         strpos(lower(p.first_name), lower($2)) > 0 or
         strpos(lower(p.last_name), lower($2)) > 0 or
         strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($2)) > 0 or
         strpos(lower(coalesce(p.phone, '')), lower($2)) > 0
       )`,
      [pharmacyId, query ?? null],
    );
    const rows = await client.query<PatientRow>(
      `select p.*,
         (
           select round(w.weight_kg * 10000 / (p.height_cm * p.height_cm), 1)::text
           from patient_weight_measurements w
           where w.pharmacy_id = p.pharmacy_id and w.patient_id = p.id
           order by w.measured_at desc, w.id desc limit 1
         ) as bmi
       from patients p
       where p.pharmacy_id = $1 and (
         $2::text is null or
         strpos(lower(p.first_name), lower($2)) > 0 or
         strpos(lower(p.last_name), lower($2)) > 0 or
         strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($2)) > 0 or
         strpos(lower(coalesce(p.phone, '')), lower($2)) > 0
       )
       order by lower(p.last_name), lower(p.first_name), p.created_at, p.id
       limit $3 offset $4`,
      [pharmacyId, query ?? null, limit, offset],
    );
    return {
      items: rows.rows.map(mapPatient),
      total: Number(result.rows[0]?.count ?? 0),
    };
  }

  public async createPatient(
    client: PoolClient,
    pharmacyId: string,
    input: CreatePatientRequest,
  ): Promise<PatientProfileResponse> {
    const result = await client.query<{ readonly id: string }>(
      `insert into patients (
         pharmacy_id, first_name, last_name, phone, date_of_birth, gender,
         height_cm, address, email, chronic_conditions, chronic_medications,
         interests, allergies, smoking, sensitivities, other_notes,
         discount_percent, do_not_disturb
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18
       ) returning id`,
      [
        pharmacyId,
        input.firstName.trim(),
        input.lastName.trim(),
        input.phone ?? null,
        input.dateOfBirth ?? null,
        input.gender ?? null,
        input.heightCm ?? null,
        input.address ?? null,
        input.email ?? null,
        input.chronicConditions ?? [],
        input.chronicMedications ?? [],
        input.interests ?? [],
        input.allergies ?? null,
        input.smoking ?? null,
        input.sensitivities ?? null,
        input.otherNotes ?? null,
        input.discountPercent ?? null,
        input.doNotDisturb ?? false,
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("Patient insert returned no id");
    const patient = await this.getPatientById(client, pharmacyId, id);
    if (patient === null) throw new Error("Patient insert could not be read");
    return patient;
  }

  public async updatePatient(
    client: PoolClient,
    pharmacyId: string,
    id: string,
    expectedRevision: string,
    input: UpdatePatientRequest,
  ): Promise<PatientProfileResponse | null> {
    const columns: Readonly<Record<string, string>> = {
      firstName: "first_name",
      lastName: "last_name",
      phone: "phone",
      dateOfBirth: "date_of_birth",
      gender: "gender",
      heightCm: "height_cm",
      address: "address",
      email: "email",
      chronicConditions: "chronic_conditions",
      chronicMedications: "chronic_medications",
      interests: "interests",
      allergies: "allergies",
      smoking: "smoking",
      sensitivities: "sensitivities",
      otherNotes: "other_notes",
      discountPercent: "discount_percent",
      doNotDisturb: "do_not_disturb",
    };
    const parameters: unknown[] = [pharmacyId, id, expectedRevision];
    const assignments: string[] = [];
    for (const [field, column] of Object.entries(columns)) {
      if (!Object.hasOwn(input, field)) continue;
      let value = input[field as keyof UpdatePatientRequest];
      if (field === "firstName" || field === "lastName") {
        value = typeof value === "string" ? value.trim() : value;
      }
      parameters.push(value);
      assignments.push(`${column} = $${parameters.length}`);
    }
    // A measurement-only Save still advances the profile revision so every
    // successful Save returns a new version and one coherent audit fact.
    if (assignments.length === 0) assignments.push("id = id");
    const updated = await client.query<{ readonly id: string }>(
      `update patients set ${assignments.join(", ")}
       where pharmacy_id = $1 and id = $2 and revision = $3::bigint
       returning id`,
      parameters,
    );
    if (updated.rowCount !== 1) return null;
    return await this.getPatientById(client, pharmacyId, id);
  }

  public async appendWeight(
    client: PoolClient,
    pharmacyId: string,
    patientId: string,
    actorUserId: string,
    weightKg: string,
    measuredAt: string,
  ): Promise<PatientWeightMeasurementResponse> {
    const result = await client.query<WeightRow>(
      `insert into patient_weight_measurements (
         pharmacy_id, patient_id, created_by_user_id, weight_kg, measured_at
       ) values ($1, $2, $3, $4, $5::timestamptz)
       returning *`,
      [pharmacyId, patientId, actorUserId, weightKg, measuredAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Weight insert returned no row");
    return mapWeight(row);
  }

  public async listWeights(
    client: PoolClient,
    pharmacyId: string,
    patientId: string,
    limit: number,
    offset: number,
  ): Promise<{
    readonly items: PatientWeightMeasurementResponse[];
    readonly total: number;
    readonly bmi: string | null;
  }> {
    const count = await client.query<{ readonly count: string }>(
      `select count(*)::text as count from patient_weight_measurements
       where pharmacy_id = $1 and patient_id = $2`,
      [pharmacyId, patientId],
    );
    const rows = await client.query<WeightRow>(
      `select * from patient_weight_measurements
       where pharmacy_id = $1 and patient_id = $2
       order by measured_at desc, id desc limit $3 offset $4`,
      [pharmacyId, patientId, limit, offset],
    );
    const latest = await client.query<{ readonly bmi: string | null }>(
      `select round(w.weight_kg * 10000 / (p.height_cm * p.height_cm), 1)::text as bmi
       from patients p
       join patient_weight_measurements w
         on w.pharmacy_id = p.pharmacy_id and w.patient_id = p.id
       where p.pharmacy_id = $1 and p.id = $2 and p.height_cm is not null
       order by w.measured_at desc, w.id desc limit 1`,
      [pharmacyId, patientId],
    );
    return {
      items: rows.rows.map(mapWeight),
      total: Number(count.rows[0]?.count ?? 0),
      bmi: latest.rows[0]?.bmi ?? null,
    };
  }
}
