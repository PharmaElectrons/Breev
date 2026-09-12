import {
  inventoryDenialSchema,
  reorderItemAddContract,
  reorderItemConfirmContract,
  reorderItemRemoveContract,
  reorderItemReturnContract,
  reorderItemSchema,
  reorderItemUpdateContract,
  type CatalogFieldError,
  type IdentityDenial,
  type InventoryDenial,
  type ReorderItem,
} from "@breev/contracts/local-rest";
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

import {
  resolveCatalogInventoryFacts,
  resolveCatalogPackagingFacts,
  type CatalogInventoryFacts,
  type CatalogPackagingFacts,
} from "../catalog/catalog-inventory.js";
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
import { businessDateOf } from "./business-date.js";
import { inventoryItemView } from "./inventory-item-view.js";
import {
  proposeReorderQuantity,
  projectReorder,
  resolveReaddQuantity,
} from "./inventory-reorder.js";
import {
  readNearExpiryDays,
  resolveReceiptClassRuleSet,
} from "./inventory-persistence.js";
import {
  lockLiveReorderItemForProduct,
  lockReorderItem,
  listReorderItems,
  insertReorderItem,
  markReorderItemOrdered,
  markReorderItemRemoved,
  refreshReorderProposal,
  returnReorderItemToBasket,
  updateReorderQuantity,
  type ReorderItemRecord,
} from "./inventory-reorder-persistence.js";
import {
  readInventoryPositions,
  type InventoryPosition,
} from "./inventory-review.js";
import { DEFAULT_NEAR_EXPIRY_DAYS } from "./inventory-receipt-rules.js";

const MANAGE_PERMISSION = "inventory.reorder.manage" as const;
const CONFIRM_PERMISSION = "inventory.reorder.confirm" as const;

const COMMANDS = {
  add: "inventory.reorder.item.add",
  confirm: "inventory.reorder.item.confirm",
  remove: "inventory.reorder.item.remove",
  return: "inventory.reorder.item.return",
  update: "inventory.reorder.item.update",
} as const;

type ReorderCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
type ReorderPermission = typeof MANAGE_PERMISSION | typeof CONFIRM_PERMISSION;
type ReorderWireStatus = "basket" | "ordered";

export type ReorderCommandValue =
  | {
      readonly item: ReorderItem;
      readonly outcome: "added" | "updated" | "already-ordered";
    }
  | { readonly item: ReorderItem }
  | { readonly itemId: string; readonly removedAt: string };

interface CommandSuccess<T extends ReorderCommandValue> {
  readonly afterState: JsonObject;
  readonly beforeState?: JsonObject;
  readonly targetId: string;
  readonly value: T;
}

interface ReorderCommandExecution<T extends ReorderCommandValue> {
  readonly commandName: ReorderCommandName;
  readonly context: IdentityExecutionContext;
  readonly idempotencyKey: string;
  readonly parser: { parse(value: unknown): T };
  readonly permission: ReorderPermission;
  readonly requestHash: Buffer;
  readonly targetId: string;
  readonly work: (client: PoolClient) => Promise<CommandSuccess<T>>;
}

interface ReorderCommandRejection {
  readonly code: InventoryDenial["code"];
  readonly fieldErrors: readonly ReorderFieldError[];
  readonly statusCode: 400 | 404 | 409;
  readonly targetId?: string;
}

type ReorderFieldError = CatalogFieldError & { readonly rule?: string };

class ReorderCommandRejected extends Error {
  public constructor(public readonly rejection: ReorderCommandRejection) {
    super(rejection.code);
    this.name = "ReorderCommandRejected";
  }
}

export class InventoryReorderDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: IdentityDenial | InventoryDenial,
  ) {
    super(denial.code);
    this.name = "InventoryReorderDenied";
  }
}

interface InventorySnapshot {
  readonly facts: ReadonlyMap<string, CatalogInventoryFacts>;
  readonly nearExpiryDays: ReadonlyMap<string, number>;
  readonly now: Date;
  readonly packaging: ReadonlyMap<string, CatalogPackagingFacts>;
  readonly positions: ReadonlyMap<string, InventoryPosition>;
  readonly businessDate: string;
}

@Injectable()
export class InventoryReorderService {
  private readonly logger = new Logger(InventoryReorderService.name);

  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async addItem(
    request: Request,
    input: { readonly idempotencyKey: string; readonly productId: string },
  ): Promise<ReorderCommandValue> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName: COMMANDS.add,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: reorderItemAddContract.responses[200],
      permission: MANAGE_PERMISSION,
      requestHash: canonicalRequestHash(COMMANDS.add, input),
      targetId: input.productId,
      work: async (client) => {
        const existing = await lockLiveReorderItemForProduct(
          client,
          context.pharmacyId,
          input.productId,
        );
        const snapshot = await this.readInventorySnapshot(client, context, [
          input.productId,
        ]);
        const fact = snapshot.facts.get(input.productId);
        if (fact === undefined) {
          reject(404, "product-not-found", [], input.productId);
        }
        if (fact.status !== "active") {
          reject(
            409,
            "reorder-product-inactive",
            [
              {
                code: "invalid",
                path: ["productId"],
                rule: "inventory.reorder.product-inactive",
              },
            ],
            input.productId,
          );
        }
        const position = snapshot.positions.get(input.productId);
        const proposal = proposeReorderQuantity({
          balance: position?.balance ?? 0n,
          maximumLevel: fact.stockLevels.maximumLevel,
        });
        let row: ReorderItemRecord;
        let outcome: "added" | "updated" | "already-ordered";
        if (existing === undefined) {
          row = await insertReorderItem(client, {
            addedBy: context.actorId,
            balanceAtProposal: position?.balance ?? 0n,
            deviceId,
            maximumLevelAtProposal: fact.stockLevels.maximumLevel,
            pharmacyId: context.pharmacyId,
            productId: input.productId,
            proposedQuantity: proposal.quantity,
            proposalBasis: proposal.basis,
            quantity: proposal.quantity,
            updatedBy: context.actorId,
          });
          outcome = "added";
        } else if (existing.status === "basket") {
          row = await refreshReorderProposal(client, {
            balanceAtProposal: position?.balance ?? 0n,
            deviceId,
            id: existing.id,
            maximumLevelAtProposal: fact.stockLevels.maximumLevel,
            pharmacyId: context.pharmacyId,
            proposedQuantity: proposal.quantity,
            proposalBasis: proposal.basis,
            quantity: resolveReaddQuantity({
              previousQuantity: BigInt(existing.quantity),
              quantityEditedAt: existing.quantityEditedAt,
              proposal,
            }),
            updatedBy: context.actorId,
          });
          outcome = "updated";
        } else {
          row = existing;
          outcome = "already-ordered";
        }
        const item = await this.readItem(client, context, row, snapshot);
        return {
          afterState: {
            basis: row.proposalBasis,
            outcome,
            productId: row.productId,
            proposedQuantity: row.proposedQuantity,
            quantity: row.quantity,
          },
          targetId: row.id,
          value: { item, outcome },
        };
      },
    });
  }

  public async listItems(
    request: Request,
    status?: ReorderWireStatus,
  ): Promise<{ readonly items: readonly ReorderItem[] }> {
    const context = await this.requireReadPermission(request);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const rows = await listReorderItems(client, context.pharmacyId, status);
      return { items: await this.readItems(client, context, rows) };
    } finally {
      client.release();
    }
  }

  public async updateQuantity(
    request: Request,
    itemId: string,
    input: {
      readonly expectedVersion: string;
      readonly idempotencyKey: string;
      readonly quantity: string;
    },
  ): Promise<{ readonly item: ReorderItem }> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName: COMMANDS.update,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: reorderItemUpdateContract.responses[200],
      permission: MANAGE_PERMISSION,
      requestHash: canonicalRequestHash(COMMANDS.update, { input, itemId }),
      targetId: itemId,
      work: async (client) => {
        const row = await lockReorderItem(client, context.pharmacyId, itemId);
        requireItem(row, itemId);
        requireStatus(row, "basket", itemId);
        const snapshot = await this.readInventorySnapshot(client, context, [
          row.productId,
        ]);
        requireActiveProduct(
          snapshotFact(snapshot, row.productId),
          row.productId,
        );
        requireVersion(row, input.expectedVersion, itemId);
        const updated = await updateReorderQuantity(client, {
          deviceId,
          id: itemId,
          pharmacyId: context.pharmacyId,
          quantity: BigInt(input.quantity),
          updatedBy: context.actorId,
        });
        const item = await this.readItem(client, context, updated, snapshot);
        return {
          afterState: { quantity: updated.quantity },
          beforeState: { quantity: row.quantity },
          targetId: itemId,
          value: { item },
        };
      },
    });
  }

  public async removeItem(
    request: Request,
    itemId: string,
    input: {
      readonly expectedVersion: string;
      readonly idempotencyKey: string;
    },
  ): Promise<{ readonly itemId: string; readonly removedAt: string }> {
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName: COMMANDS.remove,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: reorderItemRemoveContract.responses[200],
      permission: MANAGE_PERMISSION,
      requestHash: canonicalRequestHash(COMMANDS.remove, { input, itemId }),
      targetId: itemId,
      work: async (client) => {
        const row = await lockReorderItem(client, context.pharmacyId, itemId);
        requireItem(row, itemId);
        requireStatus(row, "basket", itemId);
        requireVersion(row, input.expectedVersion, itemId);
        const removed = await markReorderItemRemoved(client, {
          deviceId,
          id: itemId,
          pharmacyId: context.pharmacyId,
          removedBy: context.actorId,
        });
        if (removed.removedAt === null)
          throw new Error("The removed Reorder Item has no removal time");
        return {
          afterState: { removedAt: removed.removedAt, status: "removed" },
          beforeState: { quantity: row.quantity, status: row.status },
          targetId: itemId,
          value: { itemId, removedAt: removed.removedAt },
        };
      },
    });
  }

  public async confirmItem(
    request: Request,
    itemId: string,
    input: {
      readonly expectedVersion: string;
      readonly idempotencyKey: string;
    },
  ): Promise<{ readonly item: ReorderItem }> {
    const context = await this.identity.requirePermission(
      request,
      CONFIRM_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName: COMMANDS.confirm,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: reorderItemConfirmContract.responses[200],
      permission: CONFIRM_PERMISSION,
      requestHash: canonicalRequestHash(COMMANDS.confirm, { input, itemId }),
      targetId: itemId,
      work: async (client) => {
        const row = await lockReorderItem(client, context.pharmacyId, itemId);
        requireItem(row, itemId);
        requireStatus(row, "basket", itemId);
        const snapshot = await this.readInventorySnapshot(client, context, [
          row.productId,
        ]);
        requireActiveProduct(
          snapshotFact(snapshot, row.productId),
          row.productId,
        );
        if (BigInt(row.quantity) === 0n) {
          reject(
            409,
            "reorder-quantity-zero",
            [
              {
                code: "invalid",
                path: ["quantity"],
                rule: "inventory.reorder.quantity-zero",
              },
            ],
            itemId,
          );
        }
        requireVersion(row, input.expectedVersion, itemId);
        const ordered = await markReorderItemOrdered(client, {
          deviceId,
          id: itemId,
          orderedBy: context.actorId,
          pharmacyId: context.pharmacyId,
        });
        if (ordered.orderedAt === null)
          throw new Error("The ordered Reorder Item has no order time");
        const item = await this.readItem(client, context, ordered, snapshot);
        return {
          afterState: {
            orderedAt: ordered.orderedAt,
            quantity: ordered.quantity,
            status: ordered.status,
          },
          beforeState: { status: row.status },
          targetId: itemId,
          value: { item },
        };
      },
    });
  }

  public async returnItem(
    request: Request,
    itemId: string,
    input: {
      readonly expectedVersion: string;
      readonly idempotencyKey: string;
    },
  ): Promise<{ readonly item: ReorderItem }> {
    const context = await this.identity.requirePermission(
      request,
      CONFIRM_PERMISSION,
    );
    const deviceId = requireDeviceId(context);
    return await this.executeCommand({
      commandName: COMMANDS.return,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: reorderItemReturnContract.responses[200],
      permission: CONFIRM_PERMISSION,
      requestHash: canonicalRequestHash(COMMANDS.return, { input, itemId }),
      targetId: itemId,
      work: async (client) => {
        const row = await lockReorderItem(client, context.pharmacyId, itemId);
        requireItem(row, itemId);
        requireStatus(row, "ordered", itemId);
        requireVersion(row, input.expectedVersion, itemId);
        const returned = await returnReorderItemToBasket(client, {
          deviceId,
          id: itemId,
          pharmacyId: context.pharmacyId,
          updatedBy: context.actorId,
        });
        const item = await this.readItem(client, context, returned);
        return {
          afterState: { status: returned.status },
          beforeState: { status: row.status },
          targetId: itemId,
          value: { item },
        };
      },
    });
  }

  public async rejectInvalidBody(
    request: Request,
    permission: "read" | ReorderPermission,
    action: string,
    fieldErrors: readonly ReorderFieldError[],
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
      throw new InventoryReorderDenied(
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

  private async executeCommand<T extends ReorderCommandValue>(
    input: ReorderCommandExecution<T>,
  ): Promise<T> {
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        await this.identity.revalidateInventoryReorder(
          client,
          input.context,
          input.permission,
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
          if (replay.responseStatus === 200) {
            return input.parser.parse(replay.responseBody);
          }
          throw new InventoryReorderDenied(
            replay.responseStatus,
            inventoryDenialSchema.parse(replay.responseBody),
          );
        }
        let success: CommandSuccess<T>;
        await client.query("savepoint inventory_reorder_work");
        try {
          success = await input.work(client);
        } catch (error) {
          if (!(error instanceof ReorderCommandRejected)) throw error;
          await client.query("rollback to savepoint inventory_reorder_work");
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
          responseStatus: 200,
        });
        await client.query("commit");
        transactionOpen = false;
        return success.value;
      } catch (error) {
        if (transactionOpen)
          await client.query("rollback").catch(() => undefined);
        if (!(error instanceof InventoryReorderDenied)) {
          this.logger.error(
            "Inventory Reorder command failed",
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
      context.permissions.includes(MANAGE_PERMISSION) ||
      context.permissions.includes(CONFIRM_PERMISSION)
    ) {
      return context;
    }
    return await this.identity.requirePermission(request, MANAGE_PERMISSION);
  }

  private async readItems(
    client: PoolClient,
    context: IdentityExecutionContext,
    rows: readonly ReorderItemRecord[],
    knownSnapshot?: InventorySnapshot,
  ): Promise<readonly ReorderItem[]> {
    if (rows.length === 0) return [];
    const snapshot =
      knownSnapshot ??
      (await this.readInventorySnapshot(
        client,
        context,
        rows.map((row) => row.productId),
      ));
    const userIds = [
      ...rows.map((row) => row.addedBy),
      ...rows.flatMap((row) => (row.orderedBy === null ? [] : [row.orderedBy])),
    ];
    const names = await this.identity.resolveUserDisplayNames(
      client,
      context.pharmacyId,
      [...new Set(userIds)],
    );
    return rows.map((row) => {
      const fact = snapshot.facts.get(row.productId);
      const packaging = snapshot.packaging.get(row.productId);
      if (fact === undefined || packaging === undefined) {
        throw new Error("The Reorder Item Catalog facts are unavailable");
      }
      const position = snapshot.positions.get(row.productId);
      const fullInventory = inventoryItemView(
        fact,
        position,
        false,
        snapshot.now,
        snapshot.businessDate,
        snapshot.nearExpiryDays.get(row.productId) ?? DEFAULT_NEAR_EXPIRY_DAYS,
      );
      const projection = projectReorder({
        balance: position?.balance ?? 0n,
        maximumLevel: fact.stockLevels.maximumLevel,
        quantity: BigInt(row.quantity),
      });
      return reorderItemSchema.parse({
        addedAt: row.addedAt,
        addedBy: person(row.addedBy, names),
        id: row.id,
        inventory: {
          balance: fullInventory.balance,
          batches: fullInventory.batches,
          consumptionRatePer30Days: fullInventory.consumptionRatePer30Days,
          riskIndicators: fullInventory.riskIndicators,
          stateColour: fullInventory.stateColour,
          stockLevels: fullInventory.stockLevels,
        },
        orderedAt: row.orderedAt,
        orderedBy: row.orderedBy === null ? null : person(row.orderedBy, names),
        product: {
          displayName: fact.displayName,
          inventoryUnitName: packaging.inventoryUnitName,
          mergedIntoProductId: fact.mergedIntoProductId ?? null,
          packageUnits: packaging.packageUnits,
          status: fact.status,
        },
        productId: row.productId,
        projection: {
          projectedLevel: projection.projectedLevel.toString(),
          warning: projection.warning,
        },
        proposal: {
          balance: row.balanceAtProposal,
          basis: row.proposalBasis,
          maximumLevel: row.maximumLevelAtProposal,
          proposedAt: row.proposedAt,
          quantity: row.proposedQuantity,
        },
        quantity: row.quantity,
        quantityEditedAt: row.quantityEditedAt,
        status: row.status,
        version: row.version,
      });
    });
  }

  private async readItem(
    client: PoolClient,
    context: IdentityExecutionContext,
    row: ReorderItemRecord,
    snapshot?: InventorySnapshot,
  ): Promise<ReorderItem> {
    const item = (await this.readItems(client, context, [row], snapshot))[0];
    if (item === undefined)
      throw new Error("The Reorder Item could not be read");
    return item;
  }

  private async readInventorySnapshot(
    client: PoolClient,
    context: IdentityExecutionContext,
    productIds: readonly string[],
  ): Promise<InventorySnapshot> {
    const now = new Date();
    const timeZone = await this.identity.readPharmacyBusinessTimeZone(
      client,
      context.pharmacyId,
    );
    const businessDate = businessDateOf(now, timeZone);
    await resolveReceiptClassRuleSet(client, context.pharmacyId);
    const nearExpiryDays = await readNearExpiryDays(client, context.pharmacyId);
    const facts = await resolveCatalogInventoryFacts(
      client,
      context.pharmacyId,
      {
        productIds,
      },
    );
    const positions = await readInventoryPositions(
      client,
      context.pharmacyId,
      businessDate,
      nearExpiryDays,
      { productIds },
    );
    const packaging = await resolveCatalogPackagingFacts(
      client,
      context.pharmacyId,
      productIds,
    );
    return {
      businessDate,
      facts,
      nearExpiryDays,
      now,
      packaging,
      positions: new Map(
        positions.map((position) => [position.productId, position]),
      ),
    };
  }
}

function requireDeviceId(context: IdentityExecutionContext): string {
  const deviceId = context.deviceId ?? context.terminalDeviceId;
  if (deviceId === undefined)
    throw new Error("Reorder Item device unavailable");
  return deviceId;
}

/** A basket row's product is FK-guaranteed, so a missing fact is a defect, not a denial. */
function snapshotFact(
  snapshot: InventorySnapshot,
  productId: string,
): CatalogInventoryFacts {
  const fact = snapshot.facts.get(productId);
  if (fact === undefined)
    throw new Error("The Reorder Item Catalog facts are unavailable");
  return fact;
}

function requireItem(
  item: ReorderItemRecord | undefined,
  itemId: string,
): asserts item is ReorderItemRecord {
  if (item === undefined) reject(404, "reorder-item-not-found", [], itemId);
}

function requireStatus(
  item: ReorderItemRecord,
  status: ReorderWireStatus,
  itemId: string,
): void {
  if (item.status !== status) {
    reject(
      409,
      "reorder-item-status-invalid",
      [
        {
          code: "invalid",
          path: ["itemId"],
          rule: "inventory.reorder.status-invalid",
        },
      ],
      itemId,
    );
  }
}

function requireActiveProduct(
  fact: CatalogInventoryFacts,
  productId: string,
): void {
  if (fact.status !== "active") {
    reject(
      409,
      "reorder-product-inactive",
      [
        {
          code: "invalid",
          path: ["itemId"],
          rule: "inventory.reorder.product-inactive",
        },
      ],
      productId,
    );
  }
}

function requireVersion(
  item: ReorderItemRecord,
  expectedVersion: string,
  itemId: string,
): void {
  if (item.version !== expectedVersion) {
    reject(
      409,
      "version-conflict",
      [
        {
          code: "invalid",
          path: ["expectedVersion"],
          rule: "inventory.reorder.version-conflict",
        },
      ],
      itemId,
    );
  }
}

function reject(
  statusCode: 400 | 404 | 409,
  code: InventoryDenial["code"],
  fieldErrors: readonly ReorderFieldError[] = [],
  targetId?: string,
): never {
  throw new ReorderCommandRejected({
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
  fieldErrors: readonly ReorderFieldError[] = [],
): InventoryReorderDenied {
  return new InventoryReorderDenied(
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
): ReorderItem["addedBy"] {
  return { displayName: names.get(id) ?? "—", id };
}
