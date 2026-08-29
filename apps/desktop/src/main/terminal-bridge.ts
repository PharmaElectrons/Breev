import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  localHealthDatabaseUnavailableSchema,
} from "@breev/contracts/local-rest";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  Agent,
  request as httpsRequest,
  type Agent as HttpsAgent,
} from "node:https";

import { createPairingServerIdentityChecker } from "./pairing-trust.js";
import type { TerminalDeviceBinding } from "./terminal-binding.js";

export const BRIDGE_TOKEN_HEADER = "x-breev-bridge-token" as const;
export const BRIDGE_APP_ORIGIN = "breev://app" as const;

const BRIDGE_BODY_LIMIT_BYTES = 256 * 1024;
const BRIDGE_UPSTREAM_TIMEOUT_MS = 10_000;
const ALLOWED_METHODS = ["DELETE", "GET", "PATCH", "POST", "PUT"] as const;
const ALLOWED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  BRIDGE_TOKEN_HEADER,
  BREEV_CSRF_HEADER.toLowerCase(),
] as const;

/**
 * Headers a caller must never be able to choose. The bridge speaks for this
 * device, so it sets the device identity, the origin, and the cross-site token
 * itself and drops anything the renderer tried to supply for them.
 */
const REJECTED_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "cookie",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  BREEV_CSRF_HEADER.toLowerCase(),
  BRIDGE_TOKEN_HEADER,
]);

const REJECTED_RESPONSE_HEADERS = new Set([
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
]);

export interface BridgeUpstream {
  readonly agent: HttpsAgent;
  readonly host: string;
  readonly port: number;
}

export interface TerminalBridge {
  readonly close: () => Promise<void>;
  readonly origin: string;
  readonly setUpstream: (upstream: BridgeUpstream | undefined) => void;
  readonly token: string;
}

export type BridgeAuthorization =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: string;
      readonly status: number;
    };

/**
 * The renderer proves it is the renderer with a token this process generates
 * per boot and injects through the session, exactly as the Main installation
 * injects its device credentials. Anything else on loopback is denied.
 */
export function authorizeBridgeRequest(params: {
  readonly expectedAuthority: string;
  readonly expectedOrigin: string;
  readonly headers: IncomingHttpHeaders;
  readonly method: string | undefined;
  readonly token: string;
}): BridgeAuthorization {
  if (
    params.method === undefined ||
    !(ALLOWED_METHODS as readonly string[]).includes(params.method)
  ) {
    return { allowed: false, reason: "method-not-allowed", status: 405 };
  }
  if (params.headers.host !== params.expectedAuthority) {
    return { allowed: false, reason: "host-mismatch", status: 403 };
  }
  const origin = params.headers.origin;
  if (origin !== undefined && origin !== params.expectedOrigin) {
    return { allowed: false, reason: "origin-mismatch", status: 403 };
  }
  const presented = params.headers[BRIDGE_TOKEN_HEADER];
  if (typeof presented !== "string" || !matchesToken(presented, params.token)) {
    return { allowed: false, reason: "token-invalid", status: 403 };
  }
  return { allowed: true };
}

export function buildUpstreamHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase();
    if (
      REJECTED_REQUEST_HEADERS.has(lowered) ||
      lowered.startsWith("proxy-") ||
      lowered.startsWith("x-forwarded-") ||
      lowered.startsWith("x-breev-device") ||
      value === undefined
    ) {
      continue;
    }
    forwarded[lowered] = Array.isArray(value) ? value.join(", ") : value;
  }
  forwarded.origin = BRIDGE_APP_ORIGIN;
  forwarded[BREEV_CSRF_HEADER.toLowerCase()] = BREEV_CSRF_VALUE;
  return forwarded;
}

export function buildDownstreamHeaders(
  headers: IncomingHttpHeaders,
  allowedOrigin: string,
): Record<string, string> {
  const returned: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase();
    if (REJECTED_RESPONSE_HEADERS.has(lowered) || value === undefined) {
      continue;
    }
    returned[lowered] = Array.isArray(value) ? value.join(", ") : value;
  }
  return { ...returned, ...corsHeaders(allowedOrigin) };
}

/**
 * A terminal that cannot reach its Main installation is blocked, not broken.
 * Reporting the loss as the health state the shell already understands keeps
 * the renderer on the documented 'Main unavailable' screen and lets it
 * recover on its own once the LAN returns.
 */
export function mainUnavailableBody(path: string): {
  readonly body: string;
  readonly contentType: string;
} {
  if (path.split("?")[0] === "/health") {
    return {
      body: JSON.stringify(
        localHealthDatabaseUnavailableSchema.parse({
          apiVersion: LOCAL_API_VERSION,
          database: "unavailable",
          schemaVersion: LOCAL_SCHEMA_VERSION,
          status: "degraded",
        }),
      ),
      contentType: "application/json",
    };
  }
  return {
    body: JSON.stringify({ error: "main-unavailable" }),
    contentType: "application/json",
  };
}

/**
 * The trust store holds exactly the pinned pharmacy authority, and the client
 * certificate is this terminal's own. Node therefore verifies the chain, and
 * the identity check adds the pin and installation name it cannot know.
 */
export function createUpstreamAgent(params: {
  readonly binding: TerminalDeviceBinding;
  readonly privateKeyPem: string;
}): HttpsAgent {
  return new Agent({
    ca: params.binding.caCertificatePem,
    cert: params.binding.certificatePem,
    checkServerIdentity: createPairingServerIdentityChecker({
      caFingerprint: params.binding.caFingerprint,
      installationId: params.binding.installationId,
    }),
    key: params.privateKeyPem,
    keepAlive: true,
    maxSockets: 8,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
  });
}

export async function startTerminalBridge(options: {
  readonly allowedOrigin: string;
  readonly upstream?: BridgeUpstream | undefined;
}): Promise<TerminalBridge> {
  const token = randomBytes(32).toString("base64url");
  let upstream = options.upstream;

  const server = createServer((request, response) => {
    handleBridgeRequest(request, response, {
      allowedOrigin: options.allowedOrigin,
      authority: authorityOf(server),
      token,
      upstream,
    });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
    origin: `http://${authorityOf(server)}`,
    setUpstream: (next) => {
      upstream = next;
    },
    token,
  };
}

function handleBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    readonly allowedOrigin: string;
    readonly authority: string;
    readonly token: string;
    readonly upstream: BridgeUpstream | undefined;
  },
): void {
  const path = request.url ?? "/";

  if (request.method === "OPTIONS") {
    // A preflight discloses policy only. The request it precedes still has to
    // carry the per-boot token.
    request.resume();
    if (request.headers.origin !== context.allowedOrigin) {
      response.writeHead(403).end();
      return;
    }
    response
      .writeHead(204, {
        ...corsHeaders(context.allowedOrigin),
        "Access-Control-Max-Age": "600",
      })
      .end();
    return;
  }

  const authorization = authorizeBridgeRequest({
    expectedAuthority: context.authority,
    expectedOrigin: context.allowedOrigin,
    headers: request.headers,
    method: request.method,
    token: context.token,
  });
  if (!authorization.allowed) {
    request.resume();
    respondDenied(
      response,
      authorization.status,
      authorization.reason,
      context.allowedOrigin,
    );
    return;
  }

  readBody(request, (error, body) => {
    if (error !== undefined) {
      respondDenied(response, 413, "body-too-large", context.allowedOrigin);
      return;
    }
    if (context.upstream === undefined) {
      respondMainUnavailable(response, path, context.allowedOrigin);
      return;
    }
    forwardUpstream(response, {
      allowedOrigin: context.allowedOrigin,
      body: body ?? Buffer.alloc(0),
      headers: request.headers,
      method: request.method ?? "GET",
      path,
      upstream: context.upstream,
    });
  });
}

function forwardUpstream(
  response: ServerResponse,
  context: {
    readonly allowedOrigin: string;
    readonly body: Buffer;
    readonly headers: IncomingHttpHeaders;
    readonly method: string;
    readonly path: string;
    readonly upstream: BridgeUpstream;
  },
): void {
  const headers = buildUpstreamHeaders(context.headers);
  headers["content-length"] = String(context.body.byteLength);

  const upstreamRequest = httpsRequest(
    {
      agent: context.upstream.agent,
      headers,
      host: context.upstream.host,
      method: context.method,
      path: context.path,
      port: context.upstream.port,
      timeout: BRIDGE_UPSTREAM_TIMEOUT_MS,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        buildDownstreamHeaders(upstreamResponse.headers, context.allowedOrigin),
      );
      upstreamResponse.pipe(response);
    },
  );

  const failUnavailable = (): void => {
    upstreamRequest.destroy();
    if (!response.headersSent) {
      respondMainUnavailable(response, context.path, context.allowedOrigin);
    } else {
      response.destroy();
    }
  };
  upstreamRequest.on("error", failUnavailable);
  upstreamRequest.on("timeout", failUnavailable);
  upstreamRequest.end(context.body);
}

function readBody(
  request: IncomingMessage,
  done: (error: Error | undefined, body: Buffer | undefined) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;
  const settle = (error: Error | undefined, body: Buffer | undefined): void => {
    if (!settled) {
      settled = true;
      done(error, body);
    }
  };

  request.on("data", (chunk: Buffer) => {
    size += chunk.byteLength;
    if (size > BRIDGE_BODY_LIMIT_BYTES) {
      request.destroy();
      settle(new Error("body-too-large"), undefined);
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => settle(undefined, Buffer.concat(chunks)));
  request.on("error", (error) => settle(error, undefined));
}

function respondMainUnavailable(
  response: ServerResponse,
  path: string,
  allowedOrigin: string,
): void {
  const payload = mainUnavailableBody(path);
  response
    .writeHead(503, {
      ...corsHeaders(allowedOrigin),
      "Cache-Control": "no-store",
      "Content-Type": payload.contentType,
    })
    .end(payload.body);
}

function respondDenied(
  response: ServerResponse,
  status: number,
  reason: string,
  allowedOrigin: string,
): void {
  response
    .writeHead(status, {
      ...corsHeaders(allowedOrigin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    })
    .end(JSON.stringify({ error: reason }));
}

function corsHeaders(allowedOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Headers": ALLOWED_REQUEST_HEADERS.join(", "),
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  };
}

function authorityOf(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The Breev terminal bridge is not listening on a port");
  }
  return `127.0.0.1:${address.port}`;
}

function matchesToken(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    presentedBytes.length === expectedBytes.length &&
    timingSafeEqual(presentedBytes, expectedBytes)
  );
}
