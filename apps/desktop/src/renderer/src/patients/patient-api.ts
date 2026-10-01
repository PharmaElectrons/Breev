import { z } from "zod";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  createPatientContract,
  createPatientRequestSchema,
  getPatientContract,
  getPatientPath,
  identityDenialSchema,
  licensingDenialSchema,
  listPatientWeightsContract,
  listPatientWeightsPath,
  listPatientWeightsQuerySchema,
  patientNotFoundSchema,
  patientValidationFailureSchema,
  patientVersionConflictSchema,
  searchPatientsContract,
  searchPatientsQuerySchema,
  updatePatientProfileContract,
  updatePatientProfilePath,
  updatePatientRequestSchema,
  type CreatePatientRequest,
  type IdentityDenial,
  type LicensingDenial,
  type ListPatientWeightsResponse,
  type PatientProfileResponse,
  type SearchPatientsResponse,
  type UpdatePatientRequest,
} from "@breev/contracts/local-rest";

type PatientAccessDenial = IdentityDenial | LicensingDenial;

export class PatientsApiDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: PatientAccessDenial,
  ) {
    super(denial.code);
    this.name = "PatientsApiDenied";
  }
}

export class PatientsApiValidationFailure extends Error {
  public constructor(public readonly fields: readonly string[]) {
    super("Patient request validation failed");
    this.name = "PatientsApiValidationFailure";
  }
}

export class PatientsApiVersionConflict extends Error {
  public constructor(public readonly currentRevision: string) {
    super("Patient profile version conflict");
    this.name = "PatientsApiVersionConflict";
  }
}

export class PatientsApiIdempotencyConflict extends Error {
  public constructor() {
    super("Patient command key was already used for different details");
    this.name = "PatientsApiIdempotencyConflict";
  }
}

export class PatientsApiNotFound extends Error {
  public constructor() {
    super("Patient profile was not found");
    this.name = "PatientsApiNotFound";
  }
}

/** A command may have committed even though its response did not reach the renderer. */
export class PatientsApiOutcomeUnknown extends Error {
  public constructor() {
    super("Patient command outcome is unknown");
    this.name = "PatientsApiOutcomeUnknown";
  }
}

export class PatientsApiResponseInvalid extends Error {
  public constructor() {
    super("Patient API response did not match its contract");
    this.name = "PatientsApiResponseInvalid";
  }
}

let cachedLocalApiOrigin: string | null = null;

async function resolveLocalApiOrigin(): Promise<string> {
  if (cachedLocalApiOrigin !== null) return cachedLocalApiOrigin;
  const config = await window.breevDesktop.getStartupConfig();
  cachedLocalApiOrigin = config.localApiOrigin;
  return cachedLocalApiOrigin;
}

async function requestJson<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
  signal: AbortSignal,
  successStatus: number,
  responseSchema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const origin = await resolveLocalApiOrigin();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, origin);
  const mutation = method !== "GET";
  let response: Response;

  try {
    response = await fetch(url, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(mutation
          ? {
              "Content-Type": "application/json",
              [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
            }
          : {}),
      },
      method,
      signal,
    });
  } catch {
    if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
    if (mutation) throw new PatientsApiOutcomeUnknown();
    throw new Error("Patient request could not be completed");
  }

  const payload = await readJsonPayload(response, mutation, successStatus);
  if (response.status !== successStatus) {
    throw parseFailure(response.status, payload, mutation);
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    if (mutation) throw new PatientsApiOutcomeUnknown();
    throw new PatientsApiResponseInvalid();
  }
  return parsed.data;
}

async function readJsonPayload(
  response: Response,
  mutation: boolean,
  successStatus: number,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    if (
      response.status >= 500 ||
      (mutation && response.status === successStatus)
    ) {
      throw new PatientsApiOutcomeUnknown();
    }
    throw new PatientsApiResponseInvalid();
  }
}

function parseFailure(
  status: number,
  payload: unknown,
  mutation: boolean,
): Error {
  const access = identityDenialSchema.safeParse(payload);
  if (access.success) {
    if (status === 409 && access.data.code === "idempotency-conflict") {
      return new PatientsApiIdempotencyConflict();
    }
    return new PatientsApiDenied(status, access.data);
  }

  const entitlement = licensingDenialSchema.safeParse(payload);
  if (entitlement.success)
    return new PatientsApiDenied(status, entitlement.data);

  if (status === 400) {
    const validation = patientValidationFailureSchema.safeParse(payload);
    if (validation.success) {
      return new PatientsApiValidationFailure(
        validation.data.errors.map((error) => error.field),
      );
    }
  }

  if (status === 404 && patientNotFoundSchema.safeParse(payload).success) {
    return new PatientsApiNotFound();
  }

  if (status === 409) {
    const conflict = patientVersionConflictSchema.safeParse(payload);
    if (conflict.success) {
      return new PatientsApiVersionConflict(conflict.data.currentRevision);
    }
  }

  if (status >= 500 && mutation) return new PatientsApiOutcomeUnknown();
  return new Error("Patient request was refused");
}

export function newPatientIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function searchPatients(
  signal: AbortSignal,
  query: string,
  page: number,
  limit = 20,
): Promise<SearchPatientsResponse> {
  const params = searchPatientsQuerySchema.parse({ q: query, page, limit });
  const search = new URLSearchParams({
    q: params.q ?? "",
    page: String(params.page),
    limit: String(params.limit),
  });
  return await requestJson(
    `${searchPatientsContract.path}?${search.toString()}`,
    searchPatientsContract.method,
    signal,
    200,
    searchPatientsContract.responses[200],
  );
}

export async function getPatientProfile(
  signal: AbortSignal,
  id: string,
): Promise<PatientProfileResponse> {
  return await requestJson(
    getPatientPath(id),
    getPatientContract.method,
    signal,
    200,
    getPatientContract.responses[200],
  );
}

export async function createPatient(
  signal: AbortSignal,
  data: CreatePatientRequest,
): Promise<PatientProfileResponse> {
  const body = createPatientRequestSchema.parse(data);
  return await requestJson(
    createPatientContract.path,
    createPatientContract.method,
    signal,
    201,
    createPatientContract.responses[201],
    body,
  );
}

export async function updatePatientProfile(
  signal: AbortSignal,
  id: string,
  data: UpdatePatientRequest,
): Promise<PatientProfileResponse> {
  const body = updatePatientRequestSchema.parse(data);
  return await requestJson(
    updatePatientProfilePath(id),
    updatePatientProfileContract.method,
    signal,
    200,
    updatePatientProfileContract.responses[200],
    body,
  );
}

export async function listPatientWeights(
  signal: AbortSignal,
  patientId: string,
  page: number,
  limit = 50,
): Promise<ListPatientWeightsResponse> {
  const query = listPatientWeightsQuerySchema.parse({ page, limit });
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
  });
  return await requestJson(
    `${listPatientWeightsPath(patientId)}?${params.toString()}`,
    listPatientWeightsContract.method,
    signal,
    200,
    listPatientWeightsContract.responses[200],
  );
}
