import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { json, type RequestHandler } from "express";
import type { Server } from "node:https";
import { isIP } from "node:net";

import { AppModule } from "./app.module.js";
import { LocalDatabaseService } from "./local-database.service.js";
import {
  createMainRequestBodyErrorMiddleware,
  createMainRequestSecurityMiddleware,
  MainDeviceSecurityService,
} from "./main-device/main-device-security.service.js";
import { createLanMtlsServer } from "./pharmacy-ca/lan-mtls-server.js";
import { PharmacyCaService } from "./pharmacy-ca/pharmacy-ca.service.js";
import { createRestoreQuarantineMiddleware } from "./recovery/quarantine.middleware.js";
import { RestoreQuarantineService } from "./recovery/restore-quarantine.service.js";

const DEFAULT_API_PORT = 31_310;

async function bootstrap(): Promise<void> {
  const port = readPort(process.env.API_PORT);
  const host = process.env.API_HOST ?? "127.0.0.1";
  const lanEndpoint = readLanEndpoint();
  if (host !== "127.0.0.1") {
    throw new Error("The Main local API proof must bind to 127.0.0.1");
  }
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  app.enableShutdownHooks();
  const mainDeviceSecurity = app.get(MainDeviceSecurityService);
  app.use(
    createMainRequestSecurityMiddleware({
      additionalExpectedHosts:
        lanEndpoint === undefined
          ? []
          : [`${lanEndpoint.host}:${lanEndpoint.port}`],
      expectedHost: `${host}:${port}`,
      security: mainDeviceSecurity,
    }),
  );
  app.use(json({ limit: 8 * 1024, strict: true, type: "application/json" }));
  app.use(createMainRequestBodyErrorMiddleware(mainDeviceSecurity));
  app.use(
    createRestoreQuarantineMiddleware({
      getPool: () => {
        try {
          return app.get(LocalDatabaseService).requirePool();
        } catch {
          return undefined;
        }
      },
      quarantineService: app.get(RestoreQuarantineService),
    }),
  );

  let lanServer: Server | undefined;
  try {
    await app.listen(port, host);
    if (lanEndpoint !== undefined) {
      lanServer = await createLanMtlsServer({
        apiHandler: app.getHttpAdapter().getInstance() as RequestHandler,
        host: lanEndpoint.host,
        pharmacyCa: app.get(PharmacyCaService),
        security: mainDeviceSecurity,
      });
      await listen(lanServer, lanEndpoint.port, lanEndpoint.host);
    }
  } catch (error) {
    lanServer?.close();
    await app.close();
    throw error;
  }
  app.getHttpServer().once("close", () => lanServer?.close());
}

function readPort(value: string | undefined, name = "API_PORT"): number {
  if (value === undefined) {
    return DEFAULT_API_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

function readLanEndpoint(): { host: string; port: number } | undefined {
  const host = process.env.BREEV_LAN_API_HOST;
  const port = process.env.BREEV_LAN_API_PORT;
  if (host === undefined && port === undefined) {
    return undefined;
  }
  if (host === undefined || port === undefined) {
    throw new Error(
      "BREEV_LAN_API_HOST and BREEV_LAN_API_PORT must be configured together",
    );
  }
  if (isIP(host) === 0 || host === "0.0.0.0" || host === "::") {
    throw new Error("BREEV_LAN_API_HOST must be a concrete IP address");
  }
  return { host, port: readPort(port, "BREEV_LAN_API_PORT") };
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

void bootstrap().catch(() => {
  process.stderr.write("The Breev local API could not start.\n");
  process.exitCode = 1;
});
