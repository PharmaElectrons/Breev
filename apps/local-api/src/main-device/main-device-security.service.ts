import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  localProofEvidenceSuccessSchema,
  localProofMutationContract,
  localProofMutationSuccessSchema,
  localSecurityDenialSchema,
  type LocalProofEvidenceSuccess,
  type LocalProofMutationSuccess,
  type LocalSecurityDenial,
  type LocalSecurityDenialCode,
} from "@breev/contracts/local-rest";
import { HttpException, Injectable } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";

import { LocalDatabaseService } from "../local-database.service.js";
import {
  hashMainDeviceSecret,
  isHighEntropyMainDeviceSecret,
  isUuidV7,
} from "./main-device-binding.js";

const PACKAGED_RENDERER_ORIGIN = "breev://app";
const DEVICE_AUTHORIZATION_PREFIX = "Breev-Device ";
const MAX_REQUEST_BYTES = 8 * 1024;
const STATE_CHANGING_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

type BindingResult =
  | {
      readonly status:
        "binding-invalid" | "binding-missing" | "session-binding-invalid";
    }
  | { readonly deviceId: string; readonly status: "verified" };
type DeviceContext = "missing" | "present" | "verified";
type RequestClass = "cors-preflight" | "other-state-change" | "proof-mutation";

@Injectable()
export class MainDeviceSecurityService {
  private readonly verifiedDeviceIds = new WeakMap<Request, string>();
  private readonly rateLimit = readPositiveInteger(
    process.env.BREEV_PROOF_RATE_LIMIT,
    5,
    "BREEV_PROOF_RATE_LIMIT",
  );
  private readonly rateWindowSeconds = readPositiveInteger(
    process.env.BREEV_PROOF_RATE_WINDOW_SECONDS,
    60,
    "BREEV_PROOF_RATE_WINDOW_SECONDS",
  );

  public constructor(private readonly localDatabase: LocalDatabaseService) {}

  public async verifyBinding(request: Request): Promise<BindingResult> {
    const deviceId = request.get(LOCAL_DEVICE_ID_HEADER);
    const sessionToken = request.get(LOCAL_DEVICE_SESSION_HEADER);
    const authorization = request.get("authorization");
    if (
      deviceId === undefined ||
      sessionToken === undefined ||
      authorization === undefined
    ) {
      return { status: "binding-missing" };
    }
    if (
      !isUuidV7(deviceId) ||
      !isHighEntropyMainDeviceSecret(sessionToken) ||
      !authorization.startsWith(DEVICE_AUTHORIZATION_PREFIX)
    ) {
      return { status: "binding-invalid" };
    }
    const deviceSecret = authorization.slice(
      DEVICE_AUTHORIZATION_PREFIX.length,
    );
    if (!isHighEntropyMainDeviceSecret(deviceSecret)) {
      return { status: "binding-invalid" };
    }

    const pool = this.localDatabase.requirePool();
    const device = await pool.query<{ credential_hash: Buffer }>(
      "select credential_hash from main_devices where id = $1",
      [deviceId],
    );
    const storedHash = device.rows[0]?.credential_hash;
    const presentedHash = hashMainDeviceSecret(deviceSecret);
    if (
      storedHash === undefined ||
      storedHash.length !== presentedHash.length ||
      !timingSafeEqual(storedHash, presentedHash)
    ) {
      return { status: "binding-invalid" };
    }

    const session = await pool.query(
      `select 1
       from main_device_sessions
       where token_hash = $1 and device_id = $2`,
      [hashMainDeviceSecret(sessionToken), deviceId],
    );
    if (session.rowCount !== 1) {
      return { status: "session-binding-invalid" };
    }
    this.verifiedDeviceIds.set(request, deviceId);
    return { deviceId, status: "verified" };
  }

  public verifiedDeviceId(request: Request): string | undefined {
    return this.verifiedDeviceIds.get(request);
  }

  public async consumeRate(deviceId: string): Promise<boolean> {
    const result = await this.localDatabase.requirePool().query<{
      request_count: number;
    }>(
      `with clock as (
         select floor(extract(epoch from statement_timestamp()) / $2)::bigint
           as window_number
       ), pruned as (
         delete from main_device_rate_windows
         where device_id = $1
           and action = 'proof-mutation'
           and window_number < (select window_number from clock)
       ), counted as (
         insert into main_device_rate_windows
           (device_id, action, window_number, request_count)
         select $1, 'proof-mutation', window_number, 1
         from clock
         on conflict (device_id, action, window_number) do update
         set request_count = main_device_rate_windows.request_count + 1
         returning request_count
       )
       select request_count from counted`,
      [deviceId, this.rateWindowSeconds],
    );
    return (
      (result.rows[0]?.request_count ?? this.rateLimit + 1) <= this.rateLimit
    );
  }

  public get retryAfterSeconds(): number {
    return this.rateWindowSeconds;
  }

  public async mutate(): Promise<LocalProofMutationSuccess> {
    const result = await this.localDatabase.requirePool().query<{
      mutation_count: string;
    }>(
      `update main_device_proof_state
       set mutation_count = mutation_count + 1
       where singleton = true
       returning mutation_count::text`,
    );
    return localProofMutationSuccessSchema.parse({
      status: "committed",
      mutationCount: result.rows[0]?.mutation_count,
    });
  }

  public async evidence(): Promise<LocalProofEvidenceSuccess> {
    const pool = this.localDatabase.requirePool();
    const result = await pool.query<{ mutation_count: string }>(
      `select mutation_count::text
       from main_device_proof_state
       where singleton = true`,
    );
    const denials = await pool.query<{
      code: LocalSecurityDenialCode;
      count: string;
    }>(
      `select code, denial_count::text as count
       from main_device_denial_totals
      order by code`,
    );
    const recentDenials = await pool.query<{ count: string }>(
      "select count(*)::text as count from main_device_recent_denials",
    );
    return localProofEvidenceSuccessSchema.parse({
      mutationCount: result.rows[0]?.mutation_count,
      recentDenialCount: recentDenials.rows[0]?.count,
      denials: denials.rows,
    });
  }

  public async recordDenial(
    code: LocalSecurityDenialCode,
    requestClass: RequestClass,
    deviceContext: DeviceContext,
    deviceId?: string,
  ): Promise<LocalSecurityDenial> {
    const client = await this.localDatabase.requirePool().connect();
    let requestId = "";
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(165308856)");
      const denial = await client.query<{ id: string }>(
        `insert into main_device_recent_denials
           (code, request_class, device_context, device_id)
         values ($1, $2, $3, $4)
         returning id`,
        [code, requestClass, deviceContext, deviceId ?? null],
      );
      requestId = denial.rows[0]?.id ?? "";
      await client.query(
        `insert into main_device_denial_totals
           (code, denial_count, last_denied_at)
         values ($1, 1, statement_timestamp())
         on conflict (code) do update
         set denial_count = main_device_denial_totals.denial_count + 1,
             last_denied_at = excluded.last_denied_at`,
        [code],
      );
      await client.query(
        `delete from main_device_recent_denials
         where id in (
           select id
           from main_device_recent_denials
           order by denied_at desc, id desc
           offset 256
         )`,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return localSecurityDenialSchema.parse({
      status: "denied",
      code,
      requestId,
    });
  }

  public async deny(
    code: LocalSecurityDenialCode,
    statusCode: number,
    requestClass: RequestClass = "proof-mutation",
    deviceContext: DeviceContext = "present",
    deviceId?: string,
  ): Promise<never> {
    const denial = await this.recordDenial(
      code,
      requestClass,
      deviceContext,
      deviceId,
    );
    throw new HttpException(denial, statusCode);
  }
}

export function createMainRequestSecurityMiddleware({
  expectedHost,
  security,
}: {
  readonly expectedHost: string;
  readonly security: MainDeviceSecurityService;
}): RequestHandler {
  return (request, response, next) => {
    void protectRequest(request, response, next, expectedHost, security).catch(
      next,
    );
  };
}

export function createMainRequestBodyErrorMiddleware(
  security: MainDeviceSecurityService,
): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    const errorType = readErrorType(error);
    const denial =
      errorType === "entity.too.large"
        ? { code: "request-too-large" as const, statusCode: 413 }
        : errorType === "entity.parse.failed"
          ? { code: "body-invalid" as const, statusCode: 400 }
          : undefined;
    if (denial === undefined) {
      next(error);
      return;
    }

    void sendDenial(
      response,
      security,
      denial.statusCode,
      denial.code,
      classifyRequest(request),
      "verified",
      security.verifiedDeviceId(request),
    ).catch(next);
  };
}

async function protectRequest(
  request: Request,
  response: Response,
  next: NextFunction,
  expectedHost: string,
  security: MainDeviceSecurityService,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  const requestClass = classifyRequest(request);
  if (!hasExactHost(request, expectedHost)) {
    await sendDenial(
      response,
      security,
      421,
      "host-not-allowed",
      requestClass,
      "missing",
    );
    return;
  }

  const stateChanging = STATE_CHANGING_METHODS.has(request.method);
  const protectedRead =
    request.method === "GET" &&
    request.path === localProofMutationContract.path;
  const origin = request.get("origin");
  if (origin !== undefined && origin !== PACKAGED_RENDERER_ORIGIN) {
    await sendDenial(
      response,
      security,
      403,
      "origin-not-allowed",
      requestClass,
      "missing",
    );
    return;
  }
  if (origin === PACKAGED_RENDERER_ORIGIN) {
    setExactCorsHeaders(response);
  }
  if (stateChanging || protectedRead || request.method === "OPTIONS") {
    if (origin !== PACKAGED_RENDERER_ORIGIN) {
      await sendDenial(
        response,
        security,
        403,
        "origin-not-allowed",
        requestClass,
        "missing",
      );
      return;
    }
  }

  if (request.method === "OPTIONS") {
    if (!isExactProofPreflight(request)) {
      response.removeHeader("Access-Control-Allow-Origin");
      await sendDenial(
        response,
        security,
        403,
        "cors-preflight-not-allowed",
        "cors-preflight",
        "missing",
      );
      return;
    }
    response.setHeader("Access-Control-Allow-Methods", "POST");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Breev-CSRF",
    );
    response.status(204).end();
    return;
  }

  if (!stateChanging && !protectedRead) {
    next();
    return;
  }
  const contentLength = request.get("content-length");
  if (
    contentLength !== undefined &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    await sendDenial(
      response,
      security,
      413,
      "request-too-large",
      requestClass,
      "present",
    );
    return;
  }
  if (stateChanging && request.get("content-type") !== "application/json") {
    await sendDenial(
      response,
      security,
      415,
      "content-type-not-allowed",
      requestClass,
      "present",
    );
    return;
  }
  if (stateChanging && request.get(BREEV_CSRF_HEADER) !== BREEV_CSRF_VALUE) {
    await sendDenial(
      response,
      security,
      403,
      "csrf-header-missing",
      requestClass,
      "present",
    );
    return;
  }

  const binding = await security.verifyBinding(request);
  if (binding.status !== "verified") {
    await sendDenial(
      response,
      security,
      401,
      binding.status,
      requestClass,
      binding.status === "binding-missing" ? "missing" : "present",
    );
    return;
  }
  if (
    stateChanging &&
    request.path === localProofMutationContract.path &&
    !(await security.consumeRate(binding.deviceId))
  ) {
    response.setHeader("Retry-After", String(security.retryAfterSeconds));
    await sendDenial(
      response,
      security,
      429,
      "rate-limit-exceeded",
      requestClass,
      "verified",
      binding.deviceId,
    );
    return;
  }
  next();
}

async function sendDenial(
  response: Response,
  security: MainDeviceSecurityService,
  statusCode: number,
  code: LocalSecurityDenialCode,
  requestClass: RequestClass,
  deviceContext: DeviceContext,
  deviceId?: string,
): Promise<void> {
  const denial = await security.recordDenial(
    code,
    requestClass,
    deviceContext,
    deviceId,
  );
  response.status(statusCode).json(denial);
}

function hasExactHost(request: Request, expectedHost: string): boolean {
  const hostValues: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "host") {
      hostValues.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return hostValues.length === 1 && hostValues[0] === expectedHost;
}

function setExactCorsHeaders(response: Response): void {
  response.setHeader("Access-Control-Allow-Origin", PACKAGED_RENDERER_ORIGIN);
  response.setHeader("Vary", "Origin");
}

function isExactProofPreflight(request: Request): boolean {
  if (
    request.path !== localProofMutationContract.path ||
    request.get("access-control-request-method") !== "POST"
  ) {
    return false;
  }
  const requestedHeaders = request
    .get("access-control-request-headers")
    ?.split(",")
    .map((header) => header.trim().toLowerCase())
    .sort();
  return (
    requestedHeaders?.length === 2 &&
    requestedHeaders[0] === "content-type" &&
    requestedHeaders[1] === "x-breev-csrf"
  );
}

function classifyRequest(request: Request): RequestClass {
  if (request.method === "OPTIONS") {
    return "cors-preflight";
  }
  if (request.path === localProofMutationContract.path) {
    return "proof-mutation";
  }
  return "other-state-change";
}

function readPositiveInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3600) {
    throw new Error(`${name} must be an integer between 1 and 3600`);
  }
  return parsed;
}

function readErrorType(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) {
    return undefined;
  }
  return typeof error.type === "string" ? error.type : undefined;
}
