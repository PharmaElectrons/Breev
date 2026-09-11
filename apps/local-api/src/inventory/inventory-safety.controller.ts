import {
  inventoryAllocationPreviewContract,
  inventoryAllocationPreviewRequestSchema,
  inventoryBatchExpiryCorrectionContract,
  inventoryBatchExpiryCorrectionRequestSchema,
  inventoryBatchListContract,
  inventoryBatchSafetyReviewContract,
  inventoryBatchSafetyRunContract,
  inventoryBatchSafetyStatusContract,
  inventoryBatchStatusChangeContract,
  inventoryBatchStatusChangeRequestSchema,
  type InventoryAllocationPreview,
  type InventoryBatch,
  type InventoryBatchSafetyReview,
  type InventoryBatchSafetyStatus,
} from "@breev/contracts/local-rest";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import {
  InventorySafetyDenied,
  InventorySafetyService,
} from "./inventory-safety.service.js";

@Controller()
export class InventorySafetyController {
  public constructor(private readonly safety: InventorySafetyService) {}

  @Get(inventoryBatchListContract.path)
  public async listBatches(
    @Param("productId") productId: string,
    @Req() request: Request,
  ): Promise<{
    readonly batches: readonly InventoryBatch[];
    readonly businessDate: string;
  }> {
    return await translateSafetyDenial(() =>
      this.safety.listBatches(request, productId),
    );
  }

  @Post(inventoryAllocationPreviewContract.path)
  @HttpCode(200)
  public async previewAllocation(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<InventoryAllocationPreview> {
    return await translateSafetyDenial(async () => {
      const input = inventoryAllocationPreviewRequestSchema.safeParse(body);
      if (!input.success) {
        throw await this.safety.rejectInvalidBody(
          request,
          fieldErrors(input.error),
        );
      }
      return await this.safety.previewAllocation(request, {
        lines: input.data.lines,
      });
    });
  }

  @Post(inventoryBatchStatusChangeContract.path)
  @HttpCode(201)
  public async changeStatus(
    @Param("batchId") batchId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<InventoryBatch> {
    return await translateSafetyDenial(async () => {
      const input = inventoryBatchStatusChangeRequestSchema.safeParse(body);
      if (!input.success) {
        throw await this.safety.rejectInvalidBody(
          request,
          fieldErrors(input.error),
        );
      }
      return await this.safety.changeStatus(request, batchId, input.data);
    });
  }

  @Post(inventoryBatchExpiryCorrectionContract.path)
  @HttpCode(201)
  public async correctExpiry(
    @Param("batchId") batchId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<InventoryBatch> {
    return await translateSafetyDenial(async () => {
      const input = inventoryBatchExpiryCorrectionRequestSchema.safeParse(body);
      if (!input.success) {
        throw await this.safety.rejectInvalidBody(
          request,
          fieldErrors(input.error),
        );
      }
      return await this.safety.correctExpiry(request, batchId, input.data);
    });
  }

  @Get(inventoryBatchSafetyStatusContract.path)
  public async readStatus(
    @Req() request: Request,
  ): Promise<InventoryBatchSafetyStatus> {
    return await translateSafetyDenial(() => this.safety.readStatus(request));
  }

  @Post(inventoryBatchSafetyRunContract.path)
  @HttpCode(202)
  public async triggerRun(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<InventoryBatchSafetyStatus> {
    return await translateSafetyDenial(async () => {
      const input =
        inventoryBatchSafetyRunContract.request?.body.safeParse(body);
      if (input !== undefined && !input.success) {
        throw await this.safety.rejectInvalidBody(
          request,
          fieldErrors(input.error),
        );
      }
      return await this.safety.triggerRun(request);
    });
  }

  @Get(inventoryBatchSafetyReviewContract.path)
  public async readReview(
    @Query("month") month: string | undefined,
    @Req() request: Request,
  ): Promise<InventoryBatchSafetyReview> {
    return await translateSafetyDenial(async () => {
      if (month !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)) {
        throw await this.safety.rejectInvalidBody(request, [
          { code: "invalid", path: ["month"] },
        ]);
      }
      return await this.safety.readMonthlyReview(request, month);
    });
  }
}

interface ValidationIssue {
  readonly code: string;
  readonly input?: unknown;
  readonly keys?: readonly string[];
  readonly origin?: unknown;
  readonly path: readonly PropertyKey[];
}

function fieldErrors(error: {
  readonly issues: readonly ValidationIssue[];
}): import("@breev/contracts/local-rest").CatalogFieldError[] {
  const result: import("@breev/contracts/local-rest").CatalogFieldError[] = [];
  for (const issue of error.issues) {
    const path = issue.path.filter(
      (part): part is string | number =>
        typeof part === "string" || typeof part === "number",
    );
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys ?? []) {
        result.push({ code: "unknown-field", path: [...path, key] });
      }
    } else {
      const code =
        issue.code === "too_big"
          ? issue.origin === "string"
            ? "too-long"
            : "out-of-range"
          : issue.code === "too_small"
            ? issue.input === "" || issue.input === undefined
              ? "required"
              : "out-of-range"
            : issue.code === "invalid_type" && issue.input === undefined
              ? "required"
              : "invalid";
      result.push({ code, path: path.length === 0 ? ["body"] : path });
    }
  }
  return result.length === 0 ? [{ code: "invalid", path: ["body"] }] : result;
}

async function translateSafetyDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof InventorySafetyDenied) {
      throw new HttpException(error.denial, error.statusCode);
    }
    throw error;
  }
}
