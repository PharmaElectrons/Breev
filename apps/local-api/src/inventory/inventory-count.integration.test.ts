import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  countSessionCompletionPath,
  countSessionLinesPath,
  countSessionPath,
  countVarianceApplicationPath,
  inventoryBatchStatusChangePath,
  inventoryItemListContract,
  inventoryMovementHistoryPath,
  productPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type CountLine,
  type CountSession,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchasePostResult,
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
const OWNER_USERNAME = "inventory.count.owner";
const OWNER_PASSWORD = "inventory count owner password stays in this test";

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface PurchaseFixture {
  readonly batchId: string;
  readonly movementId: string;
}

interface StockedProduct {
  readonly product: Product;
  readonly purchases: readonly PurchaseFixture[];
}

describe.sequential("Inventory count PostgreSQL seam", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId = "";
  let invoiceSequence = 0;

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

    const bootstrap = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Inventory Count Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Inventory Count Pharmacy",
    });
    expect(bootstrap.status, diagnostics(bootstrap)).toBe(201);
    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.status, diagnostics(login)).toBe(200);
    pharmacyId = String(
      (login.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("1. runs the lifecycle, converts mixed units, allocates FEFO, and conserves valuation", async () => {
    const singleBatch = await createStockedProduct("Count lifecycle", [2]);
    const session = await startSession();
    const recorded = await recordLine(session, singleBatch.product.id, [
      packageEntry("2"),
      inventoryEntry("1"),
    ]);
    expect(recorded.line).toMatchObject({
      balanceAtObservation: "8",
      countedQuantity: "9",
      enteredLabel: "2 Pack + 1 Strip",
      varianceAtObservation: "1",
    });
    expect(recorded.line.application).toBeNull();

    const applied = await applyLine(
      recorded.session,
      recorded.line,
      "8",
      "Shelf count completed",
      "Signed count sheet 1",
    );
    expect(applied.line.application).toMatchObject({
      balanceAfter: "9",
      balanceBefore: "8",
      variance: "1",
      valuationMethod: "weighted-average-cost",
      journal: {
        lines: expect.arrayContaining([
          expect.objectContaining({ accountCode: "inventory" }),
          expect.objectContaining({
            accountCode: "inventory-count-variance",
          }),
        ]),
      },
    });
    expect(applied.session.number).toMatchObject({ series: "C" });

    const second = await createStockedProduct("Count second line", [1]);
    const secondRecorded = await recordLine(
      applied.session,
      second.product.id,
      [inventoryEntry("3")],
    );
    const secondApplied = await applyLine(
      secondRecorded.session,
      secondRecorded.line,
      "4",
      "Second shelf count",
      "Signed count sheet 2",
    );
    expect(secondApplied.session.number).toEqual(applied.session.number);

    // The later-received batch expires first, so FEFO must deplete it first
    // and receipt order must not decide the allocation.
    const multiBatch = await createStockedProduct(
      "Count FEFO",
      [1, 1],
      ["2029-12-31", "2027-06-30"],
    );
    const multiRecorded = await recordLine(
      secondApplied.session,
      multiBatch.product.id,
      [inventoryEntry("2")],
    );
    const multiApplied = await applyLine(
      multiRecorded.session,
      multiRecorded.line,
      "8",
      "FEFO shortage",
      "Signed count sheet 3",
    );
    expect(multiApplied.line.application?.variance).toBe("-6");
    expect(multiApplied.line.application?.movementIds).toHaveLength(2);
    const fefoMovements = await administrator.query<{
      batch_id: string;
      quantity: string;
    }>(
      `select movement.batch_id, movement.quantity::text
       from inventory_movements movement
       where movement.pharmacy_id = $1
         and movement.source_document_type = 'count-session'
         and movement.product_id = $2
       order by movement.quantity`,
      [pharmacyId, multiBatch.product.id],
    );
    expect(fefoMovements.rows).toEqual([
      { batch_id: multiBatch.purchases[1]!.batchId, quantity: "-4" },
      { batch_id: multiBatch.purchases[0]!.batchId, quantity: "-2" },
    ]);

    const blocked = await createStockedProduct("Count blocked", [2]);
    await quarantine(blocked.purchases[0]!.batchId);
    const blockedRecorded = await recordLine(
      multiApplied.session,
      blocked.product.id,
      [inventoryEntry("3")],
    );
    const blockedApply = await request(
      "POST",
      countVarianceApplicationPath(
        blockedRecorded.session.id,
        blockedRecorded.line.id,
      ),
      applyBody(blockedRecorded.session.version, "8"),
    );
    expect(blockedApply.status, diagnostics(blockedApply)).toBe(409);
    expect(blockedApply.body).toMatchObject({ code: "count-blocked-stock" });

    const movementFacts = await administrator.query<{
      carrying_amount_fils: string;
      quantity: string;
    }>(
      `select quantity::text, carrying_amount_fils::text
       from inventory_movements
       where pharmacy_id = $1 and source_document_type = 'count-session'
         and source_document_id = $2
       order by source_row_ordinal, occurred_at, id`,
      [pharmacyId, session.id],
    );
    expect(movementFacts.rows).toHaveLength(4);
    expect(
      movementFacts.rows
        .map((row) => BigInt(row.quantity))
        .reduce((sum, quantity) => sum + quantity, 0n),
    ).toBe(-6n);
    const valuation = await administrator.query<{
      total_quantity: string;
      total_value_scaled: string;
    }>(
      `select total_quantity::text, total_value_scaled::text
       from inventory_valuation_state where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, singleBatch.product.id],
    );
    const rawValue = await administrator.query<{ value: string }>(
      `select coalesce(sum(carrying_amount_fils), 0)::text as value
       from inventory_movements where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, singleBatch.product.id],
    );
    expect(valuation.rows[0]?.total_quantity).toBe("9");
    expect(valuation.rows[0]?.total_value_scaled).toBe(
      (BigInt(rawValue.rows[0]?.value ?? "0") * 10_000_000_000n).toString(),
    );
    const allocations = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_number_allocations
       where pharmacy_id = $1 and document_type = 'count-session'
         and document_id = $2 and status = 'issued'`,
      [pharmacyId, session.id],
    );
    expect(allocations.rows[0]?.count).toBe("1");
  }, 60_000);

  it("2. rolls back every posting fault together and reuses the committed number gap", async () => {
    const faultTargets = [
      "inventory_movements",
      "inventory_valuation_state",
      "inventory_count_variance_applications",
      "accounting_journal_lines",
      "posting_outbox_entries",
      "posting_command_results",
    ] as const;
    for (const target of faultTargets) {
      const fixture = await createStockedProduct(`Rollback ${target}`, [1]);
      const session = await startSession();
      const recorded = await recordLine(session, fixture.product.id, [
        inventoryEntry("3"),
      ]);
      const key = uuidV7();
      const before = await administrator.query<{
        journal: string;
        quantity: string;
        value: string;
        version: string;
      }>(
        `select coalesce((select sum(quantity) from inventory_movements
                  where pharmacy_id = $1 and product_id = $2), 0)::text as quantity,
                coalesce((select sum(carrying_amount_fils) from inventory_movements
                  where pharmacy_id = $1 and product_id = $2), 0)::text as value,
                (select count(*) from accounting_journal_entries
                  where pharmacy_id = $1 and template_id = 'inventory.count')::text as journal,
                version::text
         from inventory_count_sessions where pharmacy_id = $1 and id = $3`,
        [pharmacyId, fixture.product.id, session.id],
      );
      await installFault(target);
      let failed: ApiResponse;
      try {
        failed = await request(
          "POST",
          countVarianceApplicationPath(session.id, recorded.line.id),
          applyBody(recorded.session.version, "4", key),
        );
      } finally {
        await removeFault(target);
      }
      expect(failed.status, diagnostics(failed)).toBe(500);

      const rolledBack = await administrator.query<{
        applications: string;
        audits: string;
        commandResults: string;
        journal: string;
        movements: string;
        outbox: string;
        quantity: string;
        value: string;
        version: string;
      }>(
        `select
          (select count(*) from inventory_count_variance_applications
             where pharmacy_id = $1 and session_id = $2)::text as applications,
          (select count(*) from posting_audit_records
             where pharmacy_id = $1 and correlation_id = $3
               and outcome = 'committed')::text as audits,
          (select count(*) from posting_command_results
             where pharmacy_id = $1 and idempotency_key = $3)::text as "commandResults",
          (select count(*) from accounting_journal_entries
             where pharmacy_id = $1 and template_id = 'inventory.count')::text as journal,
          (select count(*) from inventory_movements
             where pharmacy_id = $1 and source_document_id = $2)::text as movements,
          (select count(*) from posting_outbox_entries
             where pharmacy_id = $1 and correlation_id = $3)::text as outbox,
          (select coalesce(sum(quantity), 0) from inventory_movements
             where pharmacy_id = $1 and product_id = $4)::text as quantity,
          (select coalesce(sum(carrying_amount_fils), 0) from inventory_movements
             where pharmacy_id = $1 and product_id = $4)::text as value,
          (select version from inventory_count_sessions
             where pharmacy_id = $1 and id = $2)::text as version`,
        [pharmacyId, session.id, key, fixture.product.id],
      );
      expect(rolledBack.rows[0]).toMatchObject({
        applications: "0",
        audits: "0",
        commandResults: "0",
        movements: "0",
        outbox: "0",
        quantity: before.rows[0]?.quantity,
        value: before.rows[0]?.value,
        version: before.rows[0]?.version,
      });
      expect(rolledBack.rows[0]?.journal).toBe(before.rows[0]?.journal);
      const allocation = await administrator.query<{ status: string }>(
        `select status from posting_number_allocations
         where pharmacy_id = $1 and document_type = 'count-session'
           and correlation_id = $2`,
        [pharmacyId, key],
      );
      expect(allocation.rows[0]?.status).toBe("allocated");

      const retry = await request(
        "POST",
        countVarianceApplicationPath(session.id, recorded.line.id),
        applyBody(recorded.session.version, "4", key),
      );
      expect(retry.status, diagnostics(retry)).toBe(201);
      const issued = await administrator.query<{ count: string }>(
        `select count(*)::text as count from posting_number_allocations
         where pharmacy_id = $1 and document_type = 'count-session'
           and correlation_id = $2 and status = 'issued'`,
        [pharmacyId, key],
      );
      expect(issued.rows[0]?.count).toBe("1");
    }
  }, 120_000);

  it("3. replays idempotent success and rejection while conflicting bodies are refused", async () => {
    const fixture = await createStockedProduct("Idempotency", [1]);
    const session = await startSession();
    const line = await recordLine(session, fixture.product.id, [
      inventoryEntry("3"),
    ]);
    const key = uuidV7();
    const body = applyBody(line.session.version, "4", key);
    const first = await request(
      "POST",
      countVarianceApplicationPath(line.session.id, line.line.id),
      body,
    );
    const replay = await request(
      "POST",
      countVarianceApplicationPath(line.session.id, line.line.id),
      body,
    );
    expect(first.status, diagnostics(first)).toBe(201);
    expect(replay).toEqual(first);
    const conflict = await request(
      "POST",
      countVarianceApplicationPath(line.session.id, line.line.id),
      { ...body, reason: "Different reason" },
    );
    expect(conflict.status, diagnostics(conflict)).toBe(409);
    expect(conflict.body).toMatchObject({ code: "idempotency-conflict" });

    const matched = await createStockedProduct("Rejected replay", [1]);
    const matchedSession = await startSession();
    const matchedLine = await recordLine(matchedSession, matched.product.id, [
      inventoryEntry("4"),
    ]);
    const rejectionBody = applyBody(matchedLine.session.version, "4");
    const rejection = await request(
      "POST",
      countVarianceApplicationPath(matchedLine.session.id, matchedLine.line.id),
      rejectionBody,
    );
    const rejectionReplay = await request(
      "POST",
      countVarianceApplicationPath(matchedLine.session.id, matchedLine.line.id),
      rejectionBody,
    );
    expect(rejection.status, diagnostics(rejection)).toBe(409);
    expect(rejection.body).toMatchObject({ code: "count-variance-zero" });
    expect(rejectionReplay).toEqual(rejection);
  }, 60_000);

  it("4. revalidates balances after concurrent purchases and rejects stale versions", async () => {
    const fixture = await createStockedProduct("Stale balance", [1]);
    const session = await startSession();
    const line = await recordLine(session, fixture.product.id, [
      inventoryEntry("3"),
    ]);
    await purchaseProduct(fixture.product, "1");
    const stale = await request(
      "POST",
      countVarianceApplicationPath(session.id, line.line.id),
      applyBody(line.session.version, "4"),
    );
    expect(stale.status, diagnostics(stale)).toBe(409);
    expect(stale.body).toMatchObject({ code: "count-balance-changed" });
    const current = await request("GET", countSessionPath(session.id));
    const currentSession = current.body as CountSession;
    const applied = await request(
      "POST",
      countVarianceApplicationPath(session.id, line.line.id),
      applyBody(currentSession.version, "8"),
    );
    expect(applied.status, diagnostics(applied)).toBe(201);
    expect(
      (applied.body as { line: CountLine }).line.application?.variance,
    ).toBe("-5");
    const staleVersion = await request(
      "POST",
      countSessionLinesPath(session.id),
      {
        entries: [inventoryEntry("2")],
        expectedVersion: line.session.version,
        idempotencyKey: uuidV7(),
        productId: fixture.product.id,
      },
    );
    expect(staleVersion.status, diagnostics(staleVersion)).toBe(409);
    expect(staleVersion.body).toMatchObject({ code: "version-conflict" });

    const concurrentA = await createStockedProduct("Concurrent A", [1]);
    const concurrentB = await createStockedProduct("Concurrent B", [1]);
    const concurrentSession = await startSession();
    const concurrent = await Promise.all([
      request("POST", countSessionLinesPath(concurrentSession.id), {
        entries: [inventoryEntry("3")],
        expectedVersion: concurrentSession.version,
        idempotencyKey: uuidV7(),
        productId: concurrentA.product.id,
      }),
      request("POST", countSessionLinesPath(concurrentSession.id), {
        entries: [inventoryEntry("3")],
        expectedVersion: concurrentSession.version,
        idempotencyKey: uuidV7(),
        productId: concurrentB.product.id,
      }),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([201, 409]);
  }, 60_000);

  it("5. protects completed sessions, lines, applications, movements, and journals from mutation", async () => {
    const fixture = await createStockedProduct("Append only", [1]);
    const session = await startSession();
    const line = await recordLine(session, fixture.product.id, [
      inventoryEntry("3"),
    ]);
    const applied = await applyLine(
      line.session,
      line.line,
      "4",
      "Append-only test",
      "Append-only evidence",
    );
    const application = applied.line.application!;
    const completed = await request(
      "POST",
      countSessionCompletionPath(session.id),
      { expectedVersion: applied.session.version, idempotencyKey: uuidV7() },
    );
    expect(completed.status, diagnostics(completed)).toBe(200);

    const mutations: (() => Promise<unknown>)[] = [
      () =>
        administrator.query(
          `update inventory_count_lines set entered_label = 'mutated'
         where pharmacy_id = $1 and id = $2`,
          [pharmacyId, line.line.id],
        ),
      () =>
        administrator.query(
          `delete from inventory_count_variance_applications
         where pharmacy_id = $1 and id = $2`,
          [pharmacyId, application.id],
        ),
      () =>
        administrator.query(
          `update inventory_movements set reason = 'count-variance'
         where pharmacy_id = $1 and id = any($2::uuid[])`,
          [pharmacyId, application.movementIds],
        ),
      () =>
        administrator.query(
          `update accounting_journal_lines set debit_fils = debit_fils
         where pharmacy_id = $1 and entry_id = $2`,
          [pharmacyId, application.journal!.entryId],
        ),
      () =>
        administrator.query(
          `update inventory_count_sessions set updated_by = updated_by
         where pharmacy_id = $1 and id = $2`,
          [pharmacyId, session.id],
        ),
    ];
    for (const mutation of mutations) {
      await expect(mutation()).rejects.toMatchObject({ code: "55000" });
    }
    await expect(
      administrator.query(
        `insert into inventory_count_lines (
           pharmacy_id, session_id, ordinal, product_id, item_display_name,
           inventory_unit_name, entries, entered_label, counted_quantity,
           balance_at_observation, variance_at_observation,
           blocked_quantity_at_observation, observed_by, device_id
         ) values ($1, $2, 99, $3, 'late', 'Strip', '[]', 'late', 1, 1, 0, 0, $4, $5)`,
        [
          pharmacyId,
          session.id,
          fixture.product.id,
          application.appliedBy.id,
          credentials.deviceId,
        ],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  }, 60_000);

  it("6. survives an API restart with the same durable lines and version", async () => {
    const fixture = await createStockedProduct("Restart", [1]);
    const session = await startSession();
    const recorded = await recordLine(session, fixture.product.id, [
      inventoryEntry("3"),
    ]);
    const before = await request("GET", countSessionPath(session.id));
    // A crash, not a graceful stop: nothing gets a chance to flush.
    const exited = new Promise<void>((resolve) =>
      api.once("exit", () => resolve()),
    );
    api.kill("SIGKILL");
    await exited;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    const after = await request("GET", countSessionPath(session.id));
    expect(after.status, diagnostics(after)).toBe(200);
    expect(after.body).toMatchObject({
      id: session.id,
      lines: [
        expect.objectContaining({
          id: recorded.line.id,
          countedQuantity: "3",
        }),
      ],
      version: recorded.session.version,
    });
    expect((after.body as CountSession).lines).toEqual(
      (before.body as CountSession).lines,
    );
  }, 60_000);

  it("7. rejects direct quantity edits and leaves raw inventory facts unchanged across reads", async () => {
    const fixture = await createStockedProduct("Boundary", [1]);
    const session = await startSession();
    const before = await authoritativeHash(fixture.product.id);
    const invalidLine = await request(
      "POST",
      countSessionLinesPath(session.id),
      {
        balance: "99",
        entries: [inventoryEntry("3")],
        expectedVersion: session.version,
        idempotencyKey: uuidV7(),
        productId: fixture.product.id,
      },
    );
    expect(invalidLine.status, diagnostics(invalidLine)).toBe(400);
    expect(invalidLine.body).toMatchObject({
      code: "body-invalid",
      fieldErrors: [expect.objectContaining({ code: "unknown-field" })],
    });
    const invalidProduct = await request(
      "PUT",
      productPath(fixture.product.id),
      {
        balance: "99",
      },
    );
    expect(invalidProduct.status, diagnostics(invalidProduct)).toBe(400);
    expect(invalidProduct.body).toMatchObject({ code: "body-invalid" });
    expect(
      (invalidProduct.body as { fieldErrors: unknown[] }).fieldErrors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field" }),
      ]),
    );
    await request("GET", countSessionPath(session.id));
    await request("GET", "/inventory/count-sessions");
    await request("GET", inventoryItemListContract.path);
    await request("GET", inventoryMovementHistoryPath(fixture.product.id));
    expect(await authoritativeHash(fixture.product.id)).toBe(before);
    const catalogColumns = await administrator.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'catalog_products'
         and column_name ~ '(quantity|balance|stock)'`,
    );
    expect(catalogColumns.rows).toEqual([]);
  }, 60_000);

  it("8. reconciles raw movements, exposes the count reference, and excludes shortage from consumption", async () => {
    const fixture = await createStockedProduct("Reconciliation", [2]);
    const session = await startSession();
    const recorded = await recordLine(session, fixture.product.id, [
      inventoryEntry("3"),
    ]);
    const applied = await applyLine(
      recorded.session,
      recorded.line,
      "8",
      "Reconciliation shortage",
      "Reconciliation evidence",
    );
    const items = await request("GET", inventoryItemListContract.path);
    expect(items.status, diagnostics(items)).toBe(200);
    const item = (
      items.body as {
        items: Array<{
          balance: string;
          consumptionRatePer30Days: string;
          productId: string;
          reconciliation: string;
        }>;
      }
    ).items.find(({ productId }) => productId === fixture.product.id);
    expect(item).toMatchObject({
      balance: "3",
      consumptionRatePer30Days: "0",
      reconciliation: "consistent",
    });
    const history = await request(
      "GET",
      inventoryMovementHistoryPath(fixture.product.id),
    );
    expect(history.status, diagnostics(history)).toBe(200);
    const countMovement = (
      history.body as {
        movements: Array<{
          kind: string;
          quantity: string;
          reference: {
            documentType: string;
            label: string;
            number: { series: string } | null;
            openable: boolean;
          };
        }>;
      }
    ).movements.find(({ kind }) => kind === "count-variance");
    expect(countMovement).toMatchObject({
      kind: "count-variance",
      quantity: "-5",
      reference: {
        documentType: "count-session",
        label: `C${applied.session.number!.value}/${applied.session.number!.year} · line 1`,
        number: { series: "C" },
        openable: true,
      },
    });
  }, 60_000);

  async function startSession(): Promise<CountSession> {
    const response = await request("POST", "/inventory/count-sessions", {
      idempotencyKey: uuidV7(),
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as CountSession;
  }

  async function recordLine(
    session: CountSession,
    productId: string,
    entries: readonly unknown[],
  ): Promise<{ readonly line: CountLine; readonly session: CountSession }> {
    const response = await request("POST", countSessionLinesPath(session.id), {
      entries,
      expectedVersion: session.version,
      idempotencyKey: uuidV7(),
      productId,
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as { line: CountLine; session: CountSession };
  }

  async function applyLine(
    session: CountSession,
    line: CountLine,
    expectedBalanceBefore: string,
    reason: string,
    evidence: string,
  ): Promise<{ readonly line: CountLine; readonly session: CountSession }> {
    const response = await request(
      "POST",
      countVarianceApplicationPath(session.id, line.id),
      applyBody(
        session.version,
        expectedBalanceBefore,
        undefined,
        reason,
        evidence,
      ),
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as { line: CountLine; session: CountSession };
  }

  async function createStockedProduct(
    name: string,
    purchaseQuantities: readonly (number | string)[],
    expiryDates: readonly string[] = [],
  ): Promise<StockedProduct> {
    const created = await request(
      "POST",
      "/catalog/products",
      medicationRequest(name),
    );
    expect(created.status, diagnostics(created)).toBe(201);
    const product = created.body as Product;
    const purchases: PurchaseFixture[] = [];
    for (const [index, quantity] of purchaseQuantities.entries()) {
      purchases.push(
        await purchaseProduct(product, String(quantity), expiryDates[index]),
      );
    }
    return { product, purchases };
  }

  async function purchaseProduct(
    product: Product,
    enteredQuantity: string,
    expiryDate = "2029-12-31",
  ): Promise<PurchaseFixture> {
    const draftResponse = await request("POST", "/purchases/drafts", {
      idempotencyKey: uuidV7(),
      invoiceDate: "2026-06-15",
      settlementContext: "debt",
      supplierId: await supplierId(),
      supplierInvoiceNumber: `COUNT-${String(++invoiceSequence)}`,
    });
    expect(draftResponse.status, diagnostics(draftResponse)).toBe(201);
    let draft = (draftResponse.body as { draft: PurchaseDraft }).draft;
    const rowResponse = await request("POST", purchaseDraftRowsPath(draft.id), {
      costFils: "1000",
      enteredQuantity,
      expectedVersion: draft.version,
      expiryDate,
      idempotencyKey: uuidV7(),
      itemId: product.id,
      lotNumber: `COUNT-LOT-${String(invoiceSequence)}`,
      notes: null,
      pricing: { method: "by-price", retailPriceFils: "999999" },
      unit: { kind: "package-unit", packageUnitName: "Pack" },
    });
    expect(rowResponse.status, diagnostics(rowResponse)).toBe(201);
    draft = (rowResponse.body as { draft: PurchaseDraft }).draft;
    const posted = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(posted.status, diagnostics(posted)).toBe(201);
    const result = posted.body as PurchasePostResult;
    const row = result.posted.rows[0];
    if (row === undefined)
      throw new Error("The count test purchase had no row");
    return { batchId: row.batchId, movementId: row.movementId };
  }

  let cachedSupplierId: string | undefined;
  async function supplierId(): Promise<string> {
    if (cachedSupplierId !== undefined) return cachedSupplierId;
    const response = await request("POST", "/suppliers", {
      allowanceEffectiveFrom: "2026-01-01",
      defaultAllowancePercentage: "0",
      idempotencyKey: uuidV7(),
      name: "Inventory Count Supplier",
      terms: "Net 30",
    });
    expect(response.status, diagnostics(response)).toBe(201);
    cachedSupplierId = String((response.body as { id: string }).id);
    return cachedSupplierId;
  }

  async function quarantine(batchId: string): Promise<void> {
    const response = await request(
      "POST",
      inventoryBatchStatusChangePath(batchId),
      {
        evidence: "Quarantine evidence for count test",
        idempotencyKey: uuidV7(),
        kind: "quarantine",
        reason: "Quarantine for count test",
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
  }

  async function installFault(target: FaultTarget): Promise<void> {
    const triggerEvent =
      target === "posting_outbox_entries"
        ? "if new.event_type = 'inventory.count.variance-applied' then"
        : target === "posting_command_results"
          ? "if new.command_name = 'inventory.count.variance.apply' then"
          : "if true then";
    const timing =
      target === "inventory_valuation_state"
        ? "before update"
        : "before insert";
    await administrator.query(
      `create function count_test_fault() returns trigger language plpgsql as $$
       begin ${triggerEvent}
         raise exception 'count test injected failure' using errcode = 'P0001';
       end if; return new; end; $$`,
    );
    await administrator.query(
      `create trigger count_test_fault_trigger ${timing} on ${target}
       for each row execute function count_test_fault()`,
    );
  }

  async function removeFault(target: FaultTarget): Promise<void> {
    await administrator.query(
      `drop trigger count_test_fault_trigger on ${target}`,
    );
    await administrator.query("drop function count_test_fault()");
  }

  async function authoritativeHash(productId: string): Promise<string> {
    const result = await administrator.query<{ hash: string }>(
      `select md5(coalesce(string_agg(payload, '|' order by payload), '')) as hash
       from (
         select concat('movement:', id::text, ':', quantity::text, ':',
                       carrying_amount_fils::text) as payload
         from inventory_movements where pharmacy_id = $1 and product_id = $2
         union all
         select concat('batch:', id::text, ':', quantity::text, ':', status::text)
         from inventory_batches where pharmacy_id = $1 and product_id = $2
         union all
         select concat('valuation:', product_id::text, ':', total_quantity::text,
                       ':', total_value_scaled::text)
         from inventory_valuation_state where pharmacy_id = $1 and product_id = $2
       ) facts`,
      [pharmacyId, productId],
    );
    return result.rows[0]?.hash ?? "";
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
    method: "GET" | "POST" | "PUT",
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

type FaultTarget =
  | "accounting_journal_lines"
  | "inventory_count_variance_applications"
  | "inventory_movements"
  | "inventory_valuation_state"
  | "posting_command_results"
  | "posting_outbox_entries";

function applyBody(
  expectedVersion: string,
  expectedBalanceBefore: string,
  idempotencyKey = uuidV7(),
  reason = "Count variance reason",
  evidence = "Count variance evidence",
) {
  return {
    evidence,
    expectedBalanceBefore,
    expectedVersion,
    idempotencyKey,
    reason,
  };
}

function packageEntry(count: string) {
  return {
    count,
    unit: { kind: "package-unit", packageUnitName: "Pack" },
  };
}

function inventoryEntry(count: string) {
  return { count, unit: { kind: "inventory-unit" } };
}

function medicationRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار الجرد",
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
        count: { kind: "package-unit", packageUnitName: "Pack" },
        purchase: { kind: "package-unit", packageUnitName: "Pack" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Strip",
      packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
      thirdUnit: null,
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: "90000",
    },
    scientificName: "Paracetamol",
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: "blue" },
    stockLevels: { maximumLevel: null, minimumLevel: null, reorderPoint: null },
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
