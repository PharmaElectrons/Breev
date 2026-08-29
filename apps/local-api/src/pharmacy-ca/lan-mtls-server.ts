import express, { type RequestHandler } from "express";
import https from "node:https";

import {
  markLanRequest,
  type MainDeviceSecurityService,
} from "../main-device/main-device-security.service.js";
import { createMtlsVerificationMiddleware } from "./mtls-verification.middleware.js";
import {
  createTerminalSocketRegistry,
  type TerminalSocketRegistry,
} from "./terminal-socket-registry.js";
import type { PharmacyCaService } from "./pharmacy-ca.service.js";

export interface LanMtlsServer {
  readonly registry: TerminalSocketRegistry;
  readonly server: https.Server;
}

/**
 * The LAN listener.
 *
 * Request order is the security order. A quarantined dataset answers nothing.
 * The pairing channel — and only the exact pairing routes — is reachable
 * before the mTLS boundary, because a terminal that has no certificate yet is
 * the caller it exists for. Everything else must present a client certificate
 * that verifies, names a live device, and passes the per-request revocation
 * check.
 */
export async function createLanMtlsServer(params: {
  readonly apiHandler: RequestHandler;
  readonly host: string;
  readonly pairingHandler?: RequestHandler | undefined;
  readonly pharmacyCa: PharmacyCaService;
  readonly quarantineHandler?: RequestHandler | undefined;
  readonly security: MainDeviceSecurityService;
}): Promise<LanMtlsServer> {
  await params.pharmacyCa.initializeCA();
  const credentials = await params.pharmacyCa.issueServerCertificate([
    params.host,
  ]);
  const registry = createTerminalSocketRegistry();
  const lanApp = express();
  // Marked first, before anything can answer: the request boundary accepts the
  // LAN authority as a Host only for requests that actually arrived here.
  lanApp.use((request, _response, next) => {
    markLanRequest(request);
    next();
  });
  if (params.quarantineHandler !== undefined) {
    lanApp.use(params.quarantineHandler);
  }
  if (params.pairingHandler !== undefined) {
    lanApp.use(params.pairingHandler);
  }
  lanApp.use(
    createMtlsVerificationMiddleware({
      pharmacyCa: params.pharmacyCa,
      registry,
      security: params.security,
    }),
  );
  lanApp.use(params.apiHandler);

  const server = https.createServer(
    {
      ca: [credentials.caCertPem],
      // The leaf is served with its issuer so a terminal that has only the CA
      // fingerprint from the QR can build and check the chain before it sends
      // anything at all.
      cert: `${credentials.certPem}\n${credentials.caCertPem}`,
      ciphers: [
        "TLS_AES_256_GCM_SHA384",
        "TLS_AES_128_GCM_SHA256",
        "TLS_CHACHA20_POLY1305_SHA256",
      ].join(":"),
      honorCipherOrder: true,
      key: credentials.privateKeyPem,
      maxVersion: "TLSv1.3",
      minVersion: "TLSv1.3",
      rejectUnauthorized: false,
      requestCert: true,
    },
    lanApp,
  );
  server.once("close", () => {
    registry.destroyAll();
  });

  return { registry, server };
}
