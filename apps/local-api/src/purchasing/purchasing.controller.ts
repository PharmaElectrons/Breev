import {
  purchaseDraftCreateContract,
  purchaseDraftCreateRequestSchema,
  purchaseDraftDiscardContract,
  purchaseDraftDiscardRequestSchema,
  purchaseDraftListContract,
  purchaseDraftReadContract,
  purchaseDraftSchema,
  purchaseDraftUpdateContract,
  purchaseDraftUpdateRequestSchema,
  supplierArchiveContract,
  supplierArchiveRequestSchema,
  supplierCreateContract,
  supplierCreateRequestSchema,
  supplierEditContract,
  supplierEditRequestSchema,
  supplierListContract,
  supplierMergeContract,
  supplierMergeRequestSchema,
  supplierSchema,
  type PurchaseDraft,
  type PurchaseDraftResult,
  type PurchasingFieldError,
  type Supplier,
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
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { PurchasingDenied, PurchasingService } from "./purchasing.service.js";

@Controller()
export class PurchasingController {
  public constructor(private readonly purchasing: PurchasingService) {}

  @Get(supplierListContract.path)
  public async listSuppliers(
    @Req() request: Request,
  ): Promise<{ suppliers: Supplier[] }> {
    return await translatePurchasingDenial(() =>
      this.purchasing.listSuppliers(request),
    );
  }

  @Post(supplierCreateContract.path)
  @HttpCode(201)
  public async createSupplier(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Supplier> {
    return await translatePurchasingDenial(async () => {
      const input = supplierCreateRequestSchema.safeParse(body);
      if (!input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "supplier.create",
          "suppliers.manage",
          fieldErrors(input.error),
        );
      return await this.purchasing.createSupplier(request, input.data);
    });
  }

  @Put(supplierEditContract.path)
  public async editSupplier(
    @Param("supplierId") supplierId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Supplier> {
    return await translatePurchasingDenial(async () => {
      const id = supplierSchema.shape.id.safeParse(supplierId);
      const input = supplierEditRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "supplier.edit",
          "suppliers.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["supplierId"] }],
          id.success ? id.data : undefined,
        );
      return await this.purchasing.editSupplier(request, id.data, input.data);
    });
  }

  @Post(supplierArchiveContract.path)
  @HttpCode(201)
  public async archiveSupplier(
    @Param("supplierId") supplierId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Supplier> {
    return await translatePurchasingDenial(async () => {
      const id = supplierSchema.shape.id.safeParse(supplierId);
      const input = supplierArchiveRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "supplier.archive",
          "suppliers.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["supplierId"] }],
          id.success ? id.data : undefined,
        );
      return await this.purchasing.archiveSupplier(
        request,
        id.data,
        input.data,
      );
    });
  }

  @Post(supplierMergeContract.path)
  @HttpCode(201)
  public async mergeSupplier(
    @Param("supplierId") supplierId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Supplier> {
    return await translatePurchasingDenial(async () => {
      const id = supplierSchema.shape.id.safeParse(supplierId);
      const input = supplierMergeRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "supplier.merge",
          "suppliers.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["supplierId"] }],
          id.success ? id.data : undefined,
        );
      return await this.purchasing.mergeSupplier(request, id.data, input.data);
    });
  }

  @Get(purchaseDraftListContract.path)
  public async listDrafts(
    @Req() request: Request,
  ): Promise<{ drafts: PurchaseDraft[] }> {
    return await translatePurchasingDenial(() =>
      this.purchasing.listDrafts(request),
    );
  }

  @Get(purchaseDraftReadContract.path)
  public async readDraft(
    @Param("draftId") draftId: string,
    @Req() request: Request,
  ): Promise<PurchaseDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseDraftSchema.shape.id.safeParse(draftId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.draft.read",
          "purchases.drafts.manage",
          "draft-not-found",
        );
      return await this.purchasing.readDraft(request, id.data);
    });
  }

  @Post(purchaseDraftCreateContract.path)
  @HttpCode(201)
  public async createDraft(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseDraftResult> {
    return await translatePurchasingDenial(async () => {
      const input = purchaseDraftCreateRequestSchema.safeParse(body);
      if (!input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.draft.create",
          "purchases.drafts.manage",
          fieldErrors(input.error),
        );
      return await this.purchasing.createDraft(request, input.data);
    });
  }

  @Put(purchaseDraftUpdateContract.path)
  public async updateDraft(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseDraftResult> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseDraftUpdateRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.draft.update",
          "purchases.drafts.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.purchasing.updateDraft(request, id.data, input.data);
    });
  }

  @Post(purchaseDraftDiscardContract.path)
  @HttpCode(201)
  public async discardDraft(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseDraftDiscardRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.draft.discard",
          "purchases.drafts.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.purchasing.discardDraft(request, id.data, input.data);
    });
  }
}

async function translatePurchasingDenial<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof PurchasingDenied)
      throw new HttpException(error.denial, error.statusCode);
    throw error;
  }
}

interface ValidationIssue {
  code: string;
  input?: unknown;
  keys?: readonly string[];
  origin?: unknown;
  path: readonly PropertyKey[];
}
function fieldErrors(error: {
  issues: readonly ValidationIssue[];
}): PurchasingFieldError[] {
  const result: PurchasingFieldError[] = [];
  for (const issue of error.issues) {
    const path = issue.path.filter(
      (part): part is string | number =>
        typeof part === "string" || typeof part === "number",
    );
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys ?? [])
        result.push({ code: "unknown-field", path: [...path, key] });
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
