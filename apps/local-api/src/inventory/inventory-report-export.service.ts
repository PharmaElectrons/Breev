import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import {
  inventoryReportExportSchema,
  inventoryReportQueryFor,
  type InventoryReportExport,
  type InventoryReportProtectedExportRequest,
} from "@breev/contracts/local-rest";
import { IdentityAccessService } from "../identity-access/identity-access.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
} from "../posting/idempotency.js";
import { canonicalRequestHash } from "../posting/canonical-hash.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import {
  InventoryReportDenied,
  InventoryReportService,
} from "../reporting/inventory-report.service.js";

const COMMAND = "inventory.sensitive-export";
/** Inventory owns the sensitive transaction and frozen values; Reporting only composes its read. */
@Injectable()
export class InventoryReportExportService {
  public constructor(
    private readonly database: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
    private readonly reports: InventoryReportService,
  ) {}
  public async authorizeInvalidRequest(
    request: Request,
  ): Promise<InventoryReportDenied> {
    const context = await this.identity.requirePermission(
      request,
      "reports.inventory.export",
    );
    return await this.reports.denied(context, 400, "query-invalid");
  }
  public async export(
    request: Request,
    input: InventoryReportProtectedExportRequest,
  ): Promise<InventoryReportExport> {
    const context = await this.identity.requirePermission(
      request,
      "reports.inventory.export",
    );
    if (context.roleKey !== "owner")
      throw await this.reports.denied(context, 403, "owner-role-required");
    const query = inventoryReportQueryFor(input.kind).safeParse(input.query);
    if (
      !query.success ||
      query.data.from === undefined ||
      query.data.to === undefined
    )
      throw await this.reports.denied(context, 400, "query-invalid");
    return await runWholeCommandWithRetry(async () => {
      const client = await this.database.requirePool().connect();
      let open = false;
      try {
        await client.query("begin isolation level serializable");
        open = true;
        await client.query("set local statement_timeout = '10s'");
        const fresh = await this.identity.revalidateInventoryReport(
          client,
          context,
          [
            "reports.inventory.view",
            "reports.inventory.export",
            "inventory.valuation.view",
          ],
        );
        if (fresh.roleKey !== "owner")
          throw await this.reports.denied(fresh, 403, "owner-role-required");
        const requestHash = canonicalRequestHash(COMMAND, {
          kind: input.kind,
          query: query.data,
          challengeId: input.challengeId,
          actorId: fresh.actorId,
          sessionId: fresh.sessionId,
          deviceId: fresh.deviceId,
        });
        let replay;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName: COMMAND,
            pharmacyId: fresh.pharmacyId,
            idempotencyKey: input.idempotencyKey,
            requestHash,
          });
        } catch (error) {
          if (error instanceof PostingIdempotencyConflict)
            throw await this.reports.denied(fresh, 409, "idempotency-conflict");
          throw error;
        }
        if (replay !== undefined) {
          await client.query("commit");
          open = false;
          return inventoryReportExportSchema.parse(replay.responseBody);
        }
        await this.identity.consumeInventoryExportStepUp(
          client,
          fresh,
          input.challengeId,
        );
        const report = await this.reports.compose(
          client,
          fresh,
          input.kind,
          query.data,
          true,
          true,
        );
        const bundle = inventoryReportExportSchema.parse({
          ...report,
          exportedAt: report.capturedAt,
        });
        await writePostingAudit(client, {
          action: "inventory.report-sensitive-export",
          actorUserId: fresh.actorId,
          device: fresh,
          identitySessionId: fresh.sessionId,
          pharmacyId: fresh.pharmacyId,
          correlationId: input.idempotencyKey,
          outcome: "prepared",
          afterState: {
            kind: input.kind,
            from: bundle.query.from,
            to: bundle.query.to,
            rowCount: bundle.totalRows,
          },
        });
        await recordPostingResult(client, {
          commandName: COMMAND,
          pharmacyId: fresh.pharmacyId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          actorUserId: fresh.actorId,
          device: fresh,
          identitySessionId: fresh.sessionId,
          responseBody: bundle,
          responseStatus: 201,
        });
        await client.query("commit");
        open = false;
        return bundle;
      } catch (error) {
        if (open) await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }
}
