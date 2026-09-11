import {
  inventoryDenialSchema,
  inventoryItemSchema,
  inventoryReviewPreferencesSchema,
  inventorySensitiveExportSchema,
  type IdentityDenial,
  type InventoryDenial,
  type InventoryItem,
  type InventoryMovement,
  type InventoryReviewPreferences,
  type InventoryReviewPreferencesUpdateRequest,
  type InventorySensitiveExport,
  type InventorySensitiveExportRequest,
  type CatalogFieldError,
} from "@breev/contracts/local-rest";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

import {
  resolveCatalogInventoryFacts,
  type CatalogInventoryFacts,
} from "../catalog/catalog-inventory.js";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import {
  readInventoryPositions,
  readProductMovements,
  type InventoryPosition,
  type ProductMovement,
} from "../inventory/inventory-review.js";
import { businessDateOf } from "../inventory/business-date.js";
import {
  readNearExpiryDays,
  resolveReceiptClassRuleSet,
} from "../inventory/inventory-persistence.js";
import { DEFAULT_NEAR_EXPIRY_DAYS } from "../inventory/inventory-receipt-rules.js";
import {
  automaticStateColour,
  consumptionRatePer30Days,
  effectiveStateColour,
  riskIndicators,
} from "../inventory/inventory-risk.js";
import {
  reportedAverageUnitCostScaled,
  VALUATION_SCALE,
} from "../inventory/inventory-valuation.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import { canonicalRequestHash } from "../posting/canonical-hash.js";
import { divideFilsRounded } from "../posting/money.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
  type PostingCommandReplay,
} from "../posting/idempotency.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import {
  resolvePostedPurchaseAdjustmentReferences,
  resolvePostedPurchaseReferences,
  resolvePostedPurchaseReturnReferences,
  resolveSupplierCostFacts,
  type PostedPurchaseAdjustmentReference,
  type PostedPurchaseReference,
  type PostedPurchaseReturnReference,
  type SupplierCostFact,
} from "../purchasing/purchasing-references.js";

const REVIEW_PERMISSION = "inventory.review" as const;
const VALUATION_PERMISSION = "inventory.valuation.view" as const;
const PREFERENCES_COMMAND = "inventory.review-preferences.update";
const EXPORT_COMMAND = "inventory.sensitive-export";

const DEFAULT_PREFERENCES: InventoryReviewPreferences =
  inventoryReviewPreferencesSchema.parse({
    columns: [
      { field: "item", visible: true },
      { field: "balance", visible: true },
      { field: "value", visible: true },
      { field: "averageCost", visible: true },
      { field: "batches", visible: true },
      { field: "expiry", visible: true },
      { field: "levels", visible: true },
      { field: "reorderPoint", visible: true },
      { field: "consumptionRate", visible: true },
      { field: "risk", visible: true },
    ],
    revision: "1",
  });

export class InventoryReviewDenied extends Error {
  public readonly denial: IdentityDenial | InventoryDenial;
  public readonly statusCode: number;

  public constructor(
    statusCode: number,
    denial: IdentityDenial | InventoryDenial,
  ) {
    super(denial.code);
    this.name = "InventoryReviewDenied";
    this.denial = denial;
    this.statusCode = statusCode;
  }
}

@Injectable()
export class InventoryReviewService {
  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async listItems(request: Request): Promise<{
    readonly fields: { readonly valuation: "granted" | "denied" };
    readonly items: InventoryItem[];
  }> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const now = new Date();
      const timeZone = await this.identity.readPharmacyBusinessTimeZone(
        client,
        context.pharmacyId,
      );
      const businessDate = businessDateOf(now, timeZone);
      await resolveReceiptClassRuleSet(client, context.pharmacyId);
      const nearExpiryDays = await readNearExpiryDays(
        client,
        context.pharmacyId,
      );
      const positions = await readInventoryPositions(
        client,
        context.pharmacyId,
        businessDate,
        nearExpiryDays,
      );
      const facts = await resolveCatalogInventoryFacts(
        client,
        context.pharmacyId,
      );
      const positionByProduct = new Map(
        positions.map((position) => [position.productId, position]),
      );
      const valuationGranted =
        context.permissions.includes(VALUATION_PERMISSION);
      const items = [...facts.values()]
        .filter((fact) =>
          includeInReview(fact, positionByProduct.get(fact.productId)),
        )
        .map((fact) => {
          const position = positionByProduct.get(fact.productId);
          return itemView(
            fact,
            position,
            valuationGranted,
            now,
            businessDate,
            nearExpiryDays.get(fact.productId) ?? DEFAULT_NEAR_EXPIRY_DAYS,
          );
        });
      for (const position of positions) {
        if (position.reconciliation === "mismatch") {
          await writePostingAudit(client, {
            action: "inventory.review.reconciliation",
            actorUserId: context.actorId,
            afterState: {
              balance: position.balance.toString(),
              valueFils: position.valueFils.toString(),
              valuationQuantity: position.valuationQuantity.toString(),
              valuationValueScaled: position.valuationValueScaled.toString(),
            },
            device: context,
            identitySessionId: context.sessionId,
            outcome: "mismatch",
            pharmacyId: context.pharmacyId,
            targetId: position.productId,
          });
        }
      }
      return {
        fields: { valuation: valuationGranted ? "granted" : "denied" },
        items,
      };
    } finally {
      client.release();
    }
  }

  public async rejectInvalidBody(
    request: Request,
    fieldErrors: readonly CatalogFieldError[],
  ): Promise<never> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const requestId = await writePostingAudit(client, {
        action: "inventory.review.request",
        actorUserId: context.actorId,
        afterState: { fieldErrorCount: fieldErrors.length },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "body-invalid",
        pharmacyId: context.pharmacyId,
      });
      throw new InventoryReviewDenied(
        400,
        inventoryDenialSchema.parse({
          code: "body-invalid",
          fieldErrors,
          requestId,
          status: "denied",
        }),
      );
    } finally {
      client.release();
    }
  }

  public async readMovements(
    request: Request,
    productId: string,
  ): Promise<{
    readonly movements: InventoryMovement[];
    readonly productDisplayName: string;
    readonly productId: string;
  }> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const facts = await resolveCatalogInventoryFacts(
        client,
        context.pharmacyId,
      );
      const product = facts.get(productId);
      if (product === undefined) {
        throw await this.readDenial(client, context, productId);
      }
      const movements = await readProductMovements(
        client,
        context.pharmacyId,
        productId,
      );
      const purchaseIds = movements
        .filter(
          (movement) => movement.sourceDocumentType === "purchase-invoice",
        )
        .map((movement) => movement.sourceDocumentId);
      const adjustmentIds = movements
        .filter(
          (movement) => movement.sourceDocumentType === "purchase-adjustment",
        )
        .map((movement) => movement.sourceDocumentId);
      const returnIds = movements
        .filter((movement) => movement.sourceDocumentType === "purchase-return")
        .map((movement) => movement.sourceDocumentId);
      const [references, adjustmentReferences, returnReferences] =
        await Promise.all([
          resolvePostedPurchaseReferences(client, context.pharmacyId, [
            ...new Set(purchaseIds),
          ]),
          resolvePostedPurchaseAdjustmentReferences(
            client,
            context.pharmacyId,
            [...new Set(adjustmentIds)],
          ),
          resolvePostedPurchaseReturnReferences(client, context.pharmacyId, [
            ...new Set(returnIds),
          ]),
        ]);
      const displayNames = await this.identity.resolveUserDisplayNames(
        client,
        context.pharmacyId,
        [...new Set(movements.map((movement) => movement.userId))],
      );
      return {
        movements: movements.map((movement) => {
          const reference = movementReference(
            movement,
            references,
            adjustmentReferences,
            returnReferences,
          );
          const openable = context.permissions.includes(
            "purchases.posted.view",
          );
          const userName = displayNames.get(movement.userId);
          return {
            batchId: movement.batchId,
            id: movement.id,
            kind: movement.reason,
            occurredAt: movement.occurredAt.toISOString(),
            quantity: movement.quantity.toString(),
            reference: {
              documentId: reference.documentId,
              documentType: reference.documentType,
              label: reference.label,
              number: reference.number,
              openable,
            },
            user: {
              displayName: userName ?? "—",
              id: movement.userId,
            },
            valueFils: context.permissions.includes(VALUATION_PERMISSION)
              ? movement.carryingAmountFils.toString()
              : null,
          } satisfies InventoryMovement;
        }),
        productDisplayName: product.displayName,
        productId,
      };
    } finally {
      client.release();
    }
  }

  public async readPreferences(
    request: Request,
  ): Promise<InventoryReviewPreferences> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    const result = await this.localDatabase.requirePool().query<{
      columns: unknown;
      revision: string;
    }>(
      `select columns, revision::text
       from inventory_review_preferences
       where pharmacy_id = $1 and user_id = $2`,
      [context.pharmacyId, context.actorId],
    );
    return result.rows[0] === undefined
      ? DEFAULT_PREFERENCES
      : inventoryReviewPreferencesSchema.parse(result.rows[0]);
  }

  public async updatePreferences(
    request: Request,
    input: InventoryReviewPreferencesUpdateRequest,
  ): Promise<InventoryReviewPreferences> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        const fresh = await this.identity.revalidateInventoryReview(
          client,
          context,
          REVIEW_PERMISSION,
        );
        const requestHash = canonicalRequestHash(PREFERENCES_COMMAND, input);
        let replay: PostingCommandReplay | undefined;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName: PREFERENCES_COMMAND,
            idempotencyKey: input.idempotencyKey,
            pharmacyId: fresh.pharmacyId,
            requestHash,
          });
        } catch (error) {
          if (!(error instanceof PostingIdempotencyConflict)) throw error;
          return await this.commitCommandDenial(
            client,
            fresh,
            input.idempotencyKey,
            409,
            "idempotency-conflict",
          );
        }
        if (replay !== undefined) {
          await client.query("commit");
          transactionOpen = false;
          return inventoryReviewPreferencesSchema.parse(replay.responseBody);
        }
        const stored = await client.query<{
          columns: unknown;
          revision: string;
        }>(
          `select columns, revision::text
           from inventory_review_preferences
           where pharmacy_id = $1 and user_id = $2
           for update`,
          [fresh.pharmacyId, fresh.actorId],
        );
        const previous =
          stored.rows[0] === undefined
            ? DEFAULT_PREFERENCES
            : inventoryReviewPreferencesSchema.parse(stored.rows[0]);
        if (previous.revision !== input.expectedRevision) {
          const denial = await this.commitCommandDenial(
            client,
            fresh,
            input.idempotencyKey,
            409,
            "version-conflict",
          );
          return denial;
        }
        if (stored.rows[0] === undefined) {
          await client.query(
            `insert into inventory_review_preferences
             (pharmacy_id, user_id, columns, updated_by)
             values ($1, $2, $3::jsonb, $2)`,
            [fresh.pharmacyId, fresh.actorId, JSON.stringify(input.columns)],
          );
        } else {
          await client.query(
            `update inventory_review_preferences
             set columns = $3::jsonb, revision = revision + 1,
                 updated_at = statement_timestamp(), updated_by = $2
             where pharmacy_id = $1 and user_id = $2`,
            [fresh.pharmacyId, fresh.actorId, JSON.stringify(input.columns)],
          );
        }
        const saved = await client.query<{
          columns: unknown;
          revision: string;
        }>(
          `select columns, revision::text
           from inventory_review_preferences
           where pharmacy_id = $1 and user_id = $2`,
          [fresh.pharmacyId, fresh.actorId],
        );
        const value = inventoryReviewPreferencesSchema.parse(saved.rows[0]);
        await writePostingAudit(client, {
          action: PREFERENCES_COMMAND,
          actorUserId: fresh.actorId,
          afterState: { revision: value.revision },
          beforeState: { revision: previous.revision },
          correlationId: input.idempotencyKey,
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "committed",
          pharmacyId: fresh.pharmacyId,
          targetId: fresh.actorId,
        });
        await recordPostingResult(client, {
          actorUserId: fresh.actorId,
          commandName: PREFERENCES_COMMAND,
          device: fresh,
          idempotencyKey: input.idempotencyKey,
          identitySessionId: fresh.sessionId,
          pharmacyId: fresh.pharmacyId,
          requestHash,
          responseBody: value,
          responseStatus: 200,
        });
        await client.query("commit");
        transactionOpen = false;
        return value;
      } catch (error) {
        if (transactionOpen)
          await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  public async exportSensitiveData(
    request: Request,
    input: InventorySensitiveExportRequest,
  ): Promise<InventorySensitiveExport> {
    const context = await this.identity.requirePermission(
      request,
      VALUATION_PERMISSION,
    );
    if (context.roleKey !== "owner") {
      await this.recordOwnerDenial(context, input.idempotencyKey);
    }
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        const fresh = await this.identity.revalidateInventoryReview(
          client,
          context,
          VALUATION_PERMISSION,
        );
        if (fresh.roleKey !== "owner") {
          const requestId = await writePostingAudit(client, {
            action: EXPORT_COMMAND,
            actorUserId: fresh.actorId,
            correlationId: input.idempotencyKey,
            device: fresh,
            identitySessionId: fresh.sessionId,
            outcome: "owner-role-required",
            pharmacyId: fresh.pharmacyId,
          });
          await client.query("commit");
          transactionOpen = false;
          throw new InventoryReviewDenied(403, {
            code: "owner-role-required",
            fieldErrors: [],
            requestId,
            status: "denied",
          });
        }
        const requestHash = canonicalRequestHash(EXPORT_COMMAND, input);
        let replay: PostingCommandReplay | undefined;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName: EXPORT_COMMAND,
            idempotencyKey: input.idempotencyKey,
            pharmacyId: fresh.pharmacyId,
            requestHash,
          });
        } catch (error) {
          if (!(error instanceof PostingIdempotencyConflict)) throw error;
          const requestId = await writePostingAudit(client, {
            action: EXPORT_COMMAND,
            actorUserId: fresh.actorId,
            correlationId: input.idempotencyKey,
            device: fresh,
            identitySessionId: fresh.sessionId,
            outcome: "idempotency-conflict",
            pharmacyId: fresh.pharmacyId,
          });
          await client.query("commit");
          transactionOpen = false;
          throw new InventoryReviewDenied(409, {
            code: "idempotency-conflict",
            fieldErrors: [],
            requestId,
            status: "denied",
          });
        }
        if (replay !== undefined) {
          await client.query("commit");
          transactionOpen = false;
          return inventorySensitiveExportSchema.parse(replay.responseBody);
        }
        await this.identity.consumeInventoryExportStepUp(
          client,
          fresh,
          input.challengeId,
        );
        const bundle = await this.buildExport(client, fresh);
        await writePostingAudit(client, {
          action: EXPORT_COMMAND,
          actorUserId: fresh.actorId,
          afterState: bundle.counts,
          correlationId: input.idempotencyKey,
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "committed",
          pharmacyId: fresh.pharmacyId,
        });
        await recordPostingResult(client, {
          actorUserId: fresh.actorId,
          commandName: EXPORT_COMMAND,
          device: fresh,
          idempotencyKey: input.idempotencyKey,
          identitySessionId: fresh.sessionId,
          pharmacyId: fresh.pharmacyId,
          requestHash,
          responseBody: bundle,
          responseStatus: 201,
        });
        await client.query("commit");
        transactionOpen = false;
        return bundle;
      } catch (error) {
        if (transactionOpen)
          await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async buildExport(
    client: PoolClient,
    context: IdentityExecutionContext,
  ): Promise<InventorySensitiveExport> {
    const now = new Date();
    const timeZone = await this.identity.readPharmacyBusinessTimeZone(
      client,
      context.pharmacyId,
    );
    const businessDate = businessDateOf(now, timeZone);
    await resolveReceiptClassRuleSet(client, context.pharmacyId);
    const nearExpiryDays = await readNearExpiryDays(client, context.pharmacyId);
    const positions = await readInventoryPositions(
      client,
      context.pharmacyId,
      businessDate,
      nearExpiryDays,
    );
    const facts = await resolveCatalogInventoryFacts(
      client,
      context.pharmacyId,
    );
    const suppliers = await resolveSupplierCostFacts(
      client,
      context.pharmacyId,
    );
    const names = await this.identity.resolveUserDisplayNames(
      client,
      context.pharmacyId,
      [context.actorId],
    );
    const positionByProduct = new Map(
      positions.map((position) => [position.productId, position]),
    );
    const items = [...facts.values()]
      .filter((fact) =>
        includeInReview(fact, positionByProduct.get(fact.productId)),
      )
      .map((fact) => {
        const position = positionByProduct.get(fact.productId);
        return inventoryExportItemView(
          fact,
          position,
          suppliers.get(fact.productId) ?? [],
        );
      });
    const batchCount = positions.reduce(
      (total, position) => total + position.totalBatchCount,
      0n,
    );
    const movementCount = positions.reduce(
      (total, position) => total + position.movementCount,
      0n,
    );
    return inventorySensitiveExportSchema.parse({
      counts: {
        batches: batchCount.toString(),
        items: BigInt(items.length).toString(),
        movements: movementCount.toString(),
      },
      exportedAt: new Date().toISOString(),
      exportedBy: {
        displayName: names.get(context.actorId) ?? "—",
        id: context.actorId,
      },
      items,
      pharmacyId: context.pharmacyId,
      valuationMethod: "weighted-average-cost",
    });
  }

  private async recordOwnerDenial(
    context: IdentityExecutionContext,
    correlationId: string,
  ): Promise<never> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const requestId = await writePostingAudit(client, {
        action: EXPORT_COMMAND,
        actorUserId: context.actorId,
        correlationId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: "owner-role-required",
        pharmacyId: context.pharmacyId,
      });
      await client.query("commit");
      throw new InventoryReviewDenied(403, {
        code: "owner-role-required",
        fieldErrors: [],
        requestId,
        status: "denied",
      });
    } catch (error) {
      if (!(error instanceof InventoryReviewDenied)) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async commitCommandDenial(
    client: PoolClient,
    context: IdentityExecutionContext,
    idempotencyKey: string,
    statusCode: 409,
    code: "idempotency-conflict" | "version-conflict",
  ): Promise<never> {
    const requestId = await writePostingAudit(client, {
      action: PREFERENCES_COMMAND,
      actorUserId: context.actorId,
      correlationId: idempotencyKey,
      device: context,
      identitySessionId: context.sessionId,
      outcome: code,
      pharmacyId: context.pharmacyId,
      targetId: context.actorId,
    });
    const denial = inventoryDenialSchema.parse({
      code,
      fieldErrors: [],
      requestId,
      status: "denied",
    });
    await client.query("commit");
    throw new InventoryReviewDenied(statusCode, denial);
  }

  private async readDenial(
    client: PoolClient,
    context: IdentityExecutionContext,
    productId: string,
  ): Promise<InventoryReviewDenied> {
    const requestId = await writePostingAudit(client, {
      action: "inventory.movements.read",
      actorUserId: context.actorId,
      device: context,
      identitySessionId: context.sessionId,
      outcome: "product-not-found",
      pharmacyId: context.pharmacyId,
      targetId: productId,
    });
    return new InventoryReviewDenied(
      404,
      inventoryDenialSchema.parse({
        code: "product-not-found",
        fieldErrors: [],
        requestId,
        status: "denied",
      }),
    );
  }
}

interface MovementReference {
  readonly documentId: string;
  readonly documentType: ProductMovement["sourceDocumentType"];
  readonly label: string;
  readonly number: PostedPurchaseReference["number"] | null;
}

function movementReference(
  movement: ProductMovement,
  purchaseReferences: ReadonlyMap<string, PostedPurchaseReference>,
  adjustmentReferences: ReadonlyMap<string, PostedPurchaseAdjustmentReference>,
  returnReferences: ReadonlyMap<string, PostedPurchaseReturnReference>,
): MovementReference {
  switch (movement.sourceDocumentType) {
    case "purchase-invoice": {
      const reference = purchaseReferences.get(movement.sourceDocumentId);
      return {
        documentId: movement.sourceDocumentId,
        documentType: "purchase-invoice",
        label:
          reference === undefined
            ? movement.sourceDocumentType
            : `P${reference.number.value}/${reference.number.year} · ${reference.supplierName}`,
        number: reference?.number ?? null,
      };
    }
    case "purchase-adjustment": {
      const reference = adjustmentReferences.get(movement.sourceDocumentId);
      return {
        // PostedPurchaseReview owns the adjustment list, so open the original
        // purchase; the adjustment remains reachable from that list.
        documentId: reference?.originalPurchaseId ?? movement.sourceDocumentId,
        documentType: "purchase-adjustment",
        label:
          reference === undefined
            ? movement.sourceDocumentType
            : `P${reference.number.value}/${reference.number.year}-${reference.suffixValue} · ${reference.supplierNameSnapshot}`,
        number: reference?.number ?? null,
      };
    }
    case "purchase-return": {
      const reference = returnReferences.get(movement.sourceDocumentId);
      return {
        // PostedPurchaseReview owns the return list, so open the original
        // purchase; the return remains reachable from that list.
        documentId: reference?.originalPurchaseId ?? movement.sourceDocumentId,
        documentType: "purchase-return",
        label:
          reference === undefined
            ? movement.sourceDocumentType
            : `PR${reference.returnNumber.value}/${reference.returnNumber.year} · P${reference.originalNumber.value}/${reference.originalNumber.year} · ${reference.supplierNameSnapshot}`,
        number: reference?.originalNumber ?? null,
      };
    }
    default:
      return assertNever(movement.sourceDocumentType);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected inventory movement source: ${String(value)}`);
}

function itemView(
  fact: CatalogInventoryFacts,
  position: InventoryPosition | undefined,
  valuationGranted: boolean,
  now: Date,
  businessDate: string,
  nearExpiryDays: number,
): InventoryItem {
  const balance = position?.balance ?? 0n;
  const indicators = riskIndicators({
    balance,
    coldStorageRequired: fact.coldStorageRequired,
    earliestExpiry: position?.earliestExpiry ?? null,
    expiredCount: position?.expiredCount ?? 0n,
    hasBarcode: fact.hasBarcode,
    maximumLevel: fact.stockLevels.maximumLevel,
    minimumLevel: fact.stockLevels.minimumLevel,
    businessDate,
    nearExpiryDays,
    reorderPoint: fact.stockLevels.reorderPoint,
  });
  const automatic = automaticStateColour(indicators);
  return inventoryItemSchema.parse({
    averageUnitCostFils: valuationGranted ? averageFils(position) : null,
    balance: balance.toString(),
    batches: {
      count: (position?.totalBatchCount ?? 0n).toString(),
      earliestExpiry: position?.earliestExpiry ?? null,
      expiredCount: (position?.expiredCount ?? 0n).toString(),
    },
    consumptionRatePer30Days: consumptionRatePer30Days(
      position?.movements ?? [],
      now,
    ).toString(),
    displayName: fact.displayName,
    productId: fact.productId,
    reconciliation: position?.reconciliation ?? "consistent",
    riskIndicators: indicators,
    stateColour: {
      automatic,
      effective: effectiveStateColour(fact.manualStateColour, automatic),
      manual: fact.manualStateColour,
    },
    status: fact.status,
    stockLevels: stockLevelsView(fact),
    valueFils: valuationGranted ? (position?.valueFils ?? 0n).toString() : null,
  });
}

export function inventoryExportItemView(
  fact: CatalogInventoryFacts,
  position: InventoryPosition | undefined,
  suppliers: readonly SupplierCostFact[],
): InventorySensitiveExport["items"][number] {
  return {
    averageUnitCostFils: averageFils(position),
    balance: (position?.balance ?? 0n).toString(),
    batches: (position?.batches ?? []).map((batch) => ({
      balance: batch.balance.toString(),
      batchId: batch.batchId,
      expiryDate: batch.expiryDate,
      lotNumber: batch.lotNumber,
    })),
    displayName: fact.displayName,
    productId: fact.productId,
    status: fact.status,
    stockLevels: stockLevelsView(fact),
    suppliers: suppliers.map((supplier) => ({
      lastCostAfterDiscountFils: supplier.lastCostAfterDiscountFils,
      lastInvoiceDate: supplier.lastInvoiceDate,
      lastPostedPurchaseId: supplier.lastPostedPurchaseId,
      lastPrimarySupplierCostFils: supplier.lastPrimarySupplierCostFils,
      receiptCount: supplier.receiptCount,
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
    })),
    valueFils: (position?.valueFils ?? 0n).toString(),
  };
}

export function includeInReview(
  fact: CatalogInventoryFacts,
  position: Pick<InventoryPosition, "balance"> | undefined,
): boolean {
  return (
    fact.status !== "merged" &&
    (fact.status !== "archived" || (position?.balance ?? 0n) !== 0n)
  );
}

function averageFils(position: InventoryPosition | undefined): string | null {
  if (position === undefined) return null;
  const average = reportedAverageUnitCostScaled({
    totalQuantity: position.valuationQuantity,
    totalValueScaled: position.valuationValueScaled,
  });
  return average === null
    ? null
    : divideFilsRounded(average, 10n ** BigInt(VALUATION_SCALE)).toString();
}

function stockLevelsView(fact: CatalogInventoryFacts): {
  readonly maximumLevel: string | null;
  readonly minimumLevel: string | null;
  readonly reorderPoint: string | null;
} {
  return {
    maximumLevel: fact.stockLevels.maximumLevel?.toString() ?? null,
    minimumLevel: fact.stockLevels.minimumLevel?.toString() ?? null,
    reorderPoint: fact.stockLevels.reorderPoint?.toString() ?? null,
  };
}
