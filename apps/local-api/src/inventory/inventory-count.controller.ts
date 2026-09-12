import {
  countLineRecordContract,
  countLineRecordRequestSchema,
  countSessionCompleteContract,
  countSessionCompleteRequestSchema,
  countSessionListContract,
  countSessionListQuerySchema,
  countSessionReadContract,
  countSessionStartContract,
  countSessionStartRequestSchema,
  countVarianceApplyContract,
  countVarianceApplyRequestSchema,
  identityResourceIdSchema,
  type CatalogFieldError,
  type CountLine,
  type CountSession,
  type CountSessionSummary,
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
  InventoryCountDenied,
  InventoryCountService,
} from "./inventory-count.service.js";

@Controller()
export class InventoryCountController {
  public constructor(private readonly count: InventoryCountService) {}

  @Post(countSessionStartContract.path)
  @HttpCode(201)
  public async start(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CountSession> {
    return await translateCountDenial(async () => {
      const input = countSessionStartRequestSchema.safeParse(body);
      if (!input.success) {
        throw await this.count.rejectInvalidBody(
          request,
          "inventory.counts.record",
          "inventory.count.session.start",
          fieldErrors(input.error),
        );
      }
      return await this.count.startSession(request, input.data);
    });
  }

  @Get(countSessionListContract.path)
  public async list(
    @Query("status") status: string | undefined,
    @Req() request: Request,
  ): Promise<{ readonly sessions: readonly CountSessionSummary[] }> {
    return await translateCountDenial(async () => {
      const input = countSessionListQuerySchema.safeParse({ status });
      if (!input.success) {
        throw await this.count.rejectInvalidBody(
          request,
          "read",
          "inventory.count.session.read",
          fieldErrors(input.error),
        );
      }
      return await this.count.listSessions(request, input.data);
    });
  }

  @Get(countSessionReadContract.path)
  public async read(
    @Param("sessionId") sessionId: string,
    @Req() request: Request,
  ): Promise<CountSession> {
    return await translateCountDenial(async () => {
      const parsed = identityResourceIdSchema.safeParse(sessionId);
      if (!parsed.success) {
        throw await this.count.rejectInvalidBody(
          request,
          "read",
          "inventory.count.session.read",
          [{ code: "invalid", path: ["sessionId"] }],
        );
      }
      return await this.count.readSession(request, parsed.data);
    });
  }

  @Post(countLineRecordContract.path)
  @HttpCode(201)
  public async recordLine(
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<{
    readonly line: CountLine;
    readonly session: CountSessionSummary;
  }> {
    return await translateCountDenial(async () => {
      const parsedSessionId = identityResourceIdSchema.safeParse(sessionId);
      const input = countLineRecordRequestSchema.safeParse(body);
      if (!parsedSessionId.success || !input.success) {
        throw await this.count.rejectInvalidBody(
          request,
          "inventory.counts.record",
          "inventory.count.line.record",
          [
            ...(parsedSessionId.success
              ? []
              : [{ code: "invalid" as const, path: ["sessionId"] }]),
            ...(input.success ? [] : fieldErrors(input.error, "record")),
          ],
        );
      }
      return await this.count.recordLine(
        request,
        parsedSessionId.data,
        input.data,
      );
    });
  }

  @Post(countVarianceApplyContract.path)
  @HttpCode(201)
  public async applyVariance(
    @Param("sessionId") sessionId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<{
    readonly line: CountLine;
    readonly session: CountSessionSummary;
  }> {
    return await translateCountDenial(async () => {
      const parsedSessionId = identityResourceIdSchema.safeParse(sessionId);
      const parsedLineId = identityResourceIdSchema.safeParse(lineId);
      const input = countVarianceApplyRequestSchema.safeParse(body);
      if (!parsedSessionId.success || !parsedLineId.success || !input.success) {
        throw await this.count.rejectInvalidBody(
          request,
          "inventory.counts.approve",
          "inventory.count.variance.apply",
          [
            ...(parsedSessionId.success
              ? []
              : [{ code: "invalid" as const, path: ["sessionId"] }]),
            ...(parsedLineId.success
              ? []
              : [{ code: "invalid" as const, path: ["lineId"] }]),
            ...(input.success ? [] : fieldErrors(input.error, "apply")),
          ],
        );
      }
      return await this.count.applyVariance(
        request,
        parsedSessionId.data,
        parsedLineId.data,
        input.data,
      );
    });
  }

  @Post(countSessionCompleteContract.path)
  @HttpCode(200)
  public async complete(
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CountSessionSummary> {
    return await translateCountDenial(async () => {
      const parsedSessionId = identityResourceIdSchema.safeParse(sessionId);
      const input = countSessionCompleteRequestSchema.safeParse(body);
      if (!parsedSessionId.success || !input.success) {
        throw await this.count.rejectInvalidBody(
          request,
          "inventory.counts.record",
          "inventory.count.session.complete",
          [
            ...(parsedSessionId.success
              ? []
              : [{ code: "invalid" as const, path: ["sessionId"] }]),
            ...(input.success ? [] : fieldErrors(input.error)),
          ],
        );
      }
      return await this.count.completeSession(
        request,
        parsedSessionId.data,
        input.data,
      );
    });
  }
}

async function translateCountDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof InventoryCountDenied) {
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

function fieldErrors(
  error: {
    readonly issues: readonly ValidationIssue[];
  },
  action?: "apply" | "record",
): (CatalogFieldError & {
  readonly rule?: string;
})[] {
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
      const emptyInput = issue.input === "" || issue.input === undefined;
      const rule =
        action === "apply" && emptyInput && resolvedPath[0] === "reason"
          ? "inventory.count.reason-required"
          : action === "apply" && emptyInput && resolvedPath[0] === "evidence"
            ? "inventory.count.evidence-required"
            : action === "record" && emptyInput && resolvedPath[0] === "entries"
              ? "inventory.count.entry-empty"
              : undefined;
      result.push({
        code,
        path: resolvedPath,
        ...(rule === undefined ? {} : { rule }),
      });
    }
  }
  return result.length === 0 ? [{ code: "invalid", path: ["body"] }] : result;
}
