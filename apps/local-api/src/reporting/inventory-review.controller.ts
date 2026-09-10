import {
  inventoryItemListContract,
  inventoryItemSchema,
  inventoryMovementHistoryContract,
  inventoryReviewPreferencesReadContract,
  inventoryReviewPreferencesUpdateContract,
  inventoryReviewPreferencesUpdateRequestSchema,
  inventorySensitiveExportContract,
  inventorySensitiveExportRequestSchema,
  type CatalogFieldError,
  type InventoryItem,
  type InventoryReviewPreferences,
  type InventorySensitiveExport,
} from "@breev/contracts/local-rest";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Put,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import {
  InventoryReviewDenied,
  InventoryReviewService,
} from "./inventory-review.service.js";

@Controller()
export class InventoryReviewController {
  public constructor(private readonly inventory: InventoryReviewService) {}

  @Get(inventoryItemListContract.path)
  public async listItems(@Req() request: Request): Promise<{
    readonly fields: { readonly valuation: "granted" | "denied" };
    readonly items: InventoryItem[];
  }> {
    return await translateInventoryDenial(() =>
      this.inventory.listItems(request),
    );
  }

  @Get(inventoryMovementHistoryContract.path)
  public async readMovements(
    @Param("productId") productId: string,
    @Req() request: Request,
  ) {
    return await translateInventoryDenial(async () => {
      const parsed = inventoryItemSchema.shape.productId.safeParse(productId);
      const id = parsed.success ? parsed.data : productId;
      if (!parsed.success) {
        return await this.inventory.rejectInvalidBody(request, [
          { code: "invalid", path: ["productId"] },
        ]);
      }
      return await this.inventory.readMovements(request, id);
    });
  }

  @Get(inventoryReviewPreferencesReadContract.path)
  public async readPreferences(
    @Req() request: Request,
  ): Promise<InventoryReviewPreferences> {
    return await translateInventoryDenial(() =>
      this.inventory.readPreferences(request),
    );
  }

  @Put(inventoryReviewPreferencesUpdateContract.path)
  public async updatePreferences(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<InventoryReviewPreferences> {
    return await translateInventoryDenial(async () => {
      const input =
        inventoryReviewPreferencesUpdateRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.inventory.rejectInvalidBody(
          request,
          fieldErrors(input.error),
        );
      }
      return await this.inventory.updatePreferences(request, input.data);
    });
  }

  @Post(inventorySensitiveExportContract.path)
  @HttpCode(201)
  public async exportSensitiveData(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<InventorySensitiveExport> {
    return await translateInventoryDenial(async () => {
      const input = inventorySensitiveExportRequestSchema.safeParse(body);
      if (!input.success) {
        throw await this.inventory.rejectInvalidBody(
          request,
          fieldErrors(input.error),
        );
      }
      return await this.inventory.exportSensitiveData(request, input.data);
    });
  }
}

async function translateInventoryDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof InventoryReviewDenied) {
      throw new HttpException(error.denial, error.statusCode);
    }
    throw error;
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
}): CatalogFieldError[] {
  const result: CatalogFieldError[] = [];
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
