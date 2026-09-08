import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  purchaseDraftDiscardPath,
  purchaseDraftHeaderPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchasePostResult,
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
    method: "DELETE" | "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: headers(credentials, body !== undefined),
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
