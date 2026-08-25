import { z } from "zod";

export const LOCAL_API_VERSION = "2" as const;
export const LOCAL_SCHEMA_VERSION = "1" as const;
export const LOCAL_HEALTH_SUCCESS_STATUS = 200 as const;
export const LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS = 503 as const;

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
