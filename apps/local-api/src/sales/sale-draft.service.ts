import {
  saleDraftCreateContract,
  saleDraftResumeContract,
  saleDraftLineAddContract,
  saleDraftMiscLineAddContract,
  saleDraftLineChangeContract,
  saleDraftLinePriceOverrideContract,
  saleDraftLineRemoveContract,
  saleDraftInvoiceDiscountContract,
  saleDraftClearContract,
  saleDraftSuspendContract,
  saleDraftDiscardContract,
  saleDraftSchema,
  saleProductContextSchema,
  saleProductSearchResponseSchema,
  salesDenialSchema,
  type CatalogFieldError,
  type IdentityDenial,
  type SaleDraft,
  type SaleDraftLineAddRequest,
  type SaleDraftMiscLineAddRequest,
  type SaleDraftLineChangeRequest,
  type SaleDraftLinePriceOverrideRequest,
  type SaleDraftLineRemoveRequest,
  type SaleDraftInvoiceDiscountRequest,
  type ProductSearchRequest,
  type SaleProductSearchResponse,
  type SaleProductContext,
  type SalesDenial,
} from "@breev/contracts/local-rest";
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

import { CatalogService } from "../catalog/catalog.service.js";
import {
  addSaleLine,
  addMiscSaleLine,
  changeSaleLine,
  clearSaleLines,
  lineView,
  listSaleLines,
  overrideSaleLinePrice,
  removeSaleLine,
  resolveRetailProduct,
  type SaleLineRecord,
} from "./sale-draft-lines.js";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { businessDateOf, daysBetween } from "../inventory/business-date.js";
import { readNearExpiryDays } from "../inventory/inventory-persistence.js";
import { readInventoryPositions } from "../inventory/inventory-review.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import {
  canonicalRequestHash,
  type JsonObject,
} from "../posting/canonical-hash.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
  type PostingCommandReplay,
} from "../posting/idempotency.js";
import {
  insertSaleDraft,
  listSaleDrafts,
  lockSaleDraft,
  readSaleDraft,
  touchSaleDraft,
  type SaleDraftRecord,
  type SaleDraftStatus,
} from "./sale-draft-persistence.js";

const MANAGE_PERMISSION = "sales.drafts.manage" as const;
const MISC_PERMISSION = "sales.misc.manage" as const;
const PRICE_OVERRIDE_PERMISSION = "draft.price.override" as const;
const COMMANDS = {
  create: "sale.draft.create",
  resume: "sale.draft.resume",
  lineAdd: "sale.draft.line.add",
  miscLineAdd: "sale.draft.misc-line.add",
  lineChange: "sale.draft.line.change",
  linePriceOverride: "sale.draft.line.price-override",
  lineRemove: "sale.draft.line.remove",
  discount: "sale.draft.discount",
  clear: "sale.draft.clear",
  suspend: "sale.draft.suspend",
  discard: "sale.draft.discard",
} as const;

type SaleDraftCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
type SalesFieldError = CatalogFieldError & { readonly rule?: string };

interface CommandSuccess {
  readonly afterState: JsonObject;
  readonly beforeState?: JsonObject;
  readonly reason?: string;
  readonly targetId: string;
  readonly value: SaleDraft;
}

interface SaleDraftCommandExecution {
  readonly commandName: SaleDraftCommandName;
  readonly context: IdentityExecutionContext;
  readonly idempotencyKey: string;
  readonly parser: { parse(value: unknown): SaleDraft };
  readonly requestHash: Buffer;
  readonly successStatus: 200 | 201;
  readonly targetId?: string;
  readonly priceOverride?: boolean;
  readonly work: (client: PoolClient) => Promise<CommandSuccess>;
}

interface SaleDraftCommandRejection {
  readonly code: SalesDenial["code"];
  readonly fieldErrors: readonly SalesFieldError[];
  readonly statusCode: 400 | 404 | 409;
  readonly targetId?: string;
  readonly currentDraft?: SaleDraft;
}

class SaleDraftCommandRejected extends Error {
  public constructor(public readonly rejection: SaleDraftCommandRejection) {
    super(rejection.code);
    this.name = "SaleDraftCommandRejected";
  }
}

export class SaleDraftDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: IdentityDenial | SalesDenial,
  ) {
    super(denial.code);
    this.name = "SaleDraftDenied";
  }
}

@Injectable()
export class SaleDraftService {
  private readonly logger = new Logger(SaleDraftService.name);

  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
    private readonly catalog: CatalogService,
  ) {}

  public async searchProducts(
    request: Request,
    input: ProductSearchRequest,
  ): Promise<SaleProductSearchResponse> {
    await this.identity.requirePermission(request, MANAGE_PERMISSION);
    const result = await this.catalog.search(request, input);
    return saleProductSearchResponseSchema.parse({
      hasMore: result.hasMore,
      query: result.query,
      resultCount: result.resultCount,
      results: result.results.map(({ matchedField, product }) => ({
        matchedField,
        product: {
          id: product.id,
          displayName: product.displayName,
          arabicSearchName: product.arabicSearchName,
          retailPriceFils: product.pricing.retailPriceFils,
        },
      })),
    });
  }

  public async readProductContext(
    request: Request,
    productId: string,
  ): Promise<SaleProductContext> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const product = await this.catalog.readSaleContext(request, productId);
    if (product !== undefined) {
      const client = await this.localDatabase.requirePool().connect();
      try {
        const timeZone = await this.identity.readPharmacyBusinessTimeZone(
          client,
          context.pharmacyId,
        );
        const businessDate = businessDateOf(new Date(), timeZone);
        const nearExpiryDays = await readNearExpiryDays(
          client,
          context.pharmacyId,
        );
        const [position] = await readInventoryPositions(
          client,
          context.pharmacyId,
          businessDate,
          nearExpiryDays,
          { productIds: [productId] },
        );
        const maximum = product.stockLevels.maximumLevel;
        const surplus =
          position === undefined || maximum === null
            ? null
            : position.balance > BigInt(maximum)
              ? position.balance - BigInt(maximum)
              : 0n;
        return saleProductContextSchema.parse({
          ...product,
          inventory: {
            onHandBaseUnits: position?.balance.toString() ?? null,
            estimatedSurplusBaseUnits: surplus?.toString() ?? null,
            batches:
              position?.batches
                .filter((batch) => batch.balance > 0n)
                .map((batch) => ({
                  batchId: batch.batchId,
                  balanceBaseUnits: batch.balance.toString(),
                  effectiveExpiryDate: batch.effectiveExpiryDate,
                  daysRemaining:
                    batch.effectiveExpiryDate === null
                      ? null
                      : daysBetween(businessDate, batch.effectiveExpiryDate),
                  lotNumber: batch.lotNumber,
                  status: batch.status,
                })) ?? [],
          },
        });
      } finally {
        client.release();
      }
    }
    const client = await this.localDatabase.requirePool().connect();
    try {
      const requestId = await writePostingAudit(client, {
        action: "sales.product-context.read",
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: "sale-product-unavailable",
        pharmacyId: context.pharmacyId,
        targetId: productId,
      });
      throw denied(404, "sale-product-unavailable", requestId);
    } finally {
      client.release();
    }
  }

  public async createDraft(
    request: Request,
    input: { readonly idempotencyKey: string },
  ): Promise<SaleDraft> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName: COMMANDS.create,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: saleDraftCreateContract.responses[201],
      requestHash: canonicalRequestHash(COMMANDS.create, input),
      successStatus: 201,
      work: async (client) => {
        const row = await insertSaleDraft(client, {
          createdBy: context.actorId,
          deviceId,
          pharmacyId: context.pharmacyId,
          updatedBy: context.actorId,
        });
        const draft = await this.toSaleDraft(client, context, row);
        return {
          afterState: { status: draft.status, version: draft.version },
          targetId: draft.id,
          value: draft,
        };
      },
    });
  }

  public async resumeDraft(
    request: Request,
    draftId: string,
    input: {
      readonly expectedVersion: string;
      readonly idempotencyKey: string;
    },
  ): Promise<SaleDraft> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName: COMMANDS.resume,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: saleDraftResumeContract.responses[200],
      requestHash: canonicalRequestHash(COMMANDS.resume, { draftId, input }),
      successStatus: 200,
      targetId: draftId,
      work: async (client) => {
        const row = await lockSaleDraft(client, context.pharmacyId, draftId);
        requireDraft(row, draftId);
        if (row.version !== input.expectedVersion) {
          reject(
            409,
            "version-conflict",
            versionError(),
            draftId,
            await this.toSaleDraft(client, context, row),
          );
        }
        if (row.status === "discarded")
          reject(409, "sale-draft-inactive", [], draftId);
        const updated = await touchSaleDraft(client, {
          deviceId,
          id: draftId,
          pharmacyId: context.pharmacyId,
          updatedBy: context.actorId,
          status: "active",
        });
        const draft = await this.toSaleDraft(client, context, updated);
        return {
          afterState: { status: draft.status, version: draft.version },
          beforeState: { status: row.status, version: row.version },
          targetId: draftId,
          value: draft,
        };
      },
    });
  }

  public async addLine(
    request: Request,
    draftId: string,
    input: SaleDraftLineAddRequest,
  ): Promise<SaleDraft> {
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.lineAdd,
      input,
      saleDraftLineAddContract.responses[200],
      async (client, row) => {
        const product = await resolveRetailProduct(
          client,
          row.pharmacyId,
          input.productId,
        );
        if (product === undefined)
          reject(
            400,
            "sale-product-unavailable",
            [{ code: "invalid", path: ["productId"] }],
            draftId,
          );
        const selected =
          input.unitId === undefined
            ? product
            : product.eligibleUnits.find(
                (unit) => unit.unitId === input.unitId,
              );
        if (selected === undefined)
          reject(
            400,
            "sale-unit-invalid",
            [{ code: "invalid", path: ["unitId"] }],
            draftId,
          );
        const unitPrice = roundHalfUp(
          BigInt(product.retailPriceFils) * BigInt(selected.baseUnitsPerUnit),
          BigInt(product.baseUnitsPerUnit),
        );
        if (unitPrice > BIGINT_MAX)
          reject(400, "sale-quantity-invalid", [], draftId);
        await addSaleLine(client, {
          pharmacyId: row.pharmacyId,
          draftId,
          ...product,
          unitId: selected.unitId,
          unitName: selected.unitName,
          baseUnitsPerUnit: selected.baseUnitsPerUnit,
          capturedUnitRatio: product.baseUnitsPerUnit,
          unitPriceFils: unitPrice.toString(),
        });
      },
    );
  }

  public async addMiscLine(
    request: Request,
    draftId: string,
    input: SaleDraftMiscLineAddRequest,
  ): Promise<SaleDraft> {
    await this.identity.requirePermission(request, MANAGE_PERMISSION);
    await this.identity.requirePermission(request, MISC_PERMISSION);
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.miscLineAdd,
      input,
      saleDraftMiscLineAddContract.responses[200],
      async (client, row) => {
        if (BigInt(input.quantity) > BIGINT_MAX)
          reject(
            400,
            "sale-quantity-invalid",
            [{ code: "out-of-range", path: ["quantity"] }],
            draftId,
          );
        await addMiscSaleLine(client, {
          pharmacyId: row.pharmacyId,
          draftId,
          ...input,
        });
      },
    );
  }

  public async changeLine(
    request: Request,
    draftId: string,
    lineId: string,
    input: SaleDraftLineChangeRequest,
  ): Promise<SaleDraft> {
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.lineChange,
      { lineId, ...input },
      saleDraftLineChangeContract.responses[200],
      async (client, row) => {
        const line = (
          await listSaleLines(client, row.pharmacyId, [draftId])
        ).find((item) => item.id === lineId);
        if (line === undefined) reject(404, "sale-line-not-found", [], draftId);
        if (line.kind === "misc") {
          if (input.unitId !== undefined)
            reject(
              400,
              "sale-unit-invalid",
              [{ code: "invalid", path: ["unitId"] }],
              draftId,
            );
          const quantity = input.quantity ?? line.quantity;
          if (BigInt(quantity) > BIGINT_MAX)
            reject(
              400,
              "sale-quantity-invalid",
              [{ code: "out-of-range", path: ["quantity"] }],
              draftId,
            );
          await changeSaleLine(client, row.pharmacyId, draftId, lineId, {
            unitId: null,
            unitName: line.unitName,
            baseUnitsPerUnit: "1",
            quantity,
            unitPriceFils: line.unitPriceFils,
            lineDiscountPercentage:
              input.lineDiscountPercentage ?? line.lineDiscountPercentage,
            priceSource: "misc",
            priceOverrideReason: null,
          });
          return;
        }
        const selected = line.eligibleUnits.find(
          (unit) => unit.unitId === (input.unitId ?? line.unitId),
        );
        if (selected === undefined)
          reject(
            400,
            "sale-unit-invalid",
            [{ code: "invalid", path: ["unitId"] }],
            draftId,
          );
        const oldBaseQuantity =
          BigInt(line.quantity) * BigInt(line.baseUnitsPerUnit);
        const nextRatio = BigInt(selected.baseUnitsPerUnit);
        const quantity =
          input.quantity ??
          (input.unitId === undefined
            ? line.quantity
            : oldBaseQuantity % nextRatio === 0n
              ? (oldBaseQuantity / nextRatio).toString()
              : "0");
        if (BigInt(quantity) < 1n || BigInt(quantity) > BIGINT_MAX)
          reject(
            400,
            "sale-quantity-invalid",
            [{ code: "invalid", path: ["quantity"] }],
            draftId,
          );
        if (
          input.unitId !== undefined &&
          input.quantity === undefined &&
          oldBaseQuantity % nextRatio !== 0n
        )
          reject(
            400,
            "sale-quantity-invalid",
            [{ code: "invalid", path: ["unitId"] }],
            draftId,
          );
        const unitChanged =
          input.unitId !== undefined && input.unitId !== line.unitId;
        const unitPrice =
          line.priceSource === "manual" && !unitChanged
            ? BigInt(line.unitPriceFils)
            : roundHalfUp(
                BigInt(line.capturedRetailPriceFils) * nextRatio,
                BigInt(line.capturedUnitRatio),
              );
        if (unitPrice > BIGINT_MAX)
          reject(400, "sale-quantity-invalid", [], draftId);
        await changeSaleLine(client, row.pharmacyId, draftId, lineId, {
          unitId: selected.unitId,
          unitName: selected.unitName,
          baseUnitsPerUnit: selected.baseUnitsPerUnit,
          quantity,
          unitPriceFils: unitPrice.toString(),
          lineDiscountPercentage:
            input.lineDiscountPercentage ?? line.lineDiscountPercentage,
          priceSource: unitChanged ? "retail" : line.priceSource,
          priceOverrideReason: unitChanged ? null : line.priceOverrideReason,
        });
      },
    );
  }

  public async overrideLinePrice(
    request: Request,
    draftId: string,
    lineId: string,
    input: SaleDraftLinePriceOverrideRequest,
  ): Promise<SaleDraft> {
    await this.identity.requirePermission(request, MANAGE_PERMISSION);
    await this.identity.requirePermission(request, PRICE_OVERRIDE_PERMISSION);
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.linePriceOverride,
      { lineId, ...input },
      saleDraftLinePriceOverrideContract.responses[200],
      async (client, row) => {
        const line = (
          await listSaleLines(client, row.pharmacyId, [draftId])
        ).find((item) => item.id === lineId);
        if (line === undefined) reject(404, "sale-line-not-found", [], draftId);
        if (
          line.kind !== "catalog" ||
          line.productId === null ||
          line.unitId === null
        )
          reject(
            400,
            "sale-price-invalid",
            [{ code: "invalid", path: ["lineId"] }],
            draftId,
          );
        const product = await resolveRetailProduct(
          client,
          row.pharmacyId,
          line.productId,
        );
        if (product === undefined)
          reject(
            400,
            "sale-product-unavailable",
            [{ code: "invalid", path: ["lineId"] }],
            draftId,
          );
        if (!product.eligibleUnits.some((unit) => unit.unitId === line.unitId))
          reject(
            400,
            "sale-unit-invalid",
            [{ code: "invalid", path: ["lineId"] }],
            draftId,
          );
        if (BigInt(input.unitPriceFils) * BigInt(line.quantity) > BIGINT_MAX)
          reject(
            400,
            "sale-price-invalid",
            [{ code: "out-of-range", path: ["unitPriceFils"] }],
            draftId,
          );
        await overrideSaleLinePrice(client, {
          pharmacyId: row.pharmacyId,
          draftId,
          lineId,
          unitPriceFils: input.unitPriceFils,
          currentRetailPriceFils: product.retailPriceFils,
          currentUnitRatio: product.baseUnitsPerUnit,
          currentPriceVersion: product.priceVersion,
          reason: input.reason,
        });
        return {
          auditBefore: {
            lineId,
            unitPriceFils: line.unitPriceFils,
            priceSource: line.priceSource,
            priceVersion: line.priceVersion,
          },
          auditAfter: {
            lineId,
            unitPriceFils: input.unitPriceFils,
            priceSource: "manual",
            priceVersion: product.priceVersion,
          },
          auditReason: input.reason,
        };
      },
      true,
    );
  }

  public async removeLine(
    request: Request,
    draftId: string,
    lineId: string,
    input: SaleDraftLineRemoveRequest,
  ): Promise<SaleDraft> {
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.lineRemove,
      { lineId, ...input },
      saleDraftLineRemoveContract.responses[200],
      async (client, row) => {
        const line = (
          await listSaleLines(client, row.pharmacyId, [draftId])
        ).find((item) => item.id === lineId);
        if (line === undefined) reject(404, "sale-line-not-found", [], draftId);
        await removeSaleLine(client, row.pharmacyId, draftId, lineId);
      },
    );
  }

  public async setInvoiceDiscount(
    request: Request,
    draftId: string,
    input: SaleDraftInvoiceDiscountRequest,
  ): Promise<SaleDraft> {
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.discount,
      input,
      saleDraftInvoiceDiscountContract.responses[200],
      async (client, row) => {
        const lines = await listSaleLines(client, row.pharmacyId, [draftId]);
        if (BigInt(input.invoiceDiscountFils) > subtotal(lines))
          reject(
            400,
            "sale-discount-invalid",
            [{ code: "out-of-range", path: ["invoiceDiscountFils"] }],
            draftId,
          );
        return { invoiceDiscountFils: input.invoiceDiscountFils };
      },
    );
  }

  public async clearDraft(
    request: Request,
    draftId: string,
    input: SaleDraftLineRemoveRequest,
  ): Promise<SaleDraft> {
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.clear,
      input,
      saleDraftClearContract.responses[200],
      async (client, row) => {
        await clearSaleLines(client, row.pharmacyId, draftId);
        return { invoiceDiscountFils: "0" };
      },
    );
  }

  public async suspendDraft(
    request: Request,
    draftId: string,
    input: SaleDraftLineRemoveRequest,
  ): Promise<SaleDraft> {
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.suspend,
      input,
      saleDraftSuspendContract.responses[200],
      async () => ({ status: "suspended" }),
    );
  }

  public async discardDraft(
    request: Request,
    draftId: string,
    input: SaleDraftLineRemoveRequest,
  ): Promise<SaleDraft> {
    return await this.mutateDraft(
      request,
      draftId,
      COMMANDS.discard,
      input,
      saleDraftDiscardContract.responses[200],
      async () => ({ status: "discarded" }),
    );
  }

  private async mutateDraft<
    T extends { expectedVersion: string; idempotencyKey: string },
  >(
    request: Request,
    draftId: string,
    commandName: SaleDraftCommandName,
    input: T,
    parser: { parse(value: unknown): SaleDraft },
    work: (
      client: PoolClient,
      row: SaleDraftRecord,
    ) => Promise<{
      readonly status?: SaleDraftStatus;
      readonly invoiceDiscountFils?: string;
      readonly auditBefore?: JsonObject;
      readonly auditAfter?: JsonObject;
      readonly auditReason?: string;
    } | void>,
    priceOverride = false,
  ): Promise<SaleDraft> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName,
      context,
      idempotencyKey: input.idempotencyKey,
      parser,
      requestHash: canonicalRequestHash(commandName, { draftId, input }),
      successStatus: 200,
      targetId: draftId,
      priceOverride,
      work: async (client) => {
        const row = await lockSaleDraft(client, context.pharmacyId, draftId);
        requireDraft(row, draftId);
        if (row.version !== input.expectedVersion)
          reject(
            409,
            "version-conflict",
            versionError(),
            draftId,
            await this.toSaleDraft(client, context, row),
          );
        if (row.status !== "active")
          reject(409, "sale-draft-inactive", [], draftId);
        const changed = await work(client, row);
        const { auditBefore, auditAfter, auditReason, ...options } =
          changed ?? {};
        const nextLines = await listSaleLines(client, context.pharmacyId, [
          draftId,
        ]);
        const nextDiscount = BigInt(
          options.invoiceDiscountFils ?? row.invoiceDiscountFils,
        );
        const nextSubtotal = subtotal(nextLines);
        const nextGross = nextLines.reduce(
          (sum, line) =>
            sum + BigInt(line.quantity) * BigInt(line.unitPriceFils),
          0n,
        );
        if (
          nextDiscount > nextSubtotal ||
          nextSubtotal > BIGINT_MAX ||
          nextGross > BIGINT_MAX
        )
          reject(400, "sale-discount-invalid", [], draftId);
        const updated = await touchSaleDraft(client, {
          deviceId,
          id: draftId,
          pharmacyId: context.pharmacyId,
          updatedBy: context.actorId,
          ...options,
        });
        const draft = await this.toSaleDraft(client, context, updated);
        if (
          BigInt(draft.totals.totalFils) > BIGINT_MAX ||
          BigInt(draft.totals.grossFils) > BIGINT_MAX ||
          BigInt(draft.invoiceDiscountFils) >
            BigInt(draft.totals.grossFils) -
              BigInt(draft.totals.lineDiscountFils)
        )
          reject(400, "sale-discount-invalid", [], draftId);
        return {
          beforeState: {
            status: row.status,
            version: row.version,
            ...auditBefore,
          },
          afterState: {
            status: draft.status,
            version: draft.version,
            lineCount: draft.lines.length,
            totalFils: draft.totals.totalFils,
            ...auditAfter,
          },
          targetId: draftId,
          ...(auditReason === undefined ? {} : { reason: auditReason }),
          value: draft,
        };
      },
    });
  }

  public async listDrafts(
    request: Request,
    status?: SaleDraftStatus,
  ): Promise<{ readonly drafts: readonly SaleDraft[] }> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const rows = await listSaleDrafts(client, context.pharmacyId, status);
      return { drafts: await this.toSaleDrafts(client, context, rows) };
    } finally {
      client.release();
    }
  }

  public async readDraft(
    request: Request,
    draftId: string,
  ): Promise<SaleDraft> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const row = await readSaleDraft(client, context.pharmacyId, draftId);
      if (row === undefined) {
        const requestId = await writePostingAudit(client, {
          action: "sales.draft.read",
          actorUserId: context.actorId,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "sale-draft-not-found",
          pharmacyId: context.pharmacyId,
          targetId: draftId,
        });
        throw denied(404, "sale-draft-not-found", requestId);
      }
      return await this.toSaleDraft(client, context, row);
    } finally {
      client.release();
    }
  }

  public async rejectInvalidBody(
    request: Request,
    action: string,
    fieldErrors: readonly SalesFieldError[],
  ): Promise<never> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    if (action === COMMANDS.linePriceOverride)
      await this.identity.requirePermission(request, PRICE_OVERRIDE_PERMISSION);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const requestId = await writePostingAudit(client, {
        action,
        actorUserId: context.actorId,
        afterState: { fieldErrorCount: fieldErrors.length },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "body-invalid",
        pharmacyId: context.pharmacyId,
      });
      throw denied(400, "body-invalid", requestId, fieldErrors);
    } finally {
      client.release();
    }
  }

  private async executeCommand(
    input: SaleDraftCommandExecution,
  ): Promise<SaleDraft> {
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        if (input.priceOverride)
          await this.identity.revalidateSalePriceOverride(
            client,
            input.context,
          );
        else await this.identity.revalidateSaleDrafts(client, input.context);
        let replay: PostingCommandReplay | undefined;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName: input.commandName,
            idempotencyKey: input.idempotencyKey,
            pharmacyId: input.context.pharmacyId,
            requestHash: input.requestHash,
          });
        } catch (error) {
          if (!(error instanceof PostingIdempotencyConflict)) throw error;
          const requestId = await writePostingAudit(client, {
            action: input.commandName,
            actorUserId: input.context.actorId,
            correlationId: input.idempotencyKey,
            device: input.context,
            identitySessionId: input.context.sessionId,
            outcome: "idempotency-conflict",
            pharmacyId: input.context.pharmacyId,
            ...(input.targetId === undefined
              ? {}
              : { targetId: input.targetId }),
          });
          await client.query("commit");
          transactionOpen = false;
          throw denied(409, "idempotency-conflict", requestId);
        }
        if (replay !== undefined) {
          await client.query("commit");
          transactionOpen = false;
          if (replay.responseStatus === input.successStatus) {
            return input.parser.parse(replay.responseBody);
          }
          throw new SaleDraftDenied(
            replay.responseStatus,
            salesDenialSchema.parse(replay.responseBody),
          );
        }
        let success: CommandSuccess;
        await client.query("savepoint sale_draft_work");
        try {
          success = await input.work(client);
        } catch (error) {
          if (!(error instanceof SaleDraftCommandRejected)) throw error;
          await client.query("rollback to savepoint sale_draft_work");
          const rejection = error.rejection;
          const targetId = rejection.targetId ?? input.targetId;
          const requestId = await writePostingAudit(client, {
            action: input.commandName,
            actorUserId: input.context.actorId,
            correlationId: input.idempotencyKey,
            device: input.context,
            identitySessionId: input.context.sessionId,
            outcome: rejection.code,
            pharmacyId: input.context.pharmacyId,
            ...(targetId === undefined ? {} : { targetId }),
          });
          const response = denied(
            rejection.statusCode,
            rejection.code,
            requestId,
            rejection.fieldErrors,
            rejection.currentDraft,
          );
          await recordPostingResult(client, {
            actorUserId: input.context.actorId,
            commandName: input.commandName,
            device: input.context,
            idempotencyKey: input.idempotencyKey,
            identitySessionId: input.context.sessionId,
            pharmacyId: input.context.pharmacyId,
            requestHash: input.requestHash,
            responseBody: response.denial,
            responseStatus: rejection.statusCode,
          });
          await client.query("commit");
          transactionOpen = false;
          throw response;
        }
        await writePostingAudit(client, {
          action: input.commandName,
          actorUserId: input.context.actorId,
          afterState: success.afterState,
          ...(success.beforeState === undefined
            ? {}
            : { beforeState: success.beforeState }),
          correlationId: input.idempotencyKey,
          device: input.context,
          identitySessionId: input.context.sessionId,
          outcome: "committed",
          ...(success.reason === undefined ? {} : { reason: success.reason }),
          pharmacyId: input.context.pharmacyId,
          targetId: success.targetId,
        });
        await recordPostingResult(client, {
          actorUserId: input.context.actorId,
          commandName: input.commandName,
          device: input.context,
          idempotencyKey: input.idempotencyKey,
          identitySessionId: input.context.sessionId,
          pharmacyId: input.context.pharmacyId,
          requestHash: input.requestHash,
          responseBody: success.value,
          responseStatus: input.successStatus,
        });
        await client.query("commit");
        transactionOpen = false;
        return success.value;
      } catch (error) {
        if (transactionOpen) {
          await client.query("rollback").catch(() => undefined);
        }
        if (!(error instanceof SaleDraftDenied)) {
          this.logger.error(
            "Sale Draft command failed",
            error instanceof Error ? error.stack : String(error),
          );
        }
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async toSaleDrafts(
    client: PoolClient,
    context: IdentityExecutionContext,
    rows: readonly SaleDraftRecord[],
  ): Promise<readonly SaleDraft[]> {
    const names = await this.identity.resolveUserDisplayNames(
      client,
      context.pharmacyId,
      [...new Set(rows.flatMap((row) => [row.createdBy, row.updatedBy]))],
    );
    const lines = await listSaleLines(
      client,
      context.pharmacyId,
      rows.map((row) => row.id),
    );
    return rows.map((row) =>
      saleDraftView(
        row,
        names,
        lines.filter((line) => line.draftId === row.id),
      ),
    );
  }

  private async toSaleDraft(
    client: PoolClient,
    context: IdentityExecutionContext,
    row: SaleDraftRecord,
  ): Promise<SaleDraft> {
    const [draft] = await this.toSaleDrafts(client, context, [row]);
    if (draft === undefined) throw new Error("The Sale Draft was not found");
    return draft;
  }
}

function requireDeviceId(context: IdentityExecutionContext): string {
  const deviceId = context.deviceId ?? context.terminalDeviceId;
  if (deviceId === undefined) throw new Error("Sale Draft device unavailable");
  return deviceId;
}

function requireDraft(
  draft: SaleDraftRecord | undefined,
  draftId: string,
): asserts draft is SaleDraftRecord {
  if (draft === undefined) reject(404, "sale-draft-not-found", [], draftId);
}

function reject(
  statusCode: 400 | 404 | 409,
  code: SalesDenial["code"],
  fieldErrors: readonly SalesFieldError[] = [],
  targetId?: string,
  currentDraft?: SaleDraft,
): never {
  throw new SaleDraftCommandRejected({
    code,
    fieldErrors,
    statusCode,
    ...(targetId === undefined ? {} : { targetId }),
    ...(currentDraft === undefined ? {} : { currentDraft }),
  });
}

function denied(
  statusCode: 400 | 404 | 409,
  code: SalesDenial["code"],
  requestId: string,
  fieldErrors: readonly SalesFieldError[] = [],
  currentDraft?: SaleDraft,
): SaleDraftDenied {
  return new SaleDraftDenied(
    statusCode,
    salesDenialSchema.parse({
      code,
      fieldErrors,
      requestId,
      status: "denied",
      ...(currentDraft === undefined ? {} : { currentDraft }),
    }),
  );
}

function saleDraftView(
  row: SaleDraftRecord,
  names: ReadonlyMap<string, string>,
  records: readonly SaleLineRecord[],
): SaleDraft {
  const lines = records.map(lineView);
  const gross = lines.reduce((sum, line) => sum + BigInt(line.grossFils), 0n);
  const lineDiscount = lines.reduce(
    (sum, line) => sum + BigInt(line.discountFils),
    0n,
  );
  const invoiceDiscount = BigInt(row.invoiceDiscountFils);
  return saleDraftSchema.parse({
    createdAt: row.createdAt,
    createdBy: person(row.createdBy, names),
    id: row.id,
    invoiceDiscountFils: row.invoiceDiscountFils,
    lines,
    status: row.status,
    totals: {
      grossFils: gross.toString(),
      lineDiscountFils: lineDiscount.toString(),
      invoiceDiscountFils: row.invoiceDiscountFils,
      totalFils: (gross - lineDiscount - invoiceDiscount).toString(),
    },
    updatedAt: row.updatedAt,
    updatedBy: person(row.updatedBy, names),
    version: row.version,
  });
}

const BIGINT_MAX = 9_223_372_036_854_775_807n;

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function subtotal(lines: readonly SaleLineRecord[]): bigint {
  return lines.reduce(
    (sum, line) => sum + BigInt(lineView(line).totalFils),
    0n,
  );
}

function versionError(): readonly SalesFieldError[] {
  return [
    {
      code: "invalid",
      path: ["expectedVersion"],
      rule: "sales.draft.version-conflict",
    },
  ];
}

function person(
  id: string,
  names: ReadonlyMap<string, string>,
): SaleDraft["createdBy"] {
  return { displayName: names.get(id) ?? "—", id };
}
