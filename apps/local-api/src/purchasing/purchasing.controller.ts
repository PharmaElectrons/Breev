import {
  postedPurchaseAdjustmentSchema,
  postedPurchaseReturnSchema,
  purchaseAdjustmentDraftCreateContract,
  purchaseAdjustmentDraftCreateRequestSchema,
  purchaseAdjustmentDraftDiscardContract,
  purchaseAdjustmentDraftDiscardRequestSchema,
  purchaseAdjustmentDraftReadContract,
  purchaseAdjustmentDraftSchema,
  purchaseAdjustmentDraftUpdateContract,
  purchaseAdjustmentDraftUpdateRequestSchema,
  purchaseAdjustmentPostContract,
  purchaseAdjustmentPostRequestSchema,
  purchaseAdjustmentSummaryReadContract,
  purchaseReturnDraftCreateContract,
  purchaseReturnDraftCreateRequestSchema,
  purchaseReturnDraftDiscardContract,
  purchaseReturnDraftDiscardRequestSchema,
  purchaseReturnDraftReadContract,
  purchaseReturnDraftSchema,
  purchaseReturnDraftUpdateContract,
  purchaseReturnDraftUpdateRequestSchema,
  purchaseReturnPostContract,
  purchaseReturnPostRequestSchema,
  purchaseReturnSummaryReadContract,
  purchasePostedReturnReadContract,
  purchasePostedAdjustmentReadContract,
  purchaseDraftCreateContract,
  purchaseDraftCreateRequestSchema,
  purchaseDraftDiscardContract,
  purchaseDraftDiscardRequestSchema,
  purchaseDraftListContract,
  purchaseDraftReadContract,
  purchaseDraftRowCommitContract,
  purchaseDraftRowCommitRequestSchema,
  purchaseDraftSchema,
  purchaseDraftUpdateContract,
  purchaseDraftUpdateRequestSchema,
  purchaseEntryPreferencesReadContract,
  purchaseEntryPreferencesUpdateContract,
  purchaseEntryPreferencesUpdateRequestSchema,
  purchasePostedDetailSchema,
  purchasePostedListContract,
  purchasePostedListRequestSchema,
  purchasePostedReadContract,
  purchasePostContract,
  purchasePostRequestSchema,
  supplierArchiveContract,
  supplierArchiveRequestSchema,
  supplierCreateContract,
  supplierCreateRequestSchema,
  supplierEditContract,
  supplierEditRequestSchema,
  supplierListContract,
  supplierReadContract,
  supplierMergeContract,
  supplierMergeRequestSchema,
  supplierSchema,
  type PurchaseDraft,
  type PurchaseDraftDetail,
  type PurchaseDraftRowCommitResult,
  type PurchaseDraftResult,
  type PurchaseEntryPreferences,
  type PurchasePostResult,
  type PurchasePostedDetail,
  type PurchasePostedListResponse,
  type PostedPurchaseAdjustment,
  type PostedPurchaseReturn,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentPostResult,
  type PurchaseAdjustmentSummary,
  type PurchaseReturnDraft,
  type PurchaseReturnPostResult,
  type PurchaseReturnSummary,
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
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { PurchaseAdjustmentsService } from "./purchase-adjustments.service.js";
import { PurchaseReturnsService } from "./purchase-returns.service.js";
import { PurchasingDenied, PurchasingService } from "./purchasing.service.js";

@Controller()
export class PurchasingController {
  public constructor(
    private readonly purchasing: PurchasingService,
    private readonly adjustments: PurchaseAdjustmentsService,
    private readonly returns: PurchaseReturnsService,
  ) {}

  @Get(supplierListContract.path)
  public async listSuppliers(
    @Req() request: Request,
  ): Promise<{ suppliers: Supplier[] }> {
    return await translatePurchasingDenial(() =>
      this.purchasing.listSuppliers(request),
    );
  }

  @Get(supplierReadContract.path)
  public async readSupplier(
    @Param("supplierId") supplierId: string,
    @Req() request: Request,
  ): Promise<Supplier> {
    return await translatePurchasingDenial(async () => {
      const id = supplierSchema.shape.id.safeParse(supplierId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "supplier.read",
          "suppliers.manage",
          "supplier-not-found",
        );
      return await this.purchasing.readSupplier(request, id.data);
    });
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
  ): Promise<PurchaseDraftDetail> {
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

  @Get(purchaseEntryPreferencesReadContract.path)
  public async readEntryPreferences(
    @Req() request: Request,
  ): Promise<PurchaseEntryPreferences> {
    return await translatePurchasingDenial(() =>
      this.purchasing.readEntryPreferences(request),
    );
  }

  @Put(purchaseEntryPreferencesUpdateContract.path)
  public async updateEntryPreferences(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseEntryPreferences> {
    return await translatePurchasingDenial(async () => {
      const input = purchaseEntryPreferencesUpdateRequestSchema.safeParse(body);
      if (!input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.entry-preferences.update",
          "purchases.drafts.manage",
          fieldErrors(input.error),
        );
      return await this.purchasing.updateEntryPreferences(request, input.data);
    });
  }

  @Post(purchaseDraftRowCommitContract.path)
  @HttpCode(201)
  public async commitDraftRow(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseDraftRowCommitResult> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseDraftRowCommitRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.draft.row.commit",
          "purchases.drafts.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.purchasing.commitDraftRow(request, id.data, input.data);
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

  @Post(purchasePostContract.path)
  @HttpCode(201)
  public async postPurchase(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchasePostResult> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseDraftSchema.shape.id.safeParse(draftId);
      const input = purchasePostRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.post",
          "purchases.drafts.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.purchasing.postPurchase(request, id.data, input.data);
    });
  }

  @Get(purchasePostedListContract.path)
  public async listPostedPurchases(
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<PurchasePostedListResponse> {
    return await translatePurchasingDenial(async () => {
      const input = purchasePostedListRequestSchema.safeParse(query);
      if (!input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.posted.list",
          "purchases.posted.view",
          fieldErrors(input.error),
        );
      return await this.purchasing.listPostedPurchases(request, input.data);
    });
  }

  @Get(purchasePostedReadContract.path)
  public async readPostedPurchase(
    @Param("purchaseId") purchaseId: string,
    @Req() request: Request,
  ): Promise<PurchasePostedDetail> {
    return await translatePurchasingDenial(async () => {
      const id = purchasePostedDetailSchema.shape.id.safeParse(purchaseId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.posted.read",
          "purchases.posted.view",
          "posted-purchase-not-found",
        );
      return await this.purchasing.readPostedPurchase(request, id.data);
    });
  }

  @Post(purchaseAdjustmentDraftCreateContract.path)
  @HttpCode(201)
  public async createAdjustmentDraft(
    @Param("purchaseId") purchaseId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseAdjustmentDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchasePostedDetailSchema.shape.id.safeParse(purchaseId);
      const input = purchaseAdjustmentDraftCreateRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.adjustment-draft.create",
          "purchases.adjustments.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["purchaseId"] }],
          id.success ? id.data : undefined,
        );
      return await this.adjustments.createDraft(request, id.data, input.data);
    });
  }

  @Get(purchaseAdjustmentDraftReadContract.path)
  public async readAdjustmentDraft(
    @Param("draftId") draftId: string,
    @Req() request: Request,
  ): Promise<PurchaseAdjustmentDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseAdjustmentDraftSchema.shape.id.safeParse(draftId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.adjustment-draft.read",
          "purchases.adjustments.manage",
          "adjustment-draft-not-found",
        );
      return await this.adjustments.readDraft(request, id.data);
    });
  }

  @Put(purchaseAdjustmentDraftUpdateContract.path)
  public async updateAdjustmentDraft(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseAdjustmentDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseAdjustmentDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseAdjustmentDraftUpdateRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.adjustment-draft.update",
          "purchases.adjustments.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.adjustments.updateDraft(request, id.data, input.data);
    });
  }

  @Post(purchaseAdjustmentDraftDiscardContract.path)
  @HttpCode(201)
  public async discardAdjustmentDraft(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseAdjustmentDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseAdjustmentDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseAdjustmentDraftDiscardRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.adjustment-draft.discard",
          "purchases.adjustments.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.adjustments.discardDraft(request, id.data, input.data);
    });
  }

  @Get(purchaseAdjustmentSummaryReadContract.path)
  public async previewAdjustment(
    @Param("draftId") draftId: string,
    @Req() request: Request,
  ): Promise<PurchaseAdjustmentSummary> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseAdjustmentDraftSchema.shape.id.safeParse(draftId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.adjustment.preview",
          "purchases.adjustments.manage",
          "adjustment-draft-not-found",
        );
      return await this.adjustments.preview(request, id.data);
    });
  }

  @Post(purchaseAdjustmentPostContract.path)
  @HttpCode(201)
  public async postAdjustment(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseAdjustmentPostResult> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseAdjustmentDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseAdjustmentPostRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.adjustment.post",
          "purchases.adjustments.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.adjustments.postPurchaseAdjustment(
        request,
        id.data,
        input.data,
      );
    });
  }

  @Get(purchasePostedAdjustmentReadContract.path)
  public async readPostedAdjustment(
    @Param("adjustmentId") adjustmentId: string,
    @Req() request: Request,
  ): Promise<PostedPurchaseAdjustment> {
    return await translatePurchasingDenial(async () => {
      const id =
        postedPurchaseAdjustmentSchema.shape.id.safeParse(adjustmentId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.adjustment.read",
          "purchases.posted.view",
          "adjustment-original-not-found",
        );
      return await this.adjustments.readPostedAdjustment(request, id.data);
    });
  }

  @Post(purchaseReturnDraftCreateContract.path)
  @HttpCode(201)
  public async createReturnDraft(
    @Param("purchaseId") purchaseId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseReturnDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchasePostedDetailSchema.shape.id.safeParse(purchaseId);
      const input = purchaseReturnDraftCreateRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.return-draft.create",
          "purchases.returns.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["purchaseId"] }],
          id.success ? id.data : undefined,
        );
      return await this.returns.createDraft(request, id.data, input.data);
    });
  }

  @Get(purchaseReturnDraftReadContract.path)
  public async readReturnDraft(
    @Param("draftId") draftId: string,
    @Req() request: Request,
  ): Promise<PurchaseReturnDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseReturnDraftSchema.shape.id.safeParse(draftId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.return-draft.read",
          "purchases.returns.manage",
          "return-draft-not-found",
        );
      return await this.returns.readDraft(request, id.data);
    });
  }

  @Put(purchaseReturnDraftUpdateContract.path)
  public async updateReturnDraft(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseReturnDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseReturnDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseReturnDraftUpdateRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.return-draft.update",
          "purchases.returns.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.returns.updateDraft(request, id.data, input.data);
    });
  }

  @Post(purchaseReturnDraftDiscardContract.path)
  @HttpCode(201)
  public async discardReturnDraft(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseReturnDraft> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseReturnDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseReturnDraftDiscardRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.return-draft.discard",
          "purchases.returns.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.returns.discardDraft(request, id.data, input.data);
    });
  }

  @Get(purchaseReturnSummaryReadContract.path)
  public async previewReturn(
    @Param("draftId") draftId: string,
    @Req() request: Request,
  ): Promise<PurchaseReturnSummary> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseReturnDraftSchema.shape.id.safeParse(draftId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.return.preview",
          "purchases.returns.manage",
          "return-draft-not-found",
        );
      return await this.returns.preview(request, id.data);
    });
  }

  @Post(purchaseReturnPostContract.path)
  @HttpCode(201)
  public async postReturn(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PurchaseReturnPostResult> {
    return await translatePurchasingDenial(async () => {
      const id = purchaseReturnDraftSchema.shape.id.safeParse(draftId);
      const input = purchaseReturnPostRequestSchema.safeParse(body);
      if (!id.success || !input.success)
        return await this.purchasing.rejectInvalidBody(
          request,
          "purchase.return.post",
          "purchases.returns.manage",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["draftId"] }],
          id.success ? id.data : undefined,
        );
      return await this.returns.postPurchaseReturn(
        request,
        id.data,
        input.data,
      );
    });
  }

  @Get(purchasePostedReturnReadContract.path)
  public async readPostedReturn(
    @Param("returnId") returnId: string,
    @Req() request: Request,
  ): Promise<PostedPurchaseReturn> {
    return await translatePurchasingDenial(async () => {
      const id = postedPurchaseReturnSchema.shape.id.safeParse(returnId);
      if (!id.success)
        return await this.purchasing.rejectMissing(
          request,
          "purchase.return.read",
          "purchases.posted.view",
          "return-original-not-found",
        );
      return await this.returns.readPostedReturn(request, id.data);
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
