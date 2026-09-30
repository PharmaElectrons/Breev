import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";
import {
  INVENTORY_REPORT_SENSITIVE_COLUMNS,
  inventoryReportKindSchema,
  inventoryReportQueryFor,
  inventoryReportSchema,
  inventoryReportExportSchema,
  type InventoryReport,
  type InventoryReportExport,
  type InventoryReportKind,
  type InventoryReportQuery,
  type InventoryReportColumn,
} from "@breev/contracts/local-rest";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import type { PermissionName } from "../identity-access/authorization.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { businessDateOf } from "../inventory/business-date.js";
import {
  InventoryReportTooLarge,
  readInventoryReportFacts,
} from "../inventory/inventory-report-read.js";
import {
  readPurchaseReportMetadata,
  type PurchaseReportSource,
} from "../purchasing/purchasing-report-read.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import type { JsonObject } from "../posting/canonical-hash.js";
import { presentInventoryReport } from "./inventory-report-presentation.js";

export class InventoryReportDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: {
      readonly status: "denied";
      readonly code:
        | "query-invalid"
        | "future-cutoff"
        | "sensitive-query-denied"
        | "report-too-large"
        | "export-too-large"
        | "owner-role-required"
        | "idempotency-conflict";
      readonly requestId: string;
    },
  ) {
    super(denial.code);
  }
}
export const MAXIMUM_REPORT_EXPORT_BYTES = 24 * 1024 * 1024;

@Injectable()
export class InventoryReportService {
  public constructor(
    private readonly database: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async read(
    request: Request,
    rawKind: string,
    rawQuery: unknown,
    exportAll = false,
  ): Promise<InventoryReport | InventoryReportExport> {
    const context = await this.identity.requirePermission(
      request,
      exportAll ? "reports.inventory.export" : "reports.inventory.view",
    );
    const kind = inventoryReportKindSchema.safeParse(rawKind);
    let raw: unknown = {};
    try {
      if (
        typeof rawQuery !== "object" ||
        rawQuery === null ||
        Array.isArray(rawQuery)
      )
        throw new Error();
      const params = rawQuery as Record<string, unknown>;
      if (Object.keys(params).some((key) => key !== "query")) throw new Error();
      if (params.query !== undefined) {
        if (typeof params.query !== "string" || params.query.length > 16_384)
          throw new Error();
        raw = JSON.parse(params.query);
      }
    } catch {
      throw await this.denied(context, 400, "query-invalid");
    }
    if (!kind.success) throw await this.denied(context, 400, "query-invalid");
    const query = inventoryReportQueryFor(kind.data).safeParse(raw);
    if (!query.success) throw await this.denied(context, 400, "query-invalid");
    const client = await this.database.requirePool().connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      await client.query("set local statement_timeout = '10s'");
      const required: PermissionName[] = ["reports.inventory.view"];
      if (exportAll) required.push("reports.inventory.export");
      if (["value", "average-cost"].includes(kind.data))
        required.push("inventory.valuation.view");
      const fresh = await this.identity.revalidateInventoryReport(
        client,
        context,
        required,
      );
      const valuation =
        !exportAll && fresh.permissions.includes("inventory.valuation.view");
      this.checkSensitivity(query.data, valuation);
      const report = await this.compose(
        client,
        fresh,
        kind.data,
        query.data,
        valuation,
        exportAll,
      );
      await client.query("commit");
      if (exportAll) {
        await this.audit(fresh, "reports.inventory.export", "prepared", {
          kind: kind.data,
          from: report.query.from,
          to: report.query.to,
          rowCount: report.totalRows,
          sensitivity: "redacted",
        });
        return inventoryReportExportSchema.parse({
          ...report,
          exportedAt: report.capturedAt,
        });
      }
      return report;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error instanceof InventoryReportTooLarge)
        throw await this.denied(context, 413, "report-too-large");
      if (error instanceof SensitiveReportQuery)
        throw await this.denied(context, 403, "sensitive-query-denied");
      throw error;
    } finally {
      client.release();
    }
  }

  public checkSensitivity(
    query: InventoryReportQuery,
    valuation: boolean,
  ): void {
    const queryColumns: InventoryReportColumn[] = [
      query.sort,
      ...(query.groupBy === undefined ? [] : [query.groupBy]),
      ...query.filters.map((f) => f.column),
    ];
    if (
      !valuation &&
      queryColumns.some((c) => INVENTORY_REPORT_SENSITIVE_COLUMNS.includes(c))
    )
      throw new SensitiveReportQuery();
  }

  /** Also used by Inventory's protected export handler, within its consistent transaction. */
  public async compose(
    client: PoolClient,
    context: IdentityExecutionContext,
    kind: InventoryReportKind,
    query: InventoryReportQuery,
    valuation: boolean,
    exportAll: boolean,
  ): Promise<InventoryReport> {
    const timeZone = await this.identity.readPharmacyBusinessTimeZone(
      client,
      context.pharmacyId,
    );
    const clock = await client.query<{ captured_at: Date; month_start: Date }>(
      "select transaction_timestamp() as captured_at, date_trunc('month', transaction_timestamp() at time zone $1) at time zone $1 as month_start",
      [timeZone],
    );
    const capturedAt = clock.rows[0]!.captured_at;
    const to = query.to === undefined ? capturedAt : new Date(query.to);
    if (to > capturedAt) throw await this.denied(context, 400, "future-cutoff");
    const from =
      query.from === undefined
        ? clock.rows[0]!.month_start
        : new Date(query.from);
    const inventory = await readInventoryReportFacts(
      client,
      context.pharmacyId,
      to,
      businessDateOf(new Date(to.getTime() - 1), timeZone),
    );
    const purchaseSources = new Map<string, PurchaseReportSource>();
    for (const fact of inventory.facts)
      if (fact.source.type !== "count-session")
        purchaseSources.set(`${fact.source.id}:${fact.source.ordinal}`, {
          ...fact.source,
          type: fact.source.type,
        });
    const metadata = new Map(
      await readPurchaseReportMetadata(client, context.pharmacyId, [
        ...purchaseSources.values(),
      ]),
    );
    for (const [key, value] of inventory.countMetadata)
      metadata.set(key, value);
    const userIds = [
      ...new Set([
        ...inventory.facts.map((f) => f.actorId),
        ...inventory.batches.flatMap((b) =>
          b.events.flatMap((e) => (e.actorId === null ? [] : [e.actorId])),
        ),
      ]),
    ];
    const users = await this.identity.resolveUserDisplayNames(
      client,
      context.pharmacyId,
      userIds,
    );
    const report = inventoryReportSchema.parse(
      presentInventoryReport({
        kind,
        query: { ...query, from: from.toISOString(), to: to.toISOString() },
        pharmacyId: context.pharmacyId,
        capturedAt: capturedAt.toISOString(),
        timeZone,
        inventory,
        metadata,
        users,
        valuation,
        purchasesOpenable: context.permissions.includes(
          "purchases.posted.view",
        ),
        purchaseCorrectionsOpenable:
          context.permissions.includes("purchases.posted.view") &&
          context.permissions.includes("purchases.costs.view"),
        countsOpenable:
          context.permissions.includes("inventory.counts.record") ||
          context.permissions.includes("inventory.counts.approve"),
        exportAll,
      }),
    );
    if (
      exportAll &&
      Buffer.byteLength(JSON.stringify(report), "utf8") >
        MAXIMUM_REPORT_EXPORT_BYTES
    )
      throw await this.denied(context, 413, "export-too-large");
    return report;
  }

  public async denied(
    context: IdentityExecutionContext,
    statusCode: number,
    code: InventoryReportDenied["denial"]["code"],
  ): Promise<InventoryReportDenied> {
    const requestId = await this.audit(
      context,
      "reports.inventory.request",
      code,
    );
    return new InventoryReportDenied(statusCode, {
      code,
      status: "denied",
      requestId,
    });
  }
  private async audit(
    context: IdentityExecutionContext,
    action: string,
    outcome: string,
    afterState?: JsonObject,
  ): Promise<string> {
    const client = await this.database.requirePool().connect();
    try {
      return await writePostingAudit(client, {
        action,
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        pharmacyId: context.pharmacyId,
        outcome,
        ...(afterState === undefined ? {} : { afterState }),
      });
    } finally {
      client.release();
    }
  }
}
class SensitiveReportQuery extends Error {}
