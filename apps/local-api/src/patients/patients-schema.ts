import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const patientGenderEnum = pgEnum("patient_gender", ["male", "female"]);

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    dateOfBirth: date("date_of_birth"),
    gender: patientGenderEnum("gender"),
    heightCm: numeric("height_cm", { precision: 5, scale: 1 }),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
    doNotDisturb: boolean("do_not_disturb").default(false).notNull(),
    address: varchar("address", { length: 500 }),
    email: varchar("email", { length: 254 }),
    chronicConditions: text("chronic_conditions").array().notNull().default([]),
    chronicMedications: text("chronic_medications")
      .array()
      .notNull()
      .default([]),
    interests: text("interests").array().notNull().default([]),
    allergies: text("allergies"),
    smoking: varchar("smoking", { length: 500 }),
    sensitivities: text("sensitivities"),
    otherNotes: text("other_notes"),
    revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    searchIdx: index("patients_search_idx").on(
      table.pharmacyId,
      table.lastName,
      table.firstName,
    ),
    pharmacyKey: unique("patients_id_pharmacy_key").on(
      table.id,
      table.pharmacyId,
    ),
  }),
);

export const patientWeightMeasurements = pgTable(
  "patient_weight_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    weightKg: numeric("weight_kg", { precision: 5, scale: 1 }).notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid("created_by_user_id").notNull(),
  },
  (table) => ({
    patientIdx: index("patient_weight_measurements_patient_idx").on(
      table.pharmacyId,
      table.patientId,
      table.measuredAt.desc(),
      table.id.desc(),
    ),
    patientPharmacyFk: foreignKey({
      name: "patient_weight_measurements_patient_pharmacy_fk",
      columns: [table.patientId, table.pharmacyId],
      foreignColumns: [patients.id, patients.pharmacyId],
    }),
  }),
);
