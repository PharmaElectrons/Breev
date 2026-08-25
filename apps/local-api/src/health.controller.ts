import type { LocalHealthResponse } from "@breev/contracts/local-rest";
import {
  LOCAL_API_VERSION,
  LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS,
  LOCAL_HEALTH_SUCCESS_STATUS,
  LOCAL_SCHEMA_VERSION,
  localHealthContract,
} from "@breev/contracts/local-rest";
import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";

import { DatabaseHealthService } from "./database-health.service.js";

@Controller()
export class HealthController {
  private readonly installationState = readInstallationState(
    process.env.BREEV_INSTALLATION_STATE,
  );

  public constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Get(localHealthContract.path)
  @Header("Access-Control-Allow-Origin", "breev://app")
  public async getHealth(
    @Res({ passthrough: true }) response: Response,
  ): Promise<LocalHealthResponse> {
    if (this.installationState === "repair-required") {
      response.status(LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS);
      return {
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "repair-required",
        repair: { code: "installation-state-invalid" },
      };
    }

    if (await this.databaseHealth.isAvailable()) {
      response.status(LOCAL_HEALTH_SUCCESS_STATUS);
      return {
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "healthy",
        database: "available",
      };
    }

    response.status(LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS);
    return {
      apiVersion: LOCAL_API_VERSION,
      schemaVersion: LOCAL_SCHEMA_VERSION,
      status: "degraded",
      database: "unavailable",
    };
  }
}

function readInstallationState(
  value: string | undefined,
): "ready" | "repair-required" {
  if (value === undefined || value === "ready") {
    return "ready";
  }
  if (value === "repair-required") {
    return value;
  }
  throw new Error("BREEV_INSTALLATION_STATE must be ready or repair-required");
}
