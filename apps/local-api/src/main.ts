import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { json } from "express";

import { AppModule } from "./app.module.js";
import {
  createMainRequestBodyErrorMiddleware,
  createMainRequestSecurityMiddleware,
  MainDeviceSecurityService,
} from "./main-device/main-device-security.service.js";

const DEFAULT_API_PORT = 31_310;

async function bootstrap(): Promise<void> {
  const port = readPort(process.env.API_PORT);
  const host = process.env.API_HOST ?? "127.0.0.1";
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
      expectedHost: `${host}:${port}`,
      security: mainDeviceSecurity,
    }),
  );
  app.use(json({ limit: 8 * 1024, strict: true, type: "application/json" }));
  app.use(createMainRequestBodyErrorMiddleware(mainDeviceSecurity));

  await app.listen(port, host);
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

void bootstrap().catch(() => {
  process.stderr.write("The Breev local API could not start.\n");
  process.exitCode = 1;
});
