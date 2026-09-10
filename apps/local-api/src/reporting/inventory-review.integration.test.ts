import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  inventoryItemListContract,
  inventoryMovementHistoryPath,
  inventorySensitiveExportContract,
  productArchivePath,
  purchasePostedPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type InventoryItem,
  type InventoryReviewPreferences,
  type InventorySensitiveExport,
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
import {
  applyWeightedAverageReceipt,
  EMPTY_INVENTORY_VALUATION,
  reportedAverageUnitCostScaled as reportAverage,
  valuationValueFils,
} from "../inventory/inventory-valuation.js";
import { divideFilsRounded } from "../posting/money.js";

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
      movements: "3",
    });
    expect(bundle.items[0]?.suppliers).toHaveLength(2);

    expect(await stockFacts()).toEqual(before);
  });

  it("rejects direct and maintenance-adjacent stock writes as the application role", async () => {
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
      ["inventory_batches", "id"],
      ["inventory_valuation_state", "product_id"],
      ["posted_purchases", "id"],
      ["posted_purchase_rows", "id"],
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

  async function createPostableDraft(
    supplierId: string,
    invoice: string,
    costFils: string,
    quantity: string,
    lotNumber: string,
    expiryDate: string,
  ): Promise<PurchaseDraft> {
    const created = await request("POST", "/purchases/drafts", {
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
      itemId: product.id,
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
