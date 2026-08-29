import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { json, type RequestHandler } from "express";
import type { Server } from "node:https";

import { AppModule } from "./app.module.js";
import { DevicesService } from "./devices/devices.service.js";
import {
  publishDiscovery,
  type DiscoveryPublisher,
} from "./devices/discovery-publisher.js";
import { readPairingEndpoint } from "./devices/pairing-endpoint.js";
import { createPairingChannelHandler } from "./devices/pairing.routes.js";
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
  const lanEndpoint = readPairingEndpoint(process.env);
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
  // One handler, mounted twice: the loopback pipeline runs it inside Nest, and
  // the LAN listener runs it ahead of the pairing channel so a quarantined
  // dataset answers nothing there either.
  const quarantineHandler = createRestoreQuarantineMiddleware({
    getPool: () => {
      try {
        return app.get(LocalDatabaseService).requirePool();
      } catch {
        return undefined;
      }
    },
    quarantineService: app.get(RestoreQuarantineService),
  });
  app.use(quarantineHandler);

  let lanServer: Server | undefined;
  let discovery: DiscoveryPublisher | undefined;
  try {
    await app.listen(port, host);
    if (lanEndpoint !== undefined) {
      const devices = app.get(DevicesService);
      const pharmacyCa = app.get(PharmacyCaService);
      const lan = await createLanMtlsServer({
        apiHandler: app.getHttpAdapter().getInstance() as RequestHandler,
        host: lanEndpoint.host,
        pairingHandler: createPairingChannelHandler(devices),
        pharmacyCa,
        quarantineHandler,
        security: mainDeviceSecurity,
      });
      lanServer = lan.server;
      // Revocation destroys a device's open connections through this registry,
      // so the service only learns about it once the listener exists.
      devices.useSocketRegistry(lan.registry);
      await listen(lanServer, lanEndpoint.port, lanEndpoint.host);
      discovery = publishDiscovery({
        endpoint: lanEndpoint,
        installationId: pharmacyCa.installationId,
      });
    }
  } catch (error) {
    lanServer?.close();
    await discovery?.stop().catch(() => undefined);
    await app.close();
    throw error;
  }
  app.getHttpServer().once("close", () => {
    lanServer?.close();
    void discovery?.stop().catch(() => undefined);
  });
}

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_API_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  return port;
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
