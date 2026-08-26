import express, { type RequestHandler } from "express";
import https from "node:https";

import type { MainDeviceSecurityService } from "../main-device/main-device-security.service.js";
import { createMtlsVerificationMiddleware } from "./mtls-verification.middleware.js";
import type { PharmacyCaService } from "./pharmacy-ca.service.js";

export async function createLanMtlsServer(params: {
  readonly apiHandler: RequestHandler;
  readonly host: string;
  readonly pharmacyCa: PharmacyCaService;
  readonly security: MainDeviceSecurityService;
}): Promise<https.Server> {
  await params.pharmacyCa.initializeCA();
  const credentials = await params.pharmacyCa.issueServerCertificate([
    params.host,
  ]);
  const lanApp = express();
  lanApp.use(
    createMtlsVerificationMiddleware({
      pharmacyCa: params.pharmacyCa,
      security: params.security,
    }),
  );
  lanApp.use(params.apiHandler);

  return https.createServer(
    {
      ca: [credentials.caCertPem],
      cert: credentials.certPem,
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
}
