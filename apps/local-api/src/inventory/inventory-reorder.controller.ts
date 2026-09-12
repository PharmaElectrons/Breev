import {
  identityResourceIdSchema,
  reorderBasketQuerySchema,
  reorderBasketReadContract,
  reorderItemAddContract,
  reorderItemAddRequestSchema,
  reorderItemConfirmContract,
  reorderItemRemoveContract,
  reorderItemReturnContract,
  reorderItemTransitionRequestSchema,
  reorderItemUpdateContract,
  reorderItemUpdateRequestSchema,
  type CatalogFieldError,
} from "@breev/contracts/local-rest";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import {
  InventoryReorderDenied,
  InventoryReorderService,
} from "./inventory-reorder.service.js";

@Controller()
export class InventoryReorderController {
  public constructor(private readonly reorder: InventoryReorderService) {}

  @Get(reorderBasketReadContract.path)
  public async list(
    @Query("status") status: string | undefined,
    @Req() request: Request,
  ) {
    return await translateReorderDenial(async () => {
      const input = reorderBasketQuerySchema.safeParse({ status });
      if (!input.success) {
        throw await this.reorder.rejectInvalidBody(
          request,
          "read",
          "inventory.reorder.read",
          fieldErrors(input.error),
        );
      }
      return await this.reorder.listItems(request, input.data.status);
    });
  }

  @Post(reorderItemAddContract.path)
  @HttpCode(200)
  public async add(@Body() body: unknown, @Req() request: Request) {
    return await translateReorderDenial(async () => {
      const input = reorderItemAddRequestSchema.safeParse(body);
      if (!input.success) {
        throw await this.reorder.rejectInvalidBody(
          request,
          "inventory.reorder.manage",
          "inventory.reorder.item.add",
          fieldErrors(input.error),
        );
      }
      return await this.reorder.addItem(request, input.data);
    });
  }

  @Put(reorderItemUpdateContract.path)
  @HttpCode(200)
  public async update(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await translateReorderDenial(async () => {
      const parsedItemId = identityResourceIdSchema.safeParse(itemId);
      const input = reorderItemUpdateRequestSchema.safeParse(body);
      if (!parsedItemId.success || !input.success) {
        throw await this.reorder.rejectInvalidBody(
          request,
          "inventory.reorder.manage",
          "inventory.reorder.item.update",
          [
            ...(parsedItemId.success
              ? []
              : [{ code: "invalid" as const, path: ["itemId"] }]),
            ...(input.success ? [] : fieldErrors(input.error)),
          ],
        );
      }
      return await this.reorder.updateQuantity(
        request,
        parsedItemId.data,
        input.data,
      );
    });
  }

  @Post(reorderItemRemoveContract.path)
  @HttpCode(200)
  public async remove(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await translateReorderDenial(async () => {
      const parsedItemId = identityResourceIdSchema.safeParse(itemId);
      const input = reorderItemTransitionRequestSchema.safeParse(body);
      if (!parsedItemId.success || !input.success) {
        throw await this.reorder.rejectInvalidBody(
          request,
          "inventory.reorder.manage",
          "inventory.reorder.item.remove",
          [
            ...(parsedItemId.success
              ? []
              : [{ code: "invalid" as const, path: ["itemId"] }]),
            ...(input.success ? [] : fieldErrors(input.error)),
          ],
        );
      }
      return await this.reorder.removeItem(
        request,
        parsedItemId.data,
        input.data,
      );
    });
  }

  @Post(reorderItemConfirmContract.path)
  @HttpCode(200)
  public async confirm(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await translateReorderDenial(async () => {
      const parsedItemId = identityResourceIdSchema.safeParse(itemId);
      const input = reorderItemTransitionRequestSchema.safeParse(body);
      if (!parsedItemId.success || !input.success) {
        throw await this.reorder.rejectInvalidBody(
          request,
          "inventory.reorder.confirm",
          "inventory.reorder.item.confirm",
          [
            ...(parsedItemId.success
              ? []
              : [{ code: "invalid" as const, path: ["itemId"] }]),
            ...(input.success ? [] : fieldErrors(input.error)),
          ],
        );
      }
      return await this.reorder.confirmItem(
        request,
        parsedItemId.data,
        input.data,
      );
    });
  }

  @Post(reorderItemReturnContract.path)
  @HttpCode(200)
  public async return(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await translateReorderDenial(async () => {
      const parsedItemId = identityResourceIdSchema.safeParse(itemId);
      const input = reorderItemTransitionRequestSchema.safeParse(body);
      if (!parsedItemId.success || !input.success) {
        throw await this.reorder.rejectInvalidBody(
          request,
          "inventory.reorder.confirm",
          "inventory.reorder.item.return",
          [
            ...(parsedItemId.success
              ? []
              : [{ code: "invalid" as const, path: ["itemId"] }]),
            ...(input.success ? [] : fieldErrors(input.error)),
          ],
        );
      }
      return await this.reorder.returnItem(
        request,
        parsedItemId.data,
        input.data,
      );
    });
  }
}

async function translateReorderDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof InventoryReorderDenied) {
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
}): (CatalogFieldError & { readonly rule?: string })[] {
  const result: (CatalogFieldError & { readonly rule?: string })[] = [];
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
      const resolvedPath = path.length === 0 ? ["body"] : path;
      result.push({ code, path: resolvedPath });
    }
  }
  return result.length === 0 ? [{ code: "invalid", path: ["body"] }] : result;
}
