import {
  postedPurchaseReturnSchema,
  purchaseReturnDraftSchema,
  purchaseReturnPostResultSchema,
  purchaseReturnSummarySchema,
  purchasingDenialSchema,
  type PostedPurchaseReturn,
  type PurchaseReturnDraft,
  type PurchaseReturnDraftCreateRequest,
  type PurchaseReturnDraftDiscardRequest,
  type PurchaseReturnDraftUpdateRequest,
  type PurchaseReturnPostRequest,
  type PurchaseReturnPostResult,
  type PurchaseReturnSummary,
  type PurchasingDenialCode,
  type PurchasingFieldError,
} from "@breev/contracts/local-rest";
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

import {
  applyPurchaseReturnSupplierEffect,
  postPurchaseReturnJournal,
} from "../accounting/accounting-persistence.js";
import {
  applyPurchaseReturnValuation,
  lockPurchaseReturnBatches,
  preparePurchaseReturnValuation,
  recordPurchaseReturnMovement,
  type PurchaseReturnValuationPlan,
} from "../inventory/inventory-persistence.js";
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
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import {
  calculateSupplierReduction,
  validatePurchaseReturnEligibility,
} from "./purchase-return.js";
import { PurchasingDenied } from "./purchasing.service.js";

const RETURN_PERMISSION = "purchases.returns.manage";
const COST_PERMISSION = "purchases.costs.view";
const POSTED_PERMISSION = "purchases.posted.view";
const COMMANDS = {
  create: "purchase.return-draft.create",
  discard: "purchase.return-draft.discard",
  post: "purchase.return.post",
  update: "purchase.return-draft.update",
} as const;

type ReturnCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
type ReturnCommandValue = PurchaseReturnDraft | PurchaseReturnPostResult;

interface ReturnDraftHeaderRow {
  created_at: Date;
  evidence: string;
  id: string;
  invoice_date: string;
  number_value: string;
  number_year: number;
  original_purchase_id: string;
  reason: string;
  status: "active" | "discarded" | "posted";
  supplier_id: string;
  supplier_name_snapshot: string;
  updated_at: Date;
  version: string;
}

interface ReturnDraftRowRecord {
  batch_id: string;
  id: string;
  inventory_unit_name: string;
  inventory_unit_quantity: string;
  item_display_name: string;
  ordinal: number;
  original_purchase_row_id: string;
  product_id: string;
  return_quantity: string;
  line_primary_supplier_cost_fils: string;
}

interface SelectedReturnRow extends ReturnDraftRowRecord {
  already_reduced_fils: string;
  previously_returned_quantity: string;
}

interface CommandRejected {
  readonly code: PurchasingDenialCode;
  readonly fieldErrors: readonly PurchasingFieldError[];
  readonly statusCode: 400 | 404 | 409;
  readonly targetId?: string;
}

class PurchaseReturnCommandRejected extends Error {
  public constructor(public readonly rejection: CommandRejected) {
    super(rejection.code);
    this.name = "PurchaseReturnCommandRejected";
  }
}

interface CommandSuccess<T extends ReturnCommandValue> {
  readonly afterState: Record<string, boolean | number | string | null>;
  readonly beforeState?: Record<string, boolean | number | string | null>;
  readonly targetId: string;
  readonly value: T;
}

interface CalculatedReturn {
  readonly header: ReturnDraftHeaderRow;
  readonly plan: PurchaseReturnValuationPlan;
  readonly rows: readonly (PurchaseReturnSummary["rows"][number] & {
    readonly ordinal: number;
  })[];
  readonly summary: PurchaseReturnSummary;
}

@Injectable()
export class PurchaseReturnsService {
  private readonly logger = new Logger(PurchaseReturnsService.name);

  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async createDraft(
    request: Request,
    originalPurchaseId: string,
    input: PurchaseReturnDraftCreateRequest,
  ): Promise<PurchaseReturnDraft> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.create,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseReturnDraftSchema,
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
          reject(404, "return-original-not-found", [], originalPurchaseId);
        }
        const inserted = await client.query<{ id: string }>(
          `insert into purchase_return_drafts (
             pharmacy_id, original_purchase_id, reason, evidence,
             created_by, updated_by
           ) values ($1, $2, $3, $4, $5, $5) returning id`,
          [
            context.pharmacyId,
            originalPurchaseId,
            input.reason,
            input.evidence,
            context.actorId,
          ],
        );
        const draftId = inserted.rows[0]?.id;
        if (draftId === undefined) {
          throw new Error("The Purchase Return Draft was not created");
        }
        await client.query(
          `insert into purchase_return_draft_rows (
             pharmacy_id, draft_id, original_purchase_row_id
           )
           select $1, $2, row_record.id from posted_purchase_rows row_record
           where row_record.pharmacy_id = $1
             and row_record.posted_purchase_id = $3
           order by row_record.ordinal`,
          [context.pharmacyId, draftId, originalPurchaseId],
        );
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
  ): Promise<PurchaseReturnDraft> {
    const context = await this.requireContext(request);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const header = await readDraftHeader(
        client,
        context.pharmacyId,
        draftId,
        false,
      );
      if (header === undefined) {
        throw await this.readDenied(
          context,
          "purchase.return-draft.read",
          "return-draft-not-found",
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
    input: PurchaseReturnDraftUpdateRequest,
  ): Promise<PurchaseReturnDraft> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.update,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseReturnDraftSchema,
      requestHash: canonicalRequestHash(COMMANDS.update, {
        draftId,
        input: JSON.parse(JSON.stringify(input)) as JsonObject,
      }),
      responseStatus: 200,
      targetId: draftId,
      work: async (client) => {
        const header = await readDraftHeader(
          client,
          context.pharmacyId,
          draftId,
          true,
        );
        requireEditableDraft(header, draftId, input.expectedVersion);
        const before = await readDraftView(client, context.pharmacyId, draftId);
        const available = new Map(
          before.rows.map((row) => [row.originalPurchaseRowId, row]),
        );
        if (
          input.rows.length !== available.size ||
          new Set(input.rows.map((row) => row.originalPurchaseRowId)).size !==
            input.rows.length
        ) {
          reject(400, "body-invalid", [{ code: "invalid", path: ["rows"] }]);
        }
        for (const [index, row] of input.rows.entries()) {
          const current = available.get(row.originalPurchaseRowId);
          if (current === undefined) {
            reject(409, "return-ineligible-batch", [
              {
                code: "invalid",
                path: ["rows", index, "originalPurchaseRowId"],
                rule: "purchase.return.ineligible-batch",
              },
            ]);
          }
          if (
            BigInt(row.returnQuantity) >
            BigInt(current.remainingEligibleQuantity)
          ) {
            reject(409, "return-over-eligible", [
              {
                code: "out-of-range",
                path: ["rows", index, "returnQuantity"],
                rule: "purchase.return.over-return",
              },
            ]);
          }
          await client.query(
            `update purchase_return_draft_rows
             set return_quantity = $4::bigint
             where pharmacy_id = $1 and draft_id = $2
               and original_purchase_row_id = $3`,
            [
              context.pharmacyId,
              draftId,
              row.originalPurchaseRowId,
              row.returnQuantity,
            ],
          );
        }
        await client.query(
          `update purchase_return_drafts
           set reason = $3, evidence = $4, version = version + 1,
               updated_at = statement_timestamp(), updated_by = $5
           where pharmacy_id = $1 and id = $2`,
          [
            context.pharmacyId,
            draftId,
            input.reason,
            input.evidence,
            context.actorId,
          ],
        );
        const value = await readDraftView(client, context.pharmacyId, draftId);
        return {
          afterState: draftAuditState(value),
          beforeState: draftAuditState(before),
          targetId: draftId,
          value,
        };
      },
    });
  }

  public async discardDraft(
    request: Request,
    draftId: string,
    input: PurchaseReturnDraftDiscardRequest,
  ): Promise<PurchaseReturnDraft> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.discard,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseReturnDraftSchema,
      requestHash: canonicalRequestHash(COMMANDS.discard, { draftId, input }),
      responseStatus: 201,
      targetId: draftId,
      work: async (client) => {
        const header = await readDraftHeader(
          client,
          context.pharmacyId,
          draftId,
          true,
        );
        requireEditableDraft(header, draftId, input.expectedVersion);
        const before = await readDraftView(client, context.pharmacyId, draftId);
        await client.query(
          `update purchase_return_drafts
           set status = 'discarded', discarded_at = statement_timestamp(),
               discarded_by = $3, version = version + 1,
               updated_at = statement_timestamp(), updated_by = $3
           where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, draftId, context.actorId],
        );
        const value = await readDraftView(client, context.pharmacyId, draftId);
        return {
          afterState: draftAuditState(value),
          beforeState: draftAuditState(before),
          targetId: draftId,
          value,
        };
      },
    });
  }

  public async preview(
    request: Request,
    draftId: string,
  ): Promise<PurchaseReturnSummary> {
    const context = await this.requireContext(request);
    const client = await this.localDatabase.requirePool().connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
      await this.identity.revalidatePurchaseReturnManagement(client, context);
      const header = await readDraftHeader(
        client,
        context.pharmacyId,
        draftId,
        true,
      );
      requireEditableDraft(header, draftId, header?.version ?? "0");
      const calculated = await calculateReturn(
        client,
        context.pharmacyId,
        header!,
        "draft",
      );
      await client.query("commit");
      transactionOpen = false;
      return calculated.summary;
    } catch (error) {
      if (transactionOpen)
        await client.query("rollback").catch(() => undefined);
      if (error instanceof PurchaseReturnCommandRejected) {
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

  /** Purchasing owns this one short transaction; Inventory and Accounting
   * receive the same PoolClient and write only their own tables. */
  public async postPurchaseReturn(
    request: Request,
    draftId: string,
    input: PurchaseReturnPostRequest,
  ): Promise<PurchaseReturnPostResult> {
    const context = await this.requireContext(request);
    return await this.executeCommand({
      commandName: COMMANDS.post,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseReturnPostResultSchema,
      requestHash: canonicalRequestHash(COMMANDS.post, { draftId, input }),
      responseStatus: 201,
      targetId: draftId,
      work: async (client) => {
        const header = await readDraftHeader(
          client,
          context.pharmacyId,
          draftId,
          true,
        );
        requireEditableDraft(header, draftId, input.expectedVersion);

        assertLockStageProgression("draft", "number-sequence");
        const clock = await client.query<{ posted_at: Date; year: number }>(
          `select statement_timestamp() as posted_at,
                  extract(year from statement_timestamp())::int as year`,
        );
        const postingClock = clock.rows[0];
        if (postingClock === undefined)
          throw new Error("Posting clock unavailable");
        const allocation = await allocateDocumentNumber(
          this.localDatabase.requirePool(),
          {
            actorUserId: context.actorId,
            correlationId: input.idempotencyKey,
            device: context,
            documentType: "purchase-return",
            identitySessionId: context.sessionId,
            pharmacyId: context.pharmacyId,
            year: postingClock.year,
          },
        );

        const calculated = await calculateReturn(
          client,
          context.pharmacyId,
          header!,
          "number-sequence",
        );
        if (calculated.summary.confirmationHash !== input.confirmationHash) {
          reject(409, "return-summary-stale", [
            {
              code: "invalid",
              path: ["confirmationHash"],
              rule: "purchase.return.summary-stale",
            },
          ]);
        }
        await this.identity.consumePurchaseReturnStepUp(
          client,
          context,
          input.stepUpChallengeId,
          draftId,
        );

        const inventoryCarryingAmountFils = BigInt(
          calculated.summary.inventoryCarryingAmountFils,
        );
        const supplierReductionFils = BigInt(
          calculated.summary.supplierReductionFils,
        );
        const journal = await postPurchaseReturnJournal(client, {
          facts: {
            inventoryCarryingAmountFils,
            supplierId: header!.supplier_id,
            supplierReductionFils,
          },
          pharmacyId: context.pharmacyId,
          postedBy: context.actorId,
        });
        await applyPurchaseReturnSupplierEffect(client, {
          pharmacyId: context.pharmacyId,
          supplierId: header!.supplier_id,
          supplierReductionFils,
        });
        const deviceId = context.deviceId ?? context.terminalDeviceId;
        if (deviceId === undefined)
          throw new Error("Posting device unavailable");
        const inserted = await client.query<{ id: string }>(
          `insert into posted_purchase_returns (
             pharmacy_id, draft_id, original_purchase_id,
             original_number_value, original_number_year,
             original_invoice_date, supplier_id, supplier_name_snapshot,
             number_value, number_year, reason, evidence,
             inventory_carrying_amount_fils, supplier_reduction_fils,
             difference_treatment, journal_entry_id, approval_challenge_id,
             device_id, posted_at, posted_by
           ) values (
             $1, $2, $3, $4::bigint, $5, $6, $7, $8, $9::bigint, $10,
             $11, $12, $13::bigint, $14::bigint, $15, $16, $17, $18, $19, $20
           ) returning id`,
          [
            context.pharmacyId,
            draftId,
            header!.original_purchase_id,
            header!.number_value,
            header!.number_year,
            header!.invoice_date,
            header!.supplier_id,
            header!.supplier_name_snapshot,
            allocation.value.toString(),
            postingClock.year,
            header!.reason,
            header!.evidence,
            inventoryCarryingAmountFils.toString(),
            supplierReductionFils.toString(),
            journal.treatment,
            journal.entryId,
            input.stepUpChallengeId,
            deviceId,
            postingClock.posted_at,
            context.actorId,
          ],
        );
        const returnId = inserted.rows[0]?.id;
        if (returnId === undefined) {
          throw new Error("The Posted Purchase Return was not created");
        }
        await markNumberIssued(client, {
          allocationId: allocation.allocationId,
          correlationId: input.idempotencyKey,
          documentId: returnId,
          documentType: "purchase-return",
          pharmacyId: context.pharmacyId,
          year: postingClock.year,
        });

        const postedRows: PostedPurchaseReturn["rows"][number][] = [];
        for (const row of calculated.rows) {
          const movement = await recordPurchaseReturnMovement(client, {
            actorId: context.actorId,
            batchId: row.batchId,
            carryingAmountFils: BigInt(row.carryingAmountFils),
            pharmacyId: context.pharmacyId,
            productId: row.itemId,
            quantity: BigInt(row.quantity),
            sourceDocumentId: returnId,
            sourceRowOrdinal: row.ordinal,
            supplierReductionFils: BigInt(row.supplierReductionFils),
          });
          const insertedRow = await client.query<{ id: string }>(
            `insert into posted_purchase_return_rows (
               pharmacy_id, purchase_return_id, original_purchase_row_id,
               ordinal, product_id, batch_id, item_display_name,
               inventory_unit_name, quantity, carrying_amount_per_unit_scaled,
               carrying_amount_fils, supplier_reduction_fils,
               valuation_method, movement_id
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9::bigint, $10::numeric,
               $11::bigint, $12::bigint, $13, $14
             ) returning id`,
            [
              context.pharmacyId,
              returnId,
              row.originalPurchaseRowId,
              row.ordinal,
              row.itemId,
              row.batchId,
              row.itemDisplayName,
              row.inventoryUnitName,
              row.quantity,
              row.carryingAmountPerUnitScaled,
              row.carryingAmountFils,
              row.supplierReductionFils,
              row.valuationMethod,
              movement.movementId,
            ],
          );
          const rowId = insertedRow.rows[0]?.id;
          if (rowId === undefined)
            throw new Error("Return row was not created");
          postedRows.push({
            batchId: row.batchId,
            carryingAmountFils: row.carryingAmountFils,
            carryingAmountPerUnitScaled: row.carryingAmountPerUnitScaled,
            id: rowId,
            inventoryUnitName: row.inventoryUnitName,
            itemDisplayName: row.itemDisplayName,
            itemId: row.itemId,
            movementId: movement.movementId,
            originalPurchaseRowId: row.originalPurchaseRowId,
            quantity: row.quantity,
            supplierReductionFils: row.supplierReductionFils,
            valuationMethod: row.valuationMethod,
          });
        }
        await applyPurchaseReturnValuation(
          client,
          context.pharmacyId,
          calculated.plan,
        );
        await client.query(
          `update purchase_return_drafts
           set status = 'posted', version = version + 1,
               updated_at = statement_timestamp(), updated_by = $3
           where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, draftId, context.actorId],
        );
        await appendOutboxEntry(client, {
          correlationId: input.idempotencyKey,
          envelopeVersion: CURRENT_ENVELOPE_VERSIONS["purchase.return.posted"],
          eventType: POSTING_EVENT_TYPES.purchaseReturnPosted,
          occurredAt: postingClock.posted_at,
          payload: {
            inventoryCarryingAmountFils: inventoryCarryingAmountFils.toString(),
            originalPurchaseId: header!.original_purchase_id,
            pharmacyId: context.pharmacyId,
            purchaseReturnId: returnId,
            supplierReductionFils: supplierReductionFils.toString(),
          },
          pharmacyId: context.pharmacyId,
        });
        const posted = postedPurchaseReturnSchema.parse({
          approvalChallengeId: input.stepUpChallengeId,
          deviceId,
          draftId,
          evidence: header!.evidence,
          id: returnId,
          inventoryCarryingAmountFils: inventoryCarryingAmountFils.toString(),
          journal: journalView(journal),
          number: {
            series: "PR",
            value: allocation.value.toString(),
            year: postingClock.year,
          },
          originalInvoiceDate: header!.invoice_date,
          originalNumber: {
            series: "P",
            value: header!.number_value,
            year: header!.number_year,
          },
          originalPurchaseId: header!.original_purchase_id,
          postedAt: postingClock.posted_at.toISOString(),
          postedBy: context.actorId,
          reason: header!.reason,
          rows: postedRows,
          supplierId: header!.supplier_id,
          supplierNameSnapshot: header!.supplier_name_snapshot,
          supplierReductionFils: supplierReductionFils.toString(),
        });
        return {
          afterState: {
            inventoryCarryingAmountFils: inventoryCarryingAmountFils.toString(),
            number: allocation.value.toString(),
            status: "posted",
            supplierReductionFils: supplierReductionFils.toString(),
          },
          beforeState: { status: header!.status, version: header!.version },
          targetId: returnId,
          value: { posted },
        };
      },
    });
  }

  public async readPostedReturn(
    request: Request,
    returnId: string,
  ): Promise<PostedPurchaseReturn> {
    await this.identity.requirePermission(request, POSTED_PERMISSION);
    const context = await this.identity.requirePermission(
      request,
      COST_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const result = await readPostedReturnView(
        client,
        context.pharmacyId,
        returnId,
      );
      if (result === undefined) {
        throw await this.readDenied(
          context,
          "purchase.return.read",
          "return-original-not-found",
          returnId,
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
    await this.identity.requirePermission(request, RETURN_PERMISSION);
    return await this.identity.requirePermission(request, COST_PERMISSION);
  }

  private async executeCommand<T extends ReturnCommandValue>(input: {
    readonly commandName: ReturnCommandName;
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
        await this.identity.revalidatePurchaseReturnManagement(
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
        await client.query("savepoint purchase_return_work");
        try {
          success = await input.work(client);
        } catch (error) {
          if (!(error instanceof PurchaseReturnCommandRejected)) throw error;
          await client.query("rollback to savepoint purchase_return_work");
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
            "Purchase Return command failed",
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
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const requestId = await writePostingAudit(client, {
        action,
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: code,
        pharmacyId: context.pharmacyId,
        targetId,
      });
      await client.query("commit");
      return denied(404, code, requestId);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistReadRejection(
    context: IdentityExecutionContext,
    targetId: string,
    rejection: CommandRejected,
  ): Promise<PurchasingDenied> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const requestId = await writePostingAudit(client, {
        action: "purchase.return.preview",
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: rejection.code,
        pharmacyId: context.pharmacyId,
        targetId,
      });
      await client.query("commit");
      return denied(
        rejection.statusCode,
        rejection.code,
        requestId,
        rejection.fieldErrors,
      );
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
  throw new PurchaseReturnCommandRejected({
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
  row: ReturnDraftHeaderRow | undefined,
  draftId: string,
  expectedVersion: string,
): void {
  if (row === undefined) reject(404, "return-draft-not-found", [], draftId);
  if (row.status === "discarded") {
    reject(409, "return-draft-discarded", [], draftId);
  }
  if (row.status === "posted") reject(409, "return-draft-posted", [], draftId);
  if (row.version !== expectedVersion)
    reject(409, "version-conflict", [], draftId);
}

async function readOriginalHeader(
  client: PoolClient,
  pharmacyId: string,
  purchaseId: string,
  lock: boolean,
): Promise<ReturnDraftHeaderRow | undefined> {
  const result = await client.query<ReturnDraftHeaderRow>(
    `select posted.id, posted.id as original_purchase_id,
            posted.supplier_id, posted.supplier_name_snapshot,
            posted.invoice_date::text, posted.number_value::text,
            posted.number_year, ''::text as reason, ''::text as evidence,
            'active'::text as status, '1'::text as version,
            posted.posted_at as created_at, posted.posted_at as updated_at
     from posted_purchases posted
     where posted.pharmacy_id = $1 and posted.id = $2${lock ? " for update" : ""}`,
    [pharmacyId, purchaseId],
  );
  return result.rows[0];
}

async function readDraftHeader(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
  lock: boolean,
): Promise<ReturnDraftHeaderRow | undefined> {
  const result = await client.query<ReturnDraftHeaderRow>(
    `select draft.id, draft.original_purchase_id, draft.reason,
            draft.evidence, draft.status, draft.version::text,
            draft.created_at, draft.updated_at, original.supplier_id,
            original.supplier_name_snapshot, original.invoice_date::text,
            original.number_value::text, original.number_year
     from purchase_return_drafts draft
     join posted_purchases original
       on original.id = draft.original_purchase_id
      and original.pharmacy_id = draft.pharmacy_id
     where draft.pharmacy_id = $1 and draft.id = $2${
       lock ? " for update of draft" : ""
     }`,
    [pharmacyId, draftId],
  );
  return result.rows[0];
}

async function readDraftRows(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<ReturnDraftRowRecord[]> {
  const result = await client.query<ReturnDraftRowRecord>(
    `select draft_row.id,
            draft_row.original_purchase_row_id,
            draft_row.return_quantity::text,
            original.ordinal, original.product_id, original.batch_id,
            original.item_display_name, original.inventory_unit_name,
            original.inventory_unit_quantity::text,
            original.line_primary_supplier_cost_fils::text
     from purchase_return_draft_rows draft_row
     join posted_purchase_rows original
       on original.id = draft_row.original_purchase_row_id
      and original.pharmacy_id = draft_row.pharmacy_id
     where draft_row.pharmacy_id = $1 and draft_row.draft_id = $2
     order by original.ordinal, original.id`,
    [pharmacyId, draftId],
  );
  return result.rows;
}

async function returnHistory(
  client: PoolClient,
  pharmacyId: string,
  rowIds: readonly string[],
): Promise<Map<string, { quantity: bigint; supplierReductionFils: bigint }>> {
  const result = await client.query<{
    original_purchase_row_id: string;
    quantity: string;
    supplier_reduction_fils: string;
  }>(
    `select original_purchase_row_id, sum(quantity)::text as quantity,
            sum(supplier_reduction_fils)::text as supplier_reduction_fils
     from posted_purchase_return_rows
     where pharmacy_id = $1 and original_purchase_row_id = any($2::uuid[])
     group by original_purchase_row_id`,
    [pharmacyId, rowIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.original_purchase_row_id,
      {
        quantity: BigInt(row.quantity),
        supplierReductionFils: BigInt(row.supplier_reduction_fils),
      },
    ]),
  );
}

async function readDraftView(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<PurchaseReturnDraft> {
  const header = await readDraftHeader(client, pharmacyId, draftId, false);
  if (header === undefined) throw new Error("Purchase Return Draft not found");
  const rows = await readDraftRows(client, pharmacyId, draftId);
  const history = await returnHistory(
    client,
    pharmacyId,
    rows.map((row) => row.original_purchase_row_id),
  );
  return purchaseReturnDraftSchema.parse({
    createdAt: header.created_at.toISOString(),
    evidence: header.evidence,
    id: header.id,
    originalInvoiceDate: header.invoice_date,
    originalNumber: {
      series: "P",
      value: header.number_value,
      year: header.number_year,
    },
    originalPurchaseId: header.original_purchase_id,
    reason: header.reason,
    rows: rows.map((row) => {
      const prior = history.get(row.original_purchase_row_id)?.quantity ?? 0n;
      const original = BigInt(row.inventory_unit_quantity);
      return {
        batchId: row.batch_id,
        id: row.id,
        inventoryUnitName: row.inventory_unit_name,
        itemDisplayName: row.item_display_name,
        itemId: row.product_id,
        originalPurchaseRowId: row.original_purchase_row_id,
        originalQuantity: row.inventory_unit_quantity,
        previouslyReturnedQuantity: prior.toString(),
        remainingEligibleQuantity: (original - prior).toString(),
        returnQuantity: row.return_quantity,
      };
    }),
    status: header.status,
    supplierId: header.supplier_id,
    supplierNameSnapshot: header.supplier_name_snapshot,
    updatedAt: header.updated_at.toISOString(),
    version: header.version,
  });
}

async function calculateReturn(
  client: PoolClient,
  pharmacyId: string,
  header: ReturnDraftHeaderRow,
  priorStage: "draft" | "number-sequence",
): Promise<CalculatedReturn> {
  const draftRows = await readDraftRows(client, pharmacyId, header.id);
  const selected = draftRows.filter((row) => BigInt(row.return_quantity) > 0n);
  if (selected.length === 0) {
    reject(409, "return-empty", [
      { code: "required", path: ["rows"], rule: "purchase.return.empty" },
    ]);
  }
  assertLockStageProgression(priorStage, "batch-stock");
  const batchProblem = await lockPurchaseReturnBatches(
    client,
    pharmacyId,
    selected.map((row) => ({
      batchId: row.batch_id,
      productId: row.product_id,
      quantity: BigInt(row.return_quantity),
    })),
  );
  if (batchProblem !== undefined) {
    reject(
      409,
      batchProblem.kind === "negative-stock"
        ? "return-negative-stock"
        : "return-ineligible-batch",
      [
        {
          code: "out-of-range",
          path: ["rows"],
          rule:
            batchProblem.kind === "negative-stock"
              ? "purchase.return.negative-stock"
              : "purchase.return.ineligible-batch",
        },
      ],
    );
  }
  const history = await returnHistory(
    client,
    pharmacyId,
    selected.map((row) => row.original_purchase_row_id),
  );
  const enriched: SelectedReturnRow[] = selected.map((row) => {
    const prior = history.get(row.original_purchase_row_id);
    return {
      ...row,
      already_reduced_fils: (prior?.supplierReductionFils ?? 0n).toString(),
      previously_returned_quantity: (prior?.quantity ?? 0n).toString(),
    };
  });
  for (const [index, row] of enriched.entries()) {
    const problem = validatePurchaseReturnEligibility({
      availableStock: BigInt(row.inventory_unit_quantity),
      originalQuantity: BigInt(row.inventory_unit_quantity),
      previouslyReturnedQuantity: BigInt(row.previously_returned_quantity),
      requestedQuantity: BigInt(row.return_quantity),
    });
    if (problem !== undefined) {
      reject(
        409,
        problem === "over-return"
          ? "return-over-eligible"
          : "return-ineligible-batch",
        [
          {
            code: "out-of-range",
            path: ["rows", index, "returnQuantity"],
            rule:
              problem === "over-return"
                ? "purchase.return.over-return"
                : "purchase.return.ineligible-batch",
          },
        ],
      );
    }
  }
  assertLockStageProgression("batch-stock", "valuation");
  const plan = await preparePurchaseReturnValuation(
    client,
    pharmacyId,
    enriched.map((row) => ({
      key: row.original_purchase_row_id,
      productId: row.product_id,
      quantity: BigInt(row.return_quantity),
    })),
  );
  if (plan === undefined) {
    reject(409, "return-negative-stock", [
      {
        code: "out-of-range",
        path: ["rows"],
        rule: "purchase.return.negative-stock",
      },
    ]);
  }
  const valuation = new Map(plan.effects.map((effect) => [effect.key, effect]));
  const rows = enriched.map((row) => {
    const effect = valuation.get(row.original_purchase_row_id);
    if (effect === undefined)
      throw new Error("Return valuation effect missing");
    const supplierReductionFils = calculateSupplierReduction({
      alreadyReducedFils: BigInt(row.already_reduced_fils),
      originalQuantity: BigInt(row.inventory_unit_quantity),
      originalSupplierCostFils: BigInt(row.line_primary_supplier_cost_fils),
      previouslyReturnedQuantity: BigInt(row.previously_returned_quantity),
      returnQuantity: BigInt(row.return_quantity),
    });
    return {
      batchId: row.batch_id,
      carryingAmountFils: effect.carryingAmountFils.toString(),
      carryingAmountPerUnitScaled:
        effect.carryingAmountPerUnitScaled.toString(),
      inventoryUnitName: row.inventory_unit_name,
      itemDisplayName: row.item_display_name,
      itemId: row.product_id,
      ordinal: row.ordinal,
      originalPurchaseRowId: row.original_purchase_row_id,
      quantity: row.return_quantity,
      supplierReductionFils: supplierReductionFils.toString(),
      valuationMethod: "weighted-average-cost" as const,
    };
  });
  const base = {
    draftId: header.id,
    draftVersion: header.version,
    inventoryCarryingAmountFils: rows
      .reduce((sum, row) => sum + BigInt(row.carryingAmountFils), 0n)
      .toString(),
    rows: rows.map((row) => ({
      batchId: row.batchId,
      carryingAmountFils: row.carryingAmountFils,
      carryingAmountPerUnitScaled: row.carryingAmountPerUnitScaled,
      inventoryUnitName: row.inventoryUnitName,
      itemDisplayName: row.itemDisplayName,
      itemId: row.itemId,
      originalPurchaseRowId: row.originalPurchaseRowId,
      quantity: row.quantity,
      supplierReductionFils: row.supplierReductionFils,
      valuationMethod: row.valuationMethod,
    })),
    supplierReductionFils: rows
      .reduce((sum, row) => sum + BigInt(row.supplierReductionFils), 0n)
      .toString(),
  };
  const confirmationHash = canonicalRequestHash(
    "purchase.return.summary",
    base as JsonObject,
  ).toString("hex");
  return {
    header,
    plan,
    rows,
    summary: purchaseReturnSummarySchema.parse({ ...base, confirmationHash }),
  };
}

function draftAuditState(
  draft: PurchaseReturnDraft,
): Record<string, string | number | null> {
  return {
    evidence: draft.evidence,
    originalPurchaseId: draft.originalPurchaseId,
    reason: draft.reason,
    selectedRowCount: draft.rows.filter((row) => row.returnQuantity !== "0")
      .length,
    status: draft.status,
    version: draft.version,
  };
}

function journalView(
  journal: Awaited<ReturnType<typeof postPurchaseReturnJournal>>,
) {
  return {
    entryId: journal.entryId,
    lines: journal.lines.map((line) => ({
      ...line,
      creditFils: line.creditFils.toString(),
      debitFils: line.debitFils.toString(),
    })),
    templateId: journal.templateId,
    templateVersion: journal.templateVersion,
    treatment: journal.treatment,
  };
}

async function readPostedReturnView(
  client: PoolClient,
  pharmacyId: string,
  returnId: string,
): Promise<PostedPurchaseReturn | undefined> {
  const result = await client.query<{
    approval_challenge_id: string;
    device_id: string;
    difference_treatment: string;
    draft_id: string;
    evidence: string;
    id: string;
    inventory_carrying_amount_fils: string;
    journal_entry_id: string;
    number_value: string;
    number_year: number;
    original_invoice_date: string;
    original_number_value: string;
    original_number_year: number;
    original_purchase_id: string;
    posted_at: Date;
    posted_by: string;
    reason: string;
    supplier_id: string;
    supplier_name_snapshot: string;
    supplier_reduction_fils: string;
    template_version: number;
  }>(
    `select return_record.id, return_record.draft_id,
            return_record.original_purchase_id,
            return_record.original_number_value::text,
            return_record.original_number_year,
            return_record.original_invoice_date::text,
            return_record.supplier_id, return_record.supplier_name_snapshot,
            return_record.number_value::text, return_record.number_year,
            return_record.reason, return_record.evidence,
            return_record.inventory_carrying_amount_fils::text,
            return_record.supplier_reduction_fils::text,
            return_record.difference_treatment,
            return_record.journal_entry_id,
            return_record.approval_challenge_id, return_record.device_id,
            return_record.posted_at, return_record.posted_by,
            journal.template_version
     from posted_purchase_returns return_record
     join accounting_journal_entries journal
       on journal.id = return_record.journal_entry_id
      and journal.pharmacy_id = return_record.pharmacy_id
     where return_record.pharmacy_id = $1 and return_record.id = $2`,
    [pharmacyId, returnId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const rows = await client.query<{
    batch_id: string;
    carrying_amount_fils: string;
    carrying_amount_per_unit_scaled: string;
    id: string;
    inventory_unit_name: string;
    item_display_name: string;
    movement_id: string;
    original_purchase_row_id: string;
    product_id: string;
    quantity: string;
    supplier_reduction_fils: string;
    valuation_method: "weighted-average-cost";
  }>(
    `select id, original_purchase_row_id, product_id, batch_id,
            item_display_name, inventory_unit_name, quantity::text,
            carrying_amount_per_unit_scaled::text,
            carrying_amount_fils::text, supplier_reduction_fils::text,
            valuation_method, movement_id
     from posted_purchase_return_rows
     where pharmacy_id = $1 and purchase_return_id = $2
     order by ordinal, id`,
    [pharmacyId, returnId],
  );
  const journalLines = await client.query<{
    account_code: "cash" | "inventory" | "supplier-payable";
    credit_fils: string;
    debit_fils: string;
    ordinal: number;
    supplier_id: string | null;
  }>(
    `select ordinal, account_code, supplier_id, debit_fils::text,
            credit_fils::text from accounting_journal_lines
     where pharmacy_id = $1 and entry_id = $2 order by ordinal`,
    [pharmacyId, row.journal_entry_id],
  );
  return postedPurchaseReturnSchema.parse({
    approvalChallengeId: row.approval_challenge_id,
    deviceId: row.device_id,
    draftId: row.draft_id,
    evidence: row.evidence,
    id: row.id,
    inventoryCarryingAmountFils: row.inventory_carrying_amount_fils,
    journal: {
      entryId: row.journal_entry_id,
      lines: journalLines.rows.map((line) => ({
        accountCode: line.account_code,
        creditFils: line.credit_fils,
        debitFils: line.debit_fils,
        ordinal: line.ordinal,
        supplierId: line.supplier_id,
      })),
      templateId: "purchase.return",
      templateVersion: row.template_version,
      treatment: row.difference_treatment,
    },
    number: { series: "PR", value: row.number_value, year: row.number_year },
    originalInvoiceDate: row.original_invoice_date,
    originalNumber: {
      series: "P",
      value: row.original_number_value,
      year: row.original_number_year,
    },
    originalPurchaseId: row.original_purchase_id,
    postedAt: row.posted_at.toISOString(),
    postedBy: row.posted_by,
    reason: row.reason,
    rows: rows.rows.map((item) => ({
      batchId: item.batch_id,
      carryingAmountFils: item.carrying_amount_fils,
      carryingAmountPerUnitScaled: item.carrying_amount_per_unit_scaled,
      id: item.id,
      inventoryUnitName: item.inventory_unit_name,
      itemDisplayName: item.item_display_name,
      itemId: item.product_id,
      movementId: item.movement_id,
      originalPurchaseRowId: item.original_purchase_row_id,
      quantity: item.quantity,
      supplierReductionFils: item.supplier_reduction_fils,
      valuationMethod: item.valuation_method,
    })),
    supplierId: row.supplier_id,
    supplierNameSnapshot: row.supplier_name_snapshot,
    supplierReductionFils: row.supplier_reduction_fils,
  });
}
