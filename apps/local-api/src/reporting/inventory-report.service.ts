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
import {
  InventoryReportExportTooLarge,
  readInventoryReportPage,
  readInventoryReportActivity,
} from "../inventory/inventory-report-query.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import type { JsonObject } from "../posting/canonical-hash.js";
import {
  presentInventoryReport,
  presentReportActivity,
  type ReportReadPermissions,
} from "./inventory-report-presentation.js";
import {
  inventoryReportActivityQuerySchema,
  inventoryReportActivityPageSchema,
  type InventoryReportActivityPage,
} from "@breev/contracts/local-rest";

export class InventoryReportDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: {
      readonly status: "denied";
      readonly code:
        | "query-invalid"
        | "future-cutoff"
        | "sensitive-query-denied"
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
      if (error instanceof InventoryReportExportTooLarge)
        throw await this.denied(context, 413, "export-too-large");
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
    const snapshot = await this.snapshot(client, context, query, timeZone);
    // Joined posting projections under RLS can underestimate history before
    // statistics catch up. Favor hash/merge joins to avoid batches × facts
    // rescans; PostgreSQL retains necessary indexed/lateral nested loops.
    // This setting ends with the caller's transaction, including protected export.
    await client.query("set local enable_nestloop = off");
    let page;
    try {
      page = await readInventoryReportPage(
        client,
        context.pharmacyId,
        kind,
        snapshot.query,
        snapshot.businessDate,
        exportAll,
        MAXIMUM_REPORT_EXPORT_BYTES,
        valuation,
      );
    } catch (error) {
      if (error instanceof InventoryReportExportTooLarge)
        throw await this.denied(context, 413, "export-too-large");
      throw error;
    }
    const report = inventoryReportSchema.parse(
      presentInventoryReport(
        {
          kind,
          query: snapshot.query,
          pharmacyId: context.pharmacyId,
          capturedAt: snapshot.capturedAt,
          timeZone,
          ...page,
          hasMore: !exportAll && query.page * query.pageSize < page.totalRows,
          dateBasis: "immutable-posting-time",
          balanceBasis: "all-pharmacy-activity",
          sensitivity: valuation ? "valuation" : "redacted",
          columns: [],
          explanations: [
            "working-default-columns",
            "activity-filter-does-not-filter-balances",
            ...(kind === "alerts" || kind === "batches-expiry"
              ? ["historical-policy-unavailable" as const]
              : []),
            ...(kind === "consumption" ? ["no-eligible-demand" as const] : []),
            ...(page.rows.some(
              (r) => r.cells.item == null || r.cells.unit == null,
            )
              ? ["historical-label-unavailable" as const]
              : []),
            ...(page.rows.some(
              (r) => r.source?.documentType !== "purchase-invoice",
            )
              ? ["business-date-unavailable" as const]
              : []),
          ],
        },
        this.presentationPermissions(context, valuation),
      ),
    );
    if (
      exportAll &&
      Buffer.byteLength(JSON.stringify(report), "utf8") >
        MAXIMUM_REPORT_EXPORT_BYTES
    )
      throw await this.denied(context, 413, "export-too-large");
    return report;
  }

  private presentationPermissions(
    context: IdentityExecutionContext,
    valuation: boolean,
  ): ReportReadPermissions {
    return {
      valuation,
      purchasesOpenable: context.permissions.includes("purchases.posted.view"),
      purchaseCorrectionsOpenable:
        context.permissions.includes("purchases.posted.view") &&
        context.permissions.includes("purchases.costs.view"),
      countsOpenable:
        context.permissions.includes("inventory.counts.record") ||
        context.permissions.includes("inventory.counts.approve"),
    };
  }
  private async snapshot(
    client: PoolClient,
    context: IdentityExecutionContext,
    query: InventoryReportQuery,
    timeZone: string,
  ) {
    const result = await client.query<{
      capturedAt: string;
      from: string;
      to: string;
      future: boolean;
      businessDate: string;
    }>(
      `select to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "capturedAt",
       to_char(coalesce($2::timestamptz, date_trunc('month', transaction_timestamp() at time zone $1) at time zone $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "from",
       to_char(coalesce($3::timestamptz, transaction_timestamp()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "to",
       coalesce($3::timestamptz > transaction_timestamp(), false) as future,
       ((coalesce($3::timestamptz, transaction_timestamp()) - interval '1 microsecond') at time zone $1)::date::text as "businessDate"`,
      [timeZone, query.from ?? null, query.to ?? null],
    );
    const snapshot = result.rows[0]!;
    if (snapshot.future) throw await this.denied(context, 400, "future-cutoff");
    return {
      ...snapshot,
      query: {
        ...query,
        from: query.from ?? snapshot.from,
        to: query.to ?? snapshot.to,
      },
    };
  }
  public async activity(
    request: Request,
    rawKind: string,
    rawQuery: unknown,
  ): Promise<InventoryReportActivityPage> {
    const context = await this.identity.requirePermission(
      request,
      "reports.inventory.view",
    );
    let parsed;
    const kind = inventoryReportKindSchema.safeParse(rawKind);
    try {
      const envelope = rawQuery as Record<string, unknown>;
      if (
        Object.keys(envelope).length !== 1 ||
        typeof envelope.query !== "string" ||
        envelope.query.length > 16384
      )
        throw new Error();
      parsed = inventoryReportActivityQuerySchema.parse(
        JSON.parse(envelope.query),
      );
      if (
        !kind.success ||
        !inventoryReportQueryFor(kind.data).safeParse(parsed.query).success
      )
        throw new Error();
    } catch {
      throw await this.denied(context, 400, "query-invalid");
    }
    if (!kind.success) throw await this.denied(context, 400, "query-invalid");
    const client = await this.database.requirePool().connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      await client.query("set local statement_timeout = '10s'");
      const fresh = await this.identity.revalidateInventoryReport(
        client,
        context,
        [
          "reports.inventory.view",
          ...(["value", "average-cost"].includes(kind.data)
            ? ["inventory.valuation.view" as const]
            : []),
        ],
      );
      const valuation = fresh.permissions.includes("inventory.valuation.view");
      this.checkSensitivity(parsed.query, valuation);
      const timeZone = await this.identity.readPharmacyBusinessTimeZone(
        client,
        fresh.pharmacyId,
      );
      const snapshot = await this.snapshot(
        client,
        fresh,
        parsed.query,
        timeZone,
      );
      await client.query("set local enable_nestloop = off");
      const page = await readInventoryReportActivity(
        client,
        fresh.pharmacyId,
        kind.data,
        snapshot.query,
        snapshot.businessDate,
        parsed.rowId,
        parsed.page,
        parsed.pageSize,
      );
      const result = inventoryReportActivityPageSchema.parse({
        ...page,
        rows: page.rows.map((a) =>
          presentReportActivity(
            a,
            this.presentationPermissions(fresh, valuation),
          ),
        ),
      });
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error instanceof SensitiveReportQuery)
        throw await this.denied(context, 403, "sensitive-query-denied");
      throw error;
    } finally {
      client.release();
    }
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
