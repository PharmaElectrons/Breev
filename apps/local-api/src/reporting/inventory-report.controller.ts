import {
  Controller,
  Get,
  HttpException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import {
  inventoryReportContract,
  inventoryReportExportContract,
} from "@breev/contracts/local-rest";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import {
  InventoryReportDenied,
  InventoryReportService,
} from "./inventory-report.service.js";

@Controller()
export class InventoryReportController {
  public constructor(private readonly reports: InventoryReportService) {}
  @Get(inventoryReportContract.path)
  public async read(
    @Req() request: Request,
    @Param("kind") kind: string,
    @Query() query: unknown,
  ) {
    return await translateReportDenial(() =>
      this.reports.read(request, kind, query),
    );
  }
  @Get(inventoryReportExportContract.path)
  public async export(
    @Req() request: Request,
    @Param("kind") kind: string,
    @Query() query: unknown,
  ) {
    return await translateReportDenial(() =>
      this.reports.read(request, kind, query, true),
    );
  }
}
export async function translateReportDenial<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof InventoryReportDenied)
      throw new HttpException(error.denial, error.statusCode);
    throw error;
  }
}
