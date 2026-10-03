import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import {
  inventoryReportProtectedExportContract,
  inventoryReportProtectedExportRequestSchema,
} from "@breev/contracts/local-rest";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { InventoryReportDenied } from "../reporting/inventory-report.service.js";
import { InventoryReportExportService } from "./inventory-report-export.service.js";

@Controller()
export class InventoryReportExportController {
  public constructor(private readonly exports: InventoryReportExportService) {}
  @Post(inventoryReportProtectedExportContract.path)
  @HttpCode(201)
  public async export(@Req() request: Request, @Body() body: unknown) {
    return await translateIdentityDenial(async () => {
      const parsed =
        inventoryReportProtectedExportRequestSchema.safeParse(body);
      if (!parsed.success) {
        const context = await this.exports.authorizeInvalidRequest(request);
        throw new HttpException(context.denial, context.statusCode);
      }
      try {
        return await this.exports.export(request, parsed.data);
      } catch (error) {
        if (error instanceof InventoryReportDenied)
          throw new HttpException(error.denial, error.statusCode);
        throw error;
      }
    });
  }
}
