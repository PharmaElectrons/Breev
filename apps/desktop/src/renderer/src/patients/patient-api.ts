import type {
  AddPatientWeightRequest,
  CreatePatientRequest,
  ListPatientWeightsResponse,
  PatientProfileResponse,
  SearchPatientsResponse,
  UpdatePatientDiscountRequest,
  UpdatePatientDndRequest,
  UpdatePatientNotesRequest,
  UpdatePatientRequest,
  LocalSecurityDenial,
} from "@breev/contracts/local-rest";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
} from "@breev/contracts/local-rest";

export class PatientsApiDenied extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: LocalSecurityDenial,
  ) {
    super(payload.code);
    this.name = "PatientsApiDenied";
  }
}

let cachedLocalApiOrigin: string | null = null;

async function resolveLocalApiOrigin(): Promise<string> {
  if (cachedLocalApiOrigin !== null) {
    return cachedLocalApiOrigin;
  }
  const config = await window.breevDesktop.getStartupConfig();
  cachedLocalApiOrigin = config.localApiOrigin;
  return cachedLocalApiOrigin;
}

async function localRequest<T = unknown>(
  path: string,
  options: RequestInit,
): Promise<T> {
  const origin = await resolveLocalApiOrigin();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, origin);
  const isMutation =
    options.method !== undefined &&
    options.method !== "GET" &&
    options.method !== "HEAD";

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(isMutation
      ? {
          "Content-Type": "application/json",
          [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
        }
      : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "omit",
    cache: "no-store",
  });

  if (!response.ok) {
    let errorJson: unknown = null;
    try {
      errorJson = await response.json();
    } catch {
      // not JSON
    }
    if (
      response.status === 403 &&
      errorJson !== null &&
      typeof errorJson === "object" &&
      "code" in errorJson
    ) {
      throw new PatientsApiDenied(403, errorJson as LocalSecurityDenial);
    }
    let message = `Request failed: ${response.status}`;
    if (
      errorJson !== null &&
      typeof errorJson === "object" &&
      "message" in errorJson &&
      typeof (errorJson as { message: unknown }).message === "string"
    ) {
      message = (errorJson as { message: string }).message;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function searchPatients(
  signal: AbortSignal,
  query: string,
  page: number,
  limit: number = 20,
): Promise<SearchPatientsResponse> {
  const searchParams = new URLSearchParams({
    q: query,
    page: page.toString(),
    limit: limit.toString(),
  });
  return await localRequest(`patients?${searchParams.toString()}`, {
    method: "GET",
    signal,
  });
}

export async function getPatientProfile(
  signal: AbortSignal,
  id: string,
): Promise<PatientProfileResponse> {
  return await localRequest(`patients/${encodeURIComponent(id)}`, {
    method: "GET",
    signal,
  });
}

export async function createPatient(
  signal: AbortSignal,
  data: CreatePatientRequest,
): Promise<PatientProfileResponse> {
  return await localRequest("patients", {
    method: "POST",
    body: JSON.stringify(data),
    signal,
  });
}

export async function updatePatientProfile(
  signal: AbortSignal,
  id: string,
  data: UpdatePatientRequest,
): Promise<PatientProfileResponse> {
  return await localRequest(`patients/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    signal,
  });
}

export async function updatePatientNotes(
  signal: AbortSignal,
  id: string,
  data: UpdatePatientNotesRequest,
): Promise<PatientProfileResponse> {
  return await localRequest(`patients/${encodeURIComponent(id)}/notes`, {
    method: "PATCH",
    body: JSON.stringify(data),
    signal,
  });
}

export async function updatePatientDiscount(
  signal: AbortSignal,
  id: string,
  data: UpdatePatientDiscountRequest,
): Promise<PatientProfileResponse> {
  return await localRequest(`patients/${encodeURIComponent(id)}/discount`, {
    method: "PATCH",
    body: JSON.stringify(data),
    signal,
  });
}

export async function updatePatientDnd(
  signal: AbortSignal,
  id: string,
  data: UpdatePatientDndRequest,
): Promise<PatientProfileResponse> {
  return await localRequest(`patients/${encodeURIComponent(id)}/dnd`, {
    method: "PATCH",
    body: JSON.stringify(data),
    signal,
  });
}

export async function listPatientWeights(
  signal: AbortSignal,
  patientId: string,
  page: number,
  limit: number = 50,
): Promise<ListPatientWeightsResponse> {
  const searchParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  return await localRequest(
    `patients/${encodeURIComponent(patientId)}/weights?${searchParams.toString()}`,
    {
      method: "GET",
      signal,
    },
  );
}

export async function addPatientWeight(
  signal: AbortSignal,
  patientId: string,
  data: AddPatientWeightRequest,
): Promise<void> {
  return await localRequest(
    `patients/${encodeURIComponent(patientId)}/weights`,
    {
      method: "POST",
      body: JSON.stringify(data),
      signal,
    },
  );
}

export async function archivePatient(
  signal: AbortSignal,
  id: string,
  updatedAt: string,
): Promise<PatientProfileResponse> {
  return await localRequest(`patients/${encodeURIComponent(id)}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ updatedAt }),
    signal,
  });
}

export async function restorePatient(
  signal: AbortSignal,
  id: string,
  updatedAt: string,
): Promise<PatientProfileResponse> {
  return await localRequest(`patients/${encodeURIComponent(id)}/restore`, {
    method: "PATCH",
    body: JSON.stringify({ updatedAt }),
    signal,
  });
}
