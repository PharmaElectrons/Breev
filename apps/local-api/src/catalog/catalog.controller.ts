import {
  productArchiveContract,
  productArchiveRequestSchema,
  productCreateContract,
  productCreateRequestSchema,
  productEditContract,
  productEditRequestSchema,
  productListContract,
  productMergeContract,
  productMergeRequestSchema,
  productReadContract,
  productSchema,
  type CatalogFieldError,
  type Product,
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
import { CatalogDenied, CatalogService } from "./catalog.service.js";

@Controller()
export class CatalogController {
  public constructor(private readonly catalog: CatalogService) {}

  @Get(productListContract.path)
  public async list(@Req() request: Request): Promise<{ products: Product[] }> {
    return await translateCatalogDenial(() => this.catalog.list(request));
  }

  @Get(productReadContract.path)
  public async read(
    @Param("productId") productId: string,
    @Req() request: Request,
  ): Promise<Product> {
    return await translateCatalogDenial(async () => {
      const id = productSchema.shape.id.safeParse(productId);
      if (!id.success) {
        return await this.catalog.rejectMissingProduct(
          request,
          "catalog.product.read",
          undefined,
        );
      }
      return await this.catalog.read(request, id.data);
    });
  }

  @Post(productCreateContract.path)
  @HttpCode(201)
  public async create(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Product> {
    return await translateCatalogDenial(async () => {
      const input = productCreateRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.catalog.rejectInvalidBody(
          request,
          "catalog.product.create",
          fieldErrors(input.error),
        );
      }
      const duplicates = duplicateBarcodeErrors(input.data.barcodes);
      if (duplicates.length > 0) {
        return await this.catalog.rejectInvalidBody(
          request,
          "catalog.product.create",
          duplicates,
        );
      }
      return await this.catalog.create(request, input.data);
    });
  }

  @Put(productEditContract.path)
  public async edit(
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Product> {
    return await translateCatalogDenial(async () => {
      const id = productSchema.shape.id.safeParse(productId);
      const input = productEditRequestSchema.safeParse(body);
      if (!id.success || !input.success) {
        return await this.catalog.rejectInvalidBody(
          request,
          "catalog.product.edit",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["productId"] }],
          id.success ? id.data : undefined,
        );
      }
      const duplicates = duplicateBarcodeErrors(input.data.barcodes);
      if (duplicates.length > 0) {
        return await this.catalog.rejectInvalidBody(
          request,
          "catalog.product.edit",
          duplicates,
          id.data,
        );
      }
      return await this.catalog.edit(request, id.data, input.data);
    });
  }

  @Post(productArchiveContract.path)
  @HttpCode(201)
  public async archive(
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Product> {
    return await translateCatalogDenial(async () => {
      const id = productSchema.shape.id.safeParse(productId);
      const input = productArchiveRequestSchema.safeParse(body);
      if (!id.success || !input.success) {
        return await this.catalog.rejectInvalidBody(
          request,
          "catalog.product.archive",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["productId"] }],
          id.success ? id.data : undefined,
        );
      }
      return await this.catalog.archive(request, id.data, input.data);
    });
  }

  @Post(productMergeContract.path)
  @HttpCode(201)
  public async merge(
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Product> {
    return await translateCatalogDenial(async () => {
      const id = productSchema.shape.id.safeParse(productId);
      const input = productMergeRequestSchema.safeParse(body);
      if (!id.success || !input.success) {
        return await this.catalog.rejectInvalidBody(
          request,
          "catalog.product.merge",
          id.success && !input.success
            ? fieldErrors(input.error)
            : [{ code: "invalid", path: ["productId"] }],
          id.success ? id.data : undefined,
        );
      }
      return await this.catalog.merge(request, id.data, input.data);
    });
  }
}

async function translateCatalogDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof CatalogDenied) {
      throw new HttpException(error.denial, error.statusCode);
    }
    throw error;
  }
}

function duplicateBarcodeErrors(
  barcodes: readonly string[],
): CatalogFieldError[] {
  const firstIndex = new Map<string, number>();
  const errors: CatalogFieldError[] = [];
  for (const [index, barcode] of barcodes.entries()) {
    if (firstIndex.has(barcode)) {
      errors.push({ code: "invalid", path: ["barcodes", index] });
    } else {
      firstIndex.set(barcode, index);
    }
  }
  return errors;
}

interface ValidationError {
  readonly issues: readonly ValidationIssue[];
}

interface ValidationIssue {
  readonly code: string;
  readonly input?: unknown;
  readonly keys?: readonly string[];
  readonly origin?: unknown;
  readonly path: readonly PropertyKey[];
}

function fieldErrors(error: ValidationError): CatalogFieldError[] {
  const errors: CatalogFieldError[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys ?? []) {
        errors.push({
          code: "unknown-field",
          path: [...pathParts(issue.path), key],
        });
      }
      continue;
    }
    errors.push({ code: fieldErrorCode(issue), path: wirePath(issue.path) });
  }
  return errors.length > 0 ? errors : [{ code: "invalid", path: ["body"] }];
}

function fieldErrorCode(issue: ValidationIssue): CatalogFieldError["code"] {
  if (issue.code === "too_big") {
    return issue.origin === "string" ? "too-long" : "out-of-range";
  }
  if (issue.code === "too_small") {
    return issue.input === "" || issue.input === undefined
      ? "required"
      : "out-of-range";
  }
  if (issue.code === "invalid_type" && issue.input === undefined) {
    return "required";
  }
  return "invalid";
}

function pathParts(path: readonly PropertyKey[]): (string | number)[] {
  return path.filter(
    (part): part is string | number =>
      typeof part === "string" || typeof part === "number",
  );
}

/**
 * A whole-body rejection still needs somewhere to point, so a path that walks
 * to nothing falls back to the body itself. A rejection that names a key uses
 * {@link pathParts} instead: the key is already the field the screen must
 * focus, and prefixing it would stop the renderer finding that field.
 */
function wirePath(path: readonly PropertyKey[]): (string | number)[] {
  const result = pathParts(path);
  return result.length > 0 ? result : ["body"];
}

export { translateCatalogDenial };
