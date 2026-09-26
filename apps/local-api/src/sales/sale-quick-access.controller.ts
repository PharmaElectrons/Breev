import {
  saleQuickAccessReadContract,
  saleQuickAccessReplaceContract,
  saleQuickAccessReplaceRequestSchema,
  type CatalogFieldError,
} from "@breev/contracts/local-rest";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import {
  SaleQuickAccessDenied,
  SaleQuickAccessService,
} from "./sale-quick-access.service.js";

@Controller()
export class SaleQuickAccessController {
  public constructor(private readonly quickAccess: SaleQuickAccessService) {}

  @Get(saleQuickAccessReadContract.path)
  public async read(@Req() request: Request) {
    return await translateDenial(() => this.quickAccess.read(request));
  }

  @Post(saleQuickAccessReplaceContract.path)
  @HttpCode(200)
  public async replace(@Body() body: unknown, @Req() request: Request) {
    return await translateDenial(async () => {
      const parsed = saleQuickAccessReplaceRequestSchema.safeParse(body);
      if (!parsed.success) {
        const fieldErrors: CatalogFieldError[] = parsed.error.issues.map(
          (issue) => ({
            code: "invalid",
            path: issue.path.filter(
              (part): part is string | number =>
                typeof part === "string" || typeof part === "number",
            ),
          }),
        );
        throw await this.quickAccess.rejectInvalidBody(request, fieldErrors);
      }
      return await this.quickAccess.replace(request, parsed.data);
    });
  }
}

async function translateDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof SaleQuickAccessDenied) {
      throw new HttpException(error.denial, error.statusCode);
    }
    throw error;
  }
}
