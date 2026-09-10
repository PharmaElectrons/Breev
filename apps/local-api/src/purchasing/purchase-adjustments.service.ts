import {
  purchaseAdjustmentDraftSchema,
  purchaseAdjustmentPostResultSchema,
  purchaseAdjustmentSnapshotRowSchema,
  purchaseAdjustmentSummarySchema,
  postedPurchaseAdjustmentSchema,
  purchasingDenialSchema,
  type PostedPurchaseAdjustment,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentDraftCreateRequest,
  type PurchaseAdjustmentDraftDiscardRequest,
  type PurchaseAdjustmentDraftRow,
  type PurchaseAdjustmentDraftRowInput,
  type PurchaseAdjustmentFieldChange,
  type PurchaseAdjustmentPostRequest,
  type PurchaseAdjustmentPostResult,
  type PurchaseAdjustmentSnapshotRow,
  type PurchaseAdjustmentSummary,
  type PurchasingDenialCode,
  type PurchasingFieldError,
} from "@breev/contracts/local-rest";
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";
import {
  applyPurchaseAdjustmentSettlementEffects,
  postPurchaseAdjustmentJournal,
} from "../accounting/accounting-persistence.js";
import { applyPurchasePriceUpdate } from "../catalog/catalog-purchase-price-update.js";
import { resolveCatalogPurchaseProduct } from "../catalog/catalog-purchase.js";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import {
  applyPurchaseAdjustmentToValuation,
  receiveBatch,
  recordPurchaseAdjustmentMovement,
  recordPurchaseAdjustmentValueEffect,
  resolveReceiptClassRuleSet,
  validatePurchaseAdjustmentBatches,
  validatePurchaseAdjustmentValuation,
  type PurchaseAdjustmentInventoryEffect,
} from "../inventory/inventory-persistence.js";
import {
  checkReceiptEvidence,
  receiptRuleFor,
} from "../inventory/inventory-receipt-rules.js";
import { LocalDatabaseService } from "../local-database.service.js";
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
import { assertLockStageProgression } from "../posting/lock-order.js";
import {
  allocateDocumentNumber,
  markNumberIssued,
} from "../posting/number-sequences.js";
import {
  CURRENT_ENVELOPE_VERSIONS,
  POSTING_EVENT_TYPES,
  appendOutboxEntry,
} from "../posting/outbox.js";
import {
  extractPurchaseAdjustmentDelta,
  type PurchaseAdjustmentRowSnapshot as DomainRow,
} from "./purchase-adjustment-delta.js";
import { preparePurchaseRow } from "./purchase-row.js";
import { PurchasingDenied } from "./purchasing.service.js";

const ADJUSTMENT_PERMISSION = "purchases.adjustments.manage";
const COST_PERMISSION = "purchases.costs.view";
const POSTED_PERMISSION = "purchases.posted.view";
const COMMANDS = {
  create: "purchase.adjustment-draft.create",
  discard: "purchase.adjustment-draft.discard",
  post: "purchase.adjustment.post",
  update: "purchase.adjustment-draft.update",
} as const;

type AdjustmentCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
type AdjustmentCommandValue =
  PurchaseAdjustmentDraft | PurchaseAdjustmentPostResult;

interface OriginalHeaderRow {
  allowance_percentage_snapshot: string;
  invoice_date: string;
  number_value: string;
  number_year: number;
  primary_supplier_cost_fils: string;
  settlement_context: "cash" | "debt";
  supplier_id: string;
  supplier_invoice_number: string;
  supplier_name_snapshot: string;
}

interface SnapshotRowRecord {
  base_units_per_entered_unit: string;
  batch_id: string | null;
  entered_package_unit_name: string | null;
  entered_quantity: string;
  entered_unit_kind: "inventory-unit" | "package-unit";
  expiry_date: string | null;
  id: string;
  inventory_unit_name: string;
  inventory_unit_quantity: string;
  item_display_name: string;
  lot_number: string | null;
  margin_percentage: string | null;
  notes: string | null;
  ordinal: number;
  pricing_method: "by-percentage" | "by-price";
  primary_supplier_cost_fils: string;
  product_id: string;
  retail_price_fils: string;
}

interface AdjustmentDraftHeaderRow extends OriginalHeaderRow {
  created_at: Date;
  evidence: string | null;
  id: string;
  original_purchase_id: string;
  reason:
    | "invoice-number error"
    | "other"
    | "price error"
    | "quantity error"
    | "supplier error";
  status: "active" | "discarded" | "posted";
  updated_at: Date;
  version: string;
}

interface AdjustmentDraftRowRecord extends SnapshotRowRecord {
  lineage_id: string;
  original_row_id: string | null;
}

interface CommandRejected {
  readonly code: PurchasingDenialCode;
  readonly fieldErrors: readonly PurchasingFieldError[];
  readonly statusCode: 400 | 404 | 409;
  readonly targetId?: string;
}

class PurchaseAdjustmentCommandRejected extends Error {
  public constructor(public readonly rejection: CommandRejected) {
    super(rejection.code);
    this.name = "PurchaseAdjustmentCommandRejected";
  }
}

interface CommandSuccess<T extends AdjustmentCommandValue> {
  readonly afterState: Record<string, boolean | number | string | null>;
  readonly beforeState?: Record<string, boolean | number | string | null>;
  readonly targetId: string;
  readonly value: T;
}

interface CalculatedSummary {
  readonly currentHeader: {
    readonly supplierId: string;
    readonly supplierNameSnapshot: string;
  };
  readonly currentRows: readonly PurchaseAdjustmentSnapshotRow[];
  readonly draftRows: readonly PurchaseAdjustmentDraftRow[];
  readonly original: OriginalHeaderRow;
  readonly originalRows: readonly PurchaseAdjustmentSnapshotRow[];
  readonly summary: PurchaseAdjustmentSummary;
}

@Injectable()
export class PurchaseAdjustmentsService {
  private readonly logger = new Logger(PurchaseAdjustmentsService.name);

  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async createDraft(
    request: Request,
    originalPurchaseId: string,
    input: PurchaseAdjustmentDraftCreateRequest,
  ): Promise<PurchaseAdjustmentDraft> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.create,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseAdjustmentDraftSchema,
      requestHash: canonicalRequestHash(COMMANDS.create, {
        input,
        originalPurchaseId,
      }),
      responseStatus: 201,
      targetId: originalPurchaseId,
      work: async (client) => {
        const original = await readOriginalHeader(
          client,
          context.pharmacyId,
          originalPurchaseId,
          true,
        );
        if (original === undefined) {
          reject(404, "adjustment-original-not-found", [], originalPurchaseId);
        }
        const current = await readCurrentCorrectedState(
          client,
          context.pharmacyId,
          originalPurchaseId,
          original,
        );
        const inserted = await client.query<{ id: string }>(
          `insert into purchase_adjustment_drafts (
             pharmacy_id, original_purchase_id, supplier_id,
             supplier_name_snapshot, supplier_invoice_number, invoice_date,
             settlement_context, allowance_percentage_snapshot, reason,
             evidence, created_by, updated_by
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
           returning id`,
          [
            context.pharmacyId,
            originalPurchaseId,
            current.header.supplierId,
            current.header.supplierNameSnapshot,
            current.header.supplierInvoiceNumber,
            original.invoice_date,
            original.settlement_context,
            original.allowance_percentage_snapshot,
            input.reason,
            input.evidence,
            context.actorId,
          ],
        );
        const draftId = inserted.rows[0]?.id;
        if (draftId === undefined) {
          throw new Error("The Purchase Adjustment Draft was not created");
        }
        for (const row of current.rows) {
          await insertDraftRow(client, context.pharmacyId, draftId, row);
        }
        const value = await readDraftView(client, context.pharmacyId, draftId);
        return {
          afterState: draftAuditState(value),
          targetId: draftId,
          value,
        };
      },
    });
  }

  public async readDraft(
    request: Request,
    draftId: string,
  ): Promise<PurchaseAdjustmentDraft> {
    const context = await this.requireContext(request);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const exists = await client.query(
        `select 1 from purchase_adjustment_drafts
         where pharmacy_id = $1 and id = $2`,
        [context.pharmacyId, draftId],
      );
      if (exists.rowCount === 0) {
        throw await this.readDenied(
          context,
          "purchase.adjustment-draft.read",
          "adjustment-draft-not-found",
          draftId,
        );
      }
      return await readDraftView(client, context.pharmacyId, draftId);
    } finally {
      client.release();
    }
  }

  public async updateDraft(
    request: Request,
    draftId: string,
    input: {
      readonly evidence: string | null;
      readonly expectedVersion: string;
      readonly idempotencyKey: string;
      readonly reason: PurchaseAdjustmentDraft["reason"];
      readonly rows: readonly PurchaseAdjustmentDraftRowInput[];
      readonly supplierId: string;
      readonly supplierInvoiceNumber: string;
    },
  ): Promise<PurchaseAdjustmentDraft> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.update,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseAdjustmentDraftSchema,
      requestHash: canonicalRequestHash(COMMANDS.update, {
        draftId,
        input: JSON.parse(JSON.stringify(input)) as JsonObject,
      }),
      responseStatus: 200,
      targetId: draftId,
      work: async (client) => {
        const before = await lockDraftHeader(
          client,
          context.pharmacyId,
          draftId,
        );
        requireEditableDraft(before, draftId, input.expectedVersion);
        const priorView = await readDraftView(
          client,
          context.pharmacyId,
          draftId,
        );
        const existing = new Map(
          priorView.rows.map((row) => [row.lineageId, row]),
        );
        const supplier = await resolveActiveSupplier(
          client,
          context.pharmacyId,
          input.supplierId,
        );
        const normalizedRows: PurchaseAdjustmentSnapshotRow[] = [];
        const seen = new Set<string>();
        for (const [index, row] of input.rows.entries()) {
          const normalized = await normalizeDraftRow(
            client,
            context.pharmacyId,
            row,
            existing,
            index + 1,
          );
          if (seen.has(normalized.lineageId)) {
            reject(400, "body-invalid", [
              { code: "invalid", path: ["rows", index, "lineageId"] },
            ]);
          }
          seen.add(normalized.lineageId);
          normalizedRows.push(normalized);
        }
        await client.query(
          `delete from purchase_adjustment_draft_rows
           where pharmacy_id = $1 and draft_id = $2`,
          [context.pharmacyId, draftId],
        );
        for (const row of normalizedRows) {
          await insertDraftRow(client, context.pharmacyId, draftId, row);
        }
        await client.query(
          `update purchase_adjustment_drafts
           set supplier_id = $3, supplier_name_snapshot = $4,
               supplier_invoice_number = $5, reason = $6, evidence = $7,
               version = version + 1, updated_at = statement_timestamp(),
               updated_by = $8
           where pharmacy_id = $1 and id = $2`,
          [
            context.pharmacyId,
            draftId,
            supplier.id,
            supplier.name,
            input.supplierInvoiceNumber,
            input.reason,
            input.evidence,
            context.actorId,
          ],
        );
        const updatedHeader = (
          await client.query<AdjustmentDraftHeaderRow>(
            `${draftHeaderSelect()} where draft.pharmacy_id = $1 and draft.id = $2`,
            [context.pharmacyId, draftId],
          )
        ).rows[0];
        if (updatedHeader === undefined) {
          throw new Error("The updated Purchase Adjustment Draft disappeared");
        }
        const calculated = await calculateSummary(
          client,
          context.pharmacyId,
          updatedHeader,
        );
        await validateSummaryBatches(client, context.pharmacyId, calculated);
        await validateSummaryValuation(client, context.pharmacyId, calculated);
        const value = await readDraftView(client, context.pharmacyId, draftId);
        return {
          afterState: draftAuditState(value),
          beforeState: draftAuditState(priorView),
          targetId: draftId,
          value,
        };
      },
    });
  }

  public async discardDraft(
    request: Request,
    draftId: string,
    input: PurchaseAdjustmentDraftDiscardRequest,
  ): Promise<PurchaseAdjustmentDraft> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.discard,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseAdjustmentDraftSchema,
      requestHash: canonicalRequestHash(COMMANDS.discard, { draftId, input }),
      responseStatus: 201,
      targetId: draftId,
      work: async (client) => {
        const before = await lockDraftHeader(
          client,
          context.pharmacyId,
          draftId,
        );
        requireEditableDraft(before, draftId, input.expectedVersion);
        await client.query(
          `update purchase_adjustment_drafts
           set status = 'discarded', discarded_at = statement_timestamp(),
               discarded_by = $3, version = version + 1,
               updated_at = statement_timestamp(), updated_by = $3
           where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, draftId, context.actorId],
        );
        const value = await readDraftView(client, context.pharmacyId, draftId);
        return {
          afterState: draftAuditState(value),
          beforeState: { status: before!.status, version: before!.version },
          targetId: draftId,
          value,
        };
      },
    });
  }

  public async preview(
    request: Request,
    draftId: string,
  ): Promise<PurchaseAdjustmentSummary> {
    const context = await this.requireContext(request);
    const client = await this.localDatabase.requirePool().connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
      await this.identity.revalidatePurchaseAdjustmentManagement(
        client,
        context,
      );
      const header = await lockDraftHeader(client, context.pharmacyId, draftId);
      requireEditableDraft(header, draftId, header?.version ?? "0");
      const calculated = await calculateSummary(
        client,
        context.pharmacyId,
        header!,
      );
      assertMeaningfulChange(calculated);
      await validateSummaryBatches(client, context.pharmacyId, calculated);
      await validateSummaryValuation(client, context.pharmacyId, calculated);
      await client.query("commit");
      transactionOpen = false;
      return calculated.summary;
    } catch (error) {
      if (transactionOpen)
        await client.query("rollback").catch(() => undefined);
      if (error instanceof PurchaseAdjustmentCommandRejected) {
        throw await this.persistReadRejection(
          context,
          draftId,
          error.rejection,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async postPurchaseAdjustment(
    request: Request,
    draftId: string,
    input: PurchaseAdjustmentPostRequest,
  ): Promise<PurchaseAdjustmentPostResult> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.post,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseAdjustmentPostResultSchema,
      requestHash: canonicalRequestHash(COMMANDS.post, { draftId, input }),
      responseStatus: 201,
      targetId: draftId,
      work: async (client) => {
        const header = await lockDraftHeader(
          client,
          context.pharmacyId,
          draftId,
        );
        requireEditableDraft(header, draftId, input.expectedVersion);
        const lockedOriginal = await readOriginalHeader(
          client,
          context.pharmacyId,
          header!.original_purchase_id,
          true,
        );
        if (lockedOriginal === undefined) {
          reject(
            404,
            "adjustment-original-not-found",
            [],
            header!.original_purchase_id,
          );
        }
        const calculated = await calculateSummary(
          client,
          context.pharmacyId,
          header!,
        );
        assertMeaningfulChange(calculated);
        if (calculated.summary.confirmationHash !== input.confirmationHash) {
          reject(
            409,
            "adjustment-summary-stale",
            [
              {
                code: "invalid",
                path: ["confirmationHash"],
                rule: "purchase.adjustment.summary-stale",
              },
            ],
            draftId,
          );
        }

        assertLockStageProgression("draft", "number-sequence");
        const allocation = await allocateDocumentNumber(
          this.localDatabase.requirePool(),
          {
            actorUserId: context.actorId,
            correlationId: input.idempotencyKey,
            device: context,
            documentType: `purchase-adjustment-${calculated.original.number_value}`,
            identitySessionId: context.sessionId,
            pharmacyId: context.pharmacyId,
            year: calculated.original.number_year,
          },
        );
        const clock = await client.query<{ posted_at: Date }>(
          "select statement_timestamp() as posted_at",
        );
        const postedAt = clock.rows[0]?.posted_at;
        if (postedAt === undefined)
          throw new Error("Posting clock unavailable");

        assertLockStageProgression("number-sequence", "batch-stock");
        await validateSummaryBatches(client, context.pharmacyId, calculated);

        const supplierEffects = calculated.summary.supplierEffects.map(
          (effect) => ({
            deltaFils: BigInt(effect.deltaFils),
            supplierId: effect.supplierId,
          }),
        );
        const journal = await postPurchaseAdjustmentJournal(client, {
          facts: {
            primarySupplierCostDeltaFils: BigInt(
              calculated.summary.primarySupplierCostDeltaFils,
            ),
            settlementContext: calculated.original.settlement_context,
            supplierEffects,
          },
          pharmacyId: context.pharmacyId,
          postedBy: context.actorId,
        });
        await applyPurchaseAdjustmentSettlementEffects(client, {
          pharmacyId: context.pharmacyId,
          primarySupplierCostDeltaFils: BigInt(
            calculated.summary.primarySupplierCostDeltaFils,
          ),
          settlementContext: calculated.original.settlement_context,
          supplierEffects,
        });

        const inserted = await client.query<{ id: string }>(
          `insert into posted_purchase_adjustments (
             pharmacy_id, draft_id, original_purchase_id, suffix_value,
             supplier_id, supplier_name_snapshot, supplier_invoice_number,
             reason, evidence, quantity_delta,
             primary_supplier_cost_delta_fils, allowance_delta_fils,
             cost_after_discount_delta_fils, header_changes,
             journal_entry_id, posted_at, posted_by
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint,
             $11::bigint, $12::bigint, $13::bigint, $14::jsonb, $15, $16, $17
           ) returning id`,
          [
            context.pharmacyId,
            draftId,
            header!.original_purchase_id,
            allocation.value.toString(),
            header!.supplier_id,
            header!.supplier_name_snapshot,
            header!.supplier_invoice_number,
            header!.reason,
            header!.evidence,
            calculated.summary.quantityDelta,
            calculated.summary.primarySupplierCostDeltaFils,
            calculated.summary.allowanceDeltaFils,
            calculated.summary.costAfterDiscountDeltaFils,
            JSON.stringify(calculated.summary.headerChanges),
            journal.entryId,
            postedAt,
            context.actorId,
          ],
        );
        const adjustmentId = inserted.rows[0]?.id;
        if (adjustmentId === undefined) {
          throw new Error("The Posted Purchase Adjustment was not created");
        }
        await markNumberIssued(client, {
          allocationId: allocation.allocationId,
          correlationId: input.idempotencyKey,
          documentId: adjustmentId,
          documentType: `purchase-adjustment-${calculated.original.number_value}`,
          pharmacyId: context.pharmacyId,
          year: calculated.original.number_year,
        });

        const postedDeltas = await postInventoryEffects(
          client,
          context,
          adjustmentId,
          calculated,
        );

        for (const row of postedDeltas) {
          if (
            row.after !== null &&
            row.after.pricingMethod === "by-price" &&
            row.changes.some((change) => change.field === "retail-price")
          ) {
            await applyPurchasePriceUpdate(
              client,
              context.pharmacyId,
              row.after.itemId,
              row.after.retailPriceFils,
              context.actorId,
            );
          }
        }

        assertLockStageProgression("batch-stock", "valuation");
        await validateSummaryValuation(client, context.pharmacyId, calculated);
        await applyValuationEffects(client, context.pharmacyId, postedDeltas);

        for (const row of postedDeltas) {
          await client.query(
            `insert into posted_purchase_adjustment_rows (
               pharmacy_id, adjustment_id, lineage_id, original_row_id,
               ordinal, effect_kind, before_snapshot, after_snapshot, changes,
               quantity_delta, primary_supplier_cost_delta_fils, batch_id,
               movement_id, value_effect_id
             ) values (
               $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
               $10::bigint, $11::bigint, $12, $13, $14
             )`,
            [
              context.pharmacyId,
              adjustmentId,
              row.lineageId,
              row.after?.originalRowId ?? row.before?.originalRowId ?? null,
              row.after?.ordinal ?? row.before?.ordinal ?? 1,
              row.kind,
              row.before === null ? null : JSON.stringify(row.before),
              row.after === null ? null : JSON.stringify(row.after),
              JSON.stringify(row.changes),
              row.quantityDelta,
              row.primarySupplierCostDeltaFils,
              row.after?.batchId ?? row.before?.batchId ?? null,
              row.movementId,
              row.valueEffectId,
            ],
          );
        }

        await client.query(
          `update purchase_adjustment_drafts
           set status = 'posted', version = version + 1,
               updated_at = statement_timestamp(), updated_by = $3
           where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, draftId, context.actorId],
        );
        await appendOutboxEntry(client, {
          correlationId: input.idempotencyKey,
          envelopeVersion:
            CURRENT_ENVELOPE_VERSIONS["purchase.invoice.adjusted"],
          eventType: POSTING_EVENT_TYPES.purchaseInvoiceAdjusted,
          occurredAt: postedAt,
          payload: {
            adjustmentId,
            originalPurchaseId: header!.original_purchase_id,
            pharmacyId: context.pharmacyId,
            primarySupplierCostDeltaFils:
              calculated.summary.primarySupplierCostDeltaFils,
          },
          pharmacyId: context.pharmacyId,
        });
        const posted = postedPurchaseAdjustmentSchema.parse({
          allowanceDeltaFils: calculated.summary.allowanceDeltaFils,
          costAfterDiscountDeltaFils:
            calculated.summary.costAfterDiscountDeltaFils,
          draftId,
          evidence: header!.evidence,
          headerChanges: calculated.summary.headerChanges,
          id: adjustmentId,
          journal: journalView(journal),
          number: {
            original: {
              series: "P",
              value: calculated.original.number_value,
              year: calculated.original.number_year,
            },
            suffix: allocation.value.toString(),
          },
          originalPurchaseId: header!.original_purchase_id,
          postedAt: postedAt.toISOString(),
          postedBy: context.actorId,
          primarySupplierCostDeltaFils:
            calculated.summary.primarySupplierCostDeltaFils,
          quantityDelta: calculated.summary.quantityDelta,
          reason: header!.reason,
          rowDeltas: postedDeltas,
          supplierId: header!.supplier_id,
          supplierInvoiceNumber: header!.supplier_invoice_number,
          supplierNameSnapshot: header!.supplier_name_snapshot,
        });
        return {
          afterState: {
            numberSuffix: allocation.value.toString(),
            primarySupplierCostDeltaFils:
              calculated.summary.primarySupplierCostDeltaFils,
            quantityDelta: calculated.summary.quantityDelta,
            status: "posted",
          },
          beforeState: { status: header!.status, version: header!.version },
          targetId: adjustmentId,
          value: { posted },
        };
      },
    });
  }

  public async readPostedAdjustment(
    request: Request,
    adjustmentId: string,
  ): Promise<PostedPurchaseAdjustment> {
    await this.identity.requirePermission(request, POSTED_PERMISSION);
    await this.identity.requirePermission(request, COST_PERMISSION);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const context = await this.identity.requirePermission(
        request,
        POSTED_PERMISSION,
      );
      const result = await readPostedAdjustmentView(
        client,
        context.pharmacyId,
        adjustmentId,
      );
      if (result === undefined) {
        throw await this.readDenied(
          context,
          "purchase.adjustment.read",
          "adjustment-original-not-found",
          adjustmentId,
        );
      }
      return result;
    } finally {
      client.release();
    }
  }

  private async requireContext(
    request: Request,
  ): Promise<IdentityExecutionContext> {
    await this.identity.requirePermission(request, ADJUSTMENT_PERMISSION);
    return await this.identity.requirePermission(request, COST_PERMISSION);
  }

  private async executeCommand<T extends AdjustmentCommandValue>(input: {
    readonly commandName: AdjustmentCommandName;
    readonly context: IdentityExecutionContext;
    readonly idempotencyKey: string;
    readonly parser: { parse(payload: unknown): T };
    readonly requestHash: Buffer;
    readonly responseStatus: 200 | 201;
    readonly targetId?: string;
    readonly work: (client: PoolClient) => Promise<CommandSuccess<T>>;
  }): Promise<T> {
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        await this.identity.revalidatePurchaseAdjustmentManagement(
          client,
          input.context,
        );
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
          if (replay.responseStatus === 200 || replay.responseStatus === 201) {
            return input.parser.parse(replay.responseBody);
          }
          throw new PurchasingDenied(
            replay.responseStatus as 400 | 404 | 409,
            purchasingDenialSchema.parse(replay.responseBody),
          );
        }
        let success: CommandSuccess<T>;
        await client.query("savepoint purchase_adjustment_work");
        try {
          success = await input.work(client);
        } catch (error) {
          if (!(error instanceof PurchaseAdjustmentCommandRejected))
            throw error;
          await client.query("rollback to savepoint purchase_adjustment_work");
          const rejection = error.rejection;
          const requestId = await writePostingAudit(client, {
            action: input.commandName,
            actorUserId: input.context.actorId,
            correlationId: input.idempotencyKey,
            device: input.context,
            identitySessionId: input.context.sessionId,
            outcome: rejection.code,
            pharmacyId: input.context.pharmacyId,
            ...((rejection.targetId ?? input.targetId) === undefined
              ? {}
              : { targetId: rejection.targetId ?? input.targetId }),
          });
          const response = denied(
            rejection.statusCode,
            rejection.code,
            requestId,
            rejection.fieldErrors,
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
          responseStatus: input.responseStatus,
        });
        await client.query("commit");
        transactionOpen = false;
        return success.value;
      } catch (error) {
        if (transactionOpen)
          await client.query("rollback").catch(() => undefined);
        if (!(error instanceof PurchasingDenied)) {
          this.logger.error(
            "Purchase adjustment command failed",
            error instanceof Error ? error.stack : String(error),
          );
        }
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async readDenied(
    context: IdentityExecutionContext,
    action: string,
    code: PurchasingDenialCode,
    targetId: string,
  ): Promise<PurchasingDenied> {
    const requestId = await this.writeReadAudit({
      action,
      actorUserId: context.actorId,
      device: context,
      identitySessionId: context.sessionId,
      outcome: code,
      pharmacyId: context.pharmacyId,
      targetId,
    });
    return denied(404, code, requestId);
  }

  private async persistReadRejection(
    context: IdentityExecutionContext,
    targetId: string,
    rejection: CommandRejected,
  ): Promise<PurchasingDenied> {
    const requestId = await this.writeReadAudit({
      action: "purchase.adjustment.preview",
      actorUserId: context.actorId,
      device: context,
      identitySessionId: context.sessionId,
      outcome: rejection.code,
      pharmacyId: context.pharmacyId,
      targetId,
    });
    return denied(
      rejection.statusCode,
      rejection.code,
      requestId,
      rejection.fieldErrors,
    );
  }

  private async writeReadAudit(
    input: Parameters<typeof writePostingAudit>[1],
  ): Promise<string> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const requestId = await writePostingAudit(client, input);
      await client.query("commit");
      return requestId;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function reject(
  statusCode: 400 | 404 | 409,
  code: PurchasingDenialCode,
  fieldErrors: readonly PurchasingFieldError[] = [],
  targetId?: string,
): never {
  throw new PurchaseAdjustmentCommandRejected({
    code,
    fieldErrors,
    statusCode,
    ...(targetId === undefined ? {} : { targetId }),
  });
}

function denied(
  statusCode: 400 | 404 | 409,
  code: PurchasingDenialCode,
  requestId: string,
  fieldErrors: readonly PurchasingFieldError[] = [],
): PurchasingDenied {
  return new PurchasingDenied(
    statusCode,
    purchasingDenialSchema.parse({
      code,
      fieldErrors,
      requestId,
      status: "denied",
    }),
  );
}

function requireEditableDraft(
  row: AdjustmentDraftHeaderRow | undefined,
  draftId: string,
  expectedVersion: string,
): void {
  if (row === undefined) {
    reject(404, "adjustment-draft-not-found", [], draftId);
  }
  if (row.status === "discarded") {
    reject(409, "adjustment-draft-discarded", [], draftId);
  }
  if (row.status === "posted") {
    reject(409, "adjustment-draft-posted", [], draftId);
  }
  if (row.version !== expectedVersion) {
    reject(409, "version-conflict", [], draftId);
  }
}

async function readOriginalHeader(
  client: PoolClient,
  pharmacyId: string,
  purchaseId: string,
  lock: boolean,
): Promise<OriginalHeaderRow | undefined> {
  const result = await client.query<OriginalHeaderRow>(
    `select supplier_id, supplier_name_snapshot, supplier_invoice_number,
            invoice_date::text, settlement_context,
            allowance_percentage_snapshot::text,
            primary_supplier_cost_fils::text, number_value::text, number_year
     from posted_purchases
     where pharmacy_id = $1 and id = $2${lock ? " for update" : ""}`,
    [pharmacyId, purchaseId],
  );
  return result.rows[0];
}

async function readOriginalRows(
  client: PoolClient,
  pharmacyId: string,
  purchaseId: string,
): Promise<PurchaseAdjustmentSnapshotRow[]> {
  const result = await client.query<SnapshotRowRecord>(
    `select id, ordinal, product_id, item_display_name, inventory_unit_name,
            entered_unit_kind, entered_package_unit_name,
            base_units_per_entered_unit::text, entered_quantity::text,
            inventory_unit_quantity::text, primary_supplier_cost_fils::text,
            pricing_method, retail_price_fils::text, margin_percentage::text,
            expiry_date::text, lot_number, notes, batch_id
     from posted_purchase_rows
     where pharmacy_id = $1 and posted_purchase_id = $2
     order by ordinal`,
    [pharmacyId, purchaseId],
  );
  return result.rows.map((row) => snapshotFromRecord(row, row.id, row.id));
}

async function readCurrentCorrectedState(
  client: PoolClient,
  pharmacyId: string,
  purchaseId: string,
  original: OriginalHeaderRow,
): Promise<{
  header: {
    supplierId: string;
    supplierInvoiceNumber: string;
    supplierNameSnapshot: string;
  };
  rows: PurchaseAdjustmentSnapshotRow[];
}> {
  const originalRows = await readOriginalRows(client, pharmacyId, purchaseId);
  const rows = new Map(originalRows.map((row) => [row.lineageId, row]));
  const effects = await client.query<{
    after_snapshot: unknown;
    lineage_id: string;
  }>(
    `select effect_row.lineage_id, effect_row.after_snapshot
     from posted_purchase_adjustment_rows effect_row
     join posted_purchase_adjustments adjustment
       on adjustment.id = effect_row.adjustment_id
      and adjustment.pharmacy_id = effect_row.pharmacy_id
     where adjustment.pharmacy_id = $1
       and adjustment.original_purchase_id = $2
     order by adjustment.suffix_value, effect_row.ordinal, effect_row.id`,
    [pharmacyId, purchaseId],
  );
  for (const effect of effects.rows) {
    if (effect.after_snapshot === null) rows.delete(effect.lineage_id);
    else
      rows.set(
        effect.lineage_id,
        purchaseAdjustmentSnapshotRowSchema.parse(effect.after_snapshot),
      );
  }
  const latest = await client.query<{
    supplier_id: string;
    supplier_invoice_number: string;
    supplier_name_snapshot: string;
  }>(
    `select supplier_id, supplier_name_snapshot, supplier_invoice_number
     from posted_purchase_adjustments
     where pharmacy_id = $1 and original_purchase_id = $2
     order by suffix_value desc limit 1`,
    [pharmacyId, purchaseId],
  );
  const header = latest.rows[0];
  return {
    header:
      header === undefined
        ? {
            supplierId: original.supplier_id,
            supplierInvoiceNumber: original.supplier_invoice_number,
            supplierNameSnapshot: original.supplier_name_snapshot,
          }
        : {
            supplierId: header.supplier_id,
            supplierInvoiceNumber: header.supplier_invoice_number,
            supplierNameSnapshot: header.supplier_name_snapshot,
          },
    rows: [...rows.values()].sort(
      (left, right) => left.ordinal - right.ordinal,
    ),
  };
}

async function lockDraftHeader(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<AdjustmentDraftHeaderRow | undefined> {
  const result = await client.query<AdjustmentDraftHeaderRow>(
    `${draftHeaderSelect()} where draft.pharmacy_id = $1 and draft.id = $2 for update`,
    [pharmacyId, draftId],
  );
  return result.rows[0];
}

function draftHeaderSelect(): string {
  return `select draft.id, draft.original_purchase_id, draft.supplier_id,
    draft.supplier_name_snapshot, draft.supplier_invoice_number,
    draft.invoice_date::text, draft.settlement_context,
    draft.allowance_percentage_snapshot::text, draft.reason, draft.evidence,
    draft.status, draft.version::text, draft.created_at, draft.updated_at,
    original.number_value::text, original.number_year,
    original.primary_supplier_cost_fils::text
  from purchase_adjustment_drafts draft
  join posted_purchases original
    on original.id = draft.original_purchase_id
   and original.pharmacy_id = draft.pharmacy_id`;
}

async function readDraftRows(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<PurchaseAdjustmentDraftRow[]> {
  const result = await client.query<AdjustmentDraftRowRecord>(
    `select id, lineage_id, original_row_id, ordinal, product_id,
            item_display_name, inventory_unit_name, entered_unit_kind,
            entered_package_unit_name, base_units_per_entered_unit::text,
            entered_quantity::text, inventory_unit_quantity::text,
            primary_supplier_cost_fils::text, pricing_method,
            retail_price_fils::text, margin_percentage::text,
            expiry_date::text, lot_number, notes, batch_id
     from purchase_adjustment_draft_rows
     where pharmacy_id = $1 and draft_id = $2 order by ordinal`,
    [pharmacyId, draftId],
  );
  return result.rows.map((row) => ({
    ...snapshotFromRecord(row, row.lineage_id, row.original_row_id),
    id: row.id,
  }));
}

async function readDraftView(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<PurchaseAdjustmentDraft> {
  const result = await client.query<AdjustmentDraftHeaderRow>(
    `${draftHeaderSelect()} where draft.pharmacy_id = $1 and draft.id = $2`,
    [pharmacyId, draftId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Purchase Adjustment Draft not found");
  return purchaseAdjustmentDraftSchema.parse({
    allowancePercentageSnapshot: normalizeDecimal(
      row.allowance_percentage_snapshot,
    ),
    createdAt: row.created_at.toISOString(),
    evidence: row.evidence,
    id: row.id,
    invoiceDate: row.invoice_date,
    originalNumber: {
      series: "P",
      value: row.number_value,
      year: row.number_year,
    },
    originalPurchaseId: row.original_purchase_id,
    reason: row.reason,
    rows: await readDraftRows(client, pharmacyId, draftId),
    settlementContext: row.settlement_context,
    status: row.status,
    supplierId: row.supplier_id,
    supplierInvoiceNumber: row.supplier_invoice_number,
    supplierNameSnapshot: row.supplier_name_snapshot,
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  });
}

function snapshotFromRecord(
  row: SnapshotRowRecord,
  lineageId: string,
  originalRowId: string | null,
): PurchaseAdjustmentSnapshotRow {
  return {
    baseUnitsPerEnteredUnit: row.base_units_per_entered_unit,
    batchId: row.batch_id,
    costFils: row.primary_supplier_cost_fils,
    enteredQuantity: row.entered_quantity,
    expiryDate: row.expiry_date,
    inventoryUnitName: row.inventory_unit_name,
    inventoryUnitQuantity: row.inventory_unit_quantity,
    itemDisplayName: row.item_display_name,
    itemId: row.product_id,
    lineageId,
    lotNumber: row.lot_number,
    marginPercentage:
      row.margin_percentage === null
        ? null
        : normalizeDecimal(row.margin_percentage),
    notes: row.notes,
    ordinal: row.ordinal,
    originalRowId,
    pricingMethod: row.pricing_method,
    retailPriceFils: row.retail_price_fils,
    unit:
      row.entered_unit_kind === "inventory-unit"
        ? { kind: "inventory-unit" }
        : {
            kind: "package-unit",
            packageUnitName: row.entered_package_unit_name ?? "",
          },
  };
}

async function insertDraftRow(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
  row: PurchaseAdjustmentSnapshotRow,
): Promise<void> {
  await client.query(
    `insert into purchase_adjustment_draft_rows (
       pharmacy_id, draft_id, lineage_id, original_row_id, ordinal, product_id,
       item_display_name, inventory_unit_name, entered_unit_kind,
       entered_package_unit_name, base_units_per_entered_unit,
       entered_quantity, inventory_unit_quantity, primary_supplier_cost_fils,
       pricing_method, retail_price_fils, margin_percentage, expiry_date,
       lot_number, notes, batch_id
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::bigint, $12::bigint,
       $13::bigint, $14::bigint, $15, $16::bigint, $17::numeric, $18, $19,
       $20, $21
     )`,
    [
      pharmacyId,
      draftId,
      row.lineageId,
      row.originalRowId,
      row.ordinal,
      row.itemId,
      row.itemDisplayName,
      row.inventoryUnitName,
      row.unit.kind,
      row.unit.kind === "package-unit" ? row.unit.packageUnitName : null,
      row.baseUnitsPerEnteredUnit,
      row.enteredQuantity,
      row.inventoryUnitQuantity,
      row.costFils,
      row.pricingMethod,
      row.retailPriceFils,
      row.marginPercentage,
      row.expiryDate,
      row.lotNumber,
      row.notes,
      row.batchId,
    ],
  );
}

async function normalizeDraftRow(
  client: PoolClient,
  pharmacyId: string,
  input: PurchaseAdjustmentDraftRowInput,
  existing: ReadonlyMap<string, PurchaseAdjustmentDraftRow>,
  ordinal: number,
): Promise<PurchaseAdjustmentSnapshotRow> {
  const prior =
    input.lineageId === null ? undefined : existing.get(input.lineageId);
  if (
    input.lineageId !== null &&
    (prior === undefined || prior.originalRowId !== input.originalRowId)
  ) {
    reject(400, "body-invalid", [
      {
        code: "invalid",
        path: ["rows", ordinal - 1, "lineageId"],
        rule: "purchase.adjustment.original-row-invalid",
      },
    ]);
  }
  if (
    prior !== undefined &&
    (prior.itemId !== input.itemId ||
      JSON.stringify(prior.unit) !== JSON.stringify(input.unit) ||
      prior.expiryDate !== input.expiryDate ||
      prior.lotNumber !== input.lotNumber ||
      prior.notes !== input.notes)
  ) {
    reject(400, "body-invalid", [
      {
        code: "invalid",
        path: ["rows", ordinal - 1],
        rule: "purchase.adjustment.original-row-invalid",
      },
    ]);
  }
  if (prior === undefined && input.originalRowId !== null) {
    reject(400, "body-invalid", [
      {
        code: "invalid",
        path: ["rows", ordinal - 1, "originalRowId"],
        rule: "purchase.adjustment.original-row-invalid",
      },
    ]);
  }
  const product = await resolveCatalogPurchaseProduct(
    client,
    pharmacyId,
    input.itemId,
  );
  if (product === undefined || product === null) {
    reject(
      product === undefined ? 404 : 409,
      product === undefined ? "item-not-found" : "item-unavailable",
      [{ code: "invalid", path: ["rows", ordinal - 1, "itemId"] }],
    );
  }
  const prepared = preparePurchaseRow(product, input);
  if (!prepared.ok) {
    const code =
      prepared.problem === "pricing-mode-conflict"
        ? "pricing-mode-conflict"
        : prepared.problem === "money-overflow"
          ? "money-overflow"
          : prepared.problem === "unit-invalid"
            ? "unit-invalid"
            : "body-invalid";
    reject(409, code, [{ code: "invalid", path: ["rows", ordinal - 1] }]);
  }
  if (prior === undefined) {
    const rules = await resolveReceiptClassRuleSet(client, pharmacyId);
    const problem = checkReceiptEvidence(receiptRuleFor(product, rules), {
      expiryDate: input.expiryDate,
      lotNumber: input.lotNumber,
    });
    if (problem !== null) {
      reject(409, problem, [
        {
          code: "required",
          path: [
            "rows",
            ordinal - 1,
            problem === "expiry-required" ? "expiryDate" : "lotNumber",
          ],
        },
      ]);
    }
  }
  const lineageId =
    prior?.lineageId ??
    (await client.query<{ id: string }>("select uuidv7()::text as id")).rows[0]!
      .id;
  return {
    baseUnitsPerEnteredUnit: prepared.facts.baseUnitsPerEnteredUnit,
    batchId: prior?.batchId ?? null,
    costFils: prepared.facts.costFils,
    enteredQuantity: prepared.facts.enteredQuantity,
    expiryDate: prior?.expiryDate ?? input.expiryDate,
    inventoryUnitName: prepared.facts.inventoryUnitName,
    inventoryUnitQuantity: prepared.facts.inventoryUnitQuantity,
    itemDisplayName: prior?.itemDisplayName ?? product.displayName,
    itemId: product.id,
    lineageId,
    lotNumber: prior?.lotNumber ?? input.lotNumber,
    marginPercentage: prepared.facts.marginPercentage,
    notes: prior?.notes ?? input.notes,
    ordinal,
    originalRowId: prior?.originalRowId ?? null,
    pricingMethod: prepared.facts.pricingMethod,
    retailPriceFils: prepared.facts.retailPriceFils,
    unit: prepared.facts.unit,
  };
}

async function resolveActiveSupplier(
  client: PoolClient,
  pharmacyId: string,
  supplierId: string,
): Promise<{ id: string; name: string }> {
  const result = await client.query<{
    id: string;
    name: string;
    status: string;
  }>(
    `select id, name, status from suppliers
     where pharmacy_id = $1 and id = $2 for share`,
    [pharmacyId, supplierId],
  );
  const supplier = result.rows[0];
  if (supplier === undefined) reject(404, "supplier-not-found", [], supplierId);
  if (supplier.status !== "active") {
    reject(409, "supplier-archived", [], supplierId);
  }
  return supplier;
}

async function calculateSummary(
  client: PoolClient,
  pharmacyId: string,
  draftHeader: AdjustmentDraftHeaderRow,
): Promise<CalculatedSummary> {
  const original = await readOriginalHeader(
    client,
    pharmacyId,
    draftHeader.original_purchase_id,
    true,
  );
  if (original === undefined) {
    reject(
      404,
      "adjustment-original-not-found",
      [],
      draftHeader.original_purchase_id,
    );
  }
  const originalRows = await readOriginalRows(
    client,
    pharmacyId,
    draftHeader.original_purchase_id,
  );
  const draftRows = await readDraftRows(client, pharmacyId, draftHeader.id);
  const current = await readCurrentCorrectedState(
    client,
    pharmacyId,
    draftHeader.original_purchase_id,
    original,
  );
  const priorRows = await client.query<{
    lineage_id: string;
    primary_delta: string;
    quantity_delta: string;
  }>(
    `select effect_row.lineage_id,
            sum(effect_row.quantity_delta)::text as quantity_delta,
            sum(effect_row.primary_supplier_cost_delta_fils)::text as primary_delta
     from posted_purchase_adjustment_rows effect_row
     join posted_purchase_adjustments adjustment
       on adjustment.id = effect_row.adjustment_id
      and adjustment.pharmacy_id = effect_row.pharmacy_id
     where adjustment.pharmacy_id = $1
       and adjustment.original_purchase_id = $2
     group by effect_row.lineage_id`,
    [pharmacyId, draftHeader.original_purchase_id],
  );
  const priorHeader = await client.query<{
    allowance_delta: string;
    net_delta: string;
    primary_delta: string;
  }>(
    `select coalesce(sum(allowance_delta_fils), 0)::text as allowance_delta,
            coalesce(sum(cost_after_discount_delta_fils), 0)::text as net_delta,
            coalesce(sum(primary_supplier_cost_delta_fils), 0)::text as primary_delta
     from posted_purchase_adjustments
     where pharmacy_id = $1 and original_purchase_id = $2`,
    [pharmacyId, draftHeader.original_purchase_id],
  );
  const prior = priorHeader.rows[0]!;
  const draftSnapshots = draftRows.map(draftRowSnapshot);
  const outcome = extractPurchaseAdjustmentDelta({
    allowancePercentage: normalizeDecimal(
      original.allowance_percentage_snapshot,
    ),
    correctedHeader: {
      supplierId: draftHeader.supplier_id,
      supplierInvoiceNumber: draftHeader.supplier_invoice_number,
    },
    correctedRows: draftSnapshots.map(domainRow),
    originalHeader: {
      supplierId: original.supplier_id,
      supplierInvoiceNumber: original.supplier_invoice_number,
    },
    originalRows: originalRows.map(domainRow),
    priorAllowanceDeltaFils: BigInt(prior.allowance_delta),
    priorCostAfterDiscountDeltaFils: BigInt(prior.net_delta),
    priorEffects: priorRows.rows
      .map((row) => ({
        lineageId: row.lineage_id,
        primarySupplierCostDeltaFils: BigInt(row.primary_delta),
        quantityDelta: BigInt(row.quantity_delta),
      }))
      .filter(
        (row) =>
          row.primarySupplierCostDeltaFils !== 0n || row.quantityDelta !== 0n,
      ),
    priorPrimarySupplierCostDeltaFils: BigInt(prior.primary_delta),
  });
  if (!outcome.ok)
    throw new Error(`Adjustment Delta failed: ${outcome.problem}`);
  const currentMap = new Map(current.rows.map((row) => [row.lineageId, row]));
  const draftMap = new Map(draftSnapshots.map((row) => [row.lineageId, row]));
  const rowDeltas = outcome.delta.rowDeltas.map((delta) => {
    const before = currentMap.get(delta.lineageId) ?? null;
    const after = draftMap.get(delta.lineageId) ?? null;
    return {
      after,
      before,
      changes: displayRowChanges(before, after),
      kind: before === null ? "added" : after === null ? "removed" : "changed",
      lineageId: delta.lineageId,
      primarySupplierCostDeltaFils:
        delta.primarySupplierCostDeltaFils.toString(),
      quantityDelta: delta.quantityDelta.toString(),
    } as const;
  });
  const headerChanges = displayHeaderChanges(current.header, draftHeader);
  const currentGross =
    BigInt(original.primary_supplier_cost_fils) + BigInt(prior.primary_delta);
  const desiredGross =
    currentGross + outcome.delta.primarySupplierCostDeltaFils;
  const supplierEffects =
    original.settlement_context === "cash"
      ? []
      : current.header.supplierId === draftHeader.supplier_id
        ? outcome.delta.primarySupplierCostDeltaFils === 0n
          ? []
          : [
              {
                deltaFils:
                  outcome.delta.primarySupplierCostDeltaFils.toString(),
                supplierId: draftHeader.supplier_id,
                supplierNameSnapshot: draftHeader.supplier_name_snapshot,
              },
            ]
        : [
            {
              deltaFils: (-currentGross).toString(),
              supplierId: current.header.supplierId,
              supplierNameSnapshot: current.header.supplierNameSnapshot,
            },
            {
              deltaFils: desiredGross.toString(),
              supplierId: draftHeader.supplier_id,
              supplierNameSnapshot: draftHeader.supplier_name_snapshot,
            },
          ].filter((effect) => effect.deltaFils !== "0");
  const base = {
    allowanceDeltaFils: outcome.delta.allowanceDeltaFils.toString(),
    costAfterDiscountDeltaFils:
      outcome.delta.costAfterDiscountDeltaFils.toString(),
    draftId: draftHeader.id,
    draftVersion: draftHeader.version,
    headerChanges,
    primarySupplierCostDeltaFils:
      outcome.delta.primarySupplierCostDeltaFils.toString(),
    quantityDelta: outcome.delta.quantityDelta.toString(),
    rowDeltas,
    stockEffects: rowDeltas
      .filter(
        (row) =>
          row.quantityDelta !== "0" || row.primarySupplierCostDeltaFils !== "0",
      )
      .map((row) => ({
        batchId: row.after?.batchId ?? row.before?.batchId ?? null,
        itemDisplayName:
          row.after?.itemDisplayName ?? row.before?.itemDisplayName ?? "",
        itemId: row.after?.itemId ?? row.before?.itemId ?? "",
        primarySupplierCostDeltaFils: row.primarySupplierCostDeltaFils,
        quantityDelta: row.quantityDelta,
      })),
    supplierEffects,
  };
  const confirmationHash = canonicalRequestHash(
    "purchase.adjustment.summary",
    base as JsonObject,
  ).toString("hex");
  return {
    currentHeader: {
      supplierId: current.header.supplierId,
      supplierNameSnapshot: current.header.supplierNameSnapshot,
    },
    currentRows: current.rows,
    draftRows,
    original,
    originalRows,
    summary: purchaseAdjustmentSummarySchema.parse({
      ...base,
      confirmationHash,
    }),
  };
}

function domainRow(row: PurchaseAdjustmentSnapshotRow): DomainRow {
  return {
    enteredQuantity: BigInt(row.enteredQuantity),
    inventoryUnitQuantity: BigInt(row.inventoryUnitQuantity),
    itemDisplayName: row.itemDisplayName,
    itemId: row.itemId,
    lineageId: row.lineageId,
    originalRowId: row.originalRowId,
    primarySupplierCostFils: BigInt(row.costFils),
    retailPriceFils: BigInt(row.retailPriceFils),
  };
}

function draftRowSnapshot(
  row: PurchaseAdjustmentDraftRow,
): PurchaseAdjustmentSnapshotRow {
  const value: Record<string, unknown> = { ...row };
  delete value.id;
  return purchaseAdjustmentSnapshotRowSchema.parse(value);
}

function assertMeaningfulChange(calculated: CalculatedSummary): void {
  if (
    calculated.summary.headerChanges.length === 0 &&
    calculated.summary.rowDeltas.every(
      (row) =>
        row.changes.length === 0 &&
        row.quantityDelta === "0" &&
        row.primarySupplierCostDeltaFils === "0",
    )
  ) {
    reject(409, "adjustment-empty", [
      {
        code: "invalid",
        path: ["rows"],
        rule: "purchase.adjustment.empty",
      },
    ]);
  }
}

async function validateSummaryBatches(
  client: PoolClient,
  pharmacyId: string,
  calculated: CalculatedSummary,
): Promise<void> {
  const effects: PurchaseAdjustmentInventoryEffect[] =
    calculated.summary.stockEffects
      .filter((effect) => effect.batchId !== null)
      .map((effect) => ({
        batchId: effect.batchId!,
        primarySupplierCostDeltaFils: BigInt(
          effect.primarySupplierCostDeltaFils,
        ),
        productId: effect.itemId,
        quantityDelta: BigInt(effect.quantityDelta),
      }));
  const problem = await validatePurchaseAdjustmentBatches(
    client,
    pharmacyId,
    effects,
  );
  if (problem !== undefined) {
    reject(409, "adjustment-batch-conflict", [
      {
        code: "invalid",
        path: ["rows"],
        rule:
          problem.kind === "batch-insufficient"
            ? "purchase.adjustment.batch-insufficient"
            : "purchase.adjustment.batch-invalid",
      },
    ]);
  }
}

async function validateSummaryValuation(
  client: PoolClient,
  pharmacyId: string,
  calculated: CalculatedSummary,
): Promise<void> {
  const byProduct = aggregateProductEffects(calculated.summary.stockEffects);
  for (const effect of byProduct.values()) {
    const valid = await validatePurchaseAdjustmentValuation(client, {
      pharmacyId,
      primarySupplierCostDeltaFils: effect.primarySupplierCostDeltaFils,
      productId: effect.productId,
      quantityDelta: effect.quantityDelta,
    });
    if (!valid) {
      reject(409, "adjustment-batch-conflict", [
        {
          code: "invalid",
          path: ["rows"],
          rule: "purchase.adjustment.valuation-invalid",
        },
      ]);
    }
  }
}

function aggregateProductEffects(
  effects: readonly PurchaseAdjustmentSummary["stockEffects"][number][],
): Map<
  string,
  {
    primarySupplierCostDeltaFils: bigint;
    productId: string;
    quantityDelta: bigint;
  }
> {
  const result = new Map<
    string,
    {
      primarySupplierCostDeltaFils: bigint;
      productId: string;
      quantityDelta: bigint;
    }
  >();
  for (const effect of effects) {
    const current = result.get(effect.itemId) ?? {
      primarySupplierCostDeltaFils: 0n,
      productId: effect.itemId,
      quantityDelta: 0n,
    };
    result.set(effect.itemId, {
      primarySupplierCostDeltaFils:
        current.primarySupplierCostDeltaFils +
        BigInt(effect.primarySupplierCostDeltaFils),
      productId: effect.itemId,
      quantityDelta: current.quantityDelta + BigInt(effect.quantityDelta),
    });
  }
  return result;
}

async function postInventoryEffects(
  client: PoolClient,
  context: IdentityExecutionContext,
  adjustmentId: string,
  calculated: CalculatedSummary,
): Promise<PostedPurchaseAdjustment["rowDeltas"]> {
  const result: PostedPurchaseAdjustment["rowDeltas"][number][] = [];
  for (const row of calculated.summary.rowDeltas) {
    let after = row.after;
    let batchId = after?.batchId ?? row.before?.batchId ?? null;
    const quantityDelta = BigInt(row.quantityDelta);
    const valueDelta = BigInt(row.primarySupplierCostDeltaFils);
    if (batchId === null && after !== null && quantityDelta > 0n) {
      batchId = (
        await receiveBatch(client, {
          actorId: context.actorId,
          expiryDate: after.expiryDate,
          lotNumber: after.lotNumber,
          pharmacyId: context.pharmacyId,
          productId: after.itemId,
          quantity: quantityDelta,
        })
      ).batchId;
      after = { ...after, batchId };
    }
    if ((quantityDelta !== 0n || valueDelta !== 0n) && batchId === null) {
      throw new Error("An Inventory adjustment effect has no Batch");
    }
    const movementId =
      quantityDelta === 0n
        ? null
        : (
            await recordPurchaseAdjustmentMovement(client, {
              actorId: context.actorId,
              batchId: batchId!,
              carryingAmountFils: valueDelta,
              pharmacyId: context.pharmacyId,
              productId: (after ?? row.before)!.itemId,
              quantity: quantityDelta,
              sourceDocumentId: adjustmentId,
              sourceRowOrdinal: after?.ordinal ?? row.before?.ordinal ?? 1,
            })
          ).movementId;
    const valueEffectId =
      quantityDelta === 0n && valueDelta === 0n
        ? null
        : (
            await recordPurchaseAdjustmentValueEffect(client, {
              actorId: context.actorId,
              batchId: batchId!,
              carryingAmountFils: valueDelta,
              pharmacyId: context.pharmacyId,
              productId: (after ?? row.before)!.itemId,
              quantity: quantityDelta,
              sourceDocumentId: adjustmentId,
              sourceRowOrdinal: after?.ordinal ?? row.before?.ordinal ?? 1,
            })
          ).valueEffectId;
    result.push({ ...row, after, movementId, valueEffectId });
  }
  return result;
}

async function applyValuationEffects(
  client: PoolClient,
  pharmacyId: string,
  rows: PostedPurchaseAdjustment["rowDeltas"],
): Promise<void> {
  const effects = aggregateProductEffects(
    rows.map((row) => ({
      batchId: row.after?.batchId ?? row.before?.batchId ?? null,
      itemDisplayName:
        row.after?.itemDisplayName ?? row.before?.itemDisplayName ?? "",
      itemId: row.after?.itemId ?? row.before?.itemId ?? "",
      primarySupplierCostDeltaFils: row.primarySupplierCostDeltaFils,
      quantityDelta: row.quantityDelta,
    })),
  );
  for (const effect of effects.values()) {
    const applied = await applyPurchaseAdjustmentToValuation(client, {
      pharmacyId,
      primarySupplierCostDeltaFils: effect.primarySupplierCostDeltaFils,
      productId: effect.productId,
      quantityDelta: effect.quantityDelta,
    });
    if (!applied)
      throw new Error("Validated Inventory valuation became invalid");
  }
}

function displayHeaderChanges(
  current: {
    supplierId: string;
    supplierInvoiceNumber: string;
  },
  draft: AdjustmentDraftHeaderRow,
): PurchaseAdjustmentFieldChange[] {
  const changes: PurchaseAdjustmentFieldChange[] = [];
  if (current.supplierId !== draft.supplier_id) {
    changes.push({
      after: draft.supplier_id,
      before: current.supplierId,
      field: "supplier",
    });
  }
  if (current.supplierInvoiceNumber !== draft.supplier_invoice_number) {
    changes.push({
      after: draft.supplier_invoice_number,
      before: current.supplierInvoiceNumber,
      field: "supplier-invoice-number",
    });
  }
  return changes;
}

function displayRowChanges(
  before: PurchaseAdjustmentSnapshotRow | null,
  after: PurchaseAdjustmentSnapshotRow | null,
): PurchaseAdjustmentFieldChange[] {
  if (before === null && after !== null) {
    return [
      { after: after.enteredQuantity, before: null, field: "entered-quantity" },
    ];
  }
  if (before !== null && after === null) {
    return [
      {
        after: null,
        before: before.enteredQuantity,
        field: "entered-quantity",
      },
    ];
  }
  if (before === null || after === null) return [];
  const changes: PurchaseAdjustmentFieldChange[] = [];
  for (const [field, left, right] of [
    ["entered-quantity", before.enteredQuantity, after.enteredQuantity],
    ["primary-supplier-cost", before.costFils, after.costFils],
    ["retail-price", before.retailPriceFils, after.retailPriceFils],
  ] as const) {
    if (left !== right) changes.push({ after: right, before: left, field });
  }
  return changes;
}

function draftAuditState(
  draft: PurchaseAdjustmentDraft,
): Record<string, string | number | null> {
  return {
    evidence: draft.evidence,
    originalPurchaseId: draft.originalPurchaseId,
    reason: draft.reason,
    rowCount: draft.rows.length,
    status: draft.status,
    supplierId: draft.supplierId,
    version: draft.version,
  };
}

function journalView(journal: {
  entryId: string;
  lines: readonly {
    accountCode: "cash" | "inventory" | "supplier-payable";
    creditFils: bigint;
    debitFils: bigint;
    ordinal: number;
    supplierId: string | null;
  }[];
  templateVersion: number;
}) {
  return {
    entryId: journal.entryId,
    lines: journal.lines.map((line) => ({
      ...line,
      creditFils: line.creditFils.toString(),
      debitFils: line.debitFils.toString(),
    })),
    templateId: "purchase.adjustment" as const,
    templateVersion: journal.templateVersion,
  };
}

async function readPostedAdjustmentView(
  client: PoolClient,
  pharmacyId: string,
  adjustmentId: string,
): Promise<PostedPurchaseAdjustment | undefined> {
  const header = await client.query<{
    allowance_delta_fils: string;
    cost_after_discount_delta_fils: string;
    draft_id: string;
    evidence: string | null;
    header_changes: unknown;
    id: string;
    journal_entry_id: string;
    number_value: string;
    number_year: number;
    original_purchase_id: string;
    posted_at: Date;
    posted_by: string;
    primary_supplier_cost_delta_fils: string;
    quantity_delta: string;
    reason: PurchaseAdjustmentDraft["reason"];
    suffix_value: string;
    supplier_id: string;
    supplier_invoice_number: string;
    supplier_name_snapshot: string;
    template_version: number;
  }>(
    `select adjustment.id, adjustment.draft_id,
            adjustment.original_purchase_id, adjustment.suffix_value::text,
            adjustment.supplier_id, adjustment.supplier_name_snapshot,
            adjustment.supplier_invoice_number, adjustment.reason,
            adjustment.evidence, adjustment.quantity_delta::text,
            adjustment.primary_supplier_cost_delta_fils::text,
            adjustment.allowance_delta_fils::text,
            adjustment.cost_after_discount_delta_fils::text,
            adjustment.header_changes, adjustment.journal_entry_id,
            adjustment.posted_at, adjustment.posted_by,
            original.number_value::text, original.number_year,
            journal.template_version
     from posted_purchase_adjustments adjustment
     join posted_purchases original
       on original.id = adjustment.original_purchase_id
      and original.pharmacy_id = adjustment.pharmacy_id
     join accounting_journal_entries journal
       on journal.id = adjustment.journal_entry_id
      and journal.pharmacy_id = adjustment.pharmacy_id
     where adjustment.pharmacy_id = $1 and adjustment.id = $2`,
    [pharmacyId, adjustmentId],
  );
  const row = header.rows[0];
  if (row === undefined) return undefined;
  const effects = await client.query<{
    after_snapshot: unknown;
    before_snapshot: unknown;
    changes: unknown;
    effect_kind: "added" | "changed" | "removed";
    lineage_id: string;
    movement_id: string | null;
    primary_supplier_cost_delta_fils: string;
    quantity_delta: string;
    value_effect_id: string | null;
  }>(
    `select lineage_id, effect_kind, before_snapshot, after_snapshot, changes,
            quantity_delta::text, primary_supplier_cost_delta_fils::text,
            movement_id, value_effect_id
     from posted_purchase_adjustment_rows
     where pharmacy_id = $1 and adjustment_id = $2 order by ordinal, id`,
    [pharmacyId, adjustmentId],
  );
  const lines = await client.query<{
    account_code: "cash" | "inventory" | "supplier-payable";
    credit_fils: string;
    debit_fils: string;
    ordinal: number;
    supplier_id: string | null;
  }>(
    `select ordinal, account_code, supplier_id, debit_fils::text,
            credit_fils::text
     from accounting_journal_lines
     where pharmacy_id = $1 and entry_id = $2 order by ordinal`,
    [pharmacyId, row.journal_entry_id],
  );
  return postedPurchaseAdjustmentSchema.parse({
    allowanceDeltaFils: row.allowance_delta_fils,
    costAfterDiscountDeltaFils: row.cost_after_discount_delta_fils,
    draftId: row.draft_id,
    evidence: row.evidence,
    headerChanges: row.header_changes,
    id: row.id,
    journal: {
      entryId: row.journal_entry_id,
      lines: lines.rows.map((line) => ({
        accountCode: line.account_code,
        creditFils: line.credit_fils,
        debitFils: line.debit_fils,
        ordinal: line.ordinal,
        supplierId: line.supplier_id,
      })),
      templateId: "purchase.adjustment",
      templateVersion: row.template_version,
    },
    number: {
      original: { series: "P", value: row.number_value, year: row.number_year },
      suffix: row.suffix_value,
    },
    originalPurchaseId: row.original_purchase_id,
    postedAt: row.posted_at.toISOString(),
    postedBy: row.posted_by,
    primarySupplierCostDeltaFils: row.primary_supplier_cost_delta_fils,
    quantityDelta: row.quantity_delta,
    reason: row.reason,
    rowDeltas: effects.rows.map((effect) => ({
      after: effect.after_snapshot,
      before: effect.before_snapshot,
      changes: effect.changes,
      kind: effect.effect_kind,
      lineageId: effect.lineage_id,
      movementId: effect.movement_id,
      primarySupplierCostDeltaFils: effect.primary_supplier_cost_delta_fils,
      quantityDelta: effect.quantity_delta,
      valueEffectId: effect.value_effect_id,
    })),
    supplierId: row.supplier_id,
    supplierInvoiceNumber: row.supplier_invoice_number,
    supplierNameSnapshot: row.supplier_name_snapshot,
  });
}

function normalizeDecimal(value: string): string {
  return value.includes(".")
    ? value.replace(/0+$/u, "").replace(/\.$/u, "")
    : value;
}
