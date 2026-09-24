import { z } from "zod";

// D-04: Exact arithmetic regex patterns
export const patientWeightRegex = /^(?:0\.\d|[1-9]\d{0,2}(?:\.\d)?)$/;
export const patientHeightRegex = /^(?:0\.\d|[1-9]\d{0,2}(?:\.\d)?)$/;
export const patientDiscountRegex =
  /^(?:100(?:\.00?)?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/;
export const patientBmiRegex = /^(?:0\.\d|[1-9]\d{0,2}(?:\.\d)?)$/;

export const patientGenderSchema = z.enum(["male", "female"]);

export const patientProfileBaseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).nullable(),
  dateOfBirth: z.string().length(10).nullable(), // YYYY-MM-DD
  gender: patientGenderSchema.nullable(),
  heightCm: z.string().regex(patientHeightRegex).nullable(),
  discountPercent: z.string().regex(patientDiscountRegex).nullable(),
  doNotDisturb: z.boolean(),
  address: z.string().max(500).nullable(),
  email: z.string().max(254).nullable(),
  chronicConditions: z.array(z.string().min(1).max(200)),
  chronicMedications: z.array(z.string().min(1).max(200)),
  interests: z.array(z.string().min(1).max(200)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type PatientProfileBase = z.infer<typeof patientProfileBaseSchema>;

export const patientBmiCategorySchema = z.enum([
  "underweight",
  "normal",
  "overweight",
  "obese",
]);
export type PatientBmiCategory = z.infer<typeof patientBmiCategorySchema>;

// Response schema including optional notes (if authorized) and derived BMI
export const patientProfileResponseSchema = patientProfileBaseSchema.extend({
  allergies: z.string().max(2000).nullable().optional(),
  smoking: z.string().max(500).nullable().optional(),
  sensitivities: z.string().max(2000).nullable().optional(),
  otherNotes: z.string().max(5000).nullable().optional(),
  bmi: z.string().regex(patientBmiRegex).nullable(),
  bmiCategory: patientBmiCategorySchema.nullable().optional(),
});

export type PatientProfileResponse = z.infer<
  typeof patientProfileResponseSchema
>;

// GET /patients
export const searchPatientsQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchPatientsResponseSchema = z.object({
  items: z.array(patientProfileBaseSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(50),
  totalPages: z.number().int().min(0),
});

export type SearchPatientsResponse = z.infer<
  typeof searchPatientsResponseSchema
>;

// POST /patients
export const createPatientRequestSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).nullable().optional(),
  dateOfBirth: z.string().length(10).nullable().optional(),
  gender: patientGenderSchema.nullable().optional(),
  heightCm: z.string().regex(patientHeightRegex).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  chronicConditions: z.array(z.string().min(1).max(200)).optional(),
  chronicMedications: z.array(z.string().min(1).max(200)).optional(),
  interests: z.array(z.string().min(1).max(200)).optional(),
});

export type CreatePatientRequest = z.infer<typeof createPatientRequestSchema>;

// PATCH /patients/:id
export const updatePatientRequestSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).nullable().optional(),
  dateOfBirth: z.string().length(10).nullable().optional(),
  gender: patientGenderSchema.nullable().optional(),
  heightCm: z.string().regex(patientHeightRegex).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  chronicConditions: z.array(z.string().min(1).max(200)).optional(),
  chronicMedications: z.array(z.string().min(1).max(200)).optional(),
  interests: z.array(z.string().min(1).max(200)).optional(),
  updatedAt: z.string().datetime(), // For optimistic locking
});

export type UpdatePatientRequest = z.infer<typeof updatePatientRequestSchema>;

// PATCH /patients/:id/notes
export const updatePatientNotesRequestSchema = z.object({
  allergies: z.string().max(2000).nullable(),
  smoking: z.string().max(500).nullable(),
  sensitivities: z.string().max(2000).nullable(),
  otherNotes: z.string().max(5000).nullable(),
  updatedAt: z.string().datetime(),
});

export type UpdatePatientNotesRequest = z.infer<
  typeof updatePatientNotesRequestSchema
>;

// PATCH /patients/:id/discount
export const updatePatientDiscountRequestSchema = z.object({
  discountPercent: z.string().regex(patientDiscountRegex).nullable(),
  updatedAt: z.string().datetime(),
});

export type UpdatePatientDiscountRequest = z.infer<
  typeof updatePatientDiscountRequestSchema
>;

// PATCH /patients/:id/dnd
export const updatePatientDndRequestSchema = z.object({
  doNotDisturb: z.boolean(),
  updatedAt: z.string().datetime(),
});

export type UpdatePatientDndRequest = z.infer<
  typeof updatePatientDndRequestSchema
>;

// POST /patients/:id/weights
export const addPatientWeightRequestSchema = z.object({
  weightKg: z.string().regex(patientWeightRegex),
  measuredAt: z.string().datetime(),
});

export type AddPatientWeightRequest = z.infer<
  typeof addPatientWeightRequestSchema
>;

// GET /patients/:id/weights
export const listPatientWeightsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const patientWeightMeasurementSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  weightKg: z.string().regex(patientWeightRegex),
  measuredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  createdByUserId: z.string().uuid(),
});

export type PatientWeightMeasurementResponse = z.infer<
  typeof patientWeightMeasurementSchema
>;

export const listPatientWeightsResponseSchema = z.object({
  items: z.array(patientWeightMeasurementSchema),
  bmi: z.string().regex(patientBmiRegex).nullable(),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(50),
  totalPages: z.number().int().min(0),
});

export type ListPatientWeightsResponse = z.infer<
  typeof listPatientWeightsResponseSchema
>;

// Contract endpoints for test parity validation
export const searchPatientsContract = {
  method: "GET",
  path: "/patients",
} as const;

export const createPatientContract = {
  method: "POST",
  path: "/patients",
} as const;

export const getPatientContract = {
  method: "GET",
  path: "/patients/:id",
} as const;
export const getPatientPath = (id: string) => `/patients/${id}`;

export const updatePatientProfileContract = {
  method: "PATCH",
  path: "/patients/:id",
} as const;
export const updatePatientProfilePath = (id: string) => `/patients/${id}`;

export const updatePatientNotesContract = {
  method: "PATCH",
  path: "/patients/:id/notes",
} as const;
export const updatePatientNotesPath = (id: string) => `/patients/${id}/notes`;

export const updatePatientDiscountContract = {
  method: "PATCH",
  path: "/patients/:id/discount",
} as const;
export const updatePatientDiscountPath = (id: string) =>
  `/patients/${id}/discount`;

export const updatePatientDndContract = {
  method: "PATCH",
  path: "/patients/:id/dnd",
} as const;
export const updatePatientDndPath = (id: string) => `/patients/${id}/dnd`;

export const listPatientWeightsContract = {
  method: "GET",
  path: "/patients/:id/weights",
} as const;
export const listPatientWeightsPath = (id: string) => `/patients/${id}/weights`;

export const addPatientWeightContract = {
  method: "POST",
  path: "/patients/:id/weights",
} as const;
export const addPatientWeightPath = (id: string) => `/patients/${id}/weights`;

export const archivePatientContract = {
  method: "PATCH",
  path: "/patients/:id/archive",
} as const;
export const archivePatientPath = (id: string) => `/patients/${id}/archive`;

export const archivePatientRequestSchema = z.object({
  updatedAt: z.string().datetime(),
});
export type ArchivePatientRequest = z.infer<typeof archivePatientRequestSchema>;

export const restorePatientContract = {
  method: "PATCH",
  path: "/patients/:id/restore",
} as const;
export const restorePatientPath = (id: string) => `/patients/${id}/restore`;

export const restorePatientRequestSchema = z.object({
  updatedAt: z.string().datetime(),
});
export type RestorePatientRequest = z.infer<typeof restorePatientRequestSchema>;

export const PATIENTS_CONTRACTS = [
  searchPatientsContract,
  createPatientContract,
  getPatientContract,
  updatePatientProfileContract,
  updatePatientNotesContract,
  updatePatientDiscountContract,
  updatePatientDndContract,
  listPatientWeightsContract,
  addPatientWeightContract,
  archivePatientContract,
  restorePatientContract,
] as const;
