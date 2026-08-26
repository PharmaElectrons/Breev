/**
 * mTLS verification middleware for LAN terminal connections.
 *
 * Runs on every request from the LAN HTTPS listener. Checks the client
 * certificate chain, role, installation identity, validity window, and
 * per-request revocation (even on resumed TLS sessions / keep-alive
 * connections, per domain.md §Identity L70).
 *
 * Denial records follow the same pattern as main-device-security.service.ts:
 * typed code, UUIDv7 correlation ID, and incremented denial total.
 */

import type { LocalSecurityDenialCode } from "@breev/contracts/local-rest";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { TLSSocket } from "node:tls";

import { MainDeviceSecurityService } from "../main-device/main-device-security.service.js";
import type { PharmacyCaService } from "./pharmacy-ca.service.js";

export function createMtlsVerificationMiddleware(params: {
  readonly pharmacyCa: PharmacyCaService;
  readonly security: MainDeviceSecurityService;
}): RequestHandler {
  return (request, response, next) => {
    void verifyMtls(request, response, next, params).catch(next);
  };
}

async function verifyMtls(
  request: Request,
  response: Response,
  next: NextFunction,
  params: {
    pharmacyCa: PharmacyCaService;
    security: MainDeviceSecurityService;
  },
): Promise<void> {
  const { pharmacyCa, security } = params;

  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  const socket = request.socket as TLSSocket;
  const peerCert = socket.getPeerCertificate?.(true);

  if (!peerCert || !peerCert.raw || Object.keys(peerCert).length === 0) {
    await recordAndDeny(
      response,
      security,
      "mtls-cert-missing",
      401,
      undefined,
    );
    return;
  }

  const validation = pharmacyCa.validateCertificate(
    Buffer.from(peerCert.raw),
    "device",
  );

  if (!validation.valid) {
    await recordAndDeny(
      response,
      security,
      validation.denialCode,
      403,
      undefined,
    );
    return;
  }

  if (validation.deviceId === undefined) {
    await recordAndDeny(
      response,
      security,
      "mtls-cert-invalid",
      403,
      undefined,
    );
    return;
  }

  const revocation = await pharmacyCa.checkDeviceRevocation(
    validation.deviceId,
    validation.fingerprint,
  );
  if (revocation.revoked) {
    await recordAndDeny(
      response,
      security,
      "device-revoked",
      403,
      validation.deviceId,
    );
    return;
  }

  (request as unknown as Record<string, unknown>)["breevMtlsDeviceId"] =
    validation.deviceId;
  next();
}

async function recordAndDeny(
  response: Response,
  security: MainDeviceSecurityService,
  code: LocalSecurityDenialCode,
  statusCode: number,
  deviceId: string | undefined,
): Promise<void> {
  const denial = await security.recordDenial(
    code,
    "other-state-change",
    deviceId !== undefined ? "verified" : "missing",
    undefined,
    deviceId,
  );
  response.status(statusCode).json(denial);
}
