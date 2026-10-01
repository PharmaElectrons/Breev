import { describe, expect, it } from "vitest";
import {
  createPatientContract,
  createPatientRequestSchema,
  getPatientContract,
  listPatientWeightsContract,
  localSecurityDenialSchema,
  patientBmiRegex,
  patientDiscountRegex,
  patientHeightRegex,
  patientProfileResponseSchema,
  patientWeightInputSchema,
  patientWeightRegex,
  searchPatientsContract,
  updatePatientProfileContract,
  updatePatientRequestSchema,
} from "./index.js";

const PATIENT_ID = "01923e20-7f2a-7b3b-8b5d-1c32cfa030f0";
const COMMAND_ID = "01923e20-7f2a-7b3b-8b5d-1c32cfa030f1";

const profile = {
  id: PATIENT_ID,
  firstName: "Fatima",
  lastName: "Ali",
  phone: "0123456789",
  dateOfBirth: "1990-05-15",
  gender: "female" as const,
  heightCm: "165.0",
  discountPercent: "5.00",
  doNotDisturb: false,
  address: null,
  email: null,
  chronicConditions: ["Asthma"],
  chronicMedications: [],
  interests: [],
  revision: "2",
  createdAt: "2026-09-24T10:00:00.000Z",
  updatedAt: "2026-09-24T10:00:00.000Z",
  bmi: null,
  bmiCategory: null,
};

describe("patient runtime contracts", () => {
  it("accepts an ordinary no-height profile and omits unauthorized notes", () => {
    expect(patientProfileResponseSchema.parse(profile)).toEqual(profile);
    expect(
      patientProfileResponseSchema.parse({
        ...profile,
        allergies: "Aspirin",
        smoking: null,
        sensitivities: null,
        otherNotes: null,
      }).allergies,
    ).toBe("Aspirin");
  });

  it("supports the full BMI range permitted by height and weight fields", () => {
    expect("0.0").toMatch(patientBmiRegex);
    expect("700000000.0").toMatch(patientBmiRegex);
    expect(patientHeightRegex.test("0.1")).toBe(true);
    expect(patientWeightRegex.test("700.0")).toBe(true);
    expect(
      patientProfileResponseSchema.parse({
        ...profile,
        bmi: "0.0",
        bmiCategory: "underweight",
      }).bmi,
    ).toBe("0.0");
    expect(
      patientProfileResponseSchema.parse({
        ...profile,
        bmi: "700000000.0",
        bmiCategory: "obese",
      }).bmi,
    ).toBe("700000000.0");
    expect(
      patientProfileResponseSchema.safeParse({
        ...profile,
        bmi: "700000000.1",
        bmiCategory: "obese",
      }).success,
    ).toBe(false);
  });

  it("validates atomic create and update commands with exact values and retry keys", () => {
    expect(
      createPatientRequestSchema.parse({
        firstName: "Mariam",
        lastName: "Hassan",
        idempotencyKey: COMMAND_ID,
        allergies: "Aspirin",
        discountPercent: "12.50",
        weightMeasurement: {
          weightKg: "75.5",
          measuredAt: "2026-09-24T10:00:00.000Z",
        },
      }).weightMeasurement?.weightKg,
    ).toBe("75.5");
    expect(
      updatePatientRequestSchema.parse({
        expectedRevision: "4",
        idempotencyKey: COMMAND_ID,
        otherNotes: null,
      }).expectedRevision,
    ).toBe("4");
    expect(
      updatePatientRequestSchema.safeParse({
        expectedRevision: "4",
        idempotencyKey: COMMAND_ID,
      }).success,
    ).toBe(false);
  });

  it("rejects out-of-range values and non-UTC measurement instants", () => {
    expect(
      patientWeightInputSchema.safeParse({
        weightKg: "700.1",
        measuredAt: "2026-09-24T10:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      patientWeightInputSchema.safeParse({
        weightKg: "75.0",
        measuredAt: "2026-09-24T10:00:00+03:00",
      }).success,
    ).toBe(false);
    expect("100.00").toMatch(patientDiscountRegex);
  });

  it("publishes typed routes with explicit success and failure schemas", () => {
    expect(searchPatientsContract).toMatchObject({
      method: "GET",
      path: "/patients",
      responses: expect.objectContaining({
        200: expect.anything(),
        401: expect.anything(),
        403: expect.anything(),
      }),
    });
    expect(
      searchPatientsContract.responses[401].parse({
        status: "denied",
        code: "session-binding-invalid",
        requestId: "01923e20-7f2a-7b3b-8b5d-1c32cfa030f2",
      }),
    ).toEqual(
      localSecurityDenialSchema.parse({
        status: "denied",
        code: "session-binding-invalid",
        requestId: "01923e20-7f2a-7b3b-8b5d-1c32cfa030f2",
      }),
    );
    expect(createPatientContract.responses[201]).toBeDefined();
    expect(createPatientContract.responses[400]).toBeDefined();
    expect(createPatientContract.responses[409]).toBeDefined();
    expect(createPatientContract.responses[413]).toBeDefined();
    expect(createPatientContract.responses[415]).toBeDefined();
    expect(createPatientContract.responses[421]).toBeDefined();
    expect(createPatientContract.responses[429]).toBeDefined();
    expect(getPatientContract.responses[404]).toBeDefined();
    expect(updatePatientProfileContract).toMatchObject({
      method: "PUT",
      path: "/patients/:id",
    });
    expect(updatePatientProfileContract.responses[409]).toBeDefined();
    expect(listPatientWeightsContract.request?.query).toBeDefined();
    expect(
      listPatientWeightsContract.responses[200].parse({
        items: [],
        bmi: null,
        businessTimeZone: "Asia/Baghdad",
        limit: 50,
        page: 1,
        total: 0,
        totalPages: 0,
      }).businessTimeZone,
    ).toBe("Asia/Baghdad");
  });
});
