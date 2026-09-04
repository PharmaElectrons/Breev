import {
  purchaseDraftResultSchema,
  purchaseDraftSchema,
  purchasingDenialSchema,
  supplierSchema,
  type PurchaseDraft,
  type PurchaseDraftCreateRequest,
  type PurchaseDraftDiscardRequest,
  type PurchaseDraftResult,
  type PurchaseDraftUpdateRequest,
  type PurchasingDenial,
  type PurchasingDenialCode,
  type PurchasingFieldError,
  type Supplier,
  type SupplierArchiveRequest,
  type SupplierCreateRequest,
  type SupplierEditRequest,
  type SupplierMergeRequest,
} from "@breev/contracts/local-rest";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import { canonicalRequestHash } from "../posting/canonical-hash.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
} from "../posting/idempotency.js";

const SUPPLIER_PERMISSION = "suppliers.manage";
const DRAFT_PERMISSION = "purchases.drafts.manage";
const COMMANDS = {
  supplierArchive: "supplier.archive",
  supplierCreate: "supplier.create",
  supplierEdit: "supplier.edit",
  supplierMerge: "supplier.merge",
  draftCreate: "purchase.draft.create",
  draftUpdate: "purchase.draft.update",
  draftDiscard: "purchase.draft.discard",
} as const;

interface SupplierRow {
  allowance_effective_from: string;
  allowance_percentage: string;
  id: string;
  merged_into_supplier_id: string | null;
  name: string;
  pharmacy_id: string;
  revision: string;
  status: "active" | "archived" | "merged";
  terms: string | null;
}

const SUPPLIER_SELECT = `select supplier_row.id, supplier_row.pharmacy_id,
  supplier_row.name, supplier_row.terms, supplier_row.status,
  supplier_row.merged_into_supplier_id, supplier_row.revision::text,
  latest_rate.effective_from::text as allowance_effective_from,
  latest_rate.allowance_percentage::text as allowance_percentage
from suppliers supplier_row
join lateral (
  select rate.effective_from, rate.allowance_percentage
  from supplier_allowance_rates rate
  where rate.pharmacy_id = supplier_row.pharmacy_id and rate.supplier_id = supplier_row.id
  order by rate.effective_from desc, rate.recorded_at desc limit 1
) latest_rate on true`;

const DRAFT_SELECT = `select draft_row.id, draft_row.pharmacy_id,
  draft_row.supplier_invoice_number, draft_row.supplier_id,
  draft_row.supplier_name_snapshot, draft_row.settlement_context,
  draft_row.invoice_date::text, draft_row.allowance_percentage_snapshot::text,
  draft_row.allowance_basis_fils::text, draft_row.status,
  draft_row.version::text, draft_row.created_at, draft_row.updated_at
from purchase_drafts draft_row`;

async function insertAllowanceRate(
  client: PoolClient,
  context: IdentityExecutionContext,
  supplierId: string,
  input: Pick<
    SupplierCreateRequest,
    "allowanceEffectiveFrom" | "defaultAllowancePercentage"
  >,
): Promise<void> {
  await client.query(
    `insert into supplier_allowance_rates (
       pharmacy_id, supplier_id, effective_from, allowance_percentage, recorded_by
     ) values ($1, $2, $3, $4::numeric, $5)`,
    [
      context.pharmacyId,
      supplierId,
      input.allowanceEffectiveFrom,
      input.defaultAllowancePercentage,
      context.actorId,
    ],
  );
}

async function lockSupplier(
  client: PoolClient,
  pharmacyId: string,
  supplierId: string,
): Promise<SupplierRow | undefined> {
  await client.query(
    `select 1 from suppliers where pharmacy_id = $1 and id = $2 for update`,
    [pharmacyId, supplierId],
  );
  const result = await client.query<SupplierRow>(
    `${SUPPLIER_SELECT} where supplier_row.pharmacy_id = $1 and supplier_row.id = $2`,
    [pharmacyId, supplierId],
  );
  return result.rows[0];
}

async function requiredSupplier(
  client: PoolClient,
  pharmacyId: string,
  supplierId: string,
): Promise<SupplierRow> {
  const row = await lockSupplier(client, pharmacyId, supplierId);
  if (row === undefined)
    throw new Error("The Supplier disappeared inside its command");
  return row;
}

function requireEditableSupplier(
  row: SupplierRow | undefined,
  supplierId: string,
  expectedRevision: string,
): void {
  if (row === undefined)
    throw new PurchasingCommandRejected(
      404,
      "supplier-not-found",
      [],
      supplierId,
    );
  if (row.status === "archived")
    throw new PurchasingCommandRejected(
      409,
      "supplier-archived",
      [],
      supplierId,
    );
  if (row.status === "merged")
    throw new PurchasingCommandRejected(409, "supplier-merged", [], supplierId);
  if (row.revision !== expectedRevision)
    throw new PurchasingCommandRejected(
      409,
      "version-conflict",
      [],
      supplierId,
    );
}

async function resolveSupplierForDate(
  client: PoolClient,
  pharmacyId: string,
  supplierId: string,
  invoiceDate: string,
): Promise<ResolvedSupplier> {
  const result = await client.query<{
    id: string;
    name: string;
    status: "active" | "archived" | "merged";
  }>(
    `with recursive chain as (
       select id, name, status, merged_into_supplier_id, pharmacy_id
       from suppliers where pharmacy_id = $1 and id = $2
       union all
       select next.id, next.name, next.status, next.merged_into_supplier_id,
              next.pharmacy_id
       from suppliers next join chain on next.id = chain.merged_into_supplier_id
       where next.pharmacy_id = $1
     ) select id, name, status from chain
       where merged_into_supplier_id is null limit 1`,
    [pharmacyId, supplierId],
  );
  const supplier = result.rows[0];
  if (supplier === undefined)
    throw new PurchasingCommandRejected(
      404,
      "supplier-not-found",
      [],
      supplierId,
    );
  if (supplier.status !== "active")
    throw new PurchasingCommandRejected(
      409,
      "supplier-archived",
      [],
      supplierId,
    );
  await client.query(
    `select 1 from suppliers where pharmacy_id = $1 and id = $2 for share`,
    [pharmacyId, supplier.id],
  );
  const rate = await client.query<{ allowance_percentage: string }>(
    `select allowance_percentage::text from supplier_allowance_rates
     where pharmacy_id = $1 and supplier_id = $2 and effective_from <= $3
     order by effective_from desc, recorded_at desc limit 1`,
    [pharmacyId, supplier.id, invoiceDate],
  );
  const percentage = rate.rows[0]?.allowance_percentage;
  if (percentage === undefined)
    throw new PurchasingCommandRejected(
      409,
      "supplier-no-rate-on-date",
      [{ code: "invalid", path: ["invoiceDate"] }],
      supplier.id,
    );
  return { id: supplier.id, name: supplier.name, percentage };
}

async function lockDraft(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<DraftRow | undefined> {
  const result = await client.query<DraftRow>(
    `${DRAFT_SELECT} where draft_row.pharmacy_id = $1 and draft_row.id = $2 for update`,
    [pharmacyId, draftId],
  );
  return result.rows[0];
}

async function selectDraft(
  queryable: {
    query<T>(text: string, values: unknown[]): Promise<{ rows: T[] }>;
  },
  pharmacyId: string,
  draftId: string,
): Promise<DraftRow | undefined> {
  const result = await queryable.query<DraftRow>(
    `${DRAFT_SELECT} where draft_row.pharmacy_id = $1 and draft_row.id = $2`,
    [pharmacyId, draftId],
  );
  return result.rows[0];
}

async function requiredDraft(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<DraftRow> {
  const row = await selectDraft(client, pharmacyId, draftId);
  if (row === undefined)
    throw new Error("The Purchase Draft disappeared inside its command");
  return row;
}

function requireEditableDraft(
  row: DraftRow | undefined,
  draftId: string,
  expectedVersion: string,
): void {
  if (row === undefined)
    throw new PurchasingCommandRejected(404, "draft-not-found", [], draftId);
  if (row.status === "discarded")
    throw new PurchasingCommandRejected(409, "draft-discarded", [], draftId);
  if (row.version !== expectedVersion)
    throw new PurchasingCommandRejected(409, "version-conflict", [], draftId);
}

async function draftResult(
  client: PoolClient,
  pharmacyId: string,
  draft: PurchaseDraft,
): Promise<PurchaseDraftResult> {
  const duplicate = await client.query<{ id: string }>(
    `with recursive ancestry(id, merged_into_supplier_id) as (
       select supplier_row.id, supplier_row.merged_into_supplier_id
       from suppliers supplier_row
       where supplier_row.pharmacy_id = $1 and supplier_row.id = $2
       union all
       select parent.id, parent.merged_into_supplier_id
       from suppliers parent
       join ancestry on parent.id = ancestry.merged_into_supplier_id
       where parent.pharmacy_id = $1
     ), canonical(id) as (
       select id from ancestry where merged_into_supplier_id is null limit 1
     ), aliases(id) as (
       select id from canonical
       union
       select supplier_row.id from suppliers supplier_row
       join aliases on supplier_row.merged_into_supplier_id = aliases.id
       where supplier_row.pharmacy_id = $1
     )
     select draft_row.id from purchase_drafts draft_row
     where draft_row.pharmacy_id = $1 and draft_row.supplier_id in (select id from aliases)
       and draft_row.supplier_invoice_number = $3 and draft_row.status = 'active'
       and draft_row.id <> $4
     order by draft_row.created_at, draft_row.id`,
    [pharmacyId, draft.supplierId, draft.supplierInvoiceNumber, draft.id],
  );
  return {
    draft,
    warnings:
      duplicate.rows.length === 0
        ? []
        : [
            {
              code: "duplicate-supplier-invoice-number",
              existingDraftIds: duplicate.rows.map((row) => row.id),
              operationalRule: "warn-open-decision",
            },
          ],
  };
}

function supplierView(row: SupplierRow): Supplier {
  return supplierSchema.parse({
    allowanceEffectiveFrom: row.allowance_effective_from,
    defaultAllowancePercentage: normalizedPercentage(row.allowance_percentage),
    id: row.id,
    mergedIntoSupplierId: row.merged_into_supplier_id,
    name: row.name,
    revision: row.revision,
    status: row.status,
    terms: row.terms,
  });
}

function draftView(row: DraftRow): PurchaseDraft {
  return purchaseDraftSchema.parse({
    allowanceSnapshot: {
      basisFils: row.allowance_basis_fils,
      percentage: normalizedPercentage(row.allowance_percentage_snapshot),
    },
    createdAt: row.created_at.toISOString(),
    id: row.id,
    invoiceDate: row.invoice_date,
    settlementContext: row.settlement_context,
    status: row.status,
    supplierId: row.supplier_id,
    supplierInvoiceNumber: row.supplier_invoice_number,
    supplierNameSnapshot: row.supplier_name_snapshot,
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  });
}

function normalizedPercentage(value: string): string {
  return value.includes(".")
    ? value.replace(/0+$/u, "").replace(/\.$/u, "")
    : value;
}
function supplierAuditState(supplier: Supplier): Record<string, string | null> {
  return {
    allowanceEffectiveFrom: supplier.allowanceEffectiveFrom,
    allowancePercentage: supplier.defaultAllowancePercentage,
    mergedIntoSupplierId: supplier.mergedIntoSupplierId,
    name: supplier.name,
    revision: supplier.revision,
    status: supplier.status,
    terms: supplier.terms,
  };
}
function draftAuditState(
  draft: PurchaseDraft,
  warningCount: number,
): Record<string, number | string> {
  return {
    allowanceBasisFils: draft.allowanceSnapshot.basisFils,
    allowancePercentageSnapshot: draft.allowanceSnapshot.percentage,
    invoiceDate: draft.invoiceDate,
    settlementContext: draft.settlementContext,
    status: draft.status,
    supplierId: draft.supplierId,
    supplierInvoiceNumber: draft.supplierInvoiceNumber,
    supplierNameSnapshot: draft.supplierNameSnapshot,
    version: draft.version,
    warningCount,
  };
}
function purchasingDenied(
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
interface DraftRow {
  allowance_basis_fils: string;
  allowance_percentage_snapshot: string;
  created_at: Date;
  id: string;
  invoice_date: string;
  pharmacy_id: string;
  settlement_context: "cash" | "debt";
  status: "active" | "discarded";
  supplier_id: string;
  supplier_invoice_number: string;
  supplier_name_snapshot: string;
  updated_at: Date;
  version: string;
}
interface ResolvedSupplier {
  id: string;
  name: string;
  percentage: string;
}
type CommandValue = PurchaseDraft | PurchaseDraftResult | Supplier;
interface CommandSuccess<T extends CommandValue> {
  afterState: Record<string, boolean | number | string | null>;
  beforeState?: Record<string, boolean | number | string | null>;
  targetId: string;
  value: T;
}
interface CommandExecution<T extends CommandValue> {
  commandName: (typeof COMMANDS)[keyof typeof COMMANDS];
  context: IdentityExecutionContext;
  idempotencyKey: string;
  parser: { parse(payload: unknown): T };
  requestHash: Buffer;
  responseStatus: 200 | 201;
  targetId?: string;
  work: (client: PoolClient) => Promise<CommandSuccess<T>>;
}

export class PurchasingDenied extends Error {
  public constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly denial: PurchasingDenial,
  ) {
    super(denial.code);
    this.name = "PurchasingDenied";
  }
}
class PurchasingCommandRejected extends Error {
  public constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: PurchasingDenialCode,
    public readonly fieldErrors: readonly PurchasingFieldError[] = [],
    public readonly targetId?: string,
  ) {
    super(code);
    this.name = "PurchasingCommandRejected";
  }
}

@Injectable()
export class PurchasingService {
  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async listSuppliers(
    request: Request,
  ): Promise<{ suppliers: Supplier[] }> {
    const context = await this.identity.requireExecutionContext(request);
    if (
      !context.permissions.includes(SUPPLIER_PERMISSION) &&
      !context.permissions.includes(DRAFT_PERMISSION)
    ) {
      await this.identity.requirePermission(request, SUPPLIER_PERMISSION);
    }
    const result = await this.localDatabase.requirePool().query<SupplierRow>(
      `${SUPPLIER_SELECT} where supplier_row.pharmacy_id = $1
       order by supplier_row.name, supplier_row.id`,
      [context.pharmacyId],
    );
    return { suppliers: result.rows.map(supplierView) };
  }

  public async createSupplier(
    request: Request,
    input: SupplierCreateRequest,
  ): Promise<Supplier> {
    const context = await this.identity.requirePermission(
      request,
      SUPPLIER_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.supplierCreate,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: supplierSchema,
      requestHash: canonicalRequestHash(COMMANDS.supplierCreate, input),
      responseStatus: 201,
      work: async (client) => {
        const inserted = await client.query<{ id: string }>(
          `insert into suppliers (pharmacy_id, name, terms, created_by, updated_by)
           values ($1, $2, $3, $4, $4) returning id`,
          [context.pharmacyId, input.name, input.terms, context.actorId],
        );
        const id = inserted.rows[0]?.id;
        if (id === undefined) throw new Error("The Supplier was not created");
        await insertAllowanceRate(client, context, id, input);
        const supplier = supplierView(
          await requiredSupplier(client, context.pharmacyId, id),
        );
        return {
          afterState: supplierAuditState(supplier),
          targetId: id,
          value: supplier,
        };
      },
    });
  }

  public async editSupplier(
    request: Request,
    supplierId: string,
    input: SupplierEditRequest,
  ): Promise<Supplier> {
    const context = await this.identity.requirePermission(
      request,
      SUPPLIER_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.supplierEdit,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: supplierSchema,
      requestHash: canonicalRequestHash(COMMANDS.supplierEdit, {
        supplierId,
        input,
      }),
      responseStatus: 200,
      targetId: supplierId,
      work: async (client) => {
        const before = await lockSupplier(
          client,
          context.pharmacyId,
          supplierId,
        );
        requireEditableSupplier(before, supplierId, input.expectedRevision);
        const rateChanged =
          before!.allowance_effective_from !== input.allowanceEffectiveFrom ||
          normalizedPercentage(before!.allowance_percentage) !==
            normalizedPercentage(input.defaultAllowancePercentage);
        if (rateChanged) {
          const existing = await client.query(
            `select 1 from supplier_allowance_rates
             where pharmacy_id = $1 and supplier_id = $2 and effective_from = $3`,
            [context.pharmacyId, supplierId, input.allowanceEffectiveFrom],
          );
          if ((existing.rowCount ?? 0) > 0)
            throw new PurchasingCommandRejected(
              409,
              "allowance-rate-date-conflict",
              [{ code: "invalid", path: ["allowanceEffectiveFrom"] }],
              supplierId,
            );
          await insertAllowanceRate(client, context, supplierId, input);
        }
        await client.query(
          `update suppliers set name = $3, terms = $4, revision = revision + 1,
             updated_at = statement_timestamp(), updated_by = $5
           where pharmacy_id = $1 and id = $2`,
          [
            context.pharmacyId,
            supplierId,
            input.name,
            input.terms,
            context.actorId,
          ],
        );
        const after = supplierView(
          await requiredSupplier(client, context.pharmacyId, supplierId),
        );
        return {
          afterState: supplierAuditState(after),
          beforeState: supplierAuditState(supplierView(before!)),
          targetId: supplierId,
          value: after,
        };
      },
    });
  }

  public async archiveSupplier(
    request: Request,
    supplierId: string,
    input: SupplierArchiveRequest,
  ): Promise<Supplier> {
    const context = await this.identity.requirePermission(
      request,
      SUPPLIER_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.supplierArchive,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: supplierSchema,
      requestHash: canonicalRequestHash(COMMANDS.supplierArchive, {
        supplierId,
        input,
      }),
      responseStatus: 201,
      targetId: supplierId,
      work: async (client) => {
        const before = await lockSupplier(
          client,
          context.pharmacyId,
          supplierId,
        );
        requireEditableSupplier(before, supplierId, input.expectedRevision);
        await client.query(
          `update suppliers set status = 'archived', revision = revision + 1,
             updated_at = statement_timestamp(), updated_by = $3
           where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, supplierId, context.actorId],
        );
        const after = supplierView(
          await requiredSupplier(client, context.pharmacyId, supplierId),
        );
        return {
          afterState: supplierAuditState(after),
          beforeState: supplierAuditState(supplierView(before!)),
          targetId: supplierId,
          value: after,
        };
      },
    });
  }

  public async mergeSupplier(
    request: Request,
    supplierId: string,
    input: SupplierMergeRequest,
  ): Promise<Supplier> {
    const context = await this.identity.requirePermission(
      request,
      SUPPLIER_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.supplierMerge,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: supplierSchema,
      requestHash: canonicalRequestHash(COMMANDS.supplierMerge, {
        supplierId,
        input,
      }),
      responseStatus: 201,
      targetId: supplierId,
      work: async (client) => {
        if (supplierId === input.survivorSupplierId)
          throw new PurchasingCommandRejected(
            409,
            "merge-into-self",
            [],
            supplierId,
          );
        const before = await lockSupplier(
          client,
          context.pharmacyId,
          supplierId,
        );
        requireEditableSupplier(before, supplierId, input.expectedRevision);
        const survivor = await lockSupplier(
          client,
          context.pharmacyId,
          input.survivorSupplierId,
        );
        if (survivor === undefined || survivor.status !== "active")
          throw new PurchasingCommandRejected(
            409,
            "merge-survivor-not-mergeable",
            [],
            input.survivorSupplierId,
          );
        await client.query(
          `update suppliers set status = 'merged', merged_into_supplier_id = $3,
             revision = revision + 1, updated_at = statement_timestamp(), updated_by = $4
           where pharmacy_id = $1 and id = $2`,
          [
            context.pharmacyId,
            supplierId,
            input.survivorSupplierId,
            context.actorId,
          ],
        );
        const after = supplierView(
          await requiredSupplier(client, context.pharmacyId, supplierId),
        );
        return {
          afterState: supplierAuditState(after),
          beforeState: supplierAuditState(supplierView(before!)),
          targetId: supplierId,
          value: after,
        };
      },
    });
  }

  public async listDrafts(
    request: Request,
  ): Promise<{ drafts: PurchaseDraft[] }> {
    const context = await this.identity.requirePermission(
      request,
      DRAFT_PERMISSION,
    );
    const result = await this.localDatabase.requirePool().query<DraftRow>(
      `${DRAFT_SELECT} where draft_row.pharmacy_id = $1 and draft_row.status = 'active'
       order by draft_row.updated_at desc, draft_row.id`,
      [context.pharmacyId],
    );
    return { drafts: result.rows.map(draftView) };
  }

  public async readDraft(
    request: Request,
    draftId: string,
  ): Promise<PurchaseDraft> {
    const context = await this.identity.requirePermission(
      request,
      DRAFT_PERMISSION,
    );
    const row = await selectDraft(
      this.localDatabase.requirePool(),
      context.pharmacyId,
      draftId,
    );
    if (row !== undefined) return draftView(row);
    throw await this.readDenial(
      context,
      "purchase.draft.read",
      "draft-not-found",
      draftId,
    );
  }

  public async createDraft(
    request: Request,
    input: PurchaseDraftCreateRequest,
  ): Promise<PurchaseDraftResult> {
    const context = await this.identity.requirePermission(
      request,
      DRAFT_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.draftCreate,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseDraftResultSchema,
      requestHash: canonicalRequestHash(COMMANDS.draftCreate, input),
      responseStatus: 201,
      work: async (client) => {
        const supplier = await resolveSupplierForDate(
          client,
          context.pharmacyId,
          input.supplierId,
          input.invoiceDate,
        );
        const inserted = await client.query<{ id: string }>(
          `insert into purchase_drafts (
             pharmacy_id, supplier_invoice_number, supplier_id, supplier_name_snapshot,
             settlement_context, invoice_date, allowance_percentage_snapshot,
             created_by, updated_by
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
          [
            context.pharmacyId,
            input.supplierInvoiceNumber,
            supplier.id,
            supplier.name,
            input.settlementContext,
            input.invoiceDate,
            supplier.percentage,
            context.actorId,
          ],
        );
        const id = inserted.rows[0]?.id;
        if (id === undefined)
          throw new Error("The Purchase Draft was not created");
        const draft = draftView(
          await requiredDraft(client, context.pharmacyId, id),
        );
        const value = await draftResult(client, context.pharmacyId, draft);
        return {
          afterState: draftAuditState(draft, value.warnings.length),
          targetId: id,
          value,
        };
      },
    });
  }

  public async updateDraft(
    request: Request,
    draftId: string,
    input: PurchaseDraftUpdateRequest,
  ): Promise<PurchaseDraftResult> {
    const context = await this.identity.requirePermission(
      request,
      DRAFT_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.draftUpdate,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseDraftResultSchema,
      requestHash: canonicalRequestHash(COMMANDS.draftUpdate, {
        draftId,
        input,
      }),
      responseStatus: 200,
      targetId: draftId,
      work: async (client) => {
        const before = await lockDraft(client, context.pharmacyId, draftId);
        requireEditableDraft(before, draftId, input.expectedVersion);
        const supplier: ResolvedSupplier =
          before!.supplier_id === input.supplierId &&
          before!.invoice_date === input.invoiceDate
            ? {
                id: before!.supplier_id,
                name: before!.supplier_name_snapshot,
                percentage: before!.allowance_percentage_snapshot,
              }
            : await resolveSupplierForDate(
                client,
                context.pharmacyId,
                input.supplierId,
                input.invoiceDate,
              );
        await client.query(
          `update purchase_drafts set supplier_invoice_number = $3, supplier_id = $4,
             supplier_name_snapshot = $5, settlement_context = $6, invoice_date = $7,
             allowance_percentage_snapshot = $8, version = version + 1,
             updated_at = statement_timestamp(), updated_by = $9
           where pharmacy_id = $1 and id = $2`,
          [
            context.pharmacyId,
            draftId,
            input.supplierInvoiceNumber,
            supplier.id,
            supplier.name,
            input.settlementContext,
            input.invoiceDate,
            supplier.percentage,
            context.actorId,
          ],
        );
        const draft = draftView(
          await requiredDraft(client, context.pharmacyId, draftId),
        );
        const value = await draftResult(client, context.pharmacyId, draft);
        return {
          afterState: draftAuditState(draft, value.warnings.length),
          beforeState: draftAuditState(draftView(before!), 0),
          targetId: draftId,
          value,
        };
      },
    });
  }

  public async discardDraft(
    request: Request,
    draftId: string,
    input: PurchaseDraftDiscardRequest,
  ): Promise<PurchaseDraft> {
    const context = await this.identity.requirePermission(
      request,
      DRAFT_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.draftDiscard,
      context,
      idempotencyKey: input.idempotencyKey,
      parser: purchaseDraftSchema,
      requestHash: canonicalRequestHash(COMMANDS.draftDiscard, {
        draftId,
        input,
      }),
      responseStatus: 201,
      targetId: draftId,
      work: async (client) => {
        const before = await lockDraft(client, context.pharmacyId, draftId);
        requireEditableDraft(before, draftId, input.expectedVersion);
        await client.query(
          `update purchase_drafts set status = 'discarded', discarded_at = statement_timestamp(),
             discarded_by = $3, version = version + 1,
             updated_at = statement_timestamp(), updated_by = $3
           where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, draftId, context.actorId],
        );
        const after = draftView(
          await requiredDraft(client, context.pharmacyId, draftId),
        );
        return {
          afterState: draftAuditState(after, 0),
          beforeState: draftAuditState(draftView(before!), 0),
          targetId: draftId,
          value: after,
        };
      },
    });
  }

  public async rejectInvalidBody(
    request: Request,
    action: string,
    permission: typeof DRAFT_PERMISSION | typeof SUPPLIER_PERMISSION,
    fieldErrors: readonly PurchasingFieldError[],
    targetId?: string,
  ): Promise<never> {
    const context = await this.identity.requirePermission(request, permission);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const requestId = await writePostingAudit(client, {
        action,
        actorUserId: context.actorId,
        afterState: { fieldErrorCount: fieldErrors.length },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "body-invalid",
        pharmacyId: context.pharmacyId,
        ...(targetId === undefined ? {} : { targetId }),
      });
      await client.query("commit");
      throw purchasingDenied(400, "body-invalid", requestId, fieldErrors);
    } catch (error) {
      if (!(error instanceof PurchasingDenied))
        await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async rejectMissing(
    request: Request,
    action: string,
    permission: typeof DRAFT_PERMISSION | typeof SUPPLIER_PERMISSION,
    code: "draft-not-found" | "supplier-not-found",
    targetId?: string,
  ): Promise<never> {
    const context = await this.identity.requirePermission(request, permission);
    throw await this.readDenial(context, action, code, targetId);
  }

  private async executeCommand<T extends CommandValue>(
    input: CommandExecution<T>,
  ): Promise<T> {
    return await runWholeCommandWithRetry(async () => {
      const client = await this.localDatabase.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        let replay;
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
          throw purchasingDenied(409, "idempotency-conflict", requestId);
        }
        if (replay !== undefined) {
          await client.query("commit");
          transactionOpen = false;
          return input.parser.parse(replay.responseBody);
        }
        let success: CommandSuccess<T>;
        try {
          success = await input.work(client);
        } catch (error) {
          if (!(error instanceof PurchasingCommandRejected)) throw error;
          const requestId = await writePostingAudit(client, {
            action: input.commandName,
            actorUserId: input.context.actorId,
            correlationId: input.idempotencyKey,
            device: input.context,
            identitySessionId: input.context.sessionId,
            outcome: error.code,
            pharmacyId: input.context.pharmacyId,
            ...((error.targetId ?? input.targetId) === undefined
              ? {}
              : { targetId: error.targetId ?? input.targetId }),
          });
          const denied = purchasingDenied(
            error.statusCode,
            error.code,
            requestId,
            error.fieldErrors,
          );
          await recordPostingResult(client, {
            actorUserId: input.context.actorId,
            commandName: input.commandName,
            device: input.context,
            idempotencyKey: input.idempotencyKey,
            identitySessionId: input.context.sessionId,
            pharmacyId: input.context.pharmacyId,
            requestHash: input.requestHash,
            responseBody: denied.denial,
            responseStatus: error.statusCode,
          });
          await client.query("commit");
          transactionOpen = false;
          throw denied;
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
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async readDenial(
    context: IdentityExecutionContext,
    action: string,
    code: "draft-not-found" | "supplier-not-found",
    targetId?: string,
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
        ...(targetId === undefined ? {} : { targetId }),
      });
      await client.query("commit");
      return purchasingDenied(404, code, requestId);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
