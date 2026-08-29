import {
  pairingCaCertificateContract,
  pairingCertificateContract,
  pairingCertificateRequestSchema,
  pairingChannelStateContract,
  pairingJoinContract,
  pairingJoinRequestSchema,
} from "@breev/contracts/local-rest";
import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import { createUuidV7 } from "../pharmacy-ca/pharmacy-ca-crypto.js";
import { DevicesDenied } from "./devices-audit.js";
import { DevicesService } from "./devices.service.js";

/**
 * The pairing channel: the only routes on the LAN listener that a caller can
 * reach without a client certificate.
 *
 * A terminal that has never been paired has no certificate, so the ceremony
 * cannot live behind mTLS. Everything about this handler is therefore written
 * as an exception that stays small: an exact method-and-path allowlist, an
 * 8 KiB body cap, per-address and per-session rate limits, and no route that
 * changes anything except the pairing session it names. Anything else — a path
 * that merely starts with `/pairing/`, a different method, a body that does not
 * parse — falls through to the mTLS boundary and is refused there.
 */
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_ADDRESS = 600;
/**
 * Two budgets, because the two kinds of request are nothing alike.
 *
 * Reading a session's state is what the terminal does while a human walks to
 * the Main and compares twelve digits, so its allowance has real headroom above
 * the polling the client actually performs over the session's five minutes.
 * Claiming a session and collecting a certificate are the attempts that matter,
 * and they keep the strict shared allowance: the session's own attempt counter
 * is the real limit, and this only bounds how fast it can be spent.
 */
const MAX_STATE_POLLS_PER_SESSION = 90;
const MAX_CLAIMS_PER_SESSION = 30;
const MAX_TRACKED_KEYS = 1_024;

const SESSION_ID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CHANNEL_STATE_PATH = new RegExp(
  `^/pairing/sessions/(${SESSION_ID_PATTERN})/state$`,
  "u",
);

interface AllowedRoute {
  readonly method: string;
  readonly path: RegExp;
}

const ALLOWED_ROUTES: readonly AllowedRoute[] = [
  {
    method: pairingCaCertificateContract.method,
    path: /^\/pairing\/ca-certificate$/u,
  },
  { method: pairingJoinContract.method, path: /^\/pairing\/joins$/u },
  { method: pairingChannelStateContract.method, path: CHANNEL_STATE_PATH },
  {
    method: pairingCertificateContract.method,
    path: /^\/pairing\/certificates$/u,
  },
];

export function createPairingChannelHandler(
  devices: DevicesService,
): RequestHandler {
  const limiter = createFixedWindowLimiter();
  const parseJson = express.json({
    limit: MAX_BODY_BYTES,
    strict: true,
    type: "application/json",
  });

  return (request, response, next) => {
    if (!isAllowedRoute(request)) {
      next();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (
      !limiter.consume(
        `address:${request.socket.remoteAddress ?? ""}`,
        MAX_REQUESTS_PER_ADDRESS,
      )
    ) {
      // Refused without writing anything down. This limiter runs ahead of any
      // authentication, so a caller must never be able to make Breev append a
      // row per request; a denial that names a session is audited instead,
      // because the session's own budget bounds it.
      denyWithoutRecord(response, 429, "rate-limit-exceeded");
      return;
    }
    if (request.method === "GET") {
      void handle(devices, request, response, limiter).catch(next);
      return;
    }
    parseJson(request, response, (error: unknown) => {
      if (error !== undefined && error !== null) {
        denyWithoutRecord(response, 400, "body-invalid");
        return;
      }
      void handle(devices, request, response, limiter).catch(next);
    });
  };
}

async function handle(
  devices: DevicesService,
  request: Request,
  response: Response,
  limiter: FixedWindowLimiter,
): Promise<void> {
  try {
    if (
      request.method === "GET" &&
      request.path === "/pairing/ca-certificate"
    ) {
      response.status(200).json(await devices.caCertificate());
      return;
    }
    const stateMatch = CHANNEL_STATE_PATH.exec(request.path);
    if (request.method === "GET" && stateMatch?.[1] !== undefined) {
      const sessionId = stateMatch[1];
      if (
        !requireSessionBudget(
          response,
          limiter,
          `state:${sessionId}`,
          MAX_STATE_POLLS_PER_SESSION,
        )
      ) {
        return;
      }
      response.status(200).json(await devices.channelState(sessionId));
      return;
    }
    if (request.method === "POST" && request.path === "/pairing/joins") {
      const input = pairingJoinRequestSchema.safeParse(request.body);
      if (!input.success) {
        denyWithoutRecord(response, 400, "body-invalid");
        return;
      }
      if (
        !requireSessionBudget(
          response,
          limiter,
          `claim:${input.data.sessionId}`,
          MAX_CLAIMS_PER_SESSION,
        )
      ) {
        return;
      }
      response.status(200).json(await devices.join(input.data));
      return;
    }
    if (request.method === "POST" && request.path === "/pairing/certificates") {
      const input = pairingCertificateRequestSchema.safeParse(request.body);
      if (!input.success) {
        denyWithoutRecord(response, 400, "body-invalid");
        return;
      }
      if (
        !requireSessionBudget(
          response,
          limiter,
          `claim:${input.data.sessionId}`,
          MAX_CLAIMS_PER_SESSION,
        )
      ) {
        return;
      }
      response.status(200).json(await devices.certificate(input.data));
      return;
    }
    denyWithoutRecord(response, 400, "body-invalid");
  } catch (error) {
    if (!(error instanceof DevicesDenied)) {
      throw error;
    }
    response.status(error.statusCode).json(error.denial);
  }
}

function requireSessionBudget(
  response: Response,
  limiter: FixedWindowLimiter,
  key: string,
  limit: number,
): boolean {
  if (!limiter.consume(key, limit)) {
    // Refused without writing anything down, like the address limit above: an
    // over-budget caller is unauthenticated by definition, so it must not be
    // able to make Breev append one audit row per request. Denials that reach
    // the session itself stay audited and are bounded by this budget.
    denyWithoutRecord(response, 429, "rate-limit-exceeded");
    return false;
  }
  return true;
}

/**
 * A refusal that leaves no row behind. The correlation identifier is still a
 * UUIDv7 so the envelope is the one every Breev denial uses, and the operator
 * can quote it, but nothing about an unauthenticated caller is persisted.
 */
function denyWithoutRecord(
  response: Response,
  statusCode: number,
  code: "body-invalid" | "rate-limit-exceeded",
): void {
  response
    .status(statusCode)
    .json({ code, requestId: createUuidV7(), status: "denied" });
}

function isAllowedRoute(request: Request): boolean {
  return ALLOWED_ROUTES.some(
    (route) => route.method === request.method && route.path.test(request.path),
  );
}

interface FixedWindowLimiter {
  readonly consume: (key: string, limit: number) => boolean;
}

/**
 * A bounded in-memory window. It is deliberately not backed by the database:
 * this runs ahead of any authentication, so an attacker must not be able to
 * make Breev write a row per request. Exhausting the table is itself refused,
 * which fails closed.
 */
function createFixedWindowLimiter(): FixedWindowLimiter {
  const counters = new Map<string, { count: number; windowStart: number }>();
  return {
    consume(key: string, limit: number): boolean {
      const now = Date.now();
      for (const [candidate, value] of counters) {
        if (now - value.windowStart >= RATE_WINDOW_MS) {
          counters.delete(candidate);
        }
      }
      const existing = counters.get(key);
      if (existing === undefined) {
        if (counters.size >= MAX_TRACKED_KEYS) {
          return false;
        }
        counters.set(key, { count: 1, windowStart: now });
        return true;
      }
      existing.count += 1;
      return existing.count <= limit;
    },
  };
}
