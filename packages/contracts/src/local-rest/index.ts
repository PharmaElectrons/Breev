import { z } from "zod";

export const LOCAL_API_VERSION = "2" as const;
export const LOCAL_SCHEMA_VERSION = "1" as const;
export const LOCAL_HEALTH_SUCCESS_STATUS = 200 as const;
export const LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS = 503 as const;
export const LOCAL_PROOF_EVIDENCE_SUCCESS_STATUS = 200 as const;
export const LOCAL_PROOF_MUTATION_SUCCESS_STATUS = 201 as const;

export const BREEV_CSRF_HEADER = "X-Breev-CSRF" as const;
export const BREEV_CSRF_VALUE = "1" as const;
export const LOCAL_DEVICE_ID_HEADER = "X-Breev-Device-Id" as const;
export const LOCAL_DEVICE_SESSION_HEADER = "X-Breev-Device-Session" as const;

export const localHealthQuerySchema = z.strictObject({});

const localHealthVersionFields = {
  apiVersion: z.literal(LOCAL_API_VERSION),
  schemaVersion: z.literal(LOCAL_SCHEMA_VERSION),
} as const;

export const localHealthSuccessSchema = z.strictObject({
  ...localHealthVersionFields,
  status: z.literal("healthy"),
  database: z.literal("available"),
});

export const localHealthDatabaseUnavailableSchema = z.strictObject({
  ...localHealthVersionFields,
  status: z.literal("degraded"),
  database: z.literal("unavailable"),
});

export const localHealthRepairRequiredSchema = z.strictObject({
  ...localHealthVersionFields,
  status: z.literal("repair-required"),
  repair: z.strictObject({
    code: z.literal("installation-state-invalid"),
  }),
});

export const localHealthContract = {
  method: "GET",
  path: "/health",
  request: {
    query: localHealthQuerySchema,
  },
  responses: {
    [LOCAL_HEALTH_SUCCESS_STATUS]: localHealthSuccessSchema,
    [LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS]: z.union([
      localHealthDatabaseUnavailableSchema,
      localHealthRepairRequiredSchema,
    ]),
  },
} as const;

export const localSecurityDenialCodeSchema = z.enum([
  "binding-invalid",
  "binding-missing",
  "body-invalid",
  "content-type-not-allowed",
  "cors-preflight-not-allowed",
  "csrf-header-missing",
  "host-not-allowed",
  "origin-not-allowed",
  "rate-limit-exceeded",
  "request-too-large",
  "session-binding-invalid",
]);

export const localSecurityDenialSchema = z.strictObject({
  status: z.literal("denied"),
  code: localSecurityDenialCodeSchema,
  requestId: z.uuid(),
});

const nonNegativeIntegerStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u);

export const localProofMutationRequestSchema = z.strictObject({
  increment: z.literal(1),
});

export const localProofMutationSuccessSchema = z.strictObject({
  status: z.literal("committed"),
  mutationCount: nonNegativeIntegerStringSchema,
});

export const localProofEvidenceSuccessSchema = z.strictObject({
  mutationCount: nonNegativeIntegerStringSchema,
  recentDenialCount: nonNegativeIntegerStringSchema,
  denials: z
    .array(
      z.strictObject({
        code: localSecurityDenialCodeSchema,
        count: nonNegativeIntegerStringSchema,
      }),
    )
    .max(localSecurityDenialCodeSchema.options.length),
});

const localSecurityDenialResponses = {
  400: localSecurityDenialSchema,
  401: localSecurityDenialSchema,
  403: localSecurityDenialSchema,
  413: localSecurityDenialSchema,
  415: localSecurityDenialSchema,
  421: localSecurityDenialSchema,
  429: localSecurityDenialSchema,
} as const;

export const localProofMutationContract = {
  method: "POST",
  path: "/security/device-session-proof",
  request: {
    body: localProofMutationRequestSchema,
  },
  responses: {
    [LOCAL_PROOF_MUTATION_SUCCESS_STATUS]: localProofMutationSuccessSchema,
    ...localSecurityDenialResponses,
  },
} as const;

export const localProofEvidenceContract = {
  method: "GET",
  path: localProofMutationContract.path,
  responses: {
    [LOCAL_PROOF_EVIDENCE_SUCCESS_STATUS]: localProofEvidenceSuccessSchema,
    ...localSecurityDenialResponses,
  },
} as const;

export type LocalHealthSuccess = z.infer<typeof localHealthSuccessSchema>;
export type LocalHealthDatabaseUnavailable = z.infer<
  typeof localHealthDatabaseUnavailableSchema
>;
export type LocalHealthRepairRequired = z.infer<
  typeof localHealthRepairRequiredSchema
>;
export type LocalHealthResponse =
  | LocalHealthSuccess
  | LocalHealthDatabaseUnavailable
  | LocalHealthRepairRequired;
export type LocalHealthStatusCode = keyof typeof localHealthContract.responses;
export type LocalSecurityDenialCode = z.infer<
  typeof localSecurityDenialCodeSchema
>;
export type LocalSecurityDenial = z.infer<typeof localSecurityDenialSchema>;
export type LocalProofMutationRequest = z.infer<
  typeof localProofMutationRequestSchema
>;
export type LocalProofMutationSuccess = z.infer<
  typeof localProofMutationSuccessSchema
>;
export type LocalProofEvidenceSuccess = z.infer<
  typeof localProofEvidenceSuccessSchema
>;

export class LocalRestVersionMismatchError extends Error {
  public constructor(
    public readonly receivedApiVersion: string,
    public readonly receivedSchemaVersion: string,
  ) {
    super(
      `Local REST version mismatch: expected API ${LOCAL_API_VERSION} and schema ${LOCAL_SCHEMA_VERSION}, received API ${receivedApiVersion} and schema ${receivedSchemaVersion}`,
    );
    this.name = "LocalRestVersionMismatchError";
  }
}

export class LocalRestPayloadError extends Error {
  public constructor(public readonly statusCode: number) {
    super(`Local REST returned an invalid payload for status ${statusCode}`);
    this.name = "LocalRestPayloadError";
  }
}

export function parseLocalHealthResponse(
  statusCode: number,
  payload: unknown,
): LocalHealthResponse {
  throwOnVersionMismatch(payload);

  const schema =
    statusCode === LOCAL_HEALTH_SUCCESS_STATUS
      ? localHealthContract.responses[LOCAL_HEALTH_SUCCESS_STATUS]
      : statusCode === LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS
        ? localHealthContract.responses[
            LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS
          ]
        : undefined;

  if (schema === undefined) {
    throw new LocalRestPayloadError(statusCode);
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new LocalRestPayloadError(statusCode);
  }

  return result.data;
}

export function parseLocalProofMutationResponse(
  statusCode: number,
  payload: unknown,
): LocalProofMutationSuccess | LocalSecurityDenial {
  if (statusCode === LOCAL_PROOF_MUTATION_SUCCESS_STATUS) {
    return parseContractResponse(
      statusCode,
      payload,
      localProofMutationSuccessSchema,
    );
  }
  if (isSecurityDenialStatus(statusCode)) {
    return parseContractResponse(
      statusCode,
      payload,
      localSecurityDenialSchema,
    );
  }
  throw new LocalRestPayloadError(statusCode);
}

export function parseLocalProofEvidenceResponse(
  statusCode: number,
  payload: unknown,
): LocalProofEvidenceSuccess | LocalSecurityDenial {
  if (statusCode === LOCAL_PROOF_EVIDENCE_SUCCESS_STATUS) {
    return parseContractResponse(
      statusCode,
      payload,
      localProofEvidenceSuccessSchema,
    );
  }
  if (isSecurityDenialStatus(statusCode)) {
    return parseContractResponse(
      statusCode,
      payload,
      localSecurityDenialSchema,
    );
  }
  throw new LocalRestPayloadError(statusCode);
}

function isSecurityDenialStatus(statusCode: number): boolean {
  return Object.hasOwn(localSecurityDenialResponses, statusCode);
}

function parseContractResponse<T>(
  statusCode: number,
  payload: unknown,
  schema: z.ZodType<T> | undefined,
): T {
  if (schema === undefined) {
    throw new LocalRestPayloadError(statusCode);
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new LocalRestPayloadError(statusCode);
  }
  return result.data;
}

function throwOnVersionMismatch(payload: unknown): void {
  if (!isRecord(payload)) {
    return;
  }

  const apiVersion = payload.apiVersion;
  const schemaVersion = payload.schemaVersion;
  if (typeof apiVersion !== "string" || typeof schemaVersion !== "string") {
    return;
  }

  if (
    apiVersion !== LOCAL_API_VERSION ||
    schemaVersion !== LOCAL_SCHEMA_VERSION
  ) {
    throw new LocalRestVersionMismatchError(apiVersion, schemaVersion);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
