import {
  saleDraftCreateContract,
  saleDraftResumeContract,
  saleDraftSchema,
  salesDenialSchema,
  type CatalogFieldError,
  type IdentityDenial,
  type SaleDraft,
  type SalesDenial,
} from "@breev/contracts/local-rest";
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

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
const COMMANDS = {
  create: "sale.draft.create",
  resume: "sale.draft.resume",
} as const;

type SaleDraftCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
type SalesFieldError = CatalogFieldError & { readonly rule?: string };

interface CommandSuccess {
  readonly afterState: JsonObject;
  readonly beforeState?: JsonObject;
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
  readonly work: (client: PoolClient) => Promise<CommandSuccess>;
}

interface SaleDraftCommandRejection {
  readonly code: SalesDenial["code"];
  readonly fieldErrors: readonly SalesFieldError[];
  readonly statusCode: 400 | 404 | 409;
  readonly targetId?: string;
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
  ) {}

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
            [
              {
                code: "invalid",
                path: ["expectedVersion"],
                rule: "sales.draft.version-conflict",
              },
            ],
            draftId,
          );
        }
        const updated = await touchSaleDraft(client, {
          deviceId,
          id: draftId,
          pharmacyId: context.pharmacyId,
          updatedBy: context.actorId,
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
        await this.identity.revalidateSaleDrafts(client, input.context);
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
    return rows.map((row) => saleDraftView(row, names));
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
): never {
  throw new SaleDraftCommandRejected({
    code,
    fieldErrors,
    statusCode,
    ...(targetId === undefined ? {} : { targetId }),
  });
}

function denied(
  statusCode: 400 | 404 | 409,
  code: SalesDenial["code"],
  requestId: string,
  fieldErrors: readonly SalesFieldError[] = [],
): SaleDraftDenied {
  return new SaleDraftDenied(
    statusCode,
    salesDenialSchema.parse({
      code,
      fieldErrors,
      requestId,
      status: "denied",
    }),
  );
}

function saleDraftView(
  row: SaleDraftRecord,
  names: ReadonlyMap<string, string>,
): SaleDraft {
  return saleDraftSchema.parse({
    createdAt: row.createdAt,
    createdBy: person(row.createdBy, names),
    id: row.id,
    status: row.status,
    updatedAt: row.updatedAt,
    updatedBy: person(row.updatedBy, names),
    version: row.version,
  });
}

function person(
  id: string,
  names: ReadonlyMap<string, string>,
): SaleDraft["createdBy"] {
  return { displayName: names.get(id) ?? "—", id };
}
