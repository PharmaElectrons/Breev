import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

const DEFAULT_API_PORT = 31_310;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.enableShutdownHooks();

  await app.listen(
    readPort(process.env.API_PORT),
    process.env.API_HOST ?? "127.0.0.1",
  );
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
