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
  public constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Get(localHealthContract.path)
  @Header("Access-Control-Allow-Origin", "null")
  public async getHealth(
    @Res({ passthrough: true }) response: Response,
  ): Promise<LocalHealthResponse> {
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
