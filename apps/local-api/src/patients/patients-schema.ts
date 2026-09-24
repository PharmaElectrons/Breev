import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const patientGenderEnum = pgEnum("patient_gender", ["male", "female"]);
export const patientAuditActionEnum = pgEnum("patient_audit_action", [
  "create",
  "edit-profile",
  "edit-notes",
  "edit-discount",
  "edit-dnd",
  "add-weight",
  "view-notes",
  "archive",
  "restore",
]);
export const patientAuditOutcomeEnum = pgEnum("patient_audit_outcome", [
  "allowed",
  "denied",
]);

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(), // Actually UUIDv7 in Postgres via sql`uuidv7()` but drizzle schema represents it as default function
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    searchIdx: index("patients_search_idx").on(table.lastName, table.firstName),
  }),
);

export const patientsRelations = relations(patients, ({ many }) => ({
  weightMeasurements: many(patientWeightMeasurements),
  auditEvents: many(patientAuditEvents),
}));

export const patientWeightMeasurements = pgTable(
  "patient_weight_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    weightKg: numeric("weight_kg", { precision: 5, scale: 1 }).notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid("created_by_user_id").notNull(),
  },
  (table) => ({
    patientIdx: index("patient_weight_measurements_patient_idx").on(
      table.patientId,
      table.measuredAt,
      table.id,
    ),
  }),
);

export const patientWeightMeasurementsRelations = relations(
  patientWeightMeasurements,
  ({ one }) => ({
    patient: one(patients, {
      fields: [patientWeightMeasurements.patientId],
      references: [patients.id],
    }),
  }),
);

export const patientAuditEvents = pgTable("patient_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  actorUserId: uuid("actor_user_id").notNull(),
  action: patientAuditActionEnum("action").notNull(),
  outcome: patientAuditOutcomeEnum("outcome").notNull(),
  changes: jsonb("changes"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const patientAuditEventsRelations = relations(
  patientAuditEvents,
  ({ one }) => ({
    patient: one(patients, {
      fields: [patientAuditEvents.patientId],
      references: [patients.id],
    }),
  }),
);
