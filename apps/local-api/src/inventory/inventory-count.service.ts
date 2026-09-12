import {
  countEntriesSchema,
  countLineRecordContract,
  countVarianceApplyContract,
  countSessionSchema,
  countSessionSummarySchema,
  inventoryDenialSchema,
  type CatalogFieldError,
  type CountLine,
  type CountLineRecordRequest,
  type CountSession,
  type CountSessionCompleteRequest,
  type CountSessionListQuery,
  type CountSessionSummary,
  type CountSessionStartRequest,
  type CountVarianceApplyRequest,
  type IdentityDenial,
  type InventoryDenial,
} from "@breev/contracts/local-rest";
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

import { postCountVarianceJournal } from "../accounting/accounting-persistence.js";
import { resolveCatalogPurchaseProduct } from "../catalog/catalog-purchase.js";
import { definePackaging } from "../catalog/catalog-packaging.js";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
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
import { businessDateOf } from "./business-date.js";
import {
  evaluateBatchEligibility,
  HARD_BLOCK_STATUSES,
} from "./inventory-eligibility.js";
import { planFefoAllocation, type BatchFact } from "./inventory-fefo.js";
import {
  composeCountEntries,
  countVariance,
  pickSurplusBatch,
  splitCarryingAmount,
  valueCountVariance,
} from "./inventory-count.js";
import {
  advanceCountSession,
  completeCountSession,
  deriveProductBalance,
  insertCountLine,
  insertCountSession,
  insertCountVarianceApplication,
  listCountSessions,
  lockCountSession,
  lockOrCreateValuationState,
  nextCountLineOrdinal,
  readCountApplication,
  readCountSession,
  readCountVarianceJournals,
  recordCountVarianceMovement,
  setCountSessionNumber,
  writeValuationState,
  type CountApplicationRecord,
  type CountLineRecord,
  type CountSessionRead,
} from "./inventory-count-persistence.js";
import {
  readBatchFacts,
  readNearExpiryDays,
  resolveReceiptClassRuleSet,
} from "./inventory-persistence.js";
import { DEFAULT_NEAR_EXPIRY_DAYS } from "./inventory-receipt-rules.js";

const RECORD_PERMISSION = "inventory.counts.record" as const;
const APPROVE_PERMISSION = "inventory.counts.approve" as const;
const VALUATION_PERMISSION = "inventory.valuation.view" as const;

const COMMANDS = {
  apply: "inventory.count.variance.apply",
  complete: "inventory.count.session.complete",
  record: "inventory.count.line.record",
  start: "inventory.count.session.start",
} as const;

type CountCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
type CountCommandValue =
  | CountSession
  | CountSessionSummary
  | { readonly line: CountLine; readonly session: CountSessionSummary };

type CountFieldError = CatalogFieldError & { readonly rule?: string };

interface CommandSuccess<T extends CountCommandValue> {
  readonly afterState: JsonObject;
  readonly beforeState?: JsonObject;
  readonly targetId: string;
  readonly value: T;
}

interface CountCommandExecution<T extends CountCommandValue> {
  readonly commandName: CountCommandName;
  readonly context: IdentityExecutionContext;
  readonly idempotencyKey: string;
  readonly parser: { parse(value: unknown): T };
  readonly requestHash: Buffer;
  readonly responseStatus: 200 | 201;
  readonly targetId: string;
  readonly work: (client: PoolClient) => Promise<CommandSuccess<T>>;
}

interface CountCommandRejection {
  readonly code: InventoryDenial["code"];
  readonly fieldErrors: readonly CountFieldError[];
  readonly statusCode: 400 | 404 | 409;
  readonly targetId?: string;
}

class CountCommandRejected extends Error {
  public constructor(public readonly rejection: CountCommandRejection) {
    super(rejection.code);
    this.name = "CountCommandRejected";
  }
}

export class InventoryCountDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: IdentityDenial | InventoryDenial,
  ) {
    super(denial.code);
    this.name = "InventoryCountDenied";
  }
}

@Injectable()
export class InventoryCountService {
  private readonly logger = new Logger(InventoryCountService.name);

  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async startSession(
    request: Request,
    input: CountSessionStartRequest,
  ): Promise<CountSession> {
    const context = await this.identity.requirePermission(
      request,
      RECORD_PERMISSION,
    );
    const deviceId = context.deviceId ?? context.terminalDeviceId;
    if (deviceId === undefined)
      throw new Error("Count Session device unavailable");
    return await this.executeCommand({
      commandName: COMMANDS.start,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: countSessionSchema,
      requestHash: canonicalRequestHash(COMMANDS.start, input),
      responseStatus: 201,
      targetId: context.pharmacyId,
      work: async (client) => {
        const inserted = await insertCountSession(client, {
          deviceId,
          pharmacyId: context.pharmacyId,
          startedBy: context.actorId,
          updatedBy: context.actorId,
        });
        const read = await readCountSession(
          client,
          context.pharmacyId,
          inserted.id,
        );
        if (read === undefined)
          throw new Error("The Count Session could not be read after start");
        const value = await this.sessionView(client, context, read);
        return {
          afterState: { status: "active", version: value.version },
          targetId: value.id,
          value,
        };
      },
    });
  }

  public async listSessions(
    request: Request,
    query: CountSessionListQuery,
  ): Promise<{ readonly sessions: readonly CountSessionSummary[] }> {
    const context = await this.requireReadPermission(request);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const reads = await listCountSessions(
        client,
        context.pharmacyId,
        query.status,
      );
      return {
        sessions: await Promise.all(
          reads.map(
            async (read) => await this.sessionSummary(client, context, read),
          ),
        ),
      };
    } finally {
      client.release();
    }
  }

  public async readSession(
    request: Request,
    sessionId: string,
  ): Promise<CountSession> {
    const context = await this.requireReadPermission(request);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const read = await readCountSession(
        client,
        context.pharmacyId,
        sessionId,
      );
      if (read === undefined) {
        throw await this.readDenial(client, context, sessionId);
      }
      return await this.sessionView(client, context, read);
    } finally {
      client.release();
    }
  }

  public async recordLine(
    request: Request,
    sessionId: string,
    input: CountLineRecordRequest,
  ): Promise<{
    readonly line: CountLine;
    readonly session: CountSessionSummary;
  }> {
    const context = await this.identity.requirePermission(
      request,
      RECORD_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.record,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: countLineRecordContract.responses[201],
      requestHash: canonicalRequestHash(COMMANDS.record, { input, sessionId }),
      responseStatus: 201,
      targetId: sessionId,
      work: async (client) => {
        const session = await lockCountSession(
          client,
          context.pharmacyId,
          sessionId,
        );
        requireActiveSession(session, input.expectedVersion, sessionId);
        const product = await resolveCatalogPurchaseProduct(
          client,
          context.pharmacyId,
          input.productId,
        );
        if (product === undefined || product === null) {
          reject(404, "product-not-found", [], input.productId);
        }
        const packaging = definePackaging(product.packaging);
        if (!packaging.ok) {
          reject(400, "count-entry-invalid", [
            {
              code: "invalid",
              path: ["entries"],
              rule: "inventory.count.unit-unknown",
            },
          ]);
        }
        const composed = composeCountEntries(
          packaging.packaging,
          input.entries.map((entry) => ({
            count: BigInt(entry.count),
            unit: entry.unit,
          })),
        );
        if (!composed.ok) {
          reject(400, "count-entry-invalid", [
            {
              code: "invalid",
              path: ["entries"],
              rule: `inventory.count.${composed.problem}`,
            },
          ]);
        }
        const facts = await this.factsWithStatus(
          client,
          context.pharmacyId,
          product.id,
        );
        const balance = facts.reduce((total, fact) => total + fact.balance, 0n);
        const blockedQuantity = facts.reduce(
          (total, fact) =>
            total +
            (fact.status !== undefined && isHardBlock(fact.status)
              ? fact.balance > 0n
                ? fact.balance
                : 0n
              : 0n),
          0n,
        );
        const ordinal = await nextCountLineOrdinal(
          client,
          context.pharmacyId,
          sessionId,
        );
        const line = await insertCountLine(client, {
          balanceAtObservation: balance,
          blockedQuantityAtObservation: blockedQuantity,
          countedQuantity: composed.countedQuantity,
          deviceId:
            context.deviceId ?? context.terminalDeviceId ?? session!.deviceId,
          entries: input.entries,
          enteredLabel: composed.enteredLabel,
          inventoryUnitName: packaging.packaging.inventoryUnitName,
          itemDisplayName: product.displayName,
          observedBy: context.actorId,
          ordinal,
          pharmacyId: context.pharmacyId,
          productId: product.id,
          sessionId,
          varianceAtObservation: countVariance(
            composed.countedQuantity,
            balance,
          ),
        });
        await advanceCountSession(
          client,
          context.pharmacyId,
          sessionId,
          context.actorId,
        );
        const read = await readCountSession(
          client,
          context.pharmacyId,
          sessionId,
        );
        if (read === undefined)
          throw new Error(
            "The Count Session disappeared after recording a line",
          );
        const value = await this.sessionView(client, context, read);
        const lineView = value.lines.find((item) => item.id === line.id);
        if (lineView === undefined)
          throw new Error("The Count Line disappeared after recording");
        return {
          afterState: {
            countedQuantity: composed.countedQuantity.toString(),
            variance: countVariance(
              composed.countedQuantity,
              balance,
            ).toString(),
            version: value.version,
          },
          targetId: line.id,
          value: { line: lineView, session: summaryFromSession(value) },
        };
      },
    });
  }

  public async applyVariance(
    request: Request,
    sessionId: string,
    lineId: string,
    input: CountVarianceApplyRequest,
  ): Promise<{
    readonly line: CountLine;
    readonly session: CountSessionSummary;
  }> {
    const context = await this.identity.requirePermission(
      request,
      APPROVE_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.apply,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: countVarianceApplyContract.responses[201],
      requestHash: canonicalRequestHash(COMMANDS.apply, {
        input,
        lineId,
        sessionId,
      }),
      responseStatus: 201,
      targetId: lineId,
      work: async (client) => {
        const session = await lockCountSession(
          client,
          context.pharmacyId,
          sessionId,
        );
        requireActiveSession(session, input.expectedVersion, sessionId);
        const line = await readCountLineForCommand(
          client,
          context.pharmacyId,
          sessionId,
          lineId,
        );
        if (line === undefined) reject(404, "count-line-not-found", [], lineId);
        const existingApplication = await readCountApplication(
          client,
          context.pharmacyId,
          sessionId,
          lineId,
        );
        if (existingApplication !== undefined) {
          reject(
            409,
            "count-variance-already-applied",
            [
              {
                code: "invalid",
                path: ["lineId"],
                rule: "inventory.count.already-applied",
              },
            ],
            lineId,
          );
        }

        assertLockStageProgression("draft", "number-sequence");
        const number = await this.allocateCountNumberIfNeeded(
          client,
          context,
          session!,
          input.idempotencyKey,
        );
        assertLockStageProgression("number-sequence", "batch-stock");
        const rawFacts = await readBatchFacts(
          client,
          context.pharmacyId,
          { productIds: [line!.productId] },
          { lock: true },
        );
        assertLockStageProgression("batch-stock", "valuation");
        const state = await lockOrCreateValuationState(
          client,
          context.pharmacyId,
          line!.productId,
        );

        // This is deliberately after the valuation lock. Purchases publish a
        // movement before waiting for that lock; deriving earlier could miss a
        // receipt that committed while the count was waiting.
        const balanceBefore = await deriveProductBalance(
          client,
          context.pharmacyId,
          line!.productId,
        );
        const expectedBalanceBefore = BigInt(input.expectedBalanceBefore);
        if (balanceBefore !== expectedBalanceBefore) {
          reject(
            409,
            "count-balance-changed",
            [
              {
                code: "invalid",
                path: ["expectedBalanceBefore"],
                rule: "inventory.count.balance-changed",
              },
            ],
            lineId,
          );
        }
        if (balanceBefore !== state.totalQuantity) {
          reject(
            409,
            "count-valuation-mismatch",
            [{ code: "invalid", path: ["expectedBalanceBefore"] }],
            lineId,
          );
        }
        const variance = countVariance(
          BigInt(line!.countedQuantity),
          balanceBefore,
        );
        if (variance === 0n) {
          reject(
            409,
            "count-variance-zero",
            [
              {
                code: "invalid",
                path: ["expectedBalanceBefore"],
                rule: "inventory.count.variance-zero",
              },
            ],
            lineId,
          );
        }

        const facts = await this.factsWithStatus(
          client,
          context.pharmacyId,
          line!.productId,
          rawFacts,
        );
        const allocations =
          variance < 0n
            ? this.planShortage(facts, line!.productId, -variance, lineId)
            : this.planSurplus(facts, line!.productId, variance, lineId);
        const valued = valueCountVariance(state, variance);
        if ("problem" in valued) {
          reject(
            409,
            "count-no-cost-basis",
            [
              {
                code: "invalid",
                path: ["lineId"],
                rule: "inventory.count.no-cost-basis",
              },
            ],
            lineId,
          );
        }
        const carryingAmounts = splitCarryingAmount(
          valued.carryingAmountFils,
          allocations,
        );
        const journal = await postCountVarianceJournal(client, {
          facts: {
            carryingAmountFils: valued.carryingAmountFils,
            variance,
          },
          pharmacyId: context.pharmacyId,
          postedBy: context.actorId,
        });
        await insertCountVarianceApplication(client, {
          appliedBy: context.actorId,
          balanceBefore,
          carryingAmountFils: valued.carryingAmountFils,
          countedQuantity: BigInt(line!.countedQuantity),
          deviceId:
            context.deviceId ?? context.terminalDeviceId ?? session!.deviceId,
          evidence: input.evidence,
          journalEntryId: journal.entryId,
          lineId,
          pharmacyId: context.pharmacyId,
          productId: line!.productId,
          reason: input.reason,
          sessionId,
          treatment: journal.treatment,
          valuationMethod: "weighted-average-cost",
          variance,
          averageUnitCostScaled: valued.averageUnitCostScaled,
        });
        if (number.allocated !== null) {
          await markNumberIssued(client, {
            allocationId: number.allocated.allocationId,
            correlationId: input.idempotencyKey,
            documentId: sessionId,
            documentType: "count-session",
            pharmacyId: context.pharmacyId,
            year: number.year,
          });
          await setCountSessionNumber(client, {
            pharmacyId: context.pharmacyId,
            sessionId,
            updatedBy: context.actorId,
            value: number.value,
            year: number.year,
          });
        } else {
          await advanceCountSession(
            client,
            context.pharmacyId,
            sessionId,
            context.actorId,
          );
        }
        const movementIds: string[] = [];
        for (const [index, allocation] of allocations.entries()) {
          const movement = await recordCountVarianceMovement(client, {
            actorId: context.actorId,
            batchId: allocation.batchId,
            carryingAmountFils: carryingAmounts[index] ?? 0n,
            pharmacyId: context.pharmacyId,
            productId: line!.productId,
            quantity:
              variance < 0n ? -allocation.quantity : allocation.quantity,
            sourceDocumentId: sessionId,
            sourceRowOrdinal: line!.ordinal,
          });
          movementIds.push(movement.movementId);
        }
        await writeValuationState(
          client,
          context.pharmacyId,
          line!.productId,
          valued.nextState,
        );
        await appendOutboxEntry(client, {
          correlationId: input.idempotencyKey,
          envelopeVersion:
            CURRENT_ENVELOPE_VERSIONS["inventory.count.variance-applied"],
          eventType: POSTING_EVENT_TYPES.inventoryCountVarianceApplied,
          payload: {
            carryingAmountFils: valued.carryingAmountFils.toString(),
            lineId,
            movementIds,
            pharmacyId: context.pharmacyId,
            productId: line!.productId,
            sessionId,
            variance: variance.toString(),
          },
          pharmacyId: context.pharmacyId,
        });
        const read = await readCountSession(
          client,
          context.pharmacyId,
          sessionId,
        );
        if (read === undefined)
          throw new Error(
            "The Count Session disappeared after applying a variance",
          );
        const value = await this.sessionView(client, context, read);
        const lineView = value.lines.find((item) => item.id === lineId);
        if (lineView === undefined)
          throw new Error(
            "The Count Line disappeared after applying a variance",
          );
        return {
          afterState: {
            balance: line!.countedQuantity,
            carryingAmountFils: valued.carryingAmountFils.toString(),
            number: {
              series: "C",
              value: number.value.toString(),
              year: number.year,
            },
            variance: variance.toString(),
          },
          beforeState: { balance: balanceBefore.toString() },
          targetId: lineId,
          value: { line: lineView, session: summaryFromSession(value) },
        };
      },
    });
  }

  public async completeSession(
    request: Request,
    sessionId: string,
    input: CountSessionCompleteRequest,
  ): Promise<CountSessionSummary> {
    const context = await this.identity.requirePermission(
      request,
      RECORD_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.complete,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: countSessionSummarySchema,
      requestHash: canonicalRequestHash(COMMANDS.complete, {
        input,
        sessionId,
      }),
      responseStatus: 200,
      targetId: sessionId,
      work: async (client) => {
        const session = await lockCountSession(
          client,
          context.pharmacyId,
          sessionId,
        );
        requireActiveSession(session, input.expectedVersion, sessionId);
        await completeCountSession(client, {
          completedBy: context.actorId,
          pharmacyId: context.pharmacyId,
          sessionId,
          updatedBy: context.actorId,
        });
        const read = await readCountSession(
          client,
          context.pharmacyId,
          sessionId,
        );
        if (read === undefined)
          throw new Error("The Count Session disappeared after completion");
        const value = await this.sessionSummary(client, context, read);
        return {
          afterState: { status: "completed", version: value.version },
          targetId: sessionId,
          value,
        };
      },
    });
  }

  public async rejectInvalidBody(
    request: Request,
    permission: "read" | "inventory.counts.record" | "inventory.counts.approve",
    action: string,
    fieldErrors: readonly (CatalogFieldError & { readonly rule?: string })[],
  ): Promise<never> {
    const context =
      permission === "read"
        ? await this.requireReadPermission(request)
        : await this.identity.requirePermission(request, permission);
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
      throw new InventoryCountDenied(
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

  private async executeCommand<T extends CountCommandValue>(
    input: CountCommandExecution<T>,
  ): Promise<T> {
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        await this.identity.revalidateInventoryCount(
          client,
          input.context,
          input.commandName === COMMANDS.apply
            ? APPROVE_PERMISSION
            : RECORD_PERMISSION,
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
            targetId: input.targetId,
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
          throw new InventoryCountDenied(
            replay.responseStatus,
            inventoryDenialSchema.parse(replay.responseBody),
          );
        }
        let success: CommandSuccess<T>;
        await client.query("savepoint inventory_count_work");
        try {
          success = await input.work(client);
        } catch (error) {
          if (!(error instanceof CountCommandRejected)) throw error;
          await client.query("rollback to savepoint inventory_count_work");
          const rejection = error.rejection;
          const requestId = await writePostingAudit(client, {
            action: input.commandName,
            actorUserId: input.context.actorId,
            correlationId: input.idempotencyKey,
            device: input.context,
            identitySessionId: input.context.sessionId,
            outcome: rejection.code,
            pharmacyId: input.context.pharmacyId,
            targetId: rejection.targetId ?? input.targetId,
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
        if (!(error instanceof InventoryCountDenied)) {
          this.logger.error(
            "Inventory Count command failed",
            error instanceof Error ? error.stack : String(error),
          );
        }
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async requireReadPermission(
    request: Request,
  ): Promise<IdentityExecutionContext> {
    const context = await this.identity.requireExecutionContext(request);
    if (
      context.permissions.includes(RECORD_PERMISSION) ||
      context.permissions.includes(APPROVE_PERMISSION)
    ) {
      return context;
    }
    return await this.identity.requirePermission(request, RECORD_PERMISSION);
  }

  private async sessionSummary(
    client: PoolClient,
    context: IdentityExecutionContext,
    read: CountSessionRead,
  ): Promise<CountSessionSummary> {
    const value = await this.sessionView(client, context, read);
    return summaryFromSession(value);
  }

  private async sessionView(
    client: PoolClient,
    context: IdentityExecutionContext,
    read: CountSessionRead,
  ): Promise<CountSession> {
    const userIds = [
      read.session.startedBy,
      ...(read.session.completedBy === null ? [] : [read.session.completedBy]),
      ...read.lines.flatMap((line) => [
        line.observedBy,
        ...(line.application === null ? [] : [line.application.appliedBy]),
      ]),
    ];
    const names = await this.identity.resolveUserDisplayNames(
      client,
      context.pharmacyId,
      [...new Set(userIds)],
    );
    const valueVisible = context.permissions.includes(VALUATION_PERMISSION);
    const journals = valueVisible
      ? await readCountVarianceJournals(
          client,
          context.pharmacyId,
          read.lines.flatMap((line) =>
            line.application === null ? [] : [line.application.journalEntryId],
          ),
        )
      : new Map();
    const lines = read.lines.map((line) =>
      lineView(
        line,
        read.currentBalances.get(line.productId) ?? 0n,
        names,
        valueVisible,
        journals,
      ),
    );
    return countSessionSchema.parse({
      completedAt:
        read.session.completedAt === null
          ? null
          : isoDateTime(read.session.completedAt),
      completedBy:
        read.session.completedBy === null
          ? null
          : person(read.session.completedBy, names),
      id: read.session.id,
      lineCount: String(lines.length),
      lines,
      number:
        read.session.numberValue === null || read.session.numberYear === null
          ? null
          : {
              series: "C",
              value: read.session.numberValue,
              year: read.session.numberYear,
            },
      pendingVarianceCount: String(
        lines.filter(
          (line) => line.status !== "applied" && line.currentVariance !== "0",
        ).length,
      ),
      startedAt: isoDateTime(read.session.startedAt),
      startedBy: person(read.session.startedBy, names),
      status: read.session.status,
      version: read.session.version,
    });
  }

  private async factsWithStatus(
    client: PoolClient,
    pharmacyId: string,
    productId: string,
    supplied?: readonly BatchFact[],
  ): Promise<readonly BatchFact[]> {
    const zone = await this.identity.readPharmacyBusinessTimeZone(
      client,
      pharmacyId,
    );
    const businessDate = businessDateOf(new Date(), zone);
    await resolveReceiptClassRuleSet(client, pharmacyId);
    const nearExpiryDays = await readNearExpiryDays(client, pharmacyId);
    const facts =
      supplied ??
      (await readBatchFacts(
        client,
        pharmacyId,
        { productIds: [productId] },
        { lock: false },
      ));
    return facts.map((fact) => ({
      ...fact,
      status: evaluateBatchEligibility({
        businessDate,
        effectiveExpiryDate: fact.effectiveExpiryDate,
        latestStatusKind: fact.latestStatusKind,
        nearExpiryDays:
          nearExpiryDays.get(productId) ?? DEFAULT_NEAR_EXPIRY_DAYS,
      }),
    }));
  }

  private planShortage(
    facts: readonly BatchFact[],
    productId: string,
    quantity: bigint,
    lineId: string,
  ) {
    const plan = planFefoAllocation(facts, [{ productId, quantity }]);
    if (plan.shortfalls.length > 0) {
      const blocked: CountFieldError[] = plan.blocked.map((batch) => ({
        code: "invalid",
        path: ["batches", batch.batchId],
        rule: "inventory.count.blocked-stock",
      }));
      reject(
        409,
        "count-blocked-stock",
        blocked.length === 0
          ? [
              {
                code: "invalid",
                path: ["lineId"],
                rule: "inventory.count.blocked-stock",
              },
            ]
          : blocked,
        lineId,
      );
    }
    return plan.allocations;
  }

  private planSurplus(
    facts: readonly BatchFact[],
    productId: string,
    quantity: bigint,
    lineId: string,
  ) {
    const batch = pickSurplusBatch(facts);
    if (batch === null) {
      reject(
        409,
        "count-no-batch",
        [
          {
            code: "invalid",
            path: ["lineId"],
            rule: "inventory.count.no-batch",
          },
        ],
        lineId,
      );
    }
    return [
      {
        batchId: batch!.batchId,
        effectiveExpiryDate: batch!.effectiveExpiryDate,
        productId,
        quantity,
        status: batch!.status === "near-expiry" ? "near-expiry" : "eligible",
      },
    ] as const;
  }

  private async allocateCountNumberIfNeeded(
    client: PoolClient,
    context: IdentityExecutionContext,
    session: {
      readonly numberValue: string | null;
      readonly numberYear: number | null;
    },
    correlationId: string,
  ): Promise<{
    readonly allocated: {
      readonly allocationId: string;
      readonly value: bigint;
    } | null;
    readonly value: bigint;
    readonly year: number;
  }> {
    if (session.numberValue !== null && session.numberYear !== null) {
      return {
        allocated: null,
        value: BigInt(session.numberValue),
        year: session.numberYear,
      };
    }
    const clock = await client.query<{ year: number }>(
      `select extract(year from statement_timestamp())::int as year`,
    );
    const year = clock.rows[0]?.year;
    if (year === undefined)
      throw new Error("The Count Session number year was not available");
    const allocation = await allocateDocumentNumber(
      this.localDatabase.requirePool(),
      {
        actorUserId: context.actorId,
        correlationId,
        device: context,
        documentType: "count-session",
        identitySessionId: context.sessionId,
        pharmacyId: context.pharmacyId,
        year,
      },
    );
    return { allocated: allocation, value: allocation.value, year };
  }

  private async readDenial(
    client: PoolClient,
    context: IdentityExecutionContext,
    sessionId: string,
  ): Promise<InventoryCountDenied> {
    const requestId = await writePostingAudit(client, {
      action: "inventory.count.session.read",
      actorUserId: context.actorId,
      device: context,
      identitySessionId: context.sessionId,
      outcome: "count-session-not-found",
      pharmacyId: context.pharmacyId,
      targetId: sessionId,
    });
    return new InventoryCountDenied(
      404,
      inventoryDenialSchema.parse({
        code: "count-session-not-found",
        fieldErrors: [],
        requestId,
        status: "denied",
      }),
    );
  }
}

async function readCountLineForCommand(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
  lineId: string,
): Promise<CountLineRecord | undefined> {
  const result = await readCountSession(client, pharmacyId, sessionId);
  return result?.lines.find((line) => line.id === lineId);
}

function requireActiveSession(
  session: Awaited<ReturnType<typeof lockCountSession>>,
  expectedVersion: string,
  sessionId: string,
): asserts session is NonNullable<
  Awaited<ReturnType<typeof lockCountSession>>
> {
  if (session === undefined)
    reject(404, "count-session-not-found", [], sessionId);
  if (session.status !== "active")
    reject(409, "count-session-completed", [], sessionId);
  if (session.version !== expectedVersion)
    reject(409, "version-conflict", [], sessionId);
}

function reject(
  statusCode: 400 | 404 | 409,
  code: InventoryDenial["code"],
  fieldErrors: readonly CountFieldError[] = [],
  targetId?: string,
): never {
  throw new CountCommandRejected({
    code,
    fieldErrors,
    statusCode,
    ...(targetId === undefined ? {} : { targetId }),
  });
}

function denied(
  statusCode: 400 | 404 | 409,
  code: InventoryDenial["code"],
  requestId: string,
  fieldErrors: readonly CountFieldError[] = [],
): InventoryCountDenied {
  return new InventoryCountDenied(
    statusCode,
    inventoryDenialSchema.parse({
      code,
      fieldErrors,
      requestId,
      status: "denied",
    }),
  );
}

function person(
  id: string,
  names: ReadonlyMap<string, string>,
): { readonly displayName: string; readonly id: string } {
  return { displayName: names.get(id) ?? "—", id };
}

function isoDateTime(value: string): string {
  return new Date(value).toISOString();
}

function lineView(
  line: CountLineRecord & {
    readonly application: CountApplicationRecord | null;
    readonly movementIds: readonly string[];
  },
  currentBalance: bigint,
  names: ReadonlyMap<string, string>,
  valueVisible: boolean,
  journals: ReadonlyMap<
    string,
    {
      readonly entryId: string;
      readonly templateId: "inventory.count";
      readonly templateVersion: number;
      readonly lines: readonly {
        readonly accountCode: "inventory" | "inventory-count-variance";
        readonly creditFils: string;
        readonly debitFils: string;
        readonly ordinal: number;
        readonly supplierId: null;
      }[];
    }
  >,
): CountLine {
  const currentVariance = countVariance(
    BigInt(line.countedQuantity),
    currentBalance,
  );
  const application = line.application;
  const journal =
    application === null || !valueVisible
      ? null
      : (() => {
          const record = journals.get(application.journalEntryId);
          if (record === undefined) return null;
          return {
            entryId: record.entryId,
            lines: record.lines.map((journalLine) => ({
              ...journalLine,
              creditFils: BigInt(journalLine.creditFils).toString(),
              debitFils: BigInt(journalLine.debitFils).toString(),
            })),
            templateId: record.templateId,
            templateVersion: record.templateVersion,
            treatment:
              application.treatment as "count-variance-account-pending-g01",
          };
        })();
  return {
    application:
      application === null
        ? null
        : {
            appliedAt: isoDateTime(application.appliedAt),
            appliedBy: person(application.appliedBy, names),
            averageUnitCostScaled: valueVisible
              ? BigInt(application.averageUnitCostScaled).toString()
              : null,
            balanceAfter: application.countedQuantity,
            balanceBefore: application.balanceBefore,
            carryingAmountFils: valueVisible
              ? application.carryingAmountFils
              : null,
            evidence: application.evidence,
            id: application.id,
            journal,
            movementIds: [...line.movementIds],
            reason: application.reason,
            treatment:
              application.treatment as "count-variance-account-pending-g01",
            valuationMethod: application.valuationMethod,
            variance: application.variance,
          },
    balanceAtObservation: line.balanceAtObservation,
    blockedQuantityAtObservation: line.blockedQuantityAtObservation,
    countedQuantity: line.countedQuantity,
    currentBalance: currentBalance.toString(),
    currentVariance: currentVariance.toString(),
    enteredLabel: line.enteredLabel,
    entries: countEntriesSchema.parse(line.entries),
    id: line.id,
    inventoryUnitName: line.inventoryUnitName,
    itemDisplayName: line.itemDisplayName,
    observedAt: isoDateTime(line.observedAt),
    observedBy: person(line.observedBy, names),
    ordinal: line.ordinal,
    productId: line.productId,
    status:
      application !== null
        ? "applied"
        : currentVariance === 0n
          ? "matched"
          : currentBalance === BigInt(line.balanceAtObservation)
            ? "pending"
            : "stale",
    varianceAtObservation: line.varianceAtObservation,
  };
}

function summaryFromSession(session: CountSession): CountSessionSummary {
  return countSessionSummarySchema.parse({
    completedAt: session.completedAt,
    completedBy: session.completedBy,
    id: session.id,
    lineCount: session.lineCount,
    number: session.number,
    pendingVarianceCount: session.pendingVarianceCount,
    startedAt: session.startedAt,
    startedBy: session.startedBy,
    status: session.status,
    version: session.version,
  });
}

function isHardBlock(status: NonNullable<BatchFact["status"]>): boolean {
  return (HARD_BLOCK_STATUSES as readonly string[]).includes(status);
}
