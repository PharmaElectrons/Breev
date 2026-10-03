import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  inventoryItemListContract,
  inventoryMovementHistoryContract,
  inventoryMovementHistoryPath,
  inventorySensitiveExportContract,
  INVENTORY_REPORT_KINDS,
  inventoryReportPath,
  inventoryReportSchema,
  inventoryReportExportSchema,
  inventoryReportActivityPageSchema,
  inventoryReportProtectedExportContract,
  type InventoryReport,
  productArchivePath,
  purchaseAdjustmentDraftPath,
  purchaseAdjustmentDraftsPath,
  purchaseAdjustmentPostingsPath,
  purchaseAdjustmentSummaryPath,
  purchasePostedPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  purchaseReturnDraftPath,
  purchaseReturnDraftsPath,
  purchaseReturnPostingsPath,
  purchaseReturnSummaryPath,
  type InventoryItem,
  type InventoryReviewPreferences,
  type InventorySensitiveExport,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentPostResult,
  type PurchaseAdjustmentSummary,
  type PurchasePostResult,
  type PurchaseReturnDraft,
  type PurchaseReturnPostResult,
  type PurchaseReturnSummary,
  type Supplier,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import {
  applyWeightedAverageReceipt,
  EMPTY_INVENTORY_VALUATION,
  reportedAverageUnitCostScaled as reportAverage,
  valuationValueFils,
} from "../inventory/inventory-valuation.js";
import { divideFilsRounded } from "../posting/money.js";
import {
  readInventoryReportPage,
  readInventoryReportActivity,
  InventoryReportExportTooLarge,
} from "../inventory/inventory-report-query.js";
import { inventoryReportQueryFor } from "@breev/contracts/local-rest";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "inventory.review.owner";
const OWNER_PASSWORD = "inventory review owner password stays in this test";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

describe.sequential("Inventory review PostgreSQL seam", () => {
  let administrator: Pool;
  let application: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let archivedProduct: Product;
  let product: Product;
  let pharmacyId = "";
  let supplierA: Supplier;
  let supplierB: Supplier;
  const postedPurchaseIds: string[] = [];

  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    application = new Pool({ connectionString: databaseRoles.applicationUrl });
    credentials = createCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);

    const bootstrapped = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Inventory Review Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Inventory Review Pharmacy",
    });
    expect(bootstrapped.status, diagnostics(bootstrapped)).toBe(201);
    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.status, diagnostics(login)).toBe(200);
    pharmacyId = String(
      (login.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );

    supplierA = await createSupplier("Primary Review Supplier", "0");
    supplierB = await createSupplier("Allowance Review Supplier", "7");
    const created = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Movement Review Item"),
    );
    expect(created.status, diagnostics(created)).toBe(201);
    product = created.body as Product;
    const archived = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Archived Empty Item"),
    );
    expect(archived.status, diagnostics(archived)).toBe(201);
    archivedProduct = archived.body as Product;
    const archive = await request(
      "POST",
      productArchivePath(archivedProduct.id),
      {
        expectedRevision: archivedProduct.revision,
        idempotencyKey: uuidV7(),
      },
    );
    expect(archive.status, diagnostics(archive)).toBe(201);

    await postPurchase(
      supplierA.id,
      "REVIEW-A",
      "1000",
      "10",
      "LOT-A",
      "2026-12-31",
    );
    await postPurchase(
      supplierB.id,
      "REVIEW-B",
      "2000",
      "5",
      "LOT-B",
      "2027-01-31",
    );
    await postPurchase(
      supplierB.id,
      "REVIEW-C",
      "3000",
      "2",
      "LOT-C",
      "2027-02-28",
    );
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("reconciles the API projection independently against movements and valuation state", async () => {
    const response = await request("GET", inventoryItemListContract.path);
    expect(response.status, diagnostics(response)).toBe(200);
    const body = response.body as { items: InventoryItem[] };
    const item = body.items.find(({ productId }) => productId === product.id);
    expect(item).toBeDefined();
    expect(
      body.items.some(({ productId }) => productId === archivedProduct.id),
    ).toBe(false);

    const raw = await administrator.query<{
      carrying_amount_fils: string;
      quantity: string;
    }>(
      `select quantity::text, carrying_amount_fils::text
       from inventory_movements where pharmacy_id = $1 and product_id = $2
       order by occurred_at, id`,
      [pharmacyId, product.id],
    );
    const folded = raw.rows.reduce(
      (state, row) =>
        applyWeightedAverageReceipt(state, {
          carryingAmountFils: BigInt(row.carrying_amount_fils),
          quantity: BigInt(row.quantity),
        }),
      EMPTY_INVENTORY_VALUATION,
    );
    expect(item!.balance).toBe(
      raw.rows
        .reduce((total, row) => total + BigInt(row.quantity), 0n)
        .toString(),
    );
    expect(item!.valueFils).toBe(valuationValueFils(folded).toString());
    expect(item!.averageUnitCostFils).toBe(
      divideFilsRounded(reportAverage(folded)!, 10_000_000_000n).toString(),
    );
    expect(item!.reconciliation).toBe("consistent");
    expect(item!.batches).toMatchObject({ count: "3", expiredCount: "0" });

    const history = await request(
      "GET",
      inventoryMovementHistoryPath(product.id),
    );
    expect(history.status, diagnostics(history)).toBe(200);
    expect((history.body as { movements: unknown[] }).movements).toHaveLength(
      3,
    );
  });

  it("reconciles adjustments and a purchase return exactly once", async () => {
    const originalPurchaseId = postedPurchaseIds[0]!;
    const quantityDraft = await createAdjustmentDraft(
      originalPurchaseId,
      "quantity error",
    );
    const quantitySaved = await saveAdjustmentDraft(quantityDraft, (rows) =>
      rows.map((row, index) =>
        index === 0
          ? {
              ...row,
              enteredQuantity: (BigInt(row.enteredQuantity) + 2n).toString(),
            }
          : row,
      ),
    );
    const quantitySummary = await previewAdjustment(quantitySaved);
    expect(quantitySummary).toMatchObject({
      primarySupplierCostDeltaFils: "2000",
      quantityDelta: "2",
    });
    const quantityPosted = await postAdjustment(quantitySaved, quantitySummary);

    const priceDraft = await createAdjustmentDraft(
      originalPurchaseId,
      "price error",
    );
    const priceSaved = await saveAdjustmentDraft(priceDraft, (rows) =>
      rows.map((row, index) =>
        index === 0 ? { ...row, costFils: "1200" } : row,
      ),
    );
    const priceSummary = await previewAdjustment(priceSaved);
    expect(priceSummary).toMatchObject({
      primarySupplierCostDeltaFils: "2400",
      quantityDelta: "0",
    });
    const pricePosted = await postAdjustment(priceSaved, priceSummary);
    const returnPosted = await postPurchaseReturn(originalPurchaseId, "1");
    expect(returnPosted.posted).toMatchObject({
      inventoryCarryingAmountFils: "1600",
      number: { series: "PR" },
      originalPurchaseId,
      supplierReductionFils: "1000",
    });

    const reconciliationAuditBefore = await administrator.query<{
      count: string;
    }>(
      `select count(*)::text as count
       from posting_audit_records
       where pharmacy_id = $1
         and action = 'inventory.review.reconciliation'
         and outcome = 'mismatch'`,
      [pharmacyId],
    );
    expect(reconciliationAuditBefore.rows[0]?.count).toBe("0");

    let item: InventoryItem | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request("GET", inventoryItemListContract.path);
      expect(response.status, diagnostics(response)).toBe(200);
      item = (response.body as { items: InventoryItem[] }).items.find(
        ({ productId }) => productId === product.id,
      );
      if (item === undefined) throw new Error("Inventory fixture item missing");
    }
    if (item === undefined) throw new Error("Inventory fixture item missing");
    const reconciliationAuditAfter = await administrator.query<{
      count: string;
    }>(
      `select count(*)::text as count
       from posting_audit_records
       where pharmacy_id = $1
         and action = 'inventory.review.reconciliation'
         and outcome = 'mismatch'`,
      [pharmacyId],
    );
    expect(reconciliationAuditAfter.rows[0]?.count).toBe("0");

    const movements = await administrator.query<{
      carrying_amount_fils: string;
      quantity: string;
      reason: "purchase-adjustment" | "purchase-receipt" | "purchase-return";
    }>(
      `select reason, quantity::text, carrying_amount_fils::text
       from inventory_movements
       where pharmacy_id = $1 and product_id = $2
       order by occurred_at, id`,
      [pharmacyId, product.id],
    );
    const valueEffects = await administrator.query<{
      carrying_amount_delta_fils: string;
      quantity_delta: string;
    }>(
      `select quantity_delta::text, carrying_amount_delta_fils::text
       from inventory_value_effects
       where pharmacy_id = $1 and product_id = $2
       order by occurred_at, id`,
      [pharmacyId, product.id],
    );
    const valuation = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      `select total_quantity::text, total_value_scaled::text
       from inventory_valuation_state
       where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, product.id],
    );
    const expectedBalance = movements.rows.reduce(
      (total, row) => total + BigInt(row.quantity),
      0n,
    );
    const expectedValue =
      movements.rows.reduce(
        (total, row) =>
          total +
          (row.reason === "purchase-adjustment"
            ? 0n
            : BigInt(row.carrying_amount_fils)),
        0n,
      ) +
      valueEffects.rows.reduce(
        (total, row) => total + BigInt(row.carrying_amount_delta_fils),
        0n,
      );
    const state = valuation.rows[0]!;
    const stateQuantity = BigInt(state.total_quantity);
    const stateValueScaled = BigInt(state.total_value_scaled);
    expect(movements.rows).toHaveLength(5);
    expect(valueEffects.rows).toHaveLength(2);
    expect(quantityPosted.posted.rowDeltas[0]?.movementId).not.toBeNull();
    expect(quantityPosted.posted.rowDeltas[0]?.valueEffectId).not.toBeNull();
    expect(pricePosted.posted.rowDeltas[0]?.movementId).toBeNull();
    expect(pricePosted.posted.rowDeltas[0]?.valueEffectId).not.toBeNull();
    expect(expectedBalance).toBe(stateQuantity);
    expect(expectedValue).toBe(stateValueScaled / 10_000_000_000n);
    expect(item.balance).toBe(expectedBalance.toString());
    expect(item.valueFils).toBe(expectedValue.toString());
    expect(item.averageUnitCostFils).toBe(
      divideFilsRounded(
        reportAverage({
          totalQuantity: stateQuantity,
          totalValueScaled: stateValueScaled,
        })!,
        10_000_000_000n,
      ).toString(),
    );
    expect(item.reconciliation).toBe("consistent");
    expect(item).toMatchObject({
      averageUnitCostFils: "1600",
      balance: "18",
      valueFils: "28800",
      reconciliation: "consistent",
    });

    // Expected amounts come from the frozen documents above, not the report
    // projection or child ledger timestamps. Each posting is indivisible.
    for (const [id, beforeQuantity, afterQuantity, beforeValue, afterValue] of [
      [quantityPosted.posted.id, "17", "19", "26000", "28000"],
      [pricePosted.posted.id, "19", "19", "28000", "30400"],
      [returnPosted.posted.id, "19", "18", "30400", "28800"],
    ]) {
      const boundaries = await administrator.query<{
        cutoff: string;
        offset: number;
      }>(
        `select to_char((posted_at + delta * interval '1 microsecond') at time zone 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cutoff, delta as offset
         from (select posted_at from posted_purchase_adjustments where pharmacy_id = $1 and id = $2
               union all select posted_at from posted_purchase_returns where pharmacy_id = $1 and id = $2) parent
         cross join (values (-1), (0), (1)) boundary(delta) order by delta`,
        [pharmacyId, id],
      );
      expect(boundaries.rows).toHaveLength(3);
      for (const boundary of boundaries.rows) {
        const response = await request(
          "GET",
          `${inventoryReportPath("value")}?query=${encodeURIComponent(
            JSON.stringify({
              from: "2020-01-01T00:00:00Z",
              to: boundary.cutoff,
            }),
          )}`,
        );
        expect(response.status, diagnostics(response)).toBe(200);
        const row = inventoryReportSchema
          .parse(response.body)
          .rows.find((r) => r.productId === product.id)!;
        expect(row.cells.closingQuantity).toBe(
          boundary.offset <= 0 ? beforeQuantity : afterQuantity,
        );
        expect(row.cells.closingValueFils).toBe(
          boundary.offset <= 0 ? beforeValue : afterValue,
        );
      }
      const response = await request(
        "GET",
        `${inventoryReportPath("value")}?query=${encodeURIComponent(
          JSON.stringify({
            from: boundaries.rows[1]!.cutoff,
            to: boundaries.rows[2]!.cutoff,
          }),
        )}`,
      );
      const row = inventoryReportSchema
        .parse(response.body)
        .rows.find((r) => r.productId === product.id)!;
      expect(row.cells.openingQuantity).toBe(beforeQuantity);
      expect(row.cells.periodQuantity).toBe(
        (BigInt(afterQuantity!) - BigInt(beforeQuantity!)).toString(),
      );
      expect(row.cells.activityValueFils).toBe(
        (BigInt(afterValue!) - BigInt(beforeValue!)).toString(),
      );
      const activities = await reportActivity("value", row.id, {
        from: boundaries.rows[1]!.cutoff,
        to: boundaries.rows[2]!.cutoff,
      });
      expect(activities.rows.every((a) => a.source?.documentId === id)).toBe(
        true,
      );
    }

    const challenge = await request("POST", "/identity/step-up-challenges", {
      action: "inventory.sensitive.export",
      idempotencyKey: uuidV7(),
    });
    expect(challenge.status, diagnostics(challenge)).toBe(201);
    const challengeId = String((challenge.body as { id?: string }).id ?? "");
    const approved = await request(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approved.status, diagnostics(approved)).toBe(200);
    const exported = await request(
      "POST",
      inventorySensitiveExportContract.path,
      { challengeId, idempotencyKey: uuidV7() },
    );
    expect(exported.status, diagnostics(exported)).toBe(201);
    const bundle = exported.body as InventorySensitiveExport;
    const exportedItem = bundle.items.find(
      ({ productId }) => productId === product.id,
    );
    expect(exportedItem).toBeDefined();
    expect(exportedItem!.balance).toBe(item.balance);
    expect(exportedItem!.valueFils).toBe(item.valueFils);
    expect(exportedItem!.averageUnitCostFils).toBe(item.averageUnitCostFils);

    const originalNumber = await administrator.query<{
      number_value: string;
      number_year: number;
    }>(
      `select number_value::text, number_year
       from posted_purchases where pharmacy_id = $1 and id = $2`,
      [pharmacyId, originalPurchaseId],
    );
    const history = await request(
      "GET",
      inventoryMovementHistoryPath(product.id),
    );
    const parsedHistory = inventoryMovementHistoryContract.responses[200].parse(
      history.body,
    );
    expect(parsedHistory.movements.map((movement) => movement.kind)).toEqual([
      "purchase-receipt",
      "purchase-receipt",
      "purchase-receipt",
      "purchase-adjustment",
      "purchase-return",
    ]);
    const adjustmentMovement = parsedHistory.movements.find(
      (movement) => movement.kind === "purchase-adjustment",
    );
    expect(adjustmentMovement?.reference).toMatchObject({
      documentId: originalPurchaseId,
      documentType: "purchase-adjustment",
      number: {
        series: "P",
        value: originalNumber.rows[0]!.number_value,
        year: originalNumber.rows[0]!.number_year,
      },
      openable: true,
    });
    expect(adjustmentMovement?.reference.label).toContain(
      "-1 · Primary Review Supplier",
    );
    const returnMovement = parsedHistory.movements.find(
      (movement) => movement.kind === "purchase-return",
    );
    expect(returnMovement?.reference).toMatchObject({
      documentId: originalPurchaseId,
      documentType: "purchase-return",
      number: {
        series: "P",
        value: originalNumber.rows[0]!.number_value,
        year: originalNumber.rows[0]!.number_year,
      },
      openable: true,
    });
    expect(returnMovement?.reference.label).toContain(
      `PR${returnPosted.posted.number.value}/${returnPosted.posted.number.year} · P${originalNumber.rows[0]!.number_value}/${originalNumber.rows[0]!.number_year} · Primary Review Supplier`,
    );
  });

  it("reports all seven categories from one historical cutoff without changing stock", async () => {
    const before = await stockFacts();
    const clock = await administrator.query<{ now: Date }>("select now()");
    const query = {
      from: "2020-01-01T00:00:00.000Z",
      to: clock.rows[0]!.now.toISOString(),
    };
    const path = (
      kind: (typeof INVENTORY_REPORT_KINDS)[number],
      extra: Record<string, unknown> = {},
    ) =>
      `${inventoryReportPath(kind)}?query=${encodeURIComponent(JSON.stringify({ ...query, ...extra }))}`;
    const reports = new Map<string, InventoryReport>();
    for (const kind of INVENTORY_REPORT_KINDS) {
      const response = await request("GET", path(kind));
      expect(response.status, `${kind}: ${diagnostics(response)}`).toBe(200);
      const report = inventoryReportSchema.parse(response.body);
      expect(report.kind).toBe(kind);
      expect(report.query).toMatchObject(query);
      expect(report.dateBasis).toBe("immutable-posting-time");
      reports.set(kind, report);
      for (const suffix of ["/export", "/activity"]) {
        const parameters =
          suffix === "/activity" ? { query, rowId: product.id } : query;
        const response = await request(
          "GET",
          `${inventoryReportPath(kind)}${suffix}?query=${encodeURIComponent(JSON.stringify(parameters))}`,
        );
        expect(response.status, diagnostics(response)).toBe(200);
        for (const verb of ["POST", "PUT", "DELETE"] as const) {
          expect(
            (await request(verb, `${inventoryReportPath(kind)}${suffix}`, {}))
              .status,
          ).toBe(404);
        }
      }
    }
    const quantity = reports
      .get("quantity")!
      .rows.find((row) => row.productId === product.id)!;
    const value = reports
      .get("value")!
      .rows.find((row) => row.productId === product.id)!;
    const average = reports
      .get("average-cost")!
      .rows.find((row) => row.productId === product.id)!;
    const independentMovements = await administrator.query<{
      quantity: string;
      carrying_amount_fils: string;
      reason: string;
      source_document_id: string;
    }>(
      "select quantity::text, carrying_amount_fils::text, reason, source_document_id::text from inventory_movements where pharmacy_id = $1 and product_id = $2",
      [pharmacyId, product.id],
    );
    const independentEffects = await administrator.query<{
      carrying_amount_delta_fils: string;
    }>(
      "select carrying_amount_delta_fils::text from inventory_value_effects where pharmacy_id = $1 and product_id = $2",
      [pharmacyId, product.id],
    );
    const balance = independentMovements.rows.reduce(
      (sum, row) => sum + BigInt(row.quantity),
      0n,
    );
    const amount =
      independentMovements.rows.reduce(
        (sum, row) =>
          sum +
          (row.reason === "purchase-adjustment"
            ? 0n
            : BigInt(row.carrying_amount_fils)),
        0n,
      ) +
      independentEffects.rows.reduce(
        (sum, row) => sum + BigInt(row.carrying_amount_delta_fils),
        0n,
      );
    expect(quantity.cells).toMatchObject({
      openingQuantity: "0",
      closingQuantity: balance.toString(),
      periodQuantity: balance.toString(),
    });
    expect(value.cells.closingValueFils).toBe(amount.toString());
    const independentState = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      "select total_quantity::text, total_value_scaled::text from inventory_valuation_state where pharmacy_id = $1 and product_id = $2",
      [pharmacyId, product.id],
    );
    expect(independentState.rows[0]?.total_quantity).toBe(balance.toString());
    expect(
      valuationValueFils({
        totalQuantity: BigInt(independentState.rows[0]!.total_quantity),
        totalValueScaled: BigInt(independentState.rows[0]!.total_value_scaled),
      }),
    ).toBe(amount);
    const independentJournal = await administrator.query<{ value: string }>(
      "select coalesce(sum(debit_fils - credit_fils), 0)::text as value from accounting_journal_lines where pharmacy_id = $1 and account_code = 'inventory'",
      [pharmacyId],
    );
    // The pending G-01 return template puts its explicit WAC/source-cost offset
    // on Inventory. Reconcile that separately from the frozen carrying amount.
    const independentReturnOffset = await administrator.query<{
      value: string;
    }>(
      "select coalesce(sum(inventory_carrying_amount_fils - supplier_reduction_fils), 0)::text as value from posted_purchase_returns where pharmacy_id = $1",
      [pharmacyId],
    );
    expect(
      BigInt(independentJournal.rows[0]!.value) -
        BigInt(independentReturnOffset.rows[0]!.value),
    ).toBe(amount);
    expect(average.cells.closingAverageCostScaled).toBe(
      reportAverage({
        totalQuantity: balance,
        totalValueScaled: amount * 10_000_000_000n,
      })?.toString(),
    );
    const quantityActivity = await reportActivity(
      "quantity",
      quantity.id,
      query,
    );
    expect(
      quantityActivity.rows.find((a) => a.reason === "purchase-adjustment")
        ?.source?.documentId,
    ).toBe(
      independentMovements.rows.find(
        (row) => row.reason === "purchase-adjustment",
      )?.source_document_id,
    );
    const count = reports.get("stocktake-movements")!;
    expect(count.rows).toHaveLength(0);
    expect(
      reports
        .get("consumption")
        ?.rows.find((row) => row.productId === product.id)?.cells
        .consumedQuantity,
    ).toBe("0");
    expect(
      reports
        .get("alerts")
        ?.rows.some(
          (row) => row.cells.availability === "historical-policy-unavailable",
        ),
    ).toBe(true);
    const userFiltered = await request(
      "GET",
      path("quantity", { actorId: quantityActivity.rows[0]!.actorId }),
    );
    expect(userFiltered.status, diagnostics(userFiltered)).toBe(200);
    const filteredRow = inventoryReportSchema
      .parse(userFiltered.body)
      .rows.find((row) => row.productId === product.id)!;
    expect(filteredRow.cells.closingQuantity).toBe(balance.toString());
    expect(filteredRow.activityCount).toBeLessThanOrEqual(
      quantity.activityCount,
    );
    const ordinary = await request(
      "GET",
      `${inventoryReportPath("quantity")}/export?query=${encodeURIComponent(JSON.stringify(query))}`,
    );
    expect(ordinary.status, diagnostics(ordinary)).toBe(200);
    const exported = inventoryReportExportSchema.parse(ordinary.body);
    expect(exported.rows).toHaveLength(exported.totalRows);
    expect(
      exported.rows.find((row) => row.productId === product.id)?.cells
        .closingValueFils,
    ).toBeUndefined();
    expect(await stockFacts()).toEqual(before);
    for (const kind of INVENTORY_REPORT_KINDS) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        expect(
          (await request(method, inventoryReportPath(kind), {})).status,
        ).toBe(404);
      }
    }
    expect(await stockFacts()).toEqual(before);
  });

  it("reconciles historical cutoffs and keeps inactive-period balances under activity filters", async () => {
    const cutoffs = await administrator.query<{ cutoff: string }>(
      `select to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cutoff
       from posted_purchases where pharmacy_id = $1 order by posted_at, id limit 3`,
      [pharmacyId],
    );
    const from = cutoffs.rows[1]!.cutoff;
    const to = cutoffs.rows[2]!.cutoff;
    const read = async (extra: Record<string, unknown>) => {
      const response = await request(
        "GET",
        `${inventoryReportPath("quantity")}?query=${encodeURIComponent(JSON.stringify({ from, to, ...extra }))}`,
      );
      expect(response.status, diagnostics(response)).toBe(200);
      return inventoryReportSchema
        .parse(response.body)
        .rows.find((row) => row.productId === product.id)!;
    };
    const complete = await read({});
    expect(complete.cells).toMatchObject({
      openingQuantity: "10",
      periodQuantity: "5",
      closingQuantity: "15",
    });
    expect(
      BigInt(complete.cells.openingQuantity!) +
        BigInt(complete.cells.periodQuantity!),
    ).toBe(BigInt(complete.cells.closingQuantity!));
    for (const extra of [
      { actorId: uuidV7() },
      { businessFrom: "1900-01-01", businessTo: "1900-01-01" },
    ]) {
      const filtered = await read(extra);
      expect(filtered.cells.openingQuantity).toBe(
        complete.cells.openingQuantity,
      );
      expect(filtered.cells.closingQuantity).toBe(
        complete.cells.closingQuantity,
      );
      expect(filtered.cells.activityQuantity).toBe("0");
      expect(filtered.activityCount).toBe(0);
    }
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const denied = await request(
      "GET",
      `${inventoryReportPath("quantity")}?query=${encodeURIComponent(JSON.stringify({ from, to: future }))}`,
    );
    expect(denied.status).toBe(400);
    expect(denied.body).toMatchObject({ code: "future-cutoff" });
  });

  it("protects a filtered valuation bundle with owner step-up and query-bound idempotency", async () => {
    const clock = await administrator.query<{ now: Date }>("select now()");
    const query = {
      from: "2020-01-01T00:00:00.000Z",
      to: clock.rows[0]!.now.toISOString(),
    };
    const challenge = await request("POST", "/identity/step-up-challenges", {
      action: "inventory.sensitive.export",
      idempotencyKey: uuidV7(),
    });
    expect(challenge.status, diagnostics(challenge)).toBe(201);
    const challengeId = String((challenge.body as { id?: string }).id ?? "");
    const approved = await request(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approved.status, diagnostics(approved)).toBe(200);
    const command = {
      challengeId,
      idempotencyKey: uuidV7(),
      kind: "value",
      query,
    };
    const first = await request(
      "POST",
      inventoryReportProtectedExportContract.path,
      command,
    );
    expect(first.status, diagnostics(first)).toBe(201);
    const bundle = inventoryReportExportSchema.parse(first.body);
    expect(
      bundle.rows.find((row) => row.productId === product.id)?.cells
        .closingValueFils,
    ).toBe("28800");
    const replay = await request(
      "POST",
      inventoryReportProtectedExportContract.path,
      command,
    );
    expect(replay.status, diagnostics(replay)).toBe(201);
    expect(replay.body).toEqual(first.body);
    const conflict = await request(
      "POST",
      inventoryReportProtectedExportContract.path,
      {
        ...command,
        query: {
          ...query,
          filters: [{ column: "item", operator: "contains", value: "nothing" }],
        },
      },
    );
    expect(conflict.status).toBe(409);
    const reusedChallenge = await request(
      "POST",
      inventoryReportProtectedExportContract.path,
      { ...command, idempotencyKey: uuidV7() },
    );
    expect(reusedChallenge.status).toBe(409);
  });

  it("keeps all stock and posted facts unchanged across every review route", async () => {
    const before = await stockFacts();
    const list = await request("GET", inventoryItemListContract.path);
    const history = await request(
      "GET",
      inventoryMovementHistoryPath(product.id),
    );
    const posted = await request(
      "GET",
      purchasePostedPath(postedPurchaseIds[0]!),
    );
    const preferences = await request("GET", "/inventory/review-preferences");
    expect(list.status).toBe(200);
    expect(history.status).toBe(200);
    expect(posted.status).toBe(200);
    expect(preferences.status).toBe(200);
    const current = preferences.body as InventoryReviewPreferences;
    const update = await request("PUT", "/inventory/review-preferences", {
      columns: current.columns.map((column) =>
        column.field === "risk" ? { ...column, visible: false } : column,
      ),
      expectedRevision: current.revision,
      idempotencyKey: uuidV7(),
    });
    expect(update.status, diagnostics(update)).toBe(200);

    const challenge = await request("POST", "/identity/step-up-challenges", {
      action: "inventory.sensitive.export",
      idempotencyKey: uuidV7(),
    });
    expect(challenge.status, diagnostics(challenge)).toBe(201);
    const challengeId = String((challenge.body as { id?: string }).id ?? "");
    const approved = await request(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approved.status, diagnostics(approved)).toBe(200);
    const exported = await request(
      "POST",
      inventorySensitiveExportContract.path,
      {
        challengeId,
        idempotencyKey: uuidV7(),
      },
    );
    expect(exported.status, diagnostics(exported)).toBe(201);
    const bundle = exported.body as InventorySensitiveExport;
    expect(bundle.valuationMethod).toBe("weighted-average-cost");
    expect(bundle.counts).toMatchObject({
      batches: "3",
      items: "1",
      movements: "5",
    });
    expect(bundle.items[0]?.suppliers).toHaveLength(2);

    expect(await stockFacts()).toEqual(before);
  });

  it("rejects direct and maintenance-adjacent stock writes as the application role", async () => {
    for (const projection of [
      "purchasing_report_sources",
      "inventory_report_facts",
      "identity_report_actors",
    ]) {
      const access = await application.query<{ read: boolean; write: boolean }>(
        `select has_table_privilege(current_user, $1, 'SELECT') as read,
                has_table_privilege(current_user, $1, 'INSERT,UPDATE,DELETE') as write`,
        [projection],
      );
      expect(access.rows[0]).toEqual({ read: true, write: false });
    }
    const movement = await administrator.query<{ id: string }>(
      `select id from inventory_movements
       where pharmacy_id = $1 and product_id = $2 order by occurred_at, id limit 1`,
      [pharmacyId, product.id],
    );
    const batch = await administrator.query<{ id: string }>(
      `select id from inventory_batches
       where pharmacy_id = $1 and product_id = $2 order by id limit 1`,
      [pharmacyId, product.id],
    );
    await expect(
      administrator.query(
        "update inventory_movements set quantity = 1 where id = $1",
        [movement.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query("delete from inventory_movements where id = $1", [
        movement.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        "update inventory_batches set quantity = 1 where id = $1",
        [batch.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query("delete from inventory_batches where id = $1", [
        batch.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      application.query("truncate inventory_movements"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      application.query("alter table inventory_movements disable trigger all"),
    ).rejects.toMatchObject({ code: "42501" });
    const columns = await administrator.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'catalog_products'
         and column_name ~ '(quantity|balance|stock)'`,
    );
    expect(columns.rows).toEqual([]);
  });

  it("returns one complete pre- or post-posting snapshot under concurrent posting", async () => {
    const before = await inventoryItem();
    const draft = await createPostableDraft(
      supplierA.id,
      "REVIEW-CONCURRENT",
      "1",
      "1",
      "LOT-CONCURRENT",
      "2027-03-31",
    );
    const [posting, during] = await Promise.all([
      request("POST", purchaseDraftPostingsPath(draft.id), {
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
      }),
      request("GET", inventoryItemListContract.path),
    ]);
    expect(posting.status, diagnostics(posting)).toBe(201);
    const after = await inventoryItem();
    const observed = (during.body as { items: InventoryItem[] }).items.find(
      ({ productId }) => productId === product.id,
    );
    expect([before.balance, after.balance]).toContain(observed?.balance);
    expect([before.valueFils, after.valueFils]).toContain(observed?.valueFils);
    expect([before.batches.count, after.batches.count]).toContain(
      observed?.batches.count,
    );
  });

  it("introduces a multi-line backdated receipt and its return only at their complete postings", async () => {
    const before = await inventoryItem();
    let draft = await createPostableDraft(
      supplierA.id,
      "MULTI-CUTOFF",
      "1000",
      "4",
      "MULTI-A",
      "2029-01-01",
    );
    const added = await request("POST", purchaseDraftRowsPath(draft.id), {
      costFils: "2000",
      enteredQuantity: "3",
      expectedVersion: draft.version,
      expiryDate: "2029-02-01",
      idempotencyKey: uuidV7(),
      itemId: product.id,
      lotNumber: "MULTI-B",
      notes: null,
      pricing: { method: "by-price", retailPriceFils: "999999" },
      unit: { kind: "inventory-unit" },
    });
    expect(added.status, diagnostics(added)).toBe(201);
    draft = (added.body as { draft: PurchaseDraft }).draft;
    const posted = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(posted.status, diagnostics(posted)).toBe(201);
    const document = (posted.body as PurchasePostResult).posted;
    const boundaries = await administrator.query<{ at: string; after: string }>(
      `select to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
              to_char((posted_at + interval '1 microsecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as after
       from posted_purchases where id = $1`,
      [document.id],
    );
    const { at, after } = boundaries.rows[0]!;
    const read = async (
      kind: "value" | "batches-expiry",
      from: string,
      to: string,
    ) => {
      const response = await request(
        "GET",
        `${inventoryReportPath(kind)}?query=${encodeURIComponent(JSON.stringify({ from, to }))}`,
      );
      expect(response.status, diagnostics(response)).toBe(200);
      return inventoryReportSchema.parse(response.body);
    };
    const value = await read("value", at, after);
    expect(
      value.rows.find((r) => r.productId === product.id)!.cells,
    ).toMatchObject({
      periodQuantity: "7",
      activityQuantity: "7",
      periodValueFils: "10000",
      activityValueFils: "10000",
    });
    const beforeBatches = await read(
      "batches-expiry",
      "2020-01-01T00:00:00Z",
      at,
    );
    expect(
      beforeBatches.rows.some((r) => r.cells.batch?.startsWith("MULTI-")),
    ).toBe(false);
    const afterBatches = await read("batches-expiry", at, after);
    expect(
      afterBatches.rows.filter((r) => r.cells.batch?.startsWith("MULTI-"))
        .length,
    ).toBe(2);
    const activity = await reportActivity("value", value.rows[0]!.id, {
      from: at,
      to: after,
    });
    expect(activity.rows.every((a) => a.businessDate === "2026-06-15")).toBe(
      true,
    );
    const returned = await postPurchaseReturn(document.id, "1");
    expect(returned.posted.rows).toHaveLength(2);
    const returnTimes = await administrator.query<{
      at: string;
      after: string;
    }>(
      `select to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
              to_char((posted_at + interval '1 microsecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as after
       from posted_purchase_returns where id = $1`,
      [returned.posted.id],
    );
    const returnTime = returnTimes.rows[0]!;
    const returnedValue = await read("value", returnTime.at, returnTime.after);
    // Use the independently posted owner position, the frozen receipt, and
    // the return's own carrying allocations, never the report projection.
    const openingQuantity = BigInt(before.balance) + 7n;
    const openingValue = BigInt(before.valueFils!) + 10000n;
    const releasedValue = returned.posted.rows.reduce(
      (sum, row) => sum + BigInt(row.carryingAmountFils),
      0n,
    );
    expect(
      returnedValue.rows.find((r) => r.productId === product.id)!.cells,
    ).toMatchObject({
      openingQuantity: openingQuantity.toString(),
      closingQuantity: (openingQuantity - 2n).toString(),
      periodQuantity: "-2",
      openingValueFils: openingValue.toString(),
      closingValueFils: (openingValue - releasedValue).toString(),
      periodValueFils: (-releasedValue).toString(),
    });
    const returnActivity = await reportActivity("value", value.rows[0]!.id, {
      from: returnTime.at,
      to: returnTime.after,
    });
    expect(returnActivity.rows).toHaveLength(2);
    expect(new Set(returnActivity.rows.map((a) => a.id)).size).toBe(2);
    expect(
      returnActivity.rows.every(
        (a) => a.source?.documentId === returned.posted.id,
      ),
    ).toBe(true);
  });

  it("bounds reports and activity above 250,000 immutable facts, with complete cross-page groups", async () => {
    // Synthetic volume on a disposable database; posting reconciliation uses
    // the separate frozen-document fixtures above. No posting algorithm changes.
    const before = await inventoryItem();
    await administrator.query(
      `insert into inventory_movements
      (pharmacy_id, product_id, batch_id, quantity, carrying_amount_fils, reason,
       source_document_type, source_document_id, source_row_ordinal, created_by)
      select pharmacy_id, product_id, batch_id, 1, 1, reason, source_document_type,
             source_document_id, source_row_ordinal, created_by
      from (select * from inventory_movements where pharmacy_id = $1 and reason = 'purchase-receipt' order by id limit 1) receipt
      cross join generate_series(1, 250001)`,
      [pharmacyId],
    );
    const query = {
      from: "2020-01-01T00:00:00Z",
      to: new Date().toISOString(),
      pageSize: 2,
    };
    const rss = async () =>
      process.platform === "linux"
        ? Number(
            (await readFile(`/proc/${api.pid}/status`, "utf8")).match(
              /VmRSS:\s+(\d+)/u,
            )![1],
          ) * 1024
        : null;
    const memoryBefore = await rss();
    let memoryPeak = memoryBefore;
    let memorySample = Promise.resolve();
    const sampler = setInterval(() => {
      memorySample = memorySample.then(async () => {
        const sample = await rss();
        if (sample !== null)
          memoryPeak = Math.max(memoryPeak ?? sample, sample);
      });
    }, 50);
    const measurements = [];
    try {
      for (const kind of INVENTORY_REPORT_KINDS) {
        const start = performance.now();
        const response = await request(
          "GET",
          `${inventoryReportPath(kind)}?query=${encodeURIComponent(JSON.stringify(query))}`,
        );
        const elapsedMs = performance.now() - start;
        expect(response.status, diagnostics(response)).toBe(200);
        const report = inventoryReportSchema.parse(response.body);
        const responseBytes = Buffer.byteLength(JSON.stringify(response.body));
        measurements.push({ kind, elapsedMs, responseBytes });
        expect(responseBytes).toBeLessThan(32_768);
        expect(report.rows.length).toBeLessThanOrEqual(2);
        expect(elapsedMs).toBeLessThan(10_000);
        if (kind === "quantity")
          expect(report.rows[0]!.cells.closingQuantity).toBe(
            (BigInt(before.balance) + 250001n).toString(),
          );
        if (kind === "consumption")
          expect(report.rows[0]!.cells.consumedQuantity).toBe("0");
      }
    } finally {
      clearInterval(sampler);
      await memorySample;
    }
    const memoryAfter = await rss();
    if (memoryBefore !== null && memoryPeak !== null)
      expect(memoryPeak - memoryBefore).toBeLessThan(64 * 1024 * 1024);
    const artifactPath = path.resolve(
      import.meta.dirname,
      "../../../../artifacts/issue-64",
    );
    await mkdir(artifactPath, { recursive: true });
    await writeFile(
      path.join(artifactPath, "scale.json"),
      JSON.stringify(
        {
          factsAdded: 250001,
          measurements,
          memoryBefore,
          memoryPeak,
          memoryAfter,
        },
        null,
        2,
      ),
    );

    const first = await request(
      "GET",
      `${inventoryReportPath("batches-expiry")}?query=${encodeURIComponent(JSON.stringify({ ...query, groupBy: "item" }))}`,
    );
    const firstPage = inventoryReportSchema.parse(first.body);
    const second = await request(
      "GET",
      `${inventoryReportPath("batches-expiry")}?query=${encodeURIComponent(JSON.stringify({ ...query, groupBy: "item", page: 2 }))}`,
    );
    const secondPage = inventoryReportSchema.parse(second.body);
    expect(
      new Set([...firstPage.rows, ...secondPage.rows].map((r) => r.id)).size,
    ).toBe(4);
    expect(firstPage.groups[0]!.rowIds).toEqual(
      firstPage.rows.map((r) => r.id),
    );
    expect(firstPage.groups[0]!.rowCount).toBe(firstPage.totalRows);
    expect(firstPage.groups[0]!.continuesAfter).toBe(true);
    expect(secondPage.groups[0]!.continuesBefore).toBe(true);
    expect(secondPage.groups[0]!.totals).toEqual(firstPage.groups[0]!.totals);
    const noBatches = await request(
      "GET",
      `${inventoryReportPath("batches-expiry")}?query=${encodeURIComponent(
        JSON.stringify({
          ...query,
          filters: [
            {
              column: "batch",
              operator: "eq",
              value: "NO-MATCHING-HISTORICAL-BATCH",
            },
          ],
        }),
      )}`,
    );
    expect(noBatches.status, diagnostics(noBatches)).toBe(200);
    const emptyBatchReport = inventoryReportSchema.parse(noBatches.body);
    expect(emptyBatchReport.rows).toEqual([]);
    expect(emptyBatchReport.actors).toEqual(firstPage.actors);

    const pages = [];
    for (const page of [1, 2]) {
      const response = await request(
        "GET",
        `${inventoryReportPath("quantity")}/activity?query=${encodeURIComponent(JSON.stringify({ query, rowId: product.id, page, pageSize: 100 }))}`,
      );
      expect(response.status, diagnostics(response)).toBe(200);
      const result = inventoryReportActivityPageSchema.parse(response.body);
      expect(result.rows).toHaveLength(100);
      expect(result.totalRows).toBeGreaterThan(250000);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(100_000);
      const filtered = await request(
        "GET",
        `${inventoryReportPath("quantity")}/activity?query=${encodeURIComponent(
          JSON.stringify({
            query: {
              ...query,
              filters: [
                { column: "closingQuantity", operator: "gte", value: "0" },
              ],
            },
            rowId: product.id,
            page,
            pageSize: 100,
          }),
        )}`,
      );
      expect(filtered.status, diagnostics(filtered)).toBe(200);
      expect(inventoryReportActivityPageSchema.parse(filtered.body)).toEqual(
        result,
      );
      pages.push(result);
    }
    expect(new Set(pages.flatMap((p) => p.rows.map((r) => r.id))).size).toBe(
      200,
    );

    const inactive = await request(
      "GET",
      `${inventoryReportPath("quantity")}?query=${encodeURIComponent(
        JSON.stringify({
          from: query.to,
          to: new Date().toISOString(),
          actorId: uuidV7(),
        }),
      )}`,
    );
    const inactiveRow = inventoryReportSchema.parse(inactive.body).rows[0]!;
    expect(inactiveRow.cells.openingQuantity).toBe(
      (BigInt(before.balance) + 250001n).toString(),
    );
    expect(inactiveRow.activityCount).toBe(0);
    const exported = await request(
      "GET",
      `${inventoryReportPath("batches-expiry")}/export?query=${encodeURIComponent(JSON.stringify(query))}`,
    );
    expect(exported.status, diagnostics(exported)).toBe(200);
    const complete = inventoryReportExportSchema.parse(exported.body);
    expect(complete.rows.length).toBe(complete.totalRows);
    expect(complete.totalRows).toBeGreaterThan(query.pageSize);
    const client = await application.connect();
    try {
      const completeRows = await readInventoryReportPage(
        client,
        pharmacyId,
        "batches-expiry",
        {
          ...inventoryReportQueryFor("batches-expiry").parse(query),
          ...query,
        },
        "2026-09-30",
        true,
        24 * 1024 * 1024,
      );
      const bytes = Buffer.byteLength(JSON.stringify(completeRows.rows));
      const atLimit = await readInventoryReportPage(
        client,
        pharmacyId,
        "batches-expiry",
        {
          ...inventoryReportQueryFor("batches-expiry").parse(query),
          ...query,
        },
        "2026-09-30",
        true,
        bytes,
      );
      expect(atLimit.rows).toEqual(completeRows.rows);
      await expect(
        readInventoryReportPage(
          client,
          pharmacyId,
          "batches-expiry",
          {
            ...inventoryReportQueryFor("batches-expiry").parse(query),
            ...query,
          },
          "2026-09-30",
          true,
          bytes - 1,
        ),
      ).rejects.toBeInstanceOf(InventoryReportExportTooLarge);
      await expect(
        readInventoryReportPage(
          client,
          pharmacyId,
          "batches-expiry",
          {
            ...inventoryReportQueryFor("batches-expiry").parse(query),
            ...query,
          },
          "2026-09-30",
          true,
          100,
        ),
      ).rejects.toBeInstanceOf(InventoryReportExportTooLarge);
    } finally {
      client.release();
    }
  }, 120_000);

  it("keeps duplicate item labels and different units in distinct, exact groups", async () => {
    const from = new Date().toISOString();
    const products = [product];
    for (const unit of ["Strip", "Bottle"]) {
      const input = medicationRequest("Movement Review Item");
      const created = await request("POST", "/catalog/products", {
        ...input,
        packaging: { ...input.packaging, inventoryUnitName: unit },
      });
      expect(created.status, diagnostics(created)).toBe(201);
      products.push(created.body as Product);
    }
    for (const item of products) {
      const draft = await createPostableDraft(
        supplierA.id,
        `GROUP-${item.id}`,
        "1000",
        "1",
        `GROUP-${item.id}`,
        "2029-06-01",
        item.id,
      );
      const posted = await request(
        "POST",
        purchaseDraftPostingsPath(draft.id),
        { expectedVersion: draft.version, idempotencyKey: uuidV7() },
      );
      expect(posted.status, diagnostics(posted)).toBe(201);
    }
    const query = {
      from,
      to: new Date().toISOString(),
      groupBy: "item",
      pageSize: 1,
    };
    const groups = [];
    const rowIds = [];
    for (const page of [1, 2, 3]) {
      const response = await request(
        "GET",
        `${inventoryReportPath("value")}?query=${encodeURIComponent(JSON.stringify({ ...query, page }))}`,
      );
      expect(response.status, diagnostics(response)).toBe(200);
      const report = inventoryReportSchema.parse(response.body);
      expect(report.totalRows).toBe(3);
      expect(report.groups).toHaveLength(1);
      const group = report.groups[0]!;
      expect(group.rowIds).toEqual(report.rows.map((r) => r.id));
      expect(group.rowCount).toBe(1);
      expect(group.totals).toEqual({
        activityQuantity: "1",
        activityValueFils: "1000",
      });
      expect(group.continuesBefore || group.continuesAfter).toBe(false);
      expect(group.item).toBe(product.displayName);
      groups.push(group);
      rowIds.push(report.rows[0]!.id);
    }
    expect(new Set(rowIds).size).toBe(3);
    expect(new Set(groups.map((g) => g.id)).size).toBe(3);
    expect(new Set(groups.map((g) => g.productId)).size).toBe(3);
    expect(groups.map((g) => g.unit).sort()).toEqual([
      "Bottle",
      "Strip",
      "Strip",
    ]);

    const batches = await administrator.query<{ id: string }>(
      "select id from inventory_batches where pharmacy_id = $1 and product_id = $2 order by id",
      [pharmacyId, products[1]!.id],
    );
    const batchId = batches.rows[0]!.id;
    const challenge = await request("POST", "/identity/step-up-challenges", {
      action: "inventory.batch_expiry.correct",
      subjectId: batchId,
      idempotencyKey: uuidV7(),
    });
    expect(challenge.status, diagnostics(challenge)).toBe(201);
    const challengeId = (challenge.body as { id: string }).id;
    const approval = await request(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      {
        idempotencyKey: uuidV7(),
        password: OWNER_PASSWORD,
      },
    );
    expect(approval.status, diagnostics(approval)).toBe(200);
    const correction = await request(
      "POST",
      `/inventory/batches/${batchId}/expiry-corrections`,
      {
        challengeId,
        correctedExpiryDate: "2030-06-01",
        reason: "Supplier expiry correction",
        evidence: "Frozen supplier correction fixture",
        idempotencyKey: uuidV7(),
      },
    );
    expect(correction.status, diagnostics(correction)).toBe(201);
    const recall = await request(
      "POST",
      `/inventory/batches/${batchId}/status-changes`,
      {
        kind: "recall",
        reason: "Supplier recall",
        evidence: "Frozen supplier notice",
        idempotencyKey: uuidV7(),
      },
    );
    expect(recall.status, diagnostics(recall)).toBe(201);
    const transitions = await administrator.query<{
      at: string;
      after: string;
      type: string;
    }>(
      `select to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
              to_char((occurred_at + interval '1 microsecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as after, type
       from (select occurred_at, 'expiry' as type from inventory_batch_expiry_amendments where batch_id = $1
             union all select occurred_at, 'recall' from inventory_batch_status_events where batch_id = $1 and kind = 'recalled') event
       order by occurred_at`,
      [batchId],
    );
    const beforeFacts = await stockFacts();
    for (const transition of transitions.rows) {
      for (const to of [transition.at, transition.after]) {
        const response = await request(
          "GET",
          `${inventoryReportPath("batches-expiry")}?query=${encodeURIComponent(
            JSON.stringify({
              from,
              to,
              pageSize: 100,
              filters: [
                {
                  column: "batch",
                  operator: "eq",
                  value: `GROUP-${products[1]!.id}`,
                },
              ],
            }),
          )}`,
        );
        expect(response.status, diagnostics(response)).toBe(200);
        const row = inventoryReportSchema.parse(response.body).rows[0]!;
        expect(row.cells.expiry).toBe(
          transition.type === "expiry" && to === transition.at
            ? "2029-06-01"
            : "2030-06-01",
        );
        expect(row.cells.status).toBe(
          transition.type === "recall" && to === transition.after
            ? "recalled"
            : "eligible",
        );
        expect(row.cells.closingQuantity).toBe("1");
      }
    }
    expect(await stockFacts()).toEqual(beforeFacts);
  }, 120_000);

  it("rejects an actual oversized export while retaining bounded ordinary pages", async () => {
    // Disposable synthetic sizing fixture, separate from posting reconciliation.
    await administrator.query(
      `with receipt as (
      select * from inventory_movements where pharmacy_id = $1 and reason = 'purchase-receipt' order by id limit 1
    ), batches as (
      insert into inventory_batches (pharmacy_id, product_id, lot_number, expiry_date, quantity, created_by)
      select pharmacy_id, product_id, 'OVERSIZE-' || lpad(number::text, 110, '0'), '2030-01-01', 1, created_by
      from receipt cross join generate_series(1, 50000) number returning id, pharmacy_id, product_id
    ) insert into inventory_movements (pharmacy_id, product_id, batch_id, quantity, carrying_amount_fils,
      reason, source_document_type, source_document_id, source_row_ordinal, created_by)
      select batch.pharmacy_id, batch.product_id, batch.id, 1, 1, receipt.reason, receipt.source_document_type,
             receipt.source_document_id, receipt.source_row_ordinal, receipt.created_by
      from batches batch cross join receipt`,
      [pharmacyId],
    );
    const query = {
      from: "2020-01-01T00:00:00Z",
      to: new Date().toISOString(),
      pageSize: 100,
      filters: [{ column: "batch", operator: "contains", value: "OVERSIZE-" }],
    };
    const before = await stockFacts();
    const viewed = await request(
      "GET",
      `${inventoryReportPath("batches-expiry")}?query=${encodeURIComponent(JSON.stringify(query))}`,
    );
    expect(viewed.status, diagnostics(viewed)).toBe(200);
    const report = inventoryReportSchema.parse(viewed.body);
    expect(report.totalRows).toBe(50000);
    expect(report.rows).toHaveLength(100);
    expect(Buffer.byteLength(JSON.stringify(viewed.body))).toBeLessThan(
      128 * 1024,
    );
    // Both requests must fail at the cheap pre-check under concurrent load,
    // rather than occupying connections until the 10-second SQL timeout.
    const exportDenialTimes = await Promise.all(
      Array.from({ length: 2 }, async () => {
        const exportStarted = performance.now();
        const exported = await request(
          "GET",
          `${inventoryReportPath("batches-expiry")}/export?query=${encodeURIComponent(JSON.stringify(query))}`,
        );
        expect(exported.status, diagnostics(exported)).toBe(413);
        expect(exported.body).toMatchObject({
          status: "denied",
          code: "export-too-large",
        });
        expect(exported.body).not.toHaveProperty("rows");
        const elapsed = performance.now() - exportStarted;
        expect(elapsed).toBeLessThan(5_000);
        expect(Buffer.byteLength(JSON.stringify(exported.body))).toBeLessThan(
          1024,
        );
        return elapsed;
      }),
    );
    const exportDenialMs = Math.max(...exportDenialTimes);
    const normalPageStarted = performance.now();
    const normalPage = await request(
      "GET",
      `${inventoryReportPath("quantity")}?query=${encodeURIComponent(
        JSON.stringify({ from: query.from, to: query.to, pageSize: 100 }),
      )}`,
    );
    expect(normalPage.status, diagnostics(normalPage)).toBe(200);
    expect(
      inventoryReportSchema.parse(normalPage.body).rows.length,
    ).toBeGreaterThan(0);
    const normalPageMs = performance.now() - normalPageStarted;
    expect(normalPageMs).toBeLessThan(5_000);
    const afterDenialStarted = performance.now();
    const afterDenial = await request(
      "GET",
      `${inventoryReportPath("batches-expiry")}?query=${encodeURIComponent(JSON.stringify(query))}`,
    );
    expect(afterDenial.status, diagnostics(afterDenial)).toBe(200);
    expect(inventoryReportSchema.parse(afterDenial.body).rows).toHaveLength(
      100,
    );
    const afterDenialMs = performance.now() - afterDenialStarted;
    if (process.env.BREEV_REPORT_PERFORMANCE_LABEL) {
      // Benchmark saturated history with current planner statistics. The cold
      // concurrent export and recovery assertions above run before this step.
      for (const table of [
        "inventory_movements",
        "inventory_batches",
        "inventory_value_effects",
      ])
        await administrator.query(`analyze ${table}`);
      const period = {
        from: "2020-01-01T00:00:00Z",
        to: query.to,
        pageSize: 100,
      };
      const scenarios = [
        {
          name: "movement-activity",
          path: `${inventoryReportPath("quantity")}/activity`,
          query: { query: period, rowId: product.id, page: 1, pageSize: 100 },
        },
        {
          name: "historical-value",
          path: inventoryReportPath("value"),
          query: period,
        },
        {
          name: "batch-history",
          path: inventoryReportPath("batches-expiry"),
          query: period,
        },
      ];
      const measurements = [];
      const sqlMeasurements = [];
      const plans: Record<string, unknown> = {};
      for (const scenario of scenarios) {
        const samples = [];
        for (let sample = 0; sample < 20; sample++) {
          const start = performance.now();
          const response = await request(
            "GET",
            `${scenario.path}?query=${encodeURIComponent(JSON.stringify(scenario.query))}`,
          );
          expect(response.status, diagnostics(response)).toBe(200);
          samples.push(performance.now() - start);
        }
        const sorted = [...samples].sort((a, b) => a - b);
        measurements.push({
          name: scenario.name,
          samples,
          p95: sorted[18],
          p99: sorted[19],
        });
        const client = await application.connect();
        try {
          await client.query("begin read only");
          await client.query("set local enable_nestloop = off");
          await client.query("set local jit = off");
          let statement: string | undefined;
          let values: unknown[] | undefined;
          const observed = new Proxy(client, {
            get(target, property) {
              if (property !== "query") return Reflect.get(target, property);
              return (...arguments_: unknown[]) => {
                if (
                  typeof arguments_[0] === "string" &&
                  arguments_[0].startsWith("with report_date")
                ) {
                  statement = arguments_[0];
                  values = arguments_[1] as unknown[];
                }
                return Reflect.apply(target.query, target, arguments_);
              };
            },
          }) as PoolClient;
          const kind =
            scenario.name === "historical-value"
              ? "value"
              : scenario.name === "batch-history"
                ? "batches-expiry"
                : "quantity";
          const canonical = {
            ...inventoryReportQueryFor(kind).parse(period),
            ...period,
          };
          if (scenario.name === "movement-activity")
            await readInventoryReportActivity(
              observed,
              pharmacyId,
              kind,
              canonical,
              "2026-10-01",
              product.id,
              1,
              100,
            );
          else
            await readInventoryReportPage(
              observed,
              pharmacyId,
              kind,
              canonical,
              "2026-10-01",
              false,
              24 * 1024 * 1024,
            );
          const sqlSamples: number[] = [];
          for (let sample = 0; sample < 20; sample++) {
            const plan = (
              await client.query(
                `explain (analyze, buffers, format json) ${statement!}`,
                values,
              )
            ).rows[0]["QUERY PLAN"];
            sqlSamples.push(plan[0]["Execution Time"] as number);
            plans[scenario.name] = plan;
          }
          const sortedSql = [...sqlSamples].sort((a, b) => a - b);
          sqlMeasurements.push({
            name: scenario.name,
            samples: sqlSamples,
            p95: sortedSql[18]!,
            p99: sortedSql[19]!,
          });
          await client.query("rollback");
        } finally {
          client.release();
        }
      }
      const directory = path.resolve(
        import.meta.dirname,
        "../../../../artifacts/issue-64",
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(
          directory,
          `performance-${process.env.BREEV_REPORT_PERFORMANCE_LABEL}.json`,
        ),
        JSON.stringify(
          {
            platform: process.platform,
            samples: 20,
            facts: (
              await administrator.query(
                "select count(*)::integer as count from inventory_report_facts",
              )
            ).rows[0].count,
            measurements,
            sqlMeasurements,
            exportDenialMs,
            exportDenialTimes,
            afterDenialMs,
            normalPageMs,
          },
          null,
          2,
        ),
      );
      await writeFile(
        path.join(
          directory,
          `plans-${process.env.BREEV_REPORT_PERFORMANCE_LABEL}.json`,
        ),
        JSON.stringify(plans, null, 2),
      );
      for (const measurement of sqlMeasurements)
        if (measurement.name !== "batch-history")
          expect(measurement.p95, measurement.name).toBeLessThanOrEqual(300);
    }
    expect(await stockFacts()).toEqual(before);
  }, 300_000);

  async function reportActivity(
    kind: (typeof INVENTORY_REPORT_KINDS)[number],
    rowId: string,
    query: unknown,
  ) {
    const response = await request(
      "GET",
      `${inventoryReportPath(kind)}/activity?query=${encodeURIComponent(JSON.stringify({ query, rowId }))}`,
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return inventoryReportActivityPageSchema.parse(response.body);
  }
  async function inventoryItem(): Promise<InventoryItem> {
    const response = await request("GET", inventoryItemListContract.path);
    expect(response.status, diagnostics(response)).toBe(200);
    const item = (response.body as { items: InventoryItem[] }).items.find(
      ({ productId }) => productId === product.id,
    );
    if (item === undefined) throw new Error("Inventory fixture item missing");
    return item;
  }

  async function stockFacts(): Promise<
    Record<string, { count: string; digest: string }>
  > {
    const tables = [
      ["inventory_movements", "id"],
      ["inventory_value_effects", "id"],
      ["inventory_batches", "id"],
      ["inventory_valuation_state", "product_id"],
      ["posted_purchases", "id"],
      ["posted_purchase_rows", "id"],
      ["posted_purchase_adjustments", "id"],
      ["posted_purchase_adjustment_rows", "id"],
      ["posted_purchase_returns", "id"],
      ["posted_purchase_return_rows", "id"],
      ["inventory_batch_status_events", "id"],
      ["inventory_batch_expiry_amendments", "id"],
      ["inventory_count_sessions", "id"],
      ["inventory_count_lines", "id"],
      ["inventory_count_variance_applications", "id"],
      ["accounting_journal_entries", "id"],
      ["accounting_journal_lines", "id"],
    ] as const;
    const result: Record<string, { count: string; digest: string }> = {};
    for (const [table, orderColumn] of tables) {
      const query = await administrator.query<{
        count: string;
        digest: string;
      }>(
        `select count(*)::text as count,
                md5(coalesce(string_agg(to_jsonb(record_row)::text, '|' order by record_row.${orderColumn}), '')) as digest
         from ${table} record_row where record_row.pharmacy_id = $1`,
        [pharmacyId],
      );
      result[table] = query.rows[0]!;
    }
    return result;
  }

  async function createSupplier(
    name: string,
    percentage: string,
  ): Promise<Supplier> {
    const response = await request("POST", "/suppliers", {
      allowanceEffectiveFrom: "2026-01-01",
      defaultAllowancePercentage: percentage,
      idempotencyKey: uuidV7(),
      name,
      terms: "Net 30",
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as Supplier;
  }

  async function postPurchase(
    supplierId: string,
    invoice: string,
    costFils: string,
    quantity: string,
    lotNumber: string,
    expiryDate: string,
  ): Promise<void> {
    const draft = await createPostableDraft(
      supplierId,
      invoice,
      costFils,
      quantity,
      lotNumber,
      expiryDate,
    );
    const response = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      {
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
    postedPurchaseIds.push(
      String(
        ((response.body as PurchasePostResult).posted as { id?: string }).id ??
          "",
      ),
    );
  }

  async function postPurchaseReturn(
    originalPurchaseId: string,
    quantity: string,
  ): Promise<PurchaseReturnPostResult> {
    const created = await request(
      "POST",
      purchaseReturnDraftsPath(originalPurchaseId),
      {
        evidence: "Supplier collection note",
        idempotencyKey: uuidV7(),
        reason: "Supplier accepted returned stock",
      },
    );
    expect(created.status, diagnostics(created)).toBe(201);
    const draft = created.body as PurchaseReturnDraft;
    const savedResponse = await request(
      "PUT",
      purchaseReturnDraftPath(draft.id),
      {
        evidence: draft.evidence,
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
        reason: draft.reason,
        rows: draft.rows.map((row) => ({
          originalPurchaseRowId: row.originalPurchaseRowId,
          returnQuantity: quantity,
        })),
      },
    );
    expect(savedResponse.status, diagnostics(savedResponse)).toBe(200);
    const saved = savedResponse.body as PurchaseReturnDraft;
    const summaryResponse = await request(
      "GET",
      purchaseReturnSummaryPath(saved.id),
    );
    expect(summaryResponse.status, diagnostics(summaryResponse)).toBe(200);
    const summary = summaryResponse.body as PurchaseReturnSummary;
    const challenge = await request("POST", "/identity/step-up-challenges", {
      action: "purchase.return.post",
      idempotencyKey: uuidV7(),
      subjectId: saved.id,
    });
    expect(challenge.status, diagnostics(challenge)).toBe(201);
    const challengeId = String((challenge.body as { id?: string }).id ?? "");
    const approved = await request(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approved.status, diagnostics(approved)).toBe(200);
    const response = await request(
      "POST",
      purchaseReturnPostingsPath(saved.id),
      {
        confirmationHash: summary.confirmationHash,
        expectedVersion: saved.version,
        idempotencyKey: uuidV7(),
        stepUpChallengeId: challengeId,
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as PurchaseReturnPostResult;
  }

  async function createAdjustmentDraft(
    originalPurchaseId: string,
    reason:
      | "quantity error"
      | "price error"
      | "invoice-number error"
      | "supplier error"
      | "other",
  ): Promise<PurchaseAdjustmentDraft> {
    const response = await request(
      "POST",
      purchaseAdjustmentDraftsPath(originalPurchaseId),
      {
        evidence: "Supplier invoice checked",
        idempotencyKey: uuidV7(),
        reason,
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as PurchaseAdjustmentDraft;
  }

  async function saveAdjustmentDraft(
    draft: PurchaseAdjustmentDraft,
    edit: (
      rows: ReturnType<typeof adjustmentRows>,
    ) => ReturnType<typeof adjustmentRows>,
  ): Promise<PurchaseAdjustmentDraft> {
    const response = await request(
      "PUT",
      purchaseAdjustmentDraftPath(draft.id),
      adjustmentUpdateBody(draft, edit(adjustmentRows(draft))),
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as PurchaseAdjustmentDraft;
  }

  async function previewAdjustment(
    draft: PurchaseAdjustmentDraft,
  ): Promise<PurchaseAdjustmentSummary> {
    const response = await request(
      "GET",
      purchaseAdjustmentSummaryPath(draft.id),
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as PurchaseAdjustmentSummary;
  }

  async function postAdjustment(
    draft: PurchaseAdjustmentDraft,
    summary: PurchaseAdjustmentSummary,
  ): Promise<PurchaseAdjustmentPostResult> {
    const response = await request(
      "POST",
      purchaseAdjustmentPostingsPath(draft.id),
      {
        confirmationHash: summary.confirmationHash,
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as PurchaseAdjustmentPostResult;
  }

  async function createPostableDraft(
    supplierId: string,
    invoice: string,
    costFils: string,
    quantity: string,
    lotNumber: string,
    expiryDate: string,
    itemId = product.id,
  ): Promise<PurchaseDraft> {
    const created = await request("POST", "/purchases/drafts", {
      invoiceOffer: { mode: "none", value: "0" },
      idempotencyKey: uuidV7(),
      invoiceDate: "2026-06-15",
      settlementContext: "debt",
      supplierId,
      supplierInvoiceNumber: invoice,
    });
    expect(created.status, diagnostics(created)).toBe(201);
    let draft = (created.body as { draft: PurchaseDraft }).draft;
    const row = await request("POST", purchaseDraftRowsPath(draft.id), {
      costFils,
      enteredQuantity: quantity,
      expectedVersion: draft.version,
      expiryDate,
      idempotencyKey: uuidV7(),
      itemId,
      lotNumber,
      notes: null,
      pricing: { method: "by-price", retailPriceFils: "999999" },
      unit: { kind: "inventory-unit" },
    });
    expect(row.status, diagnostics(row)).toBe(201);
    draft = (row.body as { draft: PurchaseDraft }).draft;
    return draft;
  }

  function startApi(): ChildProcessWithoutNullStreams {
    const child = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../dist/main.js")],
      {
        env: {
          ...process.env,
          API_HOST: "127.0.0.1",
          API_PORT: String(apiPort),
          BREEV_MAIN_DEVICE_ID: credentials.deviceId,
          BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
          BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
          DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
          DATABASE_URL: databaseRoles.applicationUrl,
          HTTPS_PROXY: "http://127.0.0.1:1",
          HTTP_PROXY: "http://127.0.0.1:1",
        },
      },
    );
    child.stdout.on("data", (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });
    return child;
  }

  async function request(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: headers(body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
      status: response.status,
    };
  }

  function diagnostics(response: ApiResponse): string {
    return `${apiOutput}\n${JSON.stringify(response)}`;
  }

  function headers(json: boolean): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: `Breev-Device ${credentials.deviceSecret}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
      [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
      [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
      [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
      Origin: "breev://app",
    };
  }
});

function adjustmentRows(draft: PurchaseAdjustmentDraft) {
  return draft.rows.map((row) => ({
    costFils: row.costFils,
    enteredQuantity: row.enteredQuantity,
    expiryDate: row.expiryDate,
    itemId: row.itemId,
    lineageId: row.lineageId,
    lotNumber: row.lotNumber,
    notes: row.notes,
    originalRowId: row.originalRowId,
    pricing:
      row.pricingMethod === "by-price"
        ? ({
            method: "by-price",
            retailPriceFils: row.retailPriceFils,
          } as const)
        : ({
            marginPercentage: row.marginPercentage ?? "0",
            method: "by-percentage",
          } as const),
    unit: row.unit,
  }));
}

function adjustmentUpdateBody(
  draft: PurchaseAdjustmentDraft,
  rows: ReturnType<typeof adjustmentRows>,
) {
  return {
    invoiceOffer: draft.invoiceOffer,
    evidence: draft.evidence,
    expectedVersion: draft.version,
    idempotencyKey: uuidV7(),
    reason: draft.reason,
    rows,
    supplierId: draft.supplierId,
    supplierInvoiceNumber: draft.supplierInvoiceNumber,
  };
}

function medicationRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "مراجعة المخزون",
    barcodes: [
      { kind: "product", value: randomBytes(6).toString("hex").slice(0, 13) },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName,
      },
      mode: "medication",
    },
    idempotencyKey: uuidV7(),
    instructions: {
      foodTiming: "after-food",
      usesPerDay: 3,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    packaging: {
      defaultUnits: {
        count: { kind: "inventory-unit" },
        purchase: { kind: "inventory-unit" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Strip",
      packageUnits: [],
      thirdUnit: null,
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: "90000",
    },
    scientificName: "Paracetamol",
    supplierIds: [],
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: null },
    stockLevels: { maximumLevel: "30", minimumLevel: "20", reorderPoint: "17" },
  };
}

function createCredentials(): Credentials {
  return {
    deviceId: uuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function uuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function waitForHealth(
  origin: string,
  diagnostics: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).status === 200) return;
    } catch {
      // The compiled API has not opened its loopback listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local API did not start\n${diagnostics()}`);
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a port"));
      } else {
        resolve(address.port);
      }
    });
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
