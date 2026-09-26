import {
  identityResourceIdSchema,
  productSearchRequestSchema,
  saleProductSearchContract,
  saleProductContextContract,
  saleDraftCreateContract,
  saleDraftCreateRequestSchema,
  saleDraftListContract,
  saleDraftListQuerySchema,
  saleDraftReadContract,
  saleDraftResumeContract,
  saleDraftResumeRequestSchema,
  saleDraftLineAddContract,
  saleDraftLineAddRequestSchema,
  saleDraftMiscLineAddContract,
  saleDraftMiscLineAddRequestSchema,
  saleDraftLineChangeContract,
  saleDraftLineChangeRequestSchema,
  saleDraftLinePriceOverrideContract,
  saleDraftLinePriceOverrideRequestSchema,
  saleDraftLineRemoveContract,
  saleDraftLineRemoveRequestSchema,
  saleDraftInvoiceDiscountContract,
  saleDraftInvoiceDiscountRequestSchema,
  saleDraftClearContract,
  saleDraftClearRequestSchema,
  saleDraftSuspendContract,
  saleDraftSuspendRequestSchema,
  saleDraftDiscardContract,
  saleDraftDiscardRequestSchema,
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
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { SaleDraftDenied, SaleDraftService } from "./sale-draft.service.js";

@Controller()
export class SaleDraftController {
  public constructor(private readonly drafts: SaleDraftService) {}

  @Get(saleProductSearchContract.path)
  public async searchProducts(
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    return await translateSaleDraftDenial(async () => {
      const input = productSearchRequestSchema.safeParse(query ?? {});
      if (!input.success) {
        throw await this.drafts.rejectInvalidBody(
          request,
          "sales.product-search",
          fieldErrors(input.error),
        );
      }
      return await this.drafts.searchProducts(request, input.data);
    });
  }

  @Get(saleProductContextContract.path)
  public async readProductContext(
    @Param("productId") productId: string,
    @Req() request: Request,
  ) {
    return await translateSaleDraftDenial(async () => {
      const parsedId = identityResourceIdSchema.safeParse(productId);
      if (!parsedId.success) {
        throw await this.drafts.rejectInvalidBody(
          request,
          "sales.product-context.read",
          [{ code: "invalid", path: ["productId"] }],
        );
      }
      return await this.drafts.readProductContext(request, parsedId.data);
    });
  }

  @Get(saleDraftListContract.path)
  public async list(@Query() query: unknown, @Req() request: Request) {
    return await translateSaleDraftDenial(async () => {
      const input = saleDraftListQuerySchema.safeParse(query ?? {});
      if (!input.success) {
        throw await this.drafts.rejectInvalidBody(
          request,
          "sales.draft.list",
          fieldErrors(input.error),
        );
      }
      return await this.drafts.listDrafts(request, input.data.status);
    });
  }

  @Get(saleDraftReadContract.path)
  public async read(
    @Param("draftId") draftId: string,
    @Req() request: Request,
  ) {
    return await translateSaleDraftDenial(async () => {
      const parsedDraftId = identityResourceIdSchema.safeParse(draftId);
      if (!parsedDraftId.success) {
        throw await this.drafts.rejectInvalidBody(request, "sales.draft.read", [
          { code: "invalid", path: ["draftId"] },
        ]);
      }
      return await this.drafts.readDraft(request, parsedDraftId.data);
    });
  }

  @Post(saleDraftCreateContract.path)
  @HttpCode(201)
  public async create(@Body() body: unknown, @Req() request: Request) {
    return await translateSaleDraftDenial(async () => {
      const input = saleDraftCreateRequestSchema.safeParse(body);
      if (!input.success) {
        throw await this.drafts.rejectInvalidBody(
          request,
          "sale.draft.create",
          fieldErrors(input.error),
        );
      }
      return await this.drafts.createDraft(request, input.data);
    });
  }

  @Post(saleDraftResumeContract.path)
  @HttpCode(200)
  public async resume(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await translateSaleDraftDenial(async () => {
      const parsedDraftId = identityResourceIdSchema.safeParse(draftId);
      const input = saleDraftResumeRequestSchema.safeParse(body);
      if (!parsedDraftId.success || !input.success) {
        throw await this.drafts.rejectInvalidBody(
          request,
          "sale.draft.resume",
          [
            ...(parsedDraftId.success
              ? []
              : [{ code: "invalid" as const, path: ["draftId"] }]),
            ...(input.success ? [] : fieldErrors(input.error)),
          ],
        );
      }
      return await this.drafts.resumeDraft(
        request,
        parsedDraftId.data,
        input.data,
      );
    });
  }

  @Post(saleDraftLineAddContract.path)
  @HttpCode(200)
  public async addLine(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.line.add",
      draftId,
      saleDraftLineAddRequestSchema,
      body,
      (id, input) => this.drafts.addLine(request, id, input),
    );
  }

  @Post(saleDraftMiscLineAddContract.path)
  @HttpCode(200)
  public async addMiscLine(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.misc-line.add",
      draftId,
      saleDraftMiscLineAddRequestSchema,
      body,
      (id, input) => this.drafts.addMiscLine(request, id, input),
    );
  }

  @Post(saleDraftLineChangeContract.path)
  @HttpCode(200)
  public async changeLine(
    @Param("draftId") draftId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.line.change",
      draftId,
      saleDraftLineChangeRequestSchema,
      body,
      (id, input) => this.drafts.changeLine(request, id, lineId, input),
      lineId,
    );
  }

  @Post(saleDraftLinePriceOverrideContract.path)
  @HttpCode(200)
  public async overrideLinePrice(
    @Param("draftId") draftId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.line.price-override",
      draftId,
      saleDraftLinePriceOverrideRequestSchema,
      body,
      (id, input) => this.drafts.overrideLinePrice(request, id, lineId, input),
      lineId,
    );
  }

  @Post(saleDraftLineRemoveContract.path)
  @HttpCode(200)
  public async removeLine(
    @Param("draftId") draftId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.line.remove",
      draftId,
      saleDraftLineRemoveRequestSchema,
      body,
      (id, input) => this.drafts.removeLine(request, id, lineId, input),
      lineId,
    );
  }

  @Post(saleDraftInvoiceDiscountContract.path)
  @HttpCode(200)
  public async discount(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.discount",
      draftId,
      saleDraftInvoiceDiscountRequestSchema,
      body,
      (id, input) => this.drafts.setInvoiceDiscount(request, id, input),
    );
  }

  @Post(saleDraftClearContract.path)
  @HttpCode(200)
  public async clear(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.clear",
      draftId,
      saleDraftClearRequestSchema,
      body,
      (id, input) => this.drafts.clearDraft(request, id, input),
    );
  }

  @Post(saleDraftSuspendContract.path)
  @HttpCode(200)
  public async suspend(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.suspend",
      draftId,
      saleDraftSuspendRequestSchema,
      body,
      (id, input) => this.drafts.suspendDraft(request, id, input),
    );
  }

  @Post(saleDraftDiscardContract.path)
  @HttpCode(200)
  public async discard(
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return await this.mutation(
      request,
      "sale.draft.discard",
      draftId,
      saleDraftDiscardRequestSchema,
      body,
      (id, input) => this.drafts.discardDraft(request, id, input),
    );
  }

  private async mutation<T>(
    request: Request,
    action: string,
    draftId: string,
    schema: {
      safeParse(
        value: unknown,
      ):
        | { success: true; data: T }
        | { success: false; error: { issues: readonly ValidationIssue[] } };
    },
    body: unknown,
    work: (id: string, input: T) => Promise<unknown>,
    lineId?: string,
  ) {
    return await translateSaleDraftDenial(async () => {
      const parsedId = identityResourceIdSchema.safeParse(draftId);
      const parsedLineId =
        lineId === undefined
          ? undefined
          : identityResourceIdSchema.safeParse(lineId);
      const parsed = schema.safeParse(body);
      if (
        !parsedId.success ||
        parsedLineId?.success === false ||
        !parsed.success
      )
        throw await this.drafts.rejectInvalidBody(request, action, [
          ...(parsedId.success
            ? []
            : [{ code: "invalid" as const, path: ["draftId"] }]),
          ...(parsedLineId === undefined || parsedLineId.success
            ? []
            : [{ code: "invalid" as const, path: ["lineId"] }]),
          ...(parsed.success ? [] : fieldErrors(parsed.error)),
        ]);
      return await work(parsedId.data, parsed.data);
    });
  }
}

async function translateSaleDraftDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof SaleDraftDenied) {
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
