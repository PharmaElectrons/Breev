import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  purchaseAdjustmentDraftPath,
  purchaseAdjustmentDraftsPath,
  purchaseAdjustmentPostingsPath,
  purchaseAdjustmentSummaryPath,
  purchaseReturnDraftPath,
  purchaseReturnDraftsPath,
  purchaseReturnPostingsPath,
  purchaseReturnSummaryPath,
  purchaseDraftDiscardPath,
  purchaseDraftHeaderPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentPostResult,
  type PurchaseAdjustmentSummary,
  type PurchaseReturnDraft,
  type PurchaseReturnPostResult,
  type PurchaseReturnSummary,
  type PurchasePostResult,
  type PurchasePostedDetail,
  type PurchasePostedListResponse,
  type Supplier,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "posting.owner";
const OWNER_PASSWORD = "posting owner password stays in this test";
interface Credentials {
  deviceId: string;
  deviceSecret: string;
  sessionToken: string;
}
interface ApiResponse {
  body: Record<string, unknown> | undefined;
  status: number;
}
interface DraftRowInput {
  costFils: string;
  enteredQuantity: string;
  itemId: string;
  lotNumber?: string | null;
  retailPriceFils?: string;
}

describe.sequential("Purchase posting PostgreSQL seam", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId = "";
  let supplierLow: Supplier;
  let productMain: Product;

  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    credentials = createCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    expect(
      (
        await request("POST", "/identity/bootstrap", {
          owner: {
            displayName: "Posting Owner",
            password: OWNER_PASSWORD,
            username: OWNER_USERNAME,
          },
          pharmacyName: "Breev Posting Test Pharmacy",
        })
      ).status,
    ).toBe(201);
    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.status).toBe(200);
    pharmacyId = String(
      (login.body?.pharmacy as { id?: string } | undefined)?.id ?? "",
    );

    const supplierResponse = await request(
      "POST",
      "/suppliers",
      supplierBody("Al-Furat", "10", "2026-01-01"),
    );
    expect(supplierResponse.status, diagnostics(supplierResponse)).toBe(201);
    supplierLow = supplierResponse.body as unknown as Supplier;

    const productResponse = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Posting Main", false),
    );
    expect(productResponse.status, diagnostics(productResponse)).toBe(201);
    productMain = productResponse.body as unknown as Product;
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("posts a debt purchase atomically with document, snapshots, batch, movement, gross WAC, gross AP, and a balanced journal", async () => {
    const draft = await createPostableDraft(supplierLow.id, "INV-P1", "debt", [
      { costFils: "1000", enteredQuantity: "10", itemId: productMain.id },
    ]);
    const idempotencyKey = uuidV7();

    const posted = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey,
    });
    expect(posted.status, diagnostics(posted)).toBe(201);
    const result = posted.body as unknown as PurchasePostResult;
    expect(result.warnings).toEqual([]);
    expect(result.posted).toMatchObject({
      allowanceFils: "1000",
      costAfterDiscountFils: "9000",
      draftId: draft.id,
      primarySupplierCostFils: "10000",
      settlementContext: "debt",
      settlementEffect: { context: "debt", payableFils: "10000" },
      supplierId: supplierLow.id,
    });
    expect(result.posted.number).toMatchObject({ series: "P", value: "1" });
    expect(result.posted.journal.lines).toHaveLength(2);
    const debitTotal = result.posted.journal.lines
      .filter((line) => line.debitFils !== "0")
      .reduce((sum, line) => sum + BigInt(line.debitFils), 0n);
    const creditTotal = result.posted.journal.lines
      .filter((line) => line.creditFils !== "0")
      .reduce((sum, line) => sum + BigInt(line.creditFils), 0n);
    expect(debitTotal).toBe(10_000n);
    expect(creditTotal).toBe(10_000n);
    expect(
      result.posted.journal.lines.find(
        (line) => line.accountCode === "supplier-payable",
      ),
    ).toMatchObject({ creditFils: "10000", supplierId: supplierLow.id });
    expect(result.posted.rows).toHaveLength(1);
    const row = result.posted.rows[0]!;
    expect(row.linePrimarySupplierCostFils).toBe("10000");
    expect(row.batchId).toBeTruthy();
    expect(row.movementId).toBeTruthy();

    const propagatedPrice = await administrator.query<{
      retail_price_fils: string;
    }>(
      `select retail_price_fils::text from catalog_products
       where pharmacy_id = $1 and id = $2`,
      [pharmacyId, productMain.id],
    );
    expect(propagatedPrice.rows[0]?.retail_price_fils).toBe("999999");

    const draftRow = await administrator.query<{
      status: string;
      version: string;
    }>(`select status, version::text from purchase_drafts where id = $1`, [
      draft.id,
    ]);
    expect(draftRow.rows[0]).toMatchObject({ status: "posted" });

    const batch = await administrator.query<{
      product_id: string;
      quantity: string;
    }>(
      `select product_id, quantity::text from inventory_batches where id = $1`,
      [row.batchId],
    );
    expect(batch.rows[0]).toMatchObject({
      product_id: productMain.id,
      quantity: "10",
    });

    const movement = await administrator.query<{
      carrying_amount_fils: string;
      quantity: string;
      reason: string;
      source_document_id: string;
    }>(
      `select reason, quantity::text, carrying_amount_fils::text, source_document_id::text
       from inventory_movements where id = $1`,
      [row.movementId],
    );
    expect(movement.rows[0]).toMatchObject({
      carrying_amount_fils: "10000",
      quantity: "10",
      reason: "purchase-receipt",
      source_document_id: result.posted.id,
    });

    const valuation = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      `select total_quantity::text, total_value_scaled::text
       from inventory_valuation_state where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, productMain.id],
    );
    expect(valuation.rows[0]).toMatchObject({
      total_quantity: "10",
      total_value_scaled: (10_000n * 10_000_000_000n).toString(),
    });

    const supplierBalance = await administrator.query<{
      balance_fils: string;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    expect(supplierBalance.rows[0]).toMatchObject({ balance_fils: "10000" });

    const cashBox = await administrator.query(
      `select 1 from accounting_cash_box_balances where pharmacy_id = $1`,
      [pharmacyId],
    );
    expect(cashBox.rowCount).toBe(0);

    const allocation = await administrator.query<{
      document_id: string;
      status: string;
      value: string;
    }>(
      `select status, value::text, document_id::text
       from posting_number_allocations
       where pharmacy_id = $1 and document_type = 'purchase-invoice' and correlation_id = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(allocation.rows[0]).toMatchObject({
      document_id: result.posted.id,
      status: "issued",
      value: "1",
    });

    const audit = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where pharmacy_id = $1 and action = 'purchase.post'
         and outcome = 'committed' and target_id = $2`,
      [pharmacyId, result.posted.id],
    );
    expect(audit.rows[0]?.count).toBe("1");

    const commandResult = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
       where pharmacy_id = $1 and command_name = 'purchase.post' and idempotency_key = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(commandResult.rows[0]?.count).toBe("1");

    const outbox = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_outbox_entries
       where pharmacy_id = $1 and event_type = 'purchase.invoice.posted'
         and envelope_version = 1 and correlation_id = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(outbox.rows[0]?.count).toBe("1");

    await expect(
      administrator.query(
        `update posted_purchases set primary_supplier_cost_fils = 1 where id = $1`,
        [result.posted.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(`delete from posted_purchases where id = $1`, [
        result.posted.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        `update posted_purchase_rows set notes = 'rewritten' where id = $1`,
        [row.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(`delete from posted_purchase_rows where id = $1`, [
        row.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        `update inventory_batches set quantity = 1 where id = $1`,
        [row.batchId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(`delete from inventory_batches where id = $1`, [
        row.batchId,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        `update inventory_movements set quantity = 1 where id = $1`,
        [row.movementId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(`delete from inventory_movements where id = $1`, [
        row.movementId,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        `update accounting_journal_entries set template_version = 2 where id = $1`,
        [result.posted.journal.entryId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        `delete from accounting_journal_entries where id = $1`,
        [result.posted.journal.entryId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        `delete from accounting_journal_lines where entry_id = $1`,
        [result.posted.journal.entryId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        `update accounting_journal_lines set debit_fils = 1 where entry_id = $1`,
        [result.posted.journal.entryId],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    const stale = await request("PUT", purchaseDraftHeaderPath(draft.id), {
      ...draftBody(supplierLow.id, "INV-P1-EDIT", draft.invoiceDate),
      expectedVersion: draftRow.rows[0]!.version,
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { code: "draft-posted" },
    });
    const discardAttempt = await request(
      "POST",
      purchaseDraftDiscardPath(draft.id),
      {
        confirmation: "discard-populated-purchase-draft",
        expectedVersion: draftRow.rows[0]!.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(discardAttempt).toMatchObject({
      status: 409,
      body: { code: "draft-posted" },
    });
    const rowCommitAttempt = await request(
      "POST",
      purchaseDraftRowsPath(draft.id),
      {
        costFils: "1",
        enteredQuantity: "1",
        expectedVersion: draftRow.rows[0]!.version,
        expiryDate: "2029-01-01",
        idempotencyKey: uuidV7(),
        itemId: productMain.id,
        lotNumber: null,
        notes: null,
        pricing: { method: "by-price", retailPriceFils: "1" },
        unit: { kind: "inventory-unit" },
      },
    );
    expect(rowCommitAttempt).toMatchObject({
      status: 409,
      body: { code: "draft-posted" },
    });
    const repostAttempt = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      {
        expectedVersion: draftRow.rows[0]!.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(repostAttempt).toMatchObject({
      status: 409,
      body: { code: "draft-posted" },
    });
  });

  it("searches stable posted numbers and reads immutable snapshots separately from current master records", async () => {
    const supplierResponse = await request(
      "POST",
      "/suppliers",
      supplierBody("Review Snapshot Supplier", "10", "2026-01-01"),
    );
    expect(supplierResponse.status, diagnostics(supplierResponse)).toBe(201);
    const supplier = supplierResponse.body as unknown as Supplier;
    const productResponse = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Review Snapshot Item", false),
    );
    expect(productResponse.status, diagnostics(productResponse)).toBe(201);
    const product = productResponse.body as unknown as Product;

    const firstDraft = await createPostableDraft(
      supplier.id,
      "INV-REVIEW-STABLE-A",
      "debt",
      [{ costFils: "1200", enteredQuantity: "2", itemId: product.id }],
    );
    const firstResponse = await request(
      "POST",
      purchaseDraftPostingsPath(firstDraft.id),
      { expectedVersion: firstDraft.version, idempotencyKey: uuidV7() },
    );
    expect(firstResponse.status, diagnostics(firstResponse)).toBe(201);
    const first = (firstResponse.body as unknown as PurchasePostResult).posted;

    const secondDraft = await createPostableDraft(
      supplier.id,
      "INV-REVIEW-STABLE-B",
      "debt",
      [{ costFils: "1000", enteredQuantity: "1", itemId: product.id }],
    );
    const secondResponse = await request(
      "POST",
      purchaseDraftPostingsPath(secondDraft.id),
      { expectedVersion: secondDraft.version, idempotencyKey: uuidV7() },
    );
    expect(secondResponse.status, diagnostics(secondResponse)).toBe(201);
    const second = (secondResponse.body as unknown as PurchasePostResult)
      .posted;

    const baselineDetailResponse = await request(
      "GET",
      `/purchases/posted/${first.id}`,
    );
    expect(
      baselineDetailResponse.status,
      diagnostics(baselineDetailResponse),
    ).toBe(200);
    const baselineDetail =
      baselineDetailResponse.body as unknown as PurchasePostedDetail;

    await administrator.query(
      `update suppliers set name = 'Current Supplier Changed', revision = revision + 1
       where pharmacy_id = $1 and id = $2`,
      [pharmacyId, supplier.id],
    );
    await administrator.query(
      `update catalog_products
       set display_name = 'Current Item Changed', retail_price_fils = 333333,
           revision = revision + 1
       where pharmacy_id = $1 and id = $2`,
      [pharmacyId, product.id],
    );
    await administrator.query(
      `insert into supplier_allowance_rates (
         pharmacy_id, supplier_id, effective_from, allowance_percentage, recorded_by
       )
       select pharmacy_id, id, '2026-09-01', 22.5, created_by
       from suppliers where pharmacy_id = $1 and id = $2`,
      [pharmacyId, supplier.id],
    );

    const registerResponse = await request(
      "GET",
      "/purchases/posted?query=REVIEW-STABLE&from=2026-06-15&to=2026-06-15&sort=number&direction=ascending",
    );
    expect(registerResponse.status, diagnostics(registerResponse)).toBe(200);
    const register =
      registerResponse.body as unknown as PurchasePostedListResponse;
    expect(register.costVisibility).toBe("visible");
    expect(register.purchases.map((purchase) => purchase.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(register.purchases[0]).toMatchObject({
      costAfterDiscountFils: "2160",
      itemCount: 1,
      primarySupplierCostFils: "2400",
      supplierNameSnapshot: "Review Snapshot Supplier",
    });

    const firstDetailResponse = await request(
      "GET",
      `/purchases/posted/${first.id}`,
    );
    expect(firstDetailResponse.status, diagnostics(firstDetailResponse)).toBe(
      200,
    );
    const firstDetail =
      firstDetailResponse.body as unknown as PurchasePostedDetail;
    expect(firstDetail).toEqual(baselineDetail);
    expect(firstDetail).toMatchObject({
      allowanceFils: "240",
      allowancePercentageSnapshot: "10",
      costAfterDiscountFils: "2160",
      costVisibility: "visible",
      primarySupplierCostFils: "2400",
      supplierNameSnapshot: "Review Snapshot Supplier",
    });
    expect(firstDetail.rows[0]).toMatchObject({
      itemDisplayName: product.displayName,
      linePrimarySupplierCostFils: "2400",
    });
    expect(firstDetail.navigation.nextId).toBe(second.id);

    const secondDetailResponse = await request(
      "GET",
      `/purchases/posted/${second.id}`,
    );
    expect(secondDetailResponse.status, diagnostics(secondDetailResponse)).toBe(
      200,
    );
    const secondDetail =
      secondDetailResponse.body as unknown as PurchasePostedDetail;
    expect(secondDetail.navigation.previousId).toBe(first.id);
    expect(secondDetail.navigation.position).toBe(
      firstDetail.navigation.position + 1,
    );

    const currentSupplier = await request("GET", `/suppliers/${supplier.id}`);
    expect(currentSupplier.body).toMatchObject({
      defaultAllowancePercentage: "22.5",
      name: "Current Supplier Changed",
    });
    const currentProduct = await request(
      "GET",
      `/catalog/products/${product.id}`,
    );
    expect(currentProduct.body).toMatchObject({
      displayName: "Current Item Changed",
      pricing: { retailPriceFils: "333333" },
    });

    const preferencesResponse = await request(
      "GET",
      "/purchases/entry-preferences",
    );
    expect(preferencesResponse.status, diagnostics(preferencesResponse)).toBe(
      200,
    );
    const preferences = preferencesResponse.body as unknown as {
      afterCommit: "new-row" | "return-to-item";
      columns: { field: string; visible: boolean }[];
      detailsPanelFields: string[];
      revision: string;
    };
    const hiddenPreferenceResponse = await request(
      "PUT",
      "/purchases/entry-preferences",
      {
        afterCommit: preferences.afterCommit,
        columns: preferences.columns.map((column) =>
          column.field === "cost" ? { ...column, visible: false } : column,
        ),
        detailsPanelFields: preferences.detailsPanelFields,
        expectedRevision: preferences.revision,
        idempotencyKey: uuidV7(),
      },
    );
    expect(
      hiddenPreferenceResponse.status,
      diagnostics(hiddenPreferenceResponse),
    ).toBe(200);

    const hiddenRegister = (
      await request("GET", "/purchases/posted?query=REVIEW-STABLE")
    ).body as unknown as PurchasePostedListResponse;
    expect(hiddenRegister.costVisibility).toBe("hidden-by-setting");
    expect(hiddenRegister.purchases[0]).toMatchObject({
      costAfterDiscountFils: null,
      primarySupplierCostFils: null,
    });
    const hiddenDetail = (await request("GET", `/purchases/posted/${first.id}`))
      .body as unknown as PurchasePostedDetail;
    expect(hiddenDetail).toMatchObject({
      allowanceFils: null,
      allowancePercentageSnapshot: null,
      costAfterDiscountFils: null,
      costVisibility: "hidden-by-setting",
      primarySupplierCostFils: null,
    });
    expect(hiddenDetail.rows[0]).toMatchObject({
      costAfterDiscountFils: null,
      linePrimarySupplierCostFils: null,
      primarySupplierCostFils: null,
    });

    const missingId = uuidV7();
    const missing = await request("GET", `/purchases/posted/${missingId}`);
    expect(missing).toMatchObject({
      status: 404,
      body: { code: "posted-purchase-not-found" },
    });
    const missingAudit = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where pharmacy_id = $1 and action = 'purchase.posted.read'
         and outcome = 'posted-purchase-not-found' and target_id = $2`,
      [pharmacyId, missingId],
    );
    expect(missingAudit.rows[0]?.count).toBe("1");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const mutation = await request(method, `/purchases/posted/${first.id}`, {
        attemptedMutation: true,
      });
      expect(mutation.status, `${method} unexpectedly reached a route`).toBe(
        404,
      );
    }
  });

  it("posts a cash purchase that changes only the Cash Box balance, never a supplier payable", async () => {
    const beforeBalance = await administrator.query<{ balance_fils: string }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    const draft = await createPostableDraft(
      supplierLow.id,
      "INV-CASH",
      "cash",
      [{ costFils: "2000", enteredQuantity: "5", itemId: productMain.id }],
    );
    const posted = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(posted.status, diagnostics(posted)).toBe(201);
    const result = posted.body as unknown as PurchasePostResult;
    expect(result.posted.settlementEffect).toEqual({
      context: "cash",
      tenderFils: "10000",
    });

    const cashBox = await administrator.query<{ balance_fils: string }>(
      `select balance_fils::text from accounting_cash_box_balances where pharmacy_id = $1`,
      [pharmacyId],
    );
    expect(cashBox.rows[0]).toMatchObject({ balance_fils: "-10000" });

    const supplierBalance = await administrator.query<{
      balance_fils: string;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    expect(supplierBalance.rows[0]?.balance_fils).toBe(
      beforeBalance.rows[0]?.balance_fils,
    );
  });

  it("replays an idempotent retry, rejects a conflicting payload, and lets exactly one of two concurrent keys post", async () => {
    const draft = await createPostableDraft(
      supplierLow.id,
      "INV-REPLAY",
      "debt",
      [{ costFils: "500", enteredQuantity: "1", itemId: productMain.id }],
    );
    const idempotencyKey = uuidV7();
    const body = { expectedVersion: draft.version, idempotencyKey };
    const sensitiveField = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      {
        ...body,
        primarySupplierCostFils: "1",
      },
    );
    expect(sensitiveField).toMatchObject({
      status: 400,
      body: { code: "body-invalid" },
    });
    const first = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      body,
    );
    expect(first.status, diagnostics(first)).toBe(201);
    const replayed = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      body,
    );
    expect(replayed).toEqual(first);

    const conflicting = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      { ...body, expectedVersion: "999999" },
    );
    expect(conflicting).toMatchObject({
      status: 409,
      body: { code: "idempotency-conflict" },
    });

    const concurrentDraft = await createPostableDraft(
      supplierLow.id,
      "INV-CONCURRENT",
      "debt",
      [{ costFils: "700", enteredQuantity: "1", itemId: productMain.id }],
    );
    const concurrent = await Promise.all([
      request("POST", purchaseDraftPostingsPath(concurrentDraft.id), {
        expectedVersion: concurrentDraft.version,
        idempotencyKey: uuidV7(),
      }),
      request("POST", purchaseDraftPostingsPath(concurrentDraft.id), {
        expectedVersion: concurrentDraft.version,
        idempotencyKey: uuidV7(),
      }),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([201, 409]);
    const postedCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posted_purchases where draft_id = $1`,
      [concurrentDraft.id],
    );
    expect(postedCount.rows[0]?.count).toBe("1");
  });

  it("posts two different drafts concurrently with distinct numbers and conserved WAC", async () => {
    const productResponse = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Concurrent Valuation", false),
    );
    expect(productResponse.status, diagnostics(productResponse)).toBe(201);
    const product = productResponse.body as unknown as Product;
    const secondSupplierResponse = await request(
      "POST",
      "/suppliers",
      supplierBody("Concurrent Supplier", "10", "2026-01-01"),
    );
    expect(
      secondSupplierResponse.status,
      diagnostics(secondSupplierResponse),
    ).toBe(201);
    const secondSupplier = secondSupplierResponse.body as unknown as Supplier;
    const firstDraft = await createPostableDraft(
      supplierLow.id,
      "INV-CONCURRENT-A",
      "debt",
      [{ costFils: "1100", enteredQuantity: "2", itemId: product.id }],
    );
    const secondDraft = await createPostableDraft(
      secondSupplier.id,
      "INV-CONCURRENT-B",
      "debt",
      [{ costFils: "1700", enteredQuantity: "3", itemId: product.id }],
    );

    const responses = await Promise.all([
      request("POST", purchaseDraftPostingsPath(firstDraft.id), {
        expectedVersion: firstDraft.version,
        idempotencyKey: uuidV7(),
      }),
      request("POST", purchaseDraftPostingsPath(secondDraft.id), {
        expectedVersion: secondDraft.version,
        idempotencyKey: uuidV7(),
      }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    const results = responses.map(
      ({ body }) => body as unknown as PurchasePostResult,
    );
    expect(new Set(results.map(({ posted }) => posted.number.value)).size).toBe(
      2,
    );
    const valuation = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      `select total_quantity::text, total_value_scaled::text
       from inventory_valuation_state where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, product.id],
    );
    expect(valuation.rows[0]).toMatchObject({
      total_quantity: "5",
      total_value_scaled: (7_300n * 10_000_000_000n).toString(),
    });
    const movements = await administrator.query<{
      carrying_amount_fils: string;
      quantity: string;
    }>(
      `select quantity::text, carrying_amount_fils::text
       from inventory_movements
       where pharmacy_id = $1 and product_id = $2
       order by carrying_amount_fils`,
      [pharmacyId, product.id],
    );
    expect(movements.rows).toEqual([
      { carrying_amount_fils: "2200", quantity: "2" },
      { carrying_amount_fils: "5100", quantity: "3" },
    ]);
  });

  it("warns but still posts a duplicate supplier invoice number", async () => {
    const firstDraft = await createPostableDraft(
      supplierLow.id,
      "INV-DUPLICATE-POSTED",
      "debt",
      [{ costFils: "900", enteredQuantity: "1", itemId: productMain.id }],
    );
    const firstResponse = await request(
      "POST",
      purchaseDraftPostingsPath(firstDraft.id),
      { expectedVersion: firstDraft.version, idempotencyKey: uuidV7() },
    );
    expect(firstResponse.status, diagnostics(firstResponse)).toBe(201);
    const first = firstResponse.body as unknown as PurchasePostResult;

    const secondDraft = await createPostableDraft(
      supplierLow.id,
      "INV-DUPLICATE-POSTED",
      "debt",
      [{ costFils: "950", enteredQuantity: "1", itemId: productMain.id }],
    );
    const secondResponse = await request(
      "POST",
      purchaseDraftPostingsPath(secondDraft.id),
      { expectedVersion: secondDraft.version, idempotencyKey: uuidV7() },
    );
    expect(secondResponse.status, diagnostics(secondResponse)).toBe(201);
    const second = secondResponse.body as unknown as PurchasePostResult;
    expect(second.warnings).toEqual([
      {
        code: "duplicate-supplier-invoice-number",
        existingPostingIds: [first.posted.id],
        operationalRule: "warn-open-decision",
      },
    ]);
  });

  it("keeps the draft and names the row rule when receipt evidence is missing", async () => {
    const created = await request("POST", "/purchases/drafts", {
      idempotencyKey: uuidV7(),
      invoiceDate: "2026-06-15",
      settlementContext: "debt",
      supplierId: supplierLow.id,
      supplierInvoiceNumber: "INV-MISSING-EXPIRY",
    });
    expect(created.status, diagnostics(created)).toBe(201);
    let draft = created.body?.draft as unknown as PurchaseDraft;
    const committed = await request("POST", purchaseDraftRowsPath(draft.id), {
      costFils: "1000",
      enteredQuantity: "1",
      expectedVersion: draft.version,
      expiryDate: null,
      idempotencyKey: uuidV7(),
      itemId: productMain.id,
      lotNumber: null,
      notes: null,
      pricing: { method: "by-price", retailPriceFils: "999999" },
      unit: { kind: "inventory-unit" },
    });
    expect(committed.status, diagnostics(committed)).toBe(201);
    draft = committed.body?.draft as unknown as PurchaseDraft;

    const rejected = await request(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      { expectedVersion: draft.version, idempotencyKey: uuidV7() },
    );
    expect(rejected).toMatchObject({
      status: 409,
      body: {
        code: "expiry-required",
        fieldErrors: [
          {
            code: "required",
            path: ["rows", 0, "expiryDate"],
            rule: "purchase.post.expiry-required-at-receipt",
          },
        ],
      },
    });
    const preserved = await administrator.query<{
      status: string;
      version: string;
    }>(`select status, version::text from purchase_drafts where id = $1`, [
      draft.id,
    ]);
    expect(preserved.rows[0]).toMatchObject({
      status: "active",
      version: draft.version,
    });
    const posted = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posted_purchases where draft_id = $1`,
      [draft.id],
    );
    expect(posted.rows[0]?.count).toBe("0");
  });

  it("changes Cost After Discount but never gross WAC or AP when only the allowance percentage differs", async () => {
    const highSupplierResponse = await request(
      "POST",
      "/suppliers",
      supplierBody("Al-Rasheed", "25", "2026-01-01"),
    );
    expect(highSupplierResponse.status, diagnostics(highSupplierResponse)).toBe(
      201,
    );
    const supplierHigh = highSupplierResponse.body as unknown as Supplier;
    const productResponse = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Allowance Isolation", false),
    );
    expect(productResponse.status, diagnostics(productResponse)).toBe(201);
    const product = productResponse.body as unknown as Product;

    const lowBalanceBefore = await administrator.query<{
      balance_fils: string | null;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    const lowBalanceBeforeFils = BigInt(
      lowBalanceBefore.rows[0]?.balance_fils ?? "0",
    );

    const draftLow = await createPostableDraft(
      supplierLow.id,
      "INV-ALLOW-LOW",
      "debt",
      [{ costFils: "3000", enteredQuantity: "4", itemId: product.id }],
    );
    const postedLow = await request(
      "POST",
      purchaseDraftPostingsPath(draftLow.id),
      { expectedVersion: draftLow.version, idempotencyKey: uuidV7() },
    );
    expect(postedLow.status, diagnostics(postedLow)).toBe(201);
    const resultLow = postedLow.body as unknown as PurchasePostResult;

    const draftHigh = await createPostableDraft(
      supplierHigh.id,
      "INV-ALLOW-HIGH",
      "debt",
      [{ costFils: "3000", enteredQuantity: "4", itemId: product.id }],
    );
    const postedHigh = await request(
      "POST",
      purchaseDraftPostingsPath(draftHigh.id),
      { expectedVersion: draftHigh.version, idempotencyKey: uuidV7() },
    );
    expect(postedHigh.status, diagnostics(postedHigh)).toBe(201);
    const resultHigh = postedHigh.body as unknown as PurchasePostResult;

    expect(resultLow.posted.primarySupplierCostFils).toBe("12000");
    expect(resultHigh.posted.primarySupplierCostFils).toBe("12000");
    expect(resultLow.posted.costAfterDiscountFils).not.toBe(
      resultHigh.posted.costAfterDiscountFils,
    );
    expect(resultLow.posted.costAfterDiscountFils).toBe("10800");
    expect(resultHigh.posted.costAfterDiscountFils).toBe("9000");

    const valuation = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      `select total_quantity::text, total_value_scaled::text
       from inventory_valuation_state where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, product.id],
    );
    expect(valuation.rows[0]).toMatchObject({
      total_quantity: "8",
      total_value_scaled: (24_000n * 10_000_000_000n).toString(),
    });

    const lowBalance = await administrator.query<{ balance_fils: string }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    const highBalance = await administrator.query<{ balance_fils: string }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierHigh.id],
    );
    expect(BigInt(lowBalance.rows[0]?.balance_fils ?? "0")).toBe(
      lowBalanceBeforeFils + 12_000n,
    );
    expect(highBalance.rows[0]?.balance_fils).toBe("12000");
  });

  it("enforces a balanced journal at commit even bypassing the application", async () => {
    const draft = await createPostableDraft(
      supplierLow.id,
      "INV-BALANCE-CHECK",
      "debt",
      [{ costFils: "100", enteredQuantity: "1", itemId: productMain.id }],
    );
    const posted = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(posted.status, diagnostics(posted)).toBe(201);
    const entryId = (posted.body as unknown as PurchasePostResult).posted
      .journal.entryId;

    const raw = await administrator.connect();
    try {
      await raw.query("begin");
      await raw.query(
        `insert into accounting_journal_lines (
           pharmacy_id, entry_id, ordinal, account_code, debit_fils, credit_fils
         ) values ($1, $2, 99, 'inventory', 500, 0)`,
        [pharmacyId, entryId],
      );
      await expect(raw.query("commit")).rejects.toMatchObject({
        code: "23514",
      });
    } finally {
      await raw.query("rollback").catch(() => undefined);
      raw.release();
    }
  });

  it("rolls back a forced database failure after number allocation, leaving an audited unissued gap a retry reuses and issues", async () => {
    const rollbackProductResponse = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Rollback Isolation", false),
    );
    expect(
      rollbackProductResponse.status,
      diagnostics(rollbackProductResponse),
    ).toBe(201);
    const rollbackProduct = rollbackProductResponse.body as unknown as Product;
    const draft = await createPostableDraft(supplierLow.id, "INV-GAP", "debt", [
      {
        costFils: "1000",
        enteredQuantity: "2",
        itemId: rollbackProduct.id,
        retailPriceFils: "777777",
      },
    ]);
    const idempotencyKey = uuidV7();
    const balanceBefore = await administrator.query<{ balance_fils: string }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    const journalBefore = await administrator.query<{ count: string }>(
      `select count(*)::text as count from accounting_journal_entries
       where pharmacy_id = $1`,
      [pharmacyId],
    );

    // A temporary trigger stands in for an unexpected database failure that
    // strikes strictly after number allocation -- while appending the
    // `inventory_movements` fact, after the batch insert -- without touching any product
    // code or crashing a connection: the fault is an ordinary catchable SQL
    // exception delivered over the API's own still-open transaction, so its
    // rollback and this test's assertions exercise exactly the real
    // failure path a genuine constraint violation or driver error would.
    await administrator.query(
      `create function test_force_one_failure()
         returns trigger language plpgsql as $$
         begin
           raise exception 'test-injected posting failure' using errcode = 'P0001';
         end;
         $$`,
    );
    await administrator.query(
      `create trigger test_force_one_failure_trigger
         before insert on inventory_movements
         for each row execute function test_force_one_failure()`,
    );

    let failed: ApiResponse;
    try {
      failed = await request("POST", purchaseDraftPostingsPath(draft.id), {
        expectedVersion: draft.version,
        idempotencyKey,
      });
    } finally {
      await administrator.query(
        `drop trigger test_force_one_failure_trigger on inventory_movements`,
      );
      await administrator.query(`drop function test_force_one_failure()`);
    }
    expect(failed.status, diagnostics(failed)).not.toBe(201);

    const draftRow = await administrator.query<{
      status: string;
      version: string;
    }>(`select status, version::text from purchase_drafts where id = $1`, [
      draft.id,
    ]);
    expect(draftRow.rows[0]).toMatchObject({
      status: "active",
      version: draft.version,
    });

    const postedCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posted_purchases where draft_id = $1`,
      [draft.id],
    );
    expect(postedCount.rows[0]?.count).toBe("0");

    const postedRowCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posted_purchase_rows posted_row
       join purchase_draft_rows draft_row on draft_row.id = posted_row.draft_row_id
       where draft_row.draft_id = $1`,
      [draft.id],
    );
    expect(postedRowCount.rows[0]?.count).toBe("0");

    const batchCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from inventory_batches
       where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, rollbackProduct.id],
    );
    expect(batchCount.rows[0]?.count).toBe("0");

    const movementCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from inventory_movements
         where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, rollbackProduct.id],
    );
    expect(movementCount.rows[0]?.count).toBe("0");

    const valuationCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from inventory_valuation_state
       where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, rollbackProduct.id],
    );
    expect(valuationCount.rows[0]?.count).toBe("0");

    const priceAfterFailure = await administrator.query<{
      retail_price_fils: string;
    }>(
      `select retail_price_fils::text from catalog_products
       where pharmacy_id = $1 and id = $2`,
      [pharmacyId, rollbackProduct.id],
    );
    expect(priceAfterFailure.rows[0]?.retail_price_fils).toBe("100000");

    const balanceAfterFailure = await administrator.query<{
      balance_fils: string;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    expect(balanceAfterFailure.rows[0]?.balance_fils).toBe(
      balanceBefore.rows[0]?.balance_fils,
    );

    const journalAfterFailure = await administrator.query<{ count: string }>(
      `select count(*)::text as count from accounting_journal_entries
       where pharmacy_id = $1`,
      [pharmacyId],
    );
    expect(journalAfterFailure.rows[0]?.count).toBe(
      journalBefore.rows[0]?.count,
    );

    const commandResultCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
         where pharmacy_id = $1 and idempotency_key = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(commandResultCount.rows[0]?.count).toBe("0");

    const auditCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
         where pharmacy_id = $1 and correlation_id = $2 and outcome = 'committed'`,
      [pharmacyId, idempotencyKey],
    );
    expect(auditCount.rows[0]?.count).toBe("0");

    const outboxCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_outbox_entries
         where pharmacy_id = $1 and correlation_id = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(outboxCount.rows[0]?.count).toBe("0");

    const gap = await administrator.query<{ status: string; value: string }>(
      `select status, value::text from posting_number_allocations
         where pharmacy_id = $1 and document_type = 'purchase-invoice' and correlation_id = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(gap.rows[0]).toMatchObject({ status: "allocated" });
    const gapValue = gap.rows[0]!.value;

    const retried = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey,
    });
    expect(retried.status, diagnostics(retried)).toBe(201);
    const retriedResult = retried.body as unknown as PurchasePostResult;
    expect(retriedResult.posted.number.value).toBe(gapValue);

    const priceAfterRetry = await administrator.query<{
      retail_price_fils: string;
    }>(
      `select retail_price_fils::text from catalog_products
       where pharmacy_id = $1 and id = $2`,
      [pharmacyId, rollbackProduct.id],
    );
    expect(priceAfterRetry.rows[0]?.retail_price_fils).toBe("777777");

    const reissued = await administrator.query<{
      document_id: string;
      status: string;
      value: string;
    }>(
      `select status, value::text, document_id::text
         from posting_number_allocations
         where pharmacy_id = $1 and document_type = 'purchase-invoice' and correlation_id = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(reissued.rows[0]).toMatchObject({
      document_id: retriedResult.posted.id,
      status: "issued",
      value: gapValue,
    });

    const finalPostedCount = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posted_purchases where draft_id = $1`,
      [draft.id],
    );
    expect(finalPostedCount.rows[0]?.count).toBe("1");
  }, 30_000);

  it("rolls back every earlier write when the final idempotency result cannot be recorded", async () => {
    const productResponse = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Late Rollback Isolation", false),
    );
    expect(productResponse.status, diagnostics(productResponse)).toBe(201);
    const product = productResponse.body as unknown as Product;
    const draft = await createPostableDraft(
      supplierLow.id,
      "INV-LATE-ROLLBACK",
      "debt",
      [
        {
          costFils: "1250",
          enteredQuantity: "2",
          itemId: product.id,
          retailPriceFils: "888888",
        },
      ],
    );
    const idempotencyKey = uuidV7();
    const supplierBalanceBefore = await administrator.query<{
      balance_fils: string;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    const journalCountBefore = await administrator.query<{ count: string }>(
      `select count(*)::text as count from accounting_journal_entries
       where pharmacy_id = $1`,
      [pharmacyId],
    );

    await administrator.query(
      `create function test_force_purchase_result_failure()
         returns trigger language plpgsql as $$
         begin
           if new.command_name = 'purchase.post' then
             raise exception 'test-injected result failure' using errcode = 'P0001';
           end if;
           return new;
         end;
         $$`,
    );
    await administrator.query(
      `create trigger test_force_purchase_result_failure_trigger
         before insert on posting_command_results
         for each row execute function test_force_purchase_result_failure()`,
    );

    let failed: ApiResponse;
    try {
      failed = await request("POST", purchaseDraftPostingsPath(draft.id), {
        expectedVersion: draft.version,
        idempotencyKey,
      });
    } finally {
      await administrator.query(
        `drop trigger test_force_purchase_result_failure_trigger on posting_command_results`,
      );
      await administrator.query(
        `drop function test_force_purchase_result_failure()`,
      );
    }
    expect(failed.status, diagnostics(failed)).toBe(500);

    const businessState = await administrator.query<{
      batches: string;
      command_results: string;
      journal_entries: string;
      movements: string;
      outbox_entries: string;
      posted_purchases: string;
      posted_rows: string;
      purchase_audits: string;
      valuation_rows: string;
    }>(
      `select
         (select count(*) from inventory_batches where pharmacy_id = $1 and product_id = $2)::text as batches,
         (select count(*) from inventory_movements where pharmacy_id = $1 and product_id = $2)::text as movements,
         (select count(*) from inventory_valuation_state where pharmacy_id = $1 and product_id = $2)::text as valuation_rows,
         (select count(*) from posted_purchases where draft_id = $3)::text as posted_purchases,
         (select count(*) from posted_purchase_rows posted_row
            join purchase_draft_rows draft_row on draft_row.id = posted_row.draft_row_id
            where draft_row.draft_id = $3)::text as posted_rows,
         (select count(*) from posting_outbox_entries where pharmacy_id = $1 and correlation_id = $4)::text as outbox_entries,
         (select count(*) from posting_command_results where pharmacy_id = $1 and idempotency_key = $4)::text as command_results,
         (select count(*) from posting_audit_records where pharmacy_id = $1 and action = 'purchase.post' and correlation_id = $4)::text as purchase_audits,
         (select count(*) from accounting_journal_entries where pharmacy_id = $1)::text as journal_entries`,
      [pharmacyId, product.id, draft.id, idempotencyKey],
    );
    expect(businessState.rows[0]).toMatchObject({
      batches: "0",
      command_results: "0",
      journal_entries: journalCountBefore.rows[0]?.count,
      movements: "0",
      outbox_entries: "0",
      posted_purchases: "0",
      posted_rows: "0",
      purchase_audits: "0",
      valuation_rows: "0",
    });

    const draftState = await administrator.query<{
      status: string;
      version: string;
    }>(`select status, version::text from purchase_drafts where id = $1`, [
      draft.id,
    ]);
    expect(draftState.rows[0]).toMatchObject({
      status: "active",
      version: draft.version,
    });
    const supplierBalanceAfter = await administrator.query<{
      balance_fils: string;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    expect(supplierBalanceAfter.rows[0]?.balance_fils).toBe(
      supplierBalanceBefore.rows[0]?.balance_fils,
    );
    const catalogPriceAfter = await administrator.query<{
      retail_price_fils: string;
    }>(
      `select retail_price_fils::text from catalog_products
       where pharmacy_id = $1 and id = $2`,
      [pharmacyId, product.id],
    );
    expect(catalogPriceAfter.rows[0]?.retail_price_fils).toBe("100000");

    const gap = await administrator.query<{ status: string; value: string }>(
      `select status, value::text from posting_number_allocations
       where pharmacy_id = $1 and document_type = 'purchase-invoice'
         and correlation_id = $2`,
      [pharmacyId, idempotencyKey],
    );
    expect(gap.rows[0]?.status).toBe("allocated");

    const retried = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey,
    });
    expect(retried.status, diagnostics(retried)).toBe(201);
    expect(
      (retried.body as unknown as PurchasePostResult).posted.number.value,
    ).toBe(gap.rows[0]?.value);
  }, 30_000);

  it("posts only Purchase Adjustment Deltas, preserves the original, numbers A01/A02, replays once, serializes, and blocks consumed stock", async () => {
    const originalDraft = await createPostableDraft(
      supplierLow.id,
      "INV-ADJUST-1",
      "debt",
      [
        { costFils: "1000", enteredQuantity: "4", itemId: productMain.id },
        { costFils: "2000", enteredQuantity: "10", itemId: productMain.id },
      ],
    );
    const originalPost = await request(
      "POST",
      purchaseDraftPostingsPath(originalDraft.id),
      { expectedVersion: originalDraft.version, idempotencyKey: uuidV7() },
    );
    expect(originalPost.status, diagnostics(originalPost)).toBe(201);
    const original = originalPost.body as unknown as PurchasePostResult;
    const originalId = original.posted.id;
    const originalBytes = await immutablePurchaseBytes(originalId);

    const firstDraft = await createAdjustmentDraft(
      originalId,
      "quantity error",
    );
    const firstSaved = await saveAdjustmentDraft(firstDraft, (rows) =>
      rows.map((row, index) =>
        index === 0 ? { ...row, enteredQuantity: "8" } : row,
      ),
    );
    const firstSummary = await previewAdjustment(firstSaved);
    expect(firstSummary).toMatchObject({
      primarySupplierCostDeltaFils: "4000",
      quantityDelta: "4",
    });
    expect(firstSummary.rowDeltas).toHaveLength(1);
    expect(firstSummary.rowDeltas[0]).toMatchObject({
      quantityDelta: "4",
    });
    const firstKey = uuidV7();
    const firstPostedResponse = await request(
      "POST",
      purchaseAdjustmentPostingsPath(firstSaved.id),
      {
        confirmationHash: firstSummary.confirmationHash,
        expectedVersion: firstSaved.version,
        idempotencyKey: firstKey,
      },
    );
    expect(firstPostedResponse.status, diagnostics(firstPostedResponse)).toBe(
      201,
    );
    const firstPosted =
      firstPostedResponse.body as unknown as PurchaseAdjustmentPostResult;
    expect(firstPosted.posted.number.suffix).toBe("1");

    const firstRetry = await request(
      "POST",
      purchaseAdjustmentPostingsPath(firstSaved.id),
      {
        confirmationHash: firstSummary.confirmationHash,
        expectedVersion: firstSaved.version,
        idempotencyKey: firstKey,
      },
    );
    expect(firstRetry.status).toBe(201);
    expect(firstRetry.body).toEqual(firstPostedResponse.body);

    const firstEffects = await administrator.query<{
      movement_count: string;
      movement_quantity: string;
      value_effect_count: string;
    }>(
      `select
         (select count(*)::text from inventory_movements
          where source_document_type = 'purchase-adjustment'
            and source_document_id = $1) as movement_count,
         (select coalesce(sum(quantity), 0)::text from inventory_movements
          where source_document_type = 'purchase-adjustment'
            and source_document_id = $1) as movement_quantity,
         (select count(*)::text from inventory_value_effects
          where source_document_id = $1) as value_effect_count`,
      [firstPosted.posted.id],
    );
    expect(firstEffects.rows[0]).toEqual({
      movement_count: "1",
      movement_quantity: "4",
      value_effect_count: "1",
    });

    const secondDraft = await createAdjustmentDraft(
      originalId,
      "quantity error",
    );
    const secondSaved = await saveAdjustmentDraft(secondDraft, (rows) =>
      rows.map((row, index) =>
        index === 0 ? { ...row, enteredQuantity: "6" } : row,
      ),
    );
    const secondSummary = await previewAdjustment(secondSaved);
    expect(secondSummary.quantityDelta).toBe("-2");
    const secondPost = await request(
      "POST",
      purchaseAdjustmentPostingsPath(secondSaved.id),
      {
        confirmationHash: secondSummary.confirmationHash,
        expectedVersion: secondSaved.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(secondPost.status, diagnostics(secondPost)).toBe(201);
    expect(
      (secondPost.body as unknown as PurchaseAdjustmentPostResult).posted.number
        .suffix,
    ).toBe("2");
    expect(await immutablePurchaseBytes(originalId)).toEqual(originalBytes);

    const concurrentDrafts = await Promise.all([
      createAdjustmentDraft(originalId, "quantity error"),
      createAdjustmentDraft(originalId, "quantity error"),
    ]);
    const concurrentSaved = await Promise.all(
      concurrentDrafts.map((candidate) =>
        saveAdjustmentDraft(candidate, (rows) =>
          rows.map((row, index) =>
            index === 0 ? { ...row, enteredQuantity: "7" } : row,
          ),
        ),
      ),
    );
    const concurrentSummaries = await Promise.all(
      concurrentSaved.map(previewAdjustment),
    );
    const concurrentPosts = await Promise.all(
      concurrentSaved.map((candidate, index) =>
        request("POST", purchaseAdjustmentPostingsPath(candidate.id), {
          confirmationHash: concurrentSummaries[index]!.confirmationHash,
          expectedVersion: candidate.version,
          idempotencyKey: uuidV7(),
        }),
      ),
    );
    expect(concurrentPosts.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    const concurrentWinner = concurrentPosts.find(
      ({ status }) => status === 201,
    );
    expect(
      (concurrentWinner?.body as unknown as PurchaseAdjustmentPostResult).posted
        .number.suffix,
    ).toBe("3");
    expect(
      concurrentPosts.find(({ status }) => status === 409)?.body,
    ).toMatchObject({ code: "adjustment-empty" });

    const current = await createAdjustmentDraft(originalId, "quantity error");
    const affected = current.rows[0]!;
    await administrator.query(
      `insert into inventory_movements (
         pharmacy_id, product_id, batch_id, reason, quantity,
         carrying_amount_fils, source_document_type, source_document_id,
         source_row_ordinal, created_by
       ) values ($1, $2, $3, 'purchase-adjustment', -5, -5000,
                 'purchase-adjustment', $4, 1, $5)`,
      [
        pharmacyId,
        affected.itemId,
        affected.batchId,
        firstPosted.posted.id,
        firstPosted.posted.postedBy,
      ],
    );
    const blocked = await request(
      "PUT",
      purchaseAdjustmentDraftPath(current.id),
      adjustmentUpdateBody(current, adjustmentRows(current).slice(1)),
    );
    expect(blocked.status, diagnostics(blocked)).toBe(409);
    expect(blocked.body).toMatchObject({
      code: "adjustment-batch-conflict",
      fieldErrors: [
        {
          rule: "purchase.adjustment.batch-insufficient",
        },
      ],
    });
    const blockedDraftState = await administrator.query<{
      row_count: string;
      version: string;
    }>(
      `select draft.version::text,
              (select count(*)::text from purchase_adjustment_draft_rows row
               where row.pharmacy_id = draft.pharmacy_id
                 and row.draft_id = draft.id) as row_count
       from purchase_adjustment_drafts draft
       where draft.pharmacy_id = $1 and draft.id = $2`,
      [pharmacyId, current.id],
    );
    expect(blockedDraftState.rows[0]).toEqual({
      row_count: "2",
      version: current.version,
    });

    await expect(
      administrator.query(
        "update posted_purchases set supplier_invoice_number = 'MUTATED' where id = $1",
        [originalId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query(
        "delete from posted_purchase_adjustments where id = $1",
        [firstPosted.posted.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  }, 30_000);

  it("posts PR returns with independent values, conservation, idempotency, contention safety, immutable proof, and bidirectional links", async () => {
    const productResponse = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Return Valuation", false),
    );
    expect(productResponse.status, diagnostics(productResponse)).toBe(201);
    const product = productResponse.body as unknown as Product;
    const originalDraft = await createPostableDraft(
      supplierLow.id,
      "INV-RETURN-ORIGINAL",
      "debt",
      [{ costFils: "1000", enteredQuantity: "10", itemId: product.id }],
    );
    const originalResponse = await request(
      "POST",
      purchaseDraftPostingsPath(originalDraft.id),
      { expectedVersion: originalDraft.version, idempotencyKey: uuidV7() },
    );
    expect(originalResponse.status, diagnostics(originalResponse)).toBe(201);
    const original = originalResponse.body as unknown as PurchasePostResult;
    const originalBytes = await immutablePurchaseBytes(original.posted.id);

    const laterDraft = await createPostableDraft(
      supplierLow.id,
      "INV-RETURN-LATER",
      "debt",
      [{ costFils: "3000", enteredQuantity: "10", itemId: product.id }],
    );
    const laterResponse = await request(
      "POST",
      purchaseDraftPostingsPath(laterDraft.id),
      { expectedVersion: laterDraft.version, idempotencyKey: uuidV7() },
    );
    expect(laterResponse.status, diagnostics(laterResponse)).toBe(201);

    const draft = await createReturnDraft(original.posted.id);
    const overReturn = await request("PUT", purchaseReturnDraftPath(draft.id), {
      evidence: draft.evidence,
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
      reason: draft.reason,
      rows: draft.rows.map((row) => ({
        originalPurchaseRowId: row.originalPurchaseRowId,
        returnQuantity: "11",
      })),
    });
    expect(overReturn.status, diagnostics(overReturn)).toBe(409);
    expect(overReturn.body).toMatchObject({
      code: "return-over-eligible",
      fieldErrors: [{ rule: "purchase.return.over-return" }],
    });
    const saved = await saveReturnDraft(draft, "4");
    const summary = await previewReturn(saved);
    expect(summary).toMatchObject({
      inventoryCarryingAmountFils: "8000",
      supplierReductionFils: "4000",
    });
    const missingStepUp = await request(
      "POST",
      purchaseReturnPostingsPath(saved.id),
      {
        confirmationHash: summary.confirmationHash,
        expectedVersion: saved.version,
        idempotencyKey: uuidV7(),
        stepUpChallengeId: uuidV7(),
      },
    );
    expect(missingStepUp.status, diagnostics(missingStepUp)).toBe(404);
    expect(missingStepUp.body).toMatchObject({
      code: "identity-resource-not-found",
    });
    const survivingDraft = await request(
      "GET",
      purchaseReturnDraftPath(saved.id),
    );
    expect(survivingDraft.status, diagnostics(survivingDraft)).toBe(200);
    expect(survivingDraft.body).toMatchObject({
      status: "active",
      version: saved.version,
    });
    const challengeId = await approvedReturnStepUp(saved.id);
    const idempotencyKey = uuidV7();
    const balanceBeforeFailure = await administrator.query<{
      balance_fils: string;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    const valuationBeforeFailure = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      `select total_quantity::text, total_value_scaled::text
       from inventory_valuation_state
       where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, product.id],
    );

    await administrator.query(
      `create function test_force_return_outbox_failure()
         returns trigger language plpgsql as $$
         begin
           if new.event_type = 'purchase.return.posted' then
             raise exception 'test-injected return outbox failure'
               using errcode = 'P0001';
           end if;
           return new;
         end;
         $$`,
    );
    await administrator.query(
      `create trigger test_force_return_outbox_failure_trigger
         before insert on posting_outbox_entries
         for each row execute function test_force_return_outbox_failure()`,
    );
    let failedPost: ApiResponse;
    try {
      failedPost = await request("POST", purchaseReturnPostingsPath(saved.id), {
        confirmationHash: summary.confirmationHash,
        expectedVersion: saved.version,
        idempotencyKey,
        stepUpChallengeId: challengeId,
      });
    } finally {
      await administrator.query(
        `drop trigger test_force_return_outbox_failure_trigger
         on posting_outbox_entries`,
      );
      await administrator.query(
        `drop function test_force_return_outbox_failure()`,
      );
    }
    expect(failedPost.status, diagnostics(failedPost)).not.toBe(201);

    const rolledBack = await administrator.query<{
      audit_count: string;
      command_count: string;
      journal_count: string;
      movement_count: string;
      outbox_count: string;
      posted_count: string;
      status: string;
      step_up_status: string;
      version: string;
    }>(
      `select draft.status::text, draft.version::text,
              (select count(*)::text from posted_purchase_returns posted
               where posted.pharmacy_id = draft.pharmacy_id
                 and posted.draft_id = draft.id) as posted_count,
              (select count(*)::text from inventory_movements movement
               where movement.pharmacy_id = draft.pharmacy_id
                 and movement.source_document_type = 'purchase-return') as movement_count,
              (select count(*)::text from accounting_journal_entries entry
               where entry.pharmacy_id = draft.pharmacy_id
                 and entry.template_id = 'purchase.return') as journal_count,
              (select count(*)::text from posting_command_results result
               where result.pharmacy_id = draft.pharmacy_id
                 and result.idempotency_key = $3) as command_count,
              (select count(*)::text from posting_audit_records audit
               where audit.pharmacy_id = draft.pharmacy_id
                 and audit.correlation_id = $3
                 and audit.outcome = 'committed') as audit_count,
              (select count(*)::text from posting_outbox_entries outbox
               where outbox.pharmacy_id = draft.pharmacy_id
                 and outbox.correlation_id = $3) as outbox_count,
              (select challenge.status::text from step_up_challenges challenge
               where challenge.id = $4) as step_up_status
       from purchase_return_drafts draft
       where draft.pharmacy_id = $1 and draft.id = $2`,
      [pharmacyId, saved.id, idempotencyKey, challengeId],
    );
    expect(rolledBack.rows[0]).toEqual({
      audit_count: "0",
      command_count: "0",
      journal_count: "0",
      movement_count: "0",
      outbox_count: "0",
      posted_count: "0",
      status: "active",
      step_up_status: "approved",
      version: saved.version,
    });
    const balanceAfterFailure = await administrator.query<{
      balance_fils: string;
    }>(
      `select balance_fils::text from accounting_supplier_balances
       where pharmacy_id = $1 and supplier_id = $2`,
      [pharmacyId, supplierLow.id],
    );
    expect(balanceAfterFailure.rows[0]).toEqual(balanceBeforeFailure.rows[0]);
    const valuationAfterFailure = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      `select total_quantity::text, total_value_scaled::text
       from inventory_valuation_state
       where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, product.id],
    );
    expect(valuationAfterFailure.rows[0]).toEqual(
      valuationBeforeFailure.rows[0],
    );

    const postedResponse = await request(
      "POST",
      purchaseReturnPostingsPath(saved.id),
      {
        confirmationHash: summary.confirmationHash,
        expectedVersion: saved.version,
        idempotencyKey,
        stepUpChallengeId: challengeId,
      },
    );
    expect(postedResponse.status, diagnostics(postedResponse)).toBe(201);
    const posted = postedResponse.body as unknown as PurchaseReturnPostResult;
    expect(posted.posted).toMatchObject({
      inventoryCarryingAmountFils: "8000",
      number: { series: "PR", value: "2" },
      originalInvoiceDate: original.posted.invoiceDate,
      originalNumber: original.posted.number,
      originalPurchaseId: original.posted.id,
      supplierReductionFils: "4000",
    });
    expect(posted.posted.journal.treatment).toBe(
      "inventory-account-offset-pending-g01",
    );
    expect(posted.posted.journal.lines).toHaveLength(3);
    expect(await immutablePurchaseBytes(original.posted.id)).toEqual(
      originalBytes,
    );

    const replay = await request("POST", purchaseReturnPostingsPath(saved.id), {
      confirmationHash: summary.confirmationHash,
      expectedVersion: saved.version,
      idempotencyKey,
      stepUpChallengeId: challengeId,
    });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(postedResponse.body);

    const effects = await administrator.query<{
      movement_carrying: string;
      movement_count: string;
      movement_quantity: string;
      posted_count: string;
    }>(
      `select
         (select count(*)::text from posted_purchase_returns where id = $1) as posted_count,
         (select count(*)::text from inventory_movements
          where source_document_type = 'purchase-return' and source_document_id = $1) as movement_count,
         (select sum(quantity)::text from inventory_movements
          where source_document_type = 'purchase-return' and source_document_id = $1) as movement_quantity,
         (select sum(carrying_amount_fils)::text from inventory_movements
          where source_document_type = 'purchase-return' and source_document_id = $1) as movement_carrying`,
      [posted.posted.id],
    );
    expect(effects.rows[0]).toEqual({
      movement_carrying: "-8000",
      movement_count: "1",
      movement_quantity: "-4",
      posted_count: "1",
    });

    const originalDetail = await request(
      "GET",
      `/purchases/posted/${original.posted.id}`,
    );
    expect(originalDetail.status, diagnostics(originalDetail)).toBe(200);
    expect(
      (originalDetail.body as unknown as PurchasePostedDetail).returns,
    ).toEqual([
      expect.objectContaining({
        id: posted.posted.id,
        number: posted.posted.number,
      }),
    ]);
    const returnRead = await request(
      "GET",
      `/purchases/posted-returns/${posted.posted.id}`,
    );
    expect(returnRead.status, diagnostics(returnRead)).toBe(200);
    expect(returnRead.body).toMatchObject({
      originalPurchaseId: original.posted.id,
      originalNumber: original.posted.number,
    });

    const contenders = await Promise.all([
      createReturnDraft(original.posted.id),
      createReturnDraft(original.posted.id),
    ]);
    const contenderSaved = await Promise.all(
      contenders.map((candidate) => saveReturnDraft(candidate, "6")),
    );
    const contenderSummaries = await Promise.all(
      contenderSaved.map(previewReturn),
    );
    const contenderChallenges = await Promise.all(
      contenderSaved.map((candidate) => approvedReturnStepUp(candidate.id)),
    );
    const contenderPosts = await Promise.all(
      contenderSaved.map((candidate, index) =>
        request("POST", purchaseReturnPostingsPath(candidate.id), {
          confirmationHash: contenderSummaries[index]!.confirmationHash,
          expectedVersion: candidate.version,
          idempotencyKey: uuidV7(),
          stepUpChallengeId: contenderChallenges[index],
        }),
      ),
    );
    expect(contenderPosts.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      contenderPosts.find(({ status }) => status === 409)?.body,
    ).toMatchObject({
      code: expect.stringMatching(/^return-(negative-stock|over-eligible)$/u),
    });
    const stock = await administrator.query<{
      batch_quantity: string;
      product_quantity: string;
    }>(
      `select (select sum(movement.quantity)::text
               from inventory_movements movement
               where movement.pharmacy_id = batch.pharmacy_id
                 and movement.batch_id = batch.id) as batch_quantity,
              valuation.total_quantity::text as product_quantity
       from inventory_batches batch
       join inventory_valuation_state valuation
         on valuation.pharmacy_id = batch.pharmacy_id
        and valuation.product_id = batch.product_id
       where batch.id = $1`,
      [original.posted.rows[0]!.batchId],
    );
    expect(stock.rows[0]).toEqual({
      batch_quantity: "0",
      product_quantity: "10",
    });

    await expect(
      administrator.query(
        "update posted_purchase_returns set reason = 'mutated' where id = $1",
        [posted.posted.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      administrator.query("delete from posted_purchase_returns where id = $1", [
        posted.posted.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });

    const sessionBoundary = await requestAs(
      { ...credentials, sessionToken: randomBytes(32).toString("base64url") },
      "GET",
      purchaseReturnDraftPath(saved.id),
    );
    expect(sessionBoundary.status, diagnostics(sessionBoundary)).toBe(401);
    expect(sessionBoundary.body).toMatchObject({
      code: "session-binding-invalid",
    });

    const deviceBoundary = await requestAs(
      { ...credentials, deviceId: uuidV7() },
      "GET",
      purchaseReturnDraftPath(saved.id),
    );
    expect(deviceBoundary.status, diagnostics(deviceBoundary)).toBe(401);
    expect(deviceBoundary.body).toMatchObject({ code: "binding-invalid" });

    const owner = await administrator.query<{
      role_id: string;
      user_id: string;
    }>(
      `select identity_user.id as user_id, identity_user.role_id
       from identity_users identity_user
       where identity_user.pharmacy_id = $1 and identity_user.username = $2`,
      [pharmacyId, OWNER_USERNAME],
    );
    const ownerId = owner.rows[0]?.user_id;
    const ownerRoleId = owner.rows[0]?.role_id;
    expect(ownerId).toBeTruthy();
    expect(ownerRoleId).toBeTruthy();

    const revoke = async (permission: string): Promise<void> => {
      await administrator.query(
        `delete from role_permission_grants
         where role_id = $1 and permission_name = $2`,
        [ownerRoleId, permission],
      );
      await administrator.query(
        "update pharmacy_roles set revision = revision + 1 where id = $1",
        [ownerRoleId],
      );
    };
    const restore = async (permission: string): Promise<void> => {
      await administrator.query(
        `insert into role_permission_grants
           (pharmacy_id, role_id, permission_name, granted_by)
         values ($1, $2, $3, $4)
         on conflict (role_id, permission_name) do nothing`,
        [pharmacyId, ownerRoleId, permission, ownerId],
      );
      await administrator.query(
        "update pharmacy_roles set revision = revision + 1 where id = $1",
        [ownerRoleId],
      );
    };
    const returnDraftBody = {
      evidence: "Boundary authorization check",
      idempotencyKey: uuidV7(),
      reason: "Boundary authorization check",
    };
    await revoke("purchases.returns.manage");
    try {
      const denied = await request(
        "POST",
        purchaseReturnDraftsPath(original.posted.id),
        returnDraftBody,
      );
      expect(denied.status, diagnostics(denied)).toBe(403);
      expect(denied.body).toMatchObject({
        code: "permission-denied",
        requiredPermission: "purchases.returns.manage",
      });
    } finally {
      await restore("purchases.returns.manage");
    }

    await revoke("purchases.costs.view");
    try {
      const denied = await request(
        "POST",
        purchaseReturnDraftsPath(original.posted.id),
        { ...returnDraftBody, idempotencyKey: uuidV7() },
      );
      expect(denied.status, diagnostics(denied)).toBe(403);
      expect(denied.body).toMatchObject({
        code: "permission-denied",
        requiredPermission: "purchases.costs.view",
      });
    } finally {
      await restore("purchases.costs.view");
    }
  }, 30_000);

  async function createReturnDraft(
    originalId: string,
  ): Promise<PurchaseReturnDraft> {
    const response = await request(
      "POST",
      purchaseReturnDraftsPath(originalId),
      {
        evidence: "Supplier collection note RT-44",
        idempotencyKey: uuidV7(),
        reason: "Supplier accepted damaged outer packaging",
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as unknown as PurchaseReturnDraft;
  }

  async function saveReturnDraft(
    draft: PurchaseReturnDraft,
    quantity: string,
  ): Promise<PurchaseReturnDraft> {
    const response = await request("PUT", purchaseReturnDraftPath(draft.id), {
      evidence: draft.evidence,
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
      reason: draft.reason,
      rows: draft.rows.map((row) => ({
        originalPurchaseRowId: row.originalPurchaseRowId,
        returnQuantity: quantity,
      })),
    });
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as unknown as PurchaseReturnDraft;
  }

  async function previewReturn(
    draft: PurchaseReturnDraft,
  ): Promise<PurchaseReturnSummary> {
    const response = await request("GET", purchaseReturnSummaryPath(draft.id));
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as unknown as PurchaseReturnSummary;
  }

  async function approvedReturnStepUp(draftId: string): Promise<string> {
    const challenge = await request("POST", "/identity/step-up-challenges", {
      action: "purchase.return.post",
      idempotencyKey: uuidV7(),
      subjectId: draftId,
    });
    expect(challenge.status, diagnostics(challenge)).toBe(201);
    const challengeId = String(challenge.body?.id ?? "");
    const approved = await request(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approved.status, diagnostics(approved)).toBe(200);
    return challengeId;
  }

  async function createAdjustmentDraft(
    originalId: string,
    reason:
      | "quantity error"
      | "price error"
      | "invoice-number error"
      | "supplier error"
      | "other",
  ): Promise<PurchaseAdjustmentDraft> {
    const response = await request(
      "POST",
      purchaseAdjustmentDraftsPath(originalId),
      {
        evidence: "Supplier invoice checked",
        idempotencyKey: uuidV7(),
        reason,
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as unknown as PurchaseAdjustmentDraft;
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
    return response.body as unknown as PurchaseAdjustmentDraft;
  }

  async function previewAdjustment(
    draft: PurchaseAdjustmentDraft,
  ): Promise<PurchaseAdjustmentSummary> {
    const response = await request(
      "GET",
      purchaseAdjustmentSummaryPath(draft.id),
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as unknown as PurchaseAdjustmentSummary;
  }

  async function immutablePurchaseBytes(purchaseId: string): Promise<unknown> {
    const result = await administrator.query<{ bytes: unknown }>(
      `select jsonb_build_object(
         'header', to_jsonb(posted),
         'rows', (select jsonb_agg(to_jsonb(snapshot) order by snapshot.ordinal)
                  from posted_purchase_rows snapshot
                  where snapshot.pharmacy_id = posted.pharmacy_id
                    and snapshot.posted_purchase_id = posted.id)
       ) as bytes
       from posted_purchases posted where posted.pharmacy_id = $1 and posted.id = $2`,
      [pharmacyId, purchaseId],
    );
    return result.rows[0]?.bytes;
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
    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    return await requestAs(credentials, method, route, body);
  }

  async function requestAs(
    requestCredentials: Credentials,
    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: headers(requestCredentials, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body:
        text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>),
      status: response.status,
    };
  }
  function diagnostics(response: ApiResponse): string {
    return `${apiOutput}\n${JSON.stringify(response)}`;
  }

  async function createPostableDraft(
    supplierId: string,
    supplierInvoiceNumber: string,
    settlementContext: "cash" | "debt",
    rows: readonly DraftRowInput[],
  ): Promise<PurchaseDraft> {
    const created = await request("POST", "/purchases/drafts", {
      idempotencyKey: uuidV7(),
      invoiceDate: "2026-06-15",
      settlementContext,
      supplierId,
      supplierInvoiceNumber,
    });
    expect(created.status, diagnostics(created)).toBe(201);
    let draft = created.body?.draft as unknown as PurchaseDraft;
    for (const row of rows) {
      const committed = await request("POST", purchaseDraftRowsPath(draft.id), {
        costFils: row.costFils,
        enteredQuantity: row.enteredQuantity,
        expectedVersion: draft.version,
        expiryDate: "2029-12-31",
        idempotencyKey: uuidV7(),
        itemId: row.itemId,
        lotNumber: row.lotNumber ?? null,
        notes: null,
        pricing: {
          method: "by-price",
          retailPriceFils: row.retailPriceFils ?? "999999",
        },
        unit: { kind: "inventory-unit" },
      });
      expect(committed.status, diagnostics(committed)).toBe(201);
      draft = committed.body?.draft as unknown as PurchaseDraft;
    }
    return draft;
  }
});

function supplierBody(name: string, percentage: string, effectiveFrom: string) {
  return {
    allowanceEffectiveFrom: effectiveFrom,
    defaultAllowancePercentage: percentage,
    idempotencyKey: uuidV7(),
    name,
    terms: "Net 30",
  };
}

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
    evidence: draft.evidence,
    expectedVersion: draft.version,
    idempotencyKey: uuidV7(),
    reason: draft.reason,
    rows,
    supplierId: draft.supplierId,
    supplierInvoiceNumber: draft.supplierInvoiceNumber,
  };
}
function draftBody(
  supplierId: string,
  supplierInvoiceNumber: string,
  invoiceDate: string,
) {
  return {
    idempotencyKey: uuidV7(),
    invoiceDate,
    settlementContext: "debt" as const,
    supplierId,
    supplierInvoiceNumber,
  };
}
function medicationRequest(
  tradeName: string,
  coldStorageRequired: boolean,
): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار الترحيل",
    barcodes: [
      {
        kind: "product",
        value: randomBytes(6).toString("hex").padStart(13, "0").slice(0, 13),
      },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "GSK",
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
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired, manual: "blue" },
    stockLevels: { maximumLevel: null, minimumLevel: null, reorderPoint: null },
  };
}
function headers(
  credentials: Credentials,
  json: boolean,
): Record<string, string> {
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
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Local API did not start at ${origin}\n${diagnostics()}`);
}
async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string")
        reject(new Error("Could not reserve a port"));
      else resolve(address.port);
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
