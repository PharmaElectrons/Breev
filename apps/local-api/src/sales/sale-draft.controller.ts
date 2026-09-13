import {
  identityResourceIdSchema,
  saleDraftCreateContract,
  saleDraftCreateRequestSchema,
  saleDraftListContract,
  saleDraftListQuerySchema,
  saleDraftReadContract,
  saleDraftResumeContract,
  saleDraftResumeRequestSchema,
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
