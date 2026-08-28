import type { LocalHealthResponse } from "@breev/contracts/local-rest";
import {
  LOCAL_API_VERSION,
  LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS,
  LOCAL_HEALTH_SUCCESS_STATUS,
  LOCAL_SCHEMA_VERSION,
  localHealthContract,
} from "@breev/contracts/local-rest";
import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";

import { DatabaseHealthService } from "./database-health.service.js";
import { DurableJobsService } from "./durable-jobs/durable-jobs.service.js";

@Controller()
export class HealthController {
  private readonly installationState = readInstallationState(
    process.env.BREEV_INSTALLATION_STATE,
  );

  public constructor(
    private readonly databaseHealth: DatabaseHealthService,
    private readonly durableJobs: DurableJobsService,
  ) {}

  @Get(localHealthContract.path)
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

    // Healthy requires the durable-job runtime too: a reachable database with
    // a dead job runtime cannot serve settings postings or backups, and an
    // unmigrated database fails the runtime's schema check, so this also keeps
    // /health honest between installation and migration.
    if (
      (await this.databaseHealth.isAvailable()) &&
      this.durableJobs.isAvailable()
    ) {
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
