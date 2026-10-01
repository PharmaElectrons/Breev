import { z } from "zod";

export const patientWeightRegex = /^(?:0\.[1-9]|[1-9]\d{0,2}(?:\.\d)?)$/u;
export const patientHeightRegex = /^(?:0\.[1-9]|[1-9]\d{0,2}(?:\.\d)?)$/u;
export const patientDiscountRegex =
  /^(?:100(?:\.00?)?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/u;
// Valid BMI is derived from the accepted maximum weight and minimum height.
export const patientBmiRegex = /^(?:0\.[0-9]|[1-9]\d{0,8}(?:\.\d)?)$/u;

const revisionSchema = z.string().regex(/^[1-9]\d*$/u);
const utcInstantSchema = z
  .string()
  .datetime()
  .refine((value) => value.endsWith("Z"), "Expected a UTC instant");

export const patientGenderSchema = z.enum(["male", "female"]);
export const patientIdSchema = z.uuidv7();

function decimalAtMostOnePlace(value: string, maximum: string): boolean {
  const [whole = "0", fraction = ""] = value.split(".");
  const [maxWhole = "0", maxFraction = ""] = maximum.split(".");
  const places = Math.max(fraction.length, maxFraction.length);
  const scale = BigInt(`1${"0".repeat(places)}`);
  const exactValue =
    BigInt(whole) * scale + BigInt(fraction.padEnd(places, "0") || "0");
  const exactMaximum =
    BigInt(maxWhole) * scale + BigInt(maxFraction.padEnd(places, "0") || "0");
  return exactValue <= exactMaximum;
}

const patientHeightSchema = z
  .string()
  .regex(patientHeightRegex)
  .refine((value) => decimalAtMostOnePlace(value, "300.0"));
const patientWeightSchema = z
  .string()
  .regex(patientWeightRegex)
  .refine((value) => decimalAtMostOnePlace(value, "700.0"));
const patientDiscountSchema = z
  .string()
  .regex(patientDiscountRegex)
  .refine((value) => decimalAtMostOnePlace(value, "100.00"));
const patientBmiSchema = z
  .string()
  .regex(patientBmiRegex)
  .refine((value) => decimalAtMostOnePlace(value, "700000000.0"));

export const patientWeightInputSchema = z.strictObject({
  weightKg: patientWeightSchema,
  measuredAt: utcInstantSchema,
});
export type PatientWeightInput = z.infer<typeof patientWeightInputSchema>;

const profileFieldsSchema = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().max(20).nullable(),
  dateOfBirth: z.iso.date().nullable(),
  gender: patientGenderSchema.nullable(),
  heightCm: patientHeightSchema.nullable(),
  address: z.string().max(500).nullable(),
  email: z.email().max(254).nullable(),
  chronicConditions: z.array(z.string().trim().min(1).max(200)),
  chronicMedications: z.array(z.string().trim().min(1).max(200)),
  interests: z.array(z.string().trim().min(1).max(200)),
  allergies: z.string().max(2000).nullable(),
  smoking: z.string().max(500).nullable(),
  sensitivities: z.string().max(2000).nullable(),
  otherNotes: z.string().max(5000).nullable(),
  discountPercent: patientDiscountSchema.nullable(),
  doNotDisturb: z.boolean(),
};

export const patientProfileResponseSchema = z.strictObject({
  id: z.uuidv7(),
  ...profileFieldsSchema,
  // Note fields are omitted unless the caller has a notes permission.
  allergies: profileFieldsSchema.allergies.optional(),
  smoking: profileFieldsSchema.smoking.optional(),
  sensitivities: profileFieldsSchema.sensitivities.optional(),
  otherNotes: profileFieldsSchema.otherNotes.optional(),
  chronicConditions: profileFieldsSchema.chronicConditions.optional(),
  chronicMedications: profileFieldsSchema.chronicMedications.optional(),
  revision: revisionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  bmi: patientBmiSchema.nullable(),
  bmiCategory: z
    .enum(["underweight", "normal", "overweight", "obese"])
    .nullable(),
});
export type PatientProfileResponse = z.infer<
  typeof patientProfileResponseSchema
>;

const createPatientFieldsSchema = z.strictObject({
  firstName: profileFieldsSchema.firstName,
  lastName: profileFieldsSchema.lastName,
  phone: profileFieldsSchema.phone.optional(),
  dateOfBirth: profileFieldsSchema.dateOfBirth.optional(),
  gender: profileFieldsSchema.gender.optional(),
  heightCm: profileFieldsSchema.heightCm.optional(),
  address: profileFieldsSchema.address.optional(),
  email: profileFieldsSchema.email.optional(),
  chronicConditions: profileFieldsSchema.chronicConditions.optional(),
  chronicMedications: profileFieldsSchema.chronicMedications.optional(),
  interests: profileFieldsSchema.interests.optional(),
  allergies: profileFieldsSchema.allergies.optional(),
  smoking: profileFieldsSchema.smoking.optional(),
  sensitivities: profileFieldsSchema.sensitivities.optional(),
  otherNotes: profileFieldsSchema.otherNotes.optional(),
  discountPercent: profileFieldsSchema.discountPercent.optional(),
  doNotDisturb: profileFieldsSchema.doNotDisturb.optional(),
  weightMeasurement: patientWeightInputSchema.optional(),
});

export const createPatientRequestSchema = createPatientFieldsSchema.extend({
  idempotencyKey: z.uuid(),
});
export type CreatePatientRequest = z.infer<typeof createPatientRequestSchema>;

const updatePatientFieldsSchema = z.strictObject({
  firstName: profileFieldsSchema.firstName.optional(),
  lastName: profileFieldsSchema.lastName.optional(),
  phone: profileFieldsSchema.phone.optional(),
  dateOfBirth: profileFieldsSchema.dateOfBirth.optional(),
  gender: profileFieldsSchema.gender.optional(),
  heightCm: profileFieldsSchema.heightCm.optional(),
  address: profileFieldsSchema.address.optional(),
  email: profileFieldsSchema.email.optional(),
  chronicConditions: profileFieldsSchema.chronicConditions.optional(),
  chronicMedications: profileFieldsSchema.chronicMedications.optional(),
  interests: profileFieldsSchema.interests.optional(),
  allergies: profileFieldsSchema.allergies.optional(),
  smoking: profileFieldsSchema.smoking.optional(),
  sensitivities: profileFieldsSchema.sensitivities.optional(),
  otherNotes: profileFieldsSchema.otherNotes.optional(),
  discountPercent: profileFieldsSchema.discountPercent.optional(),
  doNotDisturb: profileFieldsSchema.doNotDisturb.optional(),
  weightMeasurement: patientWeightInputSchema.optional(),
  expectedRevision: revisionSchema,
  idempotencyKey: z.uuid(),
});

export const updatePatientRequestSchema = updatePatientFieldsSchema.refine(
  (body) =>
    Object.keys(body).some(
      (key) => key !== "expectedRevision" && key !== "idempotencyKey",
    ),
  "At least one patient field must be supplied",
);
export type UpdatePatientRequest = z.infer<typeof updatePatientRequestSchema>;

export const searchPatientsQuerySchema = z.strictObject({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const searchPatientsResponseSchema = z.strictObject({
  items: z.array(patientProfileResponseSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(50),
  totalPages: z.number().int().min(0),
});
export type SearchPatientsResponse = z.infer<
  typeof searchPatientsResponseSchema
>;

export const patientWeightMeasurementSchema = z.strictObject({
  id: z.uuidv7(),
  patientId: z.uuidv7(),
  weightKg: z.string().regex(patientWeightRegex),
  measuredAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  createdByUserId: z.uuidv7(),
});
export type PatientWeightMeasurementResponse = z.infer<
  typeof patientWeightMeasurementSchema
>;

export const listPatientWeightsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
export const listPatientWeightsResponseSchema = z.strictObject({
  items: z.array(patientWeightMeasurementSchema),
  bmi: patientBmiSchema.nullable(),
  businessTimeZone: z.string().min(1).max(64),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(50),
  totalPages: z.number().int().min(0),
});
export type ListPatientWeightsResponse = z.infer<
  typeof listPatientWeightsResponseSchema
>;

export const patientValidationFailureSchema = z.strictObject({
  code: z.literal("validation-failed"),
  errors: z.array(
    z.strictObject({
      field: z.string().min(1).max(64),
      code: z.literal("invalid"),
    }),
  ),
});
export const patientVersionConflictSchema = z.strictObject({
  code: z.literal("version-conflict"),
  currentRevision: revisionSchema,
});
export const patientNotFoundSchema = z.strictObject({
  code: z.literal("patient-not-found"),
});

export const getPatientPath = (id: string) => `/patients/${id}`;
export const updatePatientProfilePath = (id: string) => `/patients/${id}`;
export const listPatientWeightsPath = (id: string) => `/patients/${id}/weights`;
