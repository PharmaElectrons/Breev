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

import { LocalDatabaseService } from "../local-database.service.js";
import type { PharmacyCaService } from "./pharmacy-ca.service.js";

export function createMtlsVerificationMiddleware(params: {
  readonly pharmacyCa: PharmacyCaService;
  readonly localDatabase: LocalDatabaseService;
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
    localDatabase: LocalDatabaseService;
  },
): Promise<void> {
  const { pharmacyCa, localDatabase } = params;

  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  const socket = request.socket as TLSSocket;
  const peerCert = socket.getPeerCertificate?.(true);

  if (!peerCert || !peerCert.raw || Object.keys(peerCert).length === 0) {
    await recordAndDeny(
      response,
      localDatabase,
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
      localDatabase,
      validation.denialCode,
      403,
      undefined,
    );
    return;
  }

  if (validation.deviceId === undefined) {
    await recordAndDeny(
      response,
      localDatabase,
      "mtls-cert-invalid",
      403,
      undefined,
    );
    return;
  }

  const revocation = await pharmacyCa.checkDeviceRevocation(
    validation.deviceId,
  );
  if (revocation.revoked) {
    await recordAndDeny(
      response,
      localDatabase,
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
  localDatabase: LocalDatabaseService,
  code: LocalSecurityDenialCode,
  statusCode: number,
  deviceId: string | undefined,
): Promise<void> {
  const pool = localDatabase.requirePool();

  const client = await pool.connect();
  let requestId = "";
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(165308856)");
    const denial = await client.query<{ id: string }>(
      `insert into main_device_recent_denials
         (code, request_class, device_context, device_id)
       values ($1, 'other-state-change', $2, $3)
       returning id`,
      [code, deviceId !== undefined ? "verified" : "missing", deviceId ?? null],
    );
    requestId = denial.rows[0]?.id ?? "";
    await client.query(
      `insert into main_device_denial_totals
         (code, denial_count, last_denied_at)
       values ($1, 1, statement_timestamp())
       on conflict (code) do update
         set denial_count    = main_device_denial_totals.denial_count + 1,
             last_denied_at  = excluded.last_denied_at`,
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

  response.status(statusCode).json({
    status: "denied",
    code,
    requestId,
  });
}
