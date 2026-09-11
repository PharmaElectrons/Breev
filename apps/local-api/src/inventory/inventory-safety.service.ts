import {
  inventoryAllocationPreviewSchema,
  inventoryBatchSchema,
  inventoryBatchSafetyStatusSchema,
  inventoryDenialSchema,
  type CatalogFieldError,
  type IdentityDenial,
  type InventoryAllocationPreview,
  type InventoryBatch,
  type InventoryBatchExpiryCorrectionRequest,
  type InventoryBatchSafetyReview,
  type InventoryBatchSafetyStatus,
  type InventoryBatchStatusChangeRequest,
  type InventoryDenial,
} from "@breev/contracts/local-rest";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

import { resolveCatalogInventoryFacts } from "../catalog/catalog-inventory.js";
import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import {
  addDays,
  businessDateOf,
  businessDatesBetween,
  daysBetween,
  isValidTimeZone,
  monthBounds,
} from "./business-date.js";
import {
  evaluateBatchEligibility,
  HARD_BLOCK_STATUSES,
} from "./inventory-eligibility.js";
import {
  allocateFefo,
  appendBatchExpiryAmendment,
  appendBatchStatusEvent,
  readBatchFacts,
  readBatchCarryingAmounts,
  readBatchHistories,
  readNearExpiryDays,
  resolveReceiptClassRuleSet,
  type BatchFact,
  type BatchHistory,
} from "./inventory-persistence.js";
import { DEFAULT_NEAR_EXPIRY_DAYS } from "./inventory-receipt-rules.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import { canonicalRequestHash } from "../posting/canonical-hash.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
  type PostingCommandReplay,
} from "../posting/idempotency.js";
import { assertLockStageProgression } from "../posting/lock-order.js";
import {
  CURRENT_ENVELOPE_VERSIONS,
  POSTING_EVENT_TYPES,
  appendOutboxEntry,
} from "../posting/outbox.js";
import { catchUp } from "./inventory-safety-evaluator.js";

export const INVENTORY_BATCH_SAFETY_QUEUE = "inventory.batch-safety.evaluate";
const SAFETY_PERMISSION = "inventory.batch_safety.manage" as const;
const REVIEW_PERMISSION = "inventory.review" as const;
const VALUATION_PERMISSION = "inventory.valuation.view" as const;
const STATUS_COMMAND = "inventory.batch_status.change";
const EXPIRY_COMMAND = "inventory.batch_expiry.correct";

interface SafetyJobPayload {
  readonly trigger: "catch-up" | "manual" | "scheduled" | "startup";
}

export class InventorySafetyDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: IdentityDenial | InventoryDenial,
  ) {
    super(denial.code);
    this.name = "InventorySafetyDenied";
  }
}

@Injectable()
export class InventorySafetyService implements OnModuleInit {
  private readonly logger = new Logger(InventorySafetyService.name);

  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(IdentityAccessService)
    private readonly identity: IdentityAccessService,
    @Inject(DurableJobsService)
    private readonly durableJobs: DurableJobsService,
  ) {}

  public async onModuleInit(): Promise<void> {
    try {
      await this.durableJobs.ensureStarted();
      const pharmacy = await this.pharmacyFacts();
      if (pharmacy === undefined || !this.durableJobs.isAvailable()) {
        this.logger.warn(
          "The batch-safety job runtime is unavailable or the pharmacy is not bootstrapped",
        );
        return;
      }
      await this.durableJobs.ensureQueue(INVENTORY_BATCH_SAFETY_QUEUE, {
        expireInSeconds: 900,
        retryDelay: 10,
        retryLimit: 3,
      });
      await this.durableJobs.work<SafetyJobPayload>(
        INVENTORY_BATCH_SAFETY_QUEUE,
        async (job) => {
          const zone = await this.readZone(pharmacy.id);
          if (!isValidTimeZone(zone)) {
            this.logger.error(
              `The pharmacy has an invalid business time zone: ${zone}`,
            );
            return;
          }
          await catchUp(this.localDatabase.requirePool(), {
            jobId: job.id,
            pharmacyId: pharmacy.id,
            throughBusinessDate: businessDateOf(new Date(), zone),
            trigger: job.data.trigger,
          });
        },
      );
      if (isValidTimeZone(pharmacy.businessTimeZone)) {
        await this.durableJobs.schedule(
          INVENTORY_BATCH_SAFETY_QUEUE,
          "5 0 * * *",
          { trigger: "scheduled" },
          { key: pharmacy.id, tz: pharmacy.businessTimeZone },
        );
        const today = businessDateOf(new Date(), pharmacy.businessTimeZone);
        const last = await this.lastCompleted(pharmacy.id);
        if (last === null || businessDatesBetween(last, today).length > 0) {
          await this.durableJobs.send(
            INVENTORY_BATCH_SAFETY_QUEUE,
            { trigger: "startup" },
            {
              singletonKey: "inventory.batch-safety.catch-up",
              singletonSeconds: 900,
              expireInSeconds: 900,
              retryDelay: 10,
              retryLimit: 3,
            },
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Batch-safety startup is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async readStatus(
    request: Request,
  ): Promise<InventoryBatchSafetyStatus> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    return await this.statusForContext(context);
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
        action: "inventory.batch_safety.read",
        actorUserId: context.actorId,
        afterState: { fieldErrorCount: fieldErrors.length },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "body-invalid",
        pharmacyId: context.pharmacyId,
      });
      throw new InventorySafetyDenied(
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

  public async triggerRun(
    request: Request,
  ): Promise<InventoryBatchSafetyStatus> {
    const context = await this.identity.requirePermission(
      request,
      SAFETY_PERMISSION,
    );
    if (!this.durableJobs.isAvailable()) {
      const requestId = await this.auditRuntime(
        context,
        "job-runtime-unavailable",
      );
      throw new InventorySafetyDenied(
        503,
        inventoryDenialSchema.parse({
          code: "job-runtime-unavailable",
          fieldErrors: [],
          requestId,
          status: "denied",
        }),
      );
    }
    try {
      await this.durableJobs.send(
        INVENTORY_BATCH_SAFETY_QUEUE,
        { trigger: "manual" },
        {
          singletonKey: "inventory.batch-safety.catch-up",
          singletonSeconds: 900,
          expireInSeconds: 900,
          retryDelay: 10,
          retryLimit: 3,
        },
      );
      await this.auditRuntime(context, "enqueued");
    } catch {
      const requestId = await this.auditRuntime(
        context,
        "job-runtime-unavailable",
      );
      throw new InventorySafetyDenied(
        503,
        inventoryDenialSchema.parse({
          code: "job-runtime-unavailable",
          fieldErrors: [],
          requestId,
          status: "denied",
        }),
      );
    }
    return await this.statusForContext(context);
  }

  public async listBatches(
    request: Request,
    productId: string,
  ): Promise<{
    readonly batches: readonly InventoryBatch[];
    readonly businessDate: string;
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
      if (!facts.has(productId)) {
        throw await this.denial(
          client,
          context,
          404,
          "product-not-found",
          productId,
        );
      }
      const businessDate = await this.currentBusinessDate(
        client,
        context.pharmacyId,
      );
      const nearExpiryDays = await this.nearExpiryDays(
        client,
        context.pharmacyId,
      );
      const batches = await readBatchFacts(
        client,
        context.pharmacyId,
        { productIds: [productId] },
        { lock: false },
      );
      return {
        batches: await this.batchViews(
          client,
          context,
          [...batches].sort(compareBatchFacts),
          businessDate,
          nearExpiryDays,
        ),
        businessDate,
      };
    } finally {
      client.release();
    }
  }

  public async previewAllocation(
    request: Request,
    input: {
      readonly lines: readonly {
        readonly batchId?: string | undefined;
        readonly productId: string;
        readonly quantity: string;
      }[];
    },
  ): Promise<InventoryAllocationPreview> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const businessDate = await this.currentBusinessDate(
        client,
        context.pharmacyId,
      );
      const nearExpiryDays = await this.nearExpiryDays(
        client,
        context.pharmacyId,
      );
      const plan = await allocateFefo(
        client,
        {
          businessDate,
          lines: input.lines.map((line) =>
            line.batchId === undefined
              ? { productId: line.productId, quantity: BigInt(line.quantity) }
              : {
                  batchId: line.batchId,
                  productId: line.productId,
                  quantity: BigInt(line.quantity),
                },
          ),
          nearExpiryDays: (productId) =>
            nearExpiryDays.get(productId) ?? DEFAULT_NEAR_EXPIRY_DAYS,
          pharmacyId: context.pharmacyId,
        },
        false,
      );
      if ("kind" in plan) {
        if (plan.kind === "batch-not-found") {
          const index = input.lines.findIndex(
            (line) => line.batchId === plan.batchId,
          );
          throw await this.denial(
            client,
            context,
            404,
            "batch-not-found",
            plan.batchId,
            index < 0
              ? []
              : [{ path: ["lines", index, "batchId"], code: "invalid" }],
          );
        }
        if (plan.kind === "regulatory-hard-block") {
          const index = input.lines.findIndex(
            (line) => line.batchId === plan.batchId,
          );
          throw await this.denial(
            client,
            context,
            409,
            "regulatory-hard-block",
            plan.batchId,
            index < 0
              ? []
              : [
                  {
                    path: ["lines", index, "batchId"],
                    code: "invalid",
                    rule: `inventory.batch.${plan.status}`,
                  },
                ],
            plan.status,
          );
        }
        throw new Error("Unexpected allocation problem");
      }
      return inventoryAllocationPreviewSchema.parse({
        allocations: plan.allocations.map((allocation) => ({
          batchId: allocation.batchId,
          effectiveExpiryDate: allocation.effectiveExpiryDate,
          productId: allocation.productId,
          quantity: allocation.quantity.toString(),
          status: allocation.status,
        })),
        blocked: plan.blocked.map((blocked) => ({
          balance: blocked.balance.toString(),
          batchId: blocked.batchId,
          productId: blocked.productId,
          status: blocked.status,
        })),
        businessDate,
        shortfalls: plan.shortfalls.map((shortfall) => ({
          allocatable: shortfall.allocatable.toString(),
          productId: shortfall.productId,
          requested: shortfall.requested.toString(),
        })),
      });
    } finally {
      client.release();
    }
  }

  public async changeStatus(
    request: Request,
    batchId: string,
    input: InventoryBatchStatusChangeRequest,
  ): Promise<InventoryBatch> {
    const context = await this.identity.requirePermission(
      request,
      SAFETY_PERMISSION,
    );
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        const fresh = await this.identity.revalidateBatchSafety(
          client,
          context,
        );
        const requestHash = canonicalRequestHash(STATUS_COMMAND, input);
        let replay: PostingCommandReplay | undefined;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName: STATUS_COMMAND,
            idempotencyKey: input.idempotencyKey,
            pharmacyId: fresh.pharmacyId,
            requestHash,
          });
        } catch (error) {
          if (!(error instanceof PostingIdempotencyConflict)) throw error;
          return await this.commandDenial(
            client,
            fresh,
            STATUS_COMMAND,
            input,
            requestHash,
            409,
            "idempotency-conflict",
            batchId,
          );
        }
        if (replay !== undefined) {
          await client.query("commit");
          transactionOpen = false;
          return this.replayBatch(replay);
        }
        assertLockStageProgression("draft", "batch-stock");
        const locked = await client.query<{ product_id: string }>(
          `select product_id from inventory_batches
           where id = $1 and pharmacy_id = $2
           for update`,
          [batchId, fresh.pharmacyId],
        );
        const productId = locked.rows[0]?.product_id;
        if (productId === undefined) {
          return await this.commandDenial(
            client,
            fresh,
            STATUS_COMMAND,
            input,
            requestHash,
            404,
            "batch-not-found",
            batchId,
          );
        }
        const businessDate = await this.currentBusinessDate(
          client,
          fresh.pharmacyId,
        );
        const nearExpiryDays = await this.nearExpiryDays(
          client,
          fresh.pharmacyId,
        );
        const facts = await readBatchFacts(
          client,
          fresh.pharmacyId,
          { batchIds: [batchId] },
          { lock: true },
        );
        const fact = facts[0];
        if (fact === undefined) {
          return await this.commandDenial(
            client,
            fresh,
            STATUS_COMMAND,
            input,
            requestHash,
            404,
            "batch-not-found",
            batchId,
          );
        }
        const beforeStatus = this.statusOf(fact, businessDate, nearExpiryDays);
        const allowed =
          input.kind === "recall"
            ? beforeStatus !== "recalled"
            : beforeStatus === "eligible" ||
              beforeStatus === "near-expiry" ||
              beforeStatus === "expired";
        if (!allowed) {
          return await this.commandDenial(
            client,
            fresh,
            STATUS_COMMAND,
            input,
            requestHash,
            409,
            "batch-status-transition-invalid",
            batchId,
            [],
            beforeStatus,
          );
        }
        const deviceId = fresh.deviceId ?? fresh.terminalDeviceId;
        if (deviceId === undefined)
          throw new Error("A batch status event needs a device");
        const appended = await appendBatchStatusEvent(client, {
          actorId: fresh.actorId,
          batchId,
          businessDate,
          deviceId,
          evidence: input.evidence,
          kind: input.kind === "recall" ? "recalled" : "quarantined",
          pharmacyId: fresh.pharmacyId,
          productId: fact.productId,
          reason: input.reason,
          source: "user",
        });
        await appendOutboxEntry(client, {
          correlationId: input.idempotencyKey,
          envelopeVersion:
            CURRENT_ENVELOPE_VERSIONS[
              POSTING_EVENT_TYPES.inventoryBatchStatusChanged
            ],
          eventType: POSTING_EVENT_TYPES.inventoryBatchStatusChanged,
          payload: {
            batchId,
            eventId: appended.eventId,
            kind: input.kind,
            productId: fact.productId,
          },
          pharmacyId: fresh.pharmacyId,
        });
        const currentFact = (
          await readBatchFacts(
            client,
            fresh.pharmacyId,
            { batchIds: [batchId] },
            { lock: false },
          )
        )[0];
        if (currentFact === undefined) throw new Error("The batch disappeared");
        const response = await this.batchView(
          client,
          fresh,
          currentFact,
          businessDate,
          nearExpiryDays,
        );
        await writePostingAudit(client, {
          action: STATUS_COMMAND,
          actorUserId: fresh.actorId,
          afterState: {
            status: input.kind === "recall" ? "recalled" : "quarantined",
          },
          beforeState: { status: beforeStatus },
          correlationId: input.idempotencyKey,
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "committed",
          pharmacyId: fresh.pharmacyId,
          reason: input.reason,
          targetId: batchId,
        });
        await recordPostingResult(client, {
          actorUserId: fresh.actorId,
          commandName: STATUS_COMMAND,
          device: fresh,
          idempotencyKey: input.idempotencyKey,
          identitySessionId: fresh.sessionId,
          pharmacyId: fresh.pharmacyId,
          requestHash,
          responseBody: response,
          responseStatus: 201,
        });
        await client.query("commit");
        transactionOpen = false;
        return response;
      } catch (error) {
        if (transactionOpen)
          await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  public async correctExpiry(
    request: Request,
    batchId: string,
    input: InventoryBatchExpiryCorrectionRequest,
  ): Promise<InventoryBatch> {
    const context = await this.identity.requirePermission(
      request,
      SAFETY_PERMISSION,
    );
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        const fresh = await this.identity.revalidateBatchSafety(
          client,
          context,
        );
        const requestHash = canonicalRequestHash(EXPIRY_COMMAND, input);
        let replay: PostingCommandReplay | undefined;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName: EXPIRY_COMMAND,
            idempotencyKey: input.idempotencyKey,
            pharmacyId: fresh.pharmacyId,
            requestHash,
          });
        } catch (error) {
          if (!(error instanceof PostingIdempotencyConflict)) throw error;
          return await this.commandDenial(
            client,
            fresh,
            EXPIRY_COMMAND,
            input,
            requestHash,
            409,
            "idempotency-conflict",
            batchId,
          );
        }
        if (replay !== undefined) {
          await client.query("commit");
          transactionOpen = false;
          return this.replayBatch(replay);
        }
        assertLockStageProgression("draft", "batch-stock");
        const locked = await client.query<{ product_id: string }>(
          `select product_id from inventory_batches
           where id = $1 and pharmacy_id = $2 for update`,
          [batchId, fresh.pharmacyId],
        );
        const productId = locked.rows[0]?.product_id;
        if (productId === undefined) {
          return await this.commandDenial(
            client,
            fresh,
            EXPIRY_COMMAND,
            input,
            requestHash,
            404,
            "batch-not-found",
            batchId,
          );
        }
        const businessDate = await this.currentBusinessDate(
          client,
          fresh.pharmacyId,
        );
        const nearExpiryDays = await this.nearExpiryDays(
          client,
          fresh.pharmacyId,
        );
        const fact = (
          await readBatchFacts(
            client,
            fresh.pharmacyId,
            { batchIds: [batchId] },
            { lock: true },
          )
        )[0];
        if (fact === undefined) {
          return await this.commandDenial(
            client,
            fresh,
            EXPIRY_COMMAND,
            input,
            requestHash,
            404,
            "batch-not-found",
            batchId,
          );
        }
        if (fact.effectiveExpiryDate === input.correctedExpiryDate) {
          return await this.commandDenial(
            client,
            fresh,
            EXPIRY_COMMAND,
            input,
            requestHash,
            409,
            "expiry-correction-unchanged",
            batchId,
          );
        }
        await this.identity.consumeBatchSafetyStepUp(
          client,
          fresh,
          input.challengeId,
          {
            action: "inventory.batch_expiry.correct",
            batchId,
          },
        );
        const deviceId = fresh.deviceId ?? fresh.terminalDeviceId;
        if (deviceId === undefined)
          throw new Error("An expiry amendment needs a device");
        const amendment = await appendBatchExpiryAmendment(client, {
          approvalChallengeId: input.challengeId,
          batchId,
          businessDate,
          correctedExpiryDate: input.correctedExpiryDate,
          createdBy: fresh.actorId,
          deviceId,
          evidence: input.evidence,
          pharmacyId: fresh.pharmacyId,
          productId: fact.productId,
          originalExpiryDate: fact.effectiveExpiryDate,
          reason: input.reason,
        });
        await appendOutboxEntry(client, {
          correlationId: input.idempotencyKey,
          envelopeVersion:
            CURRENT_ENVELOPE_VERSIONS[
              POSTING_EVENT_TYPES.inventoryBatchExpiryCorrected
            ],
          eventType: POSTING_EVENT_TYPES.inventoryBatchExpiryCorrected,
          payload: {
            amendmentId: amendment.amendmentId,
            batchId,
            correctedExpiryDate: input.correctedExpiryDate,
            productId: fact.productId,
          },
          pharmacyId: fresh.pharmacyId,
        });
        const currentFact = (
          await readBatchFacts(
            client,
            fresh.pharmacyId,
            { batchIds: [batchId] },
            { lock: false },
          )
        )[0];
        if (currentFact === undefined) throw new Error("The batch disappeared");
        const response = await this.batchView(
          client,
          fresh,
          currentFact,
          businessDate,
          nearExpiryDays,
        );
        await writePostingAudit(client, {
          action: EXPIRY_COMMAND,
          actorUserId: fresh.actorId,
          afterState: { expiryDate: input.correctedExpiryDate },
          beforeState: { expiryDate: fact.effectiveExpiryDate },
          correlationId: input.idempotencyKey,
          device: fresh,
          identitySessionId: fresh.sessionId,
          outcome: "committed",
          pharmacyId: fresh.pharmacyId,
          reason: input.reason,
          targetId: batchId,
        });
        await recordPostingResult(client, {
          actorUserId: fresh.actorId,
          commandName: EXPIRY_COMMAND,
          device: fresh,
          idempotencyKey: input.idempotencyKey,
          identitySessionId: fresh.sessionId,
          pharmacyId: fresh.pharmacyId,
          requestHash,
          responseBody: response,
          responseStatus: 201,
        });
        await client.query("commit");
        transactionOpen = false;
        return response;
      } catch (error) {
        if (transactionOpen)
          await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  public async readMonthlyReview(
    request: Request,
    requestedMonth?: string,
  ): Promise<InventoryBatchSafetyReview> {
    const context = await this.identity.requirePermission(
      request,
      REVIEW_PERMISSION,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      const now = new Date();
      const zone = await this.readZone(context.pharmacyId);
      const today = isValidTimeZone(zone)
        ? businessDateOf(now, zone)
        : businessDateOf(now, "UTC");
      const month = requestedMonth ?? today.slice(0, 7);
      const bounds = monthBounds(month);
      const reportDate = month === today.slice(0, 7) ? today : bounds.end;
      const nearExpiryDays = await this.nearExpiryDays(
        client,
        context.pharmacyId,
      );
      const facts = await readBatchFacts(
        client,
        context.pharmacyId,
        {},
        { lock: false },
      );
      const catalog = await resolveCatalogInventoryFacts(
        client,
        context.pharmacyId,
      );
      const rows: InventoryBatchSafetyReview["rows"] = [];
      const histories = await readBatchHistories(
        client,
        context.pharmacyId,
        facts
          .filter((fact) => fact.balance > 0n && catalog.has(fact.productId))
          .map((fact) => fact.batchId),
      );
      type ReviewCandidate = {
        readonly fact: BatchFact;
        readonly historicalFact: BatchFact;
        readonly historicalHistory: BatchHistory;
        readonly product: NonNullable<ReturnType<typeof catalog.get>>;
        readonly status: InventoryBatch["status"];
      };
      const candidates: ReviewCandidate[] = [];
      for (const fact of facts) {
        if (fact.balance <= 0n) continue;
        const product = catalog.get(fact.productId);
        if (product === undefined) continue;
        const history =
          histories.get(fact.batchId) ??
          ({ expiryAmendments: [], statusEvents: [] } satisfies BatchHistory);
        const historicalHistory = historyAsOf(history, reportDate);
        const historicalFact = factAsOf(fact, historicalHistory);
        const status = this.statusOf(
          historicalFact,
          reportDate,
          nearExpiryDays,
        );
        if (!(HARD_BLOCK_STATUSES as readonly string[]).includes(status))
          continue;
        candidates.push({
          fact,
          historicalFact,
          historicalHistory,
          product,
          status,
        });
      }
      const carryingAmounts = context.permissions.includes(VALUATION_PERMISSION)
        ? await readBatchCarryingAmounts(
            client,
            context.pharmacyId,
            candidates.map(({ fact }) => fact.batchId),
          )
        : new Map<string, string | null>();
      for (const {
        fact,
        historicalFact,
        historicalHistory,
        product,
        status,
      } of candidates) {
        const detected =
          firstBlockedDate(historicalHistory, status) ??
          historicalFact.effectiveExpiryDate ??
          reportDate;
        const batch = await this.batchView(
          client,
          context,
          historicalFact,
          reportDate,
          nearExpiryDays,
          historicalHistory,
        );
        rows.push({
          batch: omitBatchHistory(batch),
          carryingAmountFils: context.permissions.includes(VALUATION_PERMISSION)
            ? (carryingAmounts.get(fact.batchId) ?? null)
            : null,
          daysBlocked: Math.max(
            0,
            daysBetween(detected, reportDate),
          ).toString(),
          detectedOnBusinessDate: detected,
          productDisplayName: product.displayName,
        });
      }
      rows.sort(compareReviewRows);
      const runs = await this.reviewRuns(
        client,
        context.pharmacyId,
        bounds.start,
        reportDate,
      );
      return {
        businessDate: today,
        fields: {
          valuation: context.permissions.includes(VALUATION_PERMISSION)
            ? "granted"
            : "denied",
        },
        month,
        rows,
        runs,
      };
    } finally {
      client.release();
    }
  }

  private async statusForContext(
    context: IdentityExecutionContext,
  ): Promise<InventoryBatchSafetyStatus> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      const zone = await this.identity.readPharmacyBusinessTimeZone(
        client,
        context.pharmacyId,
      );
      const validZone = isValidTimeZone(zone);
      const today = validZone
        ? businessDateOf(new Date(), zone)
        : businessDateOf(new Date(), "UTC");
      const lastCompletedBusinessDate = await this.lastCompleted(
        context.pharmacyId,
      );
      const missedBusinessDates = validZone
        ? lastCompletedBusinessDate === null
          ? [today]
          : businessDatesBetween(lastCompletedBusinessDate, today)
        : [];
      let scheduled = false;
      if (this.durableJobs.isAvailable()) {
        scheduled =
          (
            await this.durableJobs.getSchedules(
              INVENTORY_BATCH_SAFETY_QUEUE,
              context.pharmacyId,
            )
          ).length > 0;
      }
      const rules = await resolveReceiptClassRuleSet(
        client,
        context.pharmacyId,
      );
      return inventoryBatchSafetyStatusSchema.parse({
        businessTimeZone: zone,
        jobRuntime: this.durableJobs.isAvailable()
          ? "available"
          : "unavailable",
        lastCompletedBusinessDate,
        missedBusinessDates,
        scheduled,
        state: !validZone
          ? "time-zone-invalid"
          : lastCompletedBusinessDate === null
            ? "never-run"
            : lastCompletedBusinessDate === today
              ? "current"
              : "behind",
        thresholds: {
          classes: Object.entries(rules).map(([receiptClass, rule]) => ({
            class: receiptClass,
            expiryRequired: rule.expiryRequired,
            lotRequired: rule.lotRequired,
            nearExpiryDays: String(rule.nearExpiryDays),
          })),
          pendingGate: "G-02",
        },
        todayBusinessDate: today,
      });
    } finally {
      client.release();
    }
  }

  private async currentBusinessDate(
    client: PoolClient,
    pharmacyId: string,
  ): Promise<string> {
    const zone = await this.identity.readPharmacyBusinessTimeZone(
      client,
      pharmacyId,
    );
    return businessDateOf(new Date(), zone);
  }

  private async nearExpiryDays(
    client: PoolClient,
    pharmacyId: string,
  ): Promise<Map<string, number>> {
    await resolveReceiptClassRuleSet(client, pharmacyId);
    return await readNearExpiryDays(client, pharmacyId);
  }

  private statusOf(
    fact: BatchFact,
    businessDate: string,
    nearExpiryDays: ReadonlyMap<string, number>,
  ): InventoryBatch["status"] {
    return evaluateBatchEligibility({
      businessDate,
      effectiveExpiryDate: fact.effectiveExpiryDate,
      latestStatusKind: fact.latestStatusKind,
      nearExpiryDays:
        nearExpiryDays.get(fact.productId) ?? DEFAULT_NEAR_EXPIRY_DAYS,
    });
  }

  private async batchViews(
    client: PoolClient,
    context: IdentityExecutionContext,
    facts: readonly BatchFact[],
    businessDate: string,
    nearExpiryDays: ReadonlyMap<string, number>,
  ): Promise<InventoryBatch[]> {
    const histories = await readBatchHistories(
      client,
      context.pharmacyId,
      facts.map((fact) => fact.batchId),
    );
    return await Promise.all(
      facts.map((fact) =>
        this.batchView(
          client,
          context,
          fact,
          businessDate,
          nearExpiryDays,
          histories.get(fact.batchId),
        ),
      ),
    );
  }

  private async batchView(
    client: PoolClient,
    context: IdentityExecutionContext,
    fact: BatchFact,
    businessDate: string,
    nearExpiryDays: ReadonlyMap<string, number>,
    suppliedHistory?: BatchHistory,
  ): Promise<InventoryBatch> {
    const history = suppliedHistory ??
      (
        await readBatchHistories(client, context.pharmacyId, [fact.batchId])
      ).get(fact.batchId) ?? { expiryAmendments: [], statusEvents: [] };
    const userIds = [
      ...history.statusEvents.flatMap((event) =>
        event.createdBy === null ? [] : [event.createdBy],
      ),
      ...history.expiryAmendments.map((amendment) => amendment.createdBy),
    ];
    const names = await this.identity.resolveUserDisplayNames(
      client,
      context.pharmacyId,
      [...new Set(userIds)],
    );
    const status = this.statusOf(fact, businessDate, nearExpiryDays);
    const blockedSince = firstBlockedDate(history, status);
    return inventoryBatchSchema.parse({
      balance: fact.balance.toString(),
      batchId: fact.batchId,
      blockedSinceBusinessDate: blockedSince,
      daysToExpiry:
        fact.effectiveExpiryDate === null
          ? null
          : daysBetween(businessDate, fact.effectiveExpiryDate).toString(),
      effectiveExpiryDate: fact.effectiveExpiryDate,
      expiryAmendments: history.expiryAmendments.map((amendment) => ({
        approvalChallengeId: amendment.approvalChallengeId,
        businessDate: amendment.businessDate,
        correctedExpiryDate: amendment.correctedExpiryDate,
        evidence: amendment.evidence,
        id: amendment.id,
        occurredAt: amendment.occurredAt.toISOString(),
        originalExpiryDate: amendment.originalExpiryDate,
        reason: amendment.reason,
        user: {
          displayName: names.get(amendment.createdBy) ?? "—",
          id: amendment.createdBy,
        },
      })),
      expiryCorrected: history.expiryAmendments.length > 0,
      lotNumber: fact.lotNumber,
      nearExpiryDays: String(
        nearExpiryDays.get(fact.productId) ?? DEFAULT_NEAR_EXPIRY_DAYS,
      ),
      originalExpiryDate: fact.originalExpiryDate,
      productId: fact.productId,
      receivedAt: fact.receivedAt,
      status,
      statusEvents: history.statusEvents.map((event) => ({
        approvalChallengeId: null,
        businessDate: event.businessDate,
        evidence: event.evidence,
        id: event.id,
        kind: event.kind,
        occurredAt: event.occurredAt.toISOString(),
        reason: event.reason,
        source: event.source,
        user:
          event.createdBy === null
            ? null
            : {
                displayName: names.get(event.createdBy) ?? "—",
                id: event.createdBy,
              },
      })),
    });
  }

  private replayBatch(replay: PostingCommandReplay): InventoryBatch {
    if (replay.responseStatus !== 201) {
      throw new InventorySafetyDenied(
        replay.responseStatus,
        inventoryDenialSchema.parse(replay.responseBody),
      );
    }
    return inventoryBatchSchema.parse(replay.responseBody);
  }

  private async commandDenial(
    client: PoolClient,
    context: IdentityExecutionContext,
    commandName: string,
    input: { readonly idempotencyKey: string },
    requestHash: Buffer,
    statusCode: number,
    code: InventoryDenial["code"],
    targetId: string,
    fieldErrors: readonly {
      readonly code: string;
      readonly path: readonly (string | number)[];
      readonly rule?: string;
    }[] = [],
    status?: string,
  ): Promise<never> {
    const requestId = await writePostingAudit(client, {
      action: commandName,
      actorUserId: context.actorId,
      ...(status === undefined ? {} : { afterState: { status } }),
      correlationId: input.idempotencyKey,
      device: context,
      identitySessionId: context.sessionId,
      outcome: code,
      pharmacyId: context.pharmacyId,
      targetId,
    });
    const denial = inventoryDenialSchema.parse({
      code,
      fieldErrors,
      requestId,
      status: "denied",
    });
    await recordPostingResult(client, {
      actorUserId: context.actorId,
      commandName,
      device: context,
      idempotencyKey: input.idempotencyKey,
      identitySessionId: context.sessionId,
      pharmacyId: context.pharmacyId,
      requestHash,
      responseBody: denial,
      responseStatus: statusCode,
    });
    await client.query("commit");
    throw new InventorySafetyDenied(statusCode, denial);
  }

  private async denial(
    client: PoolClient,
    context: IdentityExecutionContext,
    statusCode: number,
    code: InventoryDenial["code"],
    targetId: string,
    fieldErrors: readonly {
      readonly code: string;
      readonly path: readonly (string | number)[];
      readonly rule?: string;
    }[] = [],
    status?: string,
  ): Promise<InventorySafetyDenied> {
    const requestId = await writePostingAudit(client, {
      action: "inventory.batch_safety.read",
      actorUserId: context.actorId,
      ...(status === undefined ? {} : { afterState: { status } }),
      device: context,
      identitySessionId: context.sessionId,
      outcome: code,
      pharmacyId: context.pharmacyId,
      targetId,
    });
    return new InventorySafetyDenied(
      statusCode,
      inventoryDenialSchema.parse({
        code,
        fieldErrors,
        requestId,
        status: "denied",
      }),
    );
  }

  private async auditRuntime(
    context: IdentityExecutionContext,
    outcome: "enqueued" | "job-runtime-unavailable",
  ): Promise<string> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      return await writePostingAudit(client, {
        action: "inventory.batch_safety.run",
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome,
        pharmacyId: context.pharmacyId,
        targetId: context.pharmacyId,
      });
    } finally {
      client.release();
    }
  }

  private async lastCompleted(pharmacyId: string): Promise<string | null> {
    const result = await this.localDatabase
      .requirePool()
      .query<{ business_date: string }>(
        `select business_date::text from inventory_batch_safety_runs
       where pharmacy_id = $1 order by business_date desc limit 1`,
        [pharmacyId],
      );
    return result.rows[0]?.business_date ?? null;
  }

  private async pharmacyFacts(): Promise<
    { readonly businessTimeZone: string; readonly id: string } | undefined
  > {
    const result = await this.localDatabase
      .requirePool()
      .query<{ business_time_zone: string; id: string }>(
        "select id, business_time_zone from pharmacies limit 1",
      );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { businessTimeZone: row.business_time_zone, id: row.id };
  }

  private async readZone(pharmacyId: string): Promise<string> {
    const result = await this.localDatabase
      .requirePool()
      .query<{ business_time_zone: string }>(
        "select business_time_zone from pharmacies where id = $1",
        [pharmacyId],
      );
    return result.rows[0]?.business_time_zone ?? "UTC";
  }

  private async reviewRuns(
    client: PoolClient,
    pharmacyId: string,
    start: string,
    through: string,
  ): Promise<{
    readonly completedBusinessDates: string[];
    readonly missedBusinessDates: string[];
  }> {
    const result = await client.query<{ business_date: string }>(
      `select business_date::text from inventory_batch_safety_runs
       where pharmacy_id = $1 and business_date between $2 and $3
       order by business_date`,
      [pharmacyId, start, through],
    );
    const completedBusinessDates = result.rows.map((row) => row.business_date);
    const all = businessDatesBetween(addDays(start, -1), through);
    const completed = new Set(completedBusinessDates);
    return {
      completedBusinessDates,
      missedBusinessDates: all.filter((date) => !completed.has(date)),
    };
  }
}

function firstBlockedDate(
  history: BatchHistory,
  status: InventoryBatch["status"],
): string | null {
  const kind =
    status === "recalled"
      ? "recalled"
      : status === "quarantined"
        ? "quarantined"
        : status === "expired"
          ? "expired"
          : null;
  return kind === null
    ? null
    : (history.statusEvents.find((event) => event.kind === kind)
        ?.businessDate ?? null);
}

function historyAsOf(
  history: BatchHistory,
  businessDate: string,
): BatchHistory {
  return {
    expiryAmendments: history.expiryAmendments.filter(
      (amendment) => amendment.businessDate <= businessDate,
    ),
    statusEvents: history.statusEvents.filter(
      (event) => event.businessDate <= businessDate,
    ),
  };
}

function factAsOf(fact: BatchFact, history: BatchHistory): BatchFact {
  const amendment = history.expiryAmendments.at(-1);
  const statusEvent = history.statusEvents.at(-1);
  return {
    ...fact,
    effectiveExpiryDate:
      amendment?.correctedExpiryDate ?? fact.originalExpiryDate,
    latestStatusKind: statusEvent?.kind ?? null,
  };
}

function omitBatchHistory(
  batch: InventoryBatch,
): InventoryBatchSafetyReview["rows"][number]["batch"] {
  return Object.fromEntries(
    Object.entries(batch).filter(
      ([key]) => key !== "expiryAmendments" && key !== "statusEvents",
    ),
  ) as InventoryBatchSafetyReview["rows"][number]["batch"];
}

function compareReviewRows(
  left: InventoryBatchSafetyReview["rows"][number],
  right: InventoryBatchSafetyReview["rows"][number],
): number {
  const precedence = {
    recalled: 0,
    quarantined: 1,
    "postponed-blocked": 2,
    expired: 3,
  } as const;
  const leftRank =
    precedence[left.batch.status as keyof typeof precedence] ?? 99;
  const rightRank =
    precedence[right.batch.status as keyof typeof precedence] ?? 99;
  return (
    leftRank - rightRank ||
    (left.batch.effectiveExpiryDate ?? "9999-12-31").localeCompare(
      right.batch.effectiveExpiryDate ?? "9999-12-31",
    ) ||
    left.productDisplayName.localeCompare(right.productDisplayName) ||
    left.batch.batchId.localeCompare(right.batch.batchId)
  );
}

function compareBatchFacts(left: BatchFact, right: BatchFact): number {
  if (left.effectiveExpiryDate === null && right.effectiveExpiryDate !== null)
    return 1;
  if (left.effectiveExpiryDate !== null && right.effectiveExpiryDate === null)
    return -1;
  return (
    (left.effectiveExpiryDate ?? "").localeCompare(
      right.effectiveExpiryDate ?? "",
    ) ||
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.batchId.localeCompare(right.batchId)
  );
}
