import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  productArchivePath,
  productPath,
  productMergePath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  reorderBasketPath,
  reorderItemConfirmationsPath,
  reorderItemPath,
  reorderItemRemovalsPath,
  reorderItemReturnsPath,
  reorderItemsPath,
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
const OWNER_USERNAME = "inventory.reorder.integration.owner";
const OWNER_PASSWORD =
  "inventory reorder integration owner password stays in this test";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ReorderItem {
  readonly id: string;
  readonly productId: string;
  readonly status: "basket" | "ordered";
  readonly version: string;
  readonly quantity: string;
  readonly inventory: { readonly balance: string };
  readonly quantityEditedAt: string | null;
  readonly proposal: {
    readonly balance: string;
    readonly basis: string;
    readonly maximumLevel: string | null;
    readonly quantity: string;
  };
  readonly projection: {
    readonly projectedLevel: string;
    readonly warning: string | null;
  };
  readonly product: {
    readonly status: "active" | "archived" | "merged";
    readonly mergedIntoProductId: string | null;
  };
  readonly orderedAt: string | null;
}

interface ReorderResponse {
  readonly item: ReorderItem;
  readonly outcome?: string;
}

describe.sequential("Inventory reorder PostgreSQL seam", () => {
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
  let cachedSupplierId = "";

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
        displayName: "Inventory Reorder Integration Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Inventory Reorder Integration Pharmacy",
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
    await ensureSupplier();
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("1. runs the lifecycle and leaves review and movement facts unchanged", async () => {
    const productA = await createProduct("Reorder lifecycle A", "60", 2);
    const productB = await createProduct("Reorder lifecycle B", null, 0);
    const productC = await createProduct("Reorder lifecycle C", "4", 2);
    const before = await authoritativeHash(productA.id);

    const added = await add(productA.id);
    expect(added.item).toMatchObject({
      quantity: "52",
      proposal: {
        balance: "8",
        basis: "maximum-minus-balance",
        maximumLevel: "60",
        quantity: "52",
      },
      projection: { projectedLevel: "60", warning: null },
      status: "basket",
    });
    expect(added.item.inventory.balance).toBe("8");
    expect(await authoritativeHash(productA.id)).toBe(before);

    const noMaximum = await add(productB.id);
    expect(noMaximum.item).toMatchObject({
      quantity: "0",
      proposal: { basis: "no-maximum-level", quantity: "0" },
      projection: { projectedLevel: "0", warning: null },
    });
    const aboveMaximum = await add(productC.id);
    expect(aboveMaximum.item).toMatchObject({
      quantity: "0",
      proposal: { basis: "balance-at-or-above-maximum", quantity: "0" },
    });

    const edited = await update(
      productA.id,
      added.item.id,
      "60",
      added.item.version,
    );
    expect(edited.item).toMatchObject({
      quantity: "60",
      projection: { projectedLevel: "68", warning: "surplus" },
    });
    expect(await authoritativeHash(productA.id)).toBe(before);

    const confirmed = await confirm(edited.item.id, edited.item.version);
    expect(confirmed.item).toMatchObject({
      orderedAt: expect.any(String),
      quantity: "60",
      status: "ordered",
    });
    expect(await authoritativeHash(productA.id)).toBe(before);

    const returned = await returnItem(
      confirmed.item.id,
      confirmed.item.version,
    );
    expect(returned.item).toMatchObject({
      quantity: "60",
      status: "basket",
    });
    expect(await authoritativeHash(productA.id)).toBe(before);

    const removed = await removeItem(returned.item.id, returned.item.version);
    expect(removed.body).toMatchObject({
      itemId: returned.item.id,
      removedAt: expect.any(String),
    });
    expect(await authoritativeHash(productA.id)).toBe(before);
    // A removed row is gone from the wire: later commands cannot find it.
    const removedUpdate = await request(
      "PUT",
      reorderItemPath(returned.item.id),
      {
        expectedVersion: removedRowVersion(returned.item.version),
        idempotencyKey: uuidV7(),
        quantity: "1",
      },
    );
    expect(removedUpdate.status, diagnostics(removedUpdate)).toBe(404);
    expect(removedUpdate.body).toMatchObject({
      code: "reorder-item-not-found",
    });

    const readded = await add(productA.id);
    expect(readded.item.id).not.toBe(returned.item.id);
    expect(readded.item.quantity).toBe("52");
    const live = await administrator.query<{ count: string }>(
      `select count(*)::text as count from inventory_reorder_items
       where pharmacy_id = $1 and product_id = $2 and status <> 'removed'`,
      [pharmacyId, productA.id],
    );
    expect(live.rows[0]?.count).toBe("1");
  }, 90_000);

  it("2. serializes and replays idempotent adds with deterministic re-add behavior", async () => {
    const product = await createProduct("Reorder add idempotency", "60", 1);
    const key = uuidV7();
    const body = { idempotencyKey: key, productId: product.id };
    const first = await request("POST", reorderItemsPath(), body);
    const replay = await request("POST", reorderItemsPath(), body);
    expect(first.status, diagnostics(first)).toBe(200);
    expect(replay).toEqual(first);

    const other = await createProduct("Reorder add conflict", "60", 1);
    const conflict = await request("POST", reorderItemsPath(), {
      ...body,
      productId: other.id,
    });
    expect(conflict.status, diagnostics(conflict)).toBe(409);
    expect(conflict.body).toMatchObject({ code: "idempotency-conflict" });

    const concurrentProduct = await createProduct(
      "Reorder concurrent adds",
      "60",
      1,
    );
    const concurrent = await Promise.all([
      request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: concurrentProduct.id,
      }),
      request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: concurrentProduct.id,
      }),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([200, 200]);
    const concurrentItems = concurrent.map(
      (response) => response.body as ReorderResponse,
    );
    expect(concurrentItems.map(({ outcome }) => outcome).sort()).toEqual([
      "added",
      "updated",
    ]);
    expect(concurrentItems[0]?.item.id).toBe(concurrentItems[1]?.item.id);
    expect(
      concurrentItems.find(({ outcome }) => outcome === "updated")?.item
        .version,
    ).toBe("2");
    const concurrentLive = await administrator.query<{ count: string }>(
      `select count(*)::text as count from inventory_reorder_items
       where pharmacy_id = $1 and product_id = $2 and status <> 'removed'`,
      [pharmacyId, concurrentProduct.id],
    );
    expect(concurrentLive.rows[0]?.count).toBe("1");

    const manual = await add(product.id);
    await update(product.id, manual.item.id, "9", manual.item.version);
    const preserved = await add(product.id);
    expect(preserved.item.quantity).toBe("9");
    expect(preserved.item.quantityEditedAt).not.toBeNull();

    const refreshedProduct = await createProduct(
      "Reorder proposal refresh",
      "60",
      1,
    );
    const initial = await add(refreshedProduct.id);
    await purchaseProduct(refreshedProduct, "2");
    const refreshed = await add(refreshedProduct.id);
    expect(initial.item.quantity).toBe("56");
    expect(refreshed.item).toMatchObject({
      quantity: "48",
      proposal: { balance: "12", quantity: "48" },
    });

    const orderedProduct = await createProduct(
      "Reorder already ordered",
      "60",
      1,
    );
    const ordered = await add(orderedProduct.id);
    const confirmed = await confirm(ordered.item.id, ordered.item.version);
    const alreadyOrdered = await add(orderedProduct.id);
    expect(alreadyOrdered).toMatchObject({
      outcome: "already-ordered",
      item: {
        id: ordered.item.id,
        status: "ordered",
        version: confirmed.item.version,
      },
    });
  }, 90_000);

  it("3. replays every transition and every rejected command without a second write", async () => {
    const updateProduct = await createProduct("Reorder update replay", "60", 1);
    const updateRow = await add(updateProduct.id);
    const updateBody = {
      expectedVersion: updateRow.item.version,
      idempotencyKey: uuidV7(),
      quantity: "7",
    };
    const updateFirst = await request(
      "PUT",
      reorderItemPath(updateRow.item.id),
      updateBody,
    );
    const updateReplay = await request(
      "PUT",
      reorderItemPath(updateRow.item.id),
      updateBody,
    );
    expect(updateReplay).toEqual(updateFirst);
    const updateConflict = await request(
      "PUT",
      reorderItemPath(updateRow.item.id),
      { ...updateBody, quantity: "8" },
    );
    expect(updateConflict.body).toMatchObject({ code: "idempotency-conflict" });

    const removeProduct = await createProduct("Reorder remove replay", "60", 1);
    const removeRow = await add(removeProduct.id);
    const removeBody = transitionBody(removeRow.item.version);
    const removeFirst = await request(
      "POST",
      reorderItemRemovalsPath(removeRow.item.id),
      removeBody,
    );
    const removeReplay = await request(
      "POST",
      reorderItemRemovalsPath(removeRow.item.id),
      removeBody,
    );
    expect(removeReplay).toEqual(removeFirst);
    const removeConflict = await request(
      "POST",
      reorderItemRemovalsPath(removeRow.item.id),
      { ...removeBody, expectedVersion: "2" },
    );
    expect(removeConflict.body).toMatchObject({ code: "idempotency-conflict" });

    const transitionProduct = await createProduct(
      "Reorder transition replay",
      "60",
      1,
    );
    const transitionRow = await add(transitionProduct.id);
    const confirmBody = transitionBody(transitionRow.item.version);
    const confirmFirst = await request(
      "POST",
      reorderItemConfirmationsPath(transitionRow.item.id),
      confirmBody,
    );
    const confirmReplay = await request(
      "POST",
      reorderItemConfirmationsPath(transitionRow.item.id),
      confirmBody,
    );
    expect(confirmReplay).toEqual(confirmFirst);
    const returnBody = transitionBody(
      (confirmFirst.body as ReorderResponse).item.version,
    );
    const returnFirst = await request(
      "POST",
      reorderItemReturnsPath(transitionRow.item.id),
      returnBody,
    );
    const returnReplay = await request(
      "POST",
      reorderItemReturnsPath(transitionRow.item.id),
      returnBody,
    );
    expect(returnReplay).toEqual(returnFirst);

    const rejectedProduct = await createProduct(
      "Reorder rejected replay",
      null,
      0,
    );
    const rejectedRow = await add(rejectedProduct.id);
    const rejectedBody = transitionBody(rejectedRow.item.version);
    const rejection = await request(
      "POST",
      reorderItemConfirmationsPath(rejectedRow.item.id),
      rejectedBody,
    );
    const rejectionReplay = await request(
      "POST",
      reorderItemConfirmationsPath(rejectedRow.item.id),
      rejectedBody,
    );
    expect(rejection.status, diagnostics(rejection)).toBe(409);
    expect(rejection.body).toMatchObject({ code: "reorder-quantity-zero" });
    expect(rejectionReplay).toEqual(rejection);
  }, 90_000);

  it("4. enforces versions, transitions, inactive products, and merged-product reads", async () => {
    const staleProduct = await createProduct("Reorder stale version", "60", 1);
    const staleRow = await add(staleProduct.id);
    const edited = await update(
      staleProduct.id,
      staleRow.item.id,
      "7",
      staleRow.item.version,
    );
    const stale = await request("PUT", reorderItemPath(staleRow.item.id), {
      expectedVersion: staleRow.item.version,
      idempotencyKey: uuidV7(),
      quantity: "8",
    });
    expect(stale.status, diagnostics(stale)).toBe(409);
    expect(stale.body).toMatchObject({ code: "version-conflict" });

    const orderedProduct = await createProduct(
      "Reorder invalid states",
      "60",
      1,
    );
    const orderedRow = await add(orderedProduct.id);
    const ordered = await confirm(orderedRow.item.id, orderedRow.item.version);
    const removeOrdered = await request(
      "POST",
      reorderItemRemovalsPath(ordered.item.id),
      transitionBody(ordered.item.version),
    );
    expect(removeOrdered.body).toMatchObject({
      code: "reorder-item-status-invalid",
    });
    const confirmOrdered = await request(
      "POST",
      reorderItemConfirmationsPath(ordered.item.id),
      transitionBody(ordered.item.version),
    );
    expect(confirmOrdered.body).toMatchObject({
      code: "reorder-item-status-invalid",
    });
    const returnBasket = await request(
      "POST",
      reorderItemReturnsPath(staleRow.item.id),
      transitionBody(edited.item.version),
    );
    expect(returnBasket.body).toMatchObject({
      code: "reorder-item-status-invalid",
    });

    const zeroProduct = await createProduct("Reorder zero quantity", null, 0);
    const zero = await add(zeroProduct.id);
    const zeroConfirm = await request(
      "POST",
      reorderItemConfirmationsPath(zero.item.id),
      transitionBody(zero.item.version),
    );
    expect(zeroConfirm.body).toMatchObject({ code: "reorder-quantity-zero" });

    const archivedProduct = await createProduct("Reorder archived", "60", 1);
    const archived = await add(archivedProduct.id);
    const archivedResult = await archiveProduct(archivedProduct.id);
    expect(archivedResult.status, diagnostics(archivedResult)).toBe(201);
    const archivedUpdate = await request(
      "PUT",
      reorderItemPath(archived.item.id),
      {
        expectedVersion: archived.item.version,
        idempotencyKey: uuidV7(),
        quantity: "3",
      },
    );
    expect(archivedUpdate.body).toMatchObject({
      code: "reorder-product-inactive",
    });
    const archivedConfirm = await request(
      "POST",
      reorderItemConfirmationsPath(archived.item.id),
      transitionBody(archived.item.version),
    );
    expect(archivedConfirm.body).toMatchObject({
      code: "reorder-product-inactive",
    });
    const archivedRemove = await removeItem(
      archived.item.id,
      archived.item.version,
    );
    expect(archivedRemove.status).toBe(200);

    const orderedArchivedProduct = await createProduct(
      "Reorder ordered archived",
      "60",
      1,
    );
    const orderedArchived = await add(orderedArchivedProduct.id);
    const orderedArchivedConfirmed = await confirm(
      orderedArchived.item.id,
      orderedArchived.item.version,
    );
    const archivedOrderedResult = await archiveProduct(
      orderedArchivedProduct.id,
    );
    expect(archivedOrderedResult.status).toBe(201);
    const returnedArchived = await returnItem(
      orderedArchivedConfirmed.item.id,
      orderedArchivedConfirmed.item.version,
    );
    expect(returnedArchived.item.status).toBe("basket");

    const survivor = await createProduct("Reorder merge survivor", "60", 0);
    const merged = await createProduct("Reorder merged source", "60", 0);
    const mergedRow = await add(merged.id);
    const merge = await request("POST", productMergePath(merged.id), {
      expectedRevision: merged.revision,
      idempotencyKey: uuidV7(),
      survivorProductId: survivor.id,
    });
    expect(merge.status, diagnostics(merge)).toBe(201);
    const mergedRead = await readItems();
    expect(itemFor(mergedRead, merged.id).product).toMatchObject({
      mergedIntoProductId: survivor.id,
      status: "merged",
    });
    const mergedRemove = await removeItem(
      mergedRow.item.id,
      mergedRow.item.version,
    );
    expect(mergedRemove.status).toBe(200);
  }, 90_000);

  it("5. preserves append-only reorder rows and rejects invalid direct mutations", async () => {
    const product = await createProduct("Reorder immutable", "60", 1);
    const row = await add(product.id);
    const transition = await confirm(row.item.id, row.item.version);
    const removedSource = await createProduct(
      "Reorder immutable removed",
      "60",
      1,
    );
    const removed = await add(removedSource.id);
    const removedResponse = await removeItem(
      removed.item.id,
      removed.item.version,
    );
    const removedItemId = String(
      (removedResponse.body as { itemId: string }).itemId,
    );

    const mutations: (() => Promise<unknown>)[] = [
      () =>
        administrator.query(
          `delete from inventory_reorder_items where pharmacy_id = $1 and id = $2`,
          [pharmacyId, transition.item.id],
        ),
      () =>
        administrator.query(
          `update inventory_reorder_items set quantity = quantity
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, removedItemId],
        ),
      () =>
        administrator.query(
          `update inventory_reorder_items set version = version + 2
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, transition.item.id],
        ),
      () =>
        administrator.query(
          `update inventory_reorder_items set status = 'removed'
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, transition.item.id],
        ),
    ];
    for (const mutation of mutations) {
      await expect(mutation()).rejects.toMatchObject({ code: "55000" });
    }
  }, 60_000);

  it("6. survives an API restart with durable basket and Ordered Items state", async () => {
    const product = await createProduct("Reorder restart", "60", 1);
    const added = await add(product.id);
    const edited = await update(
      product.id,
      added.item.id,
      "7",
      added.item.version,
    );
    const confirmed = await confirm(edited.item.id, edited.item.version);
    const before = await readItems();

    const exited = new Promise<void>((resolve) =>
      api.once("exit", () => resolve()),
    );
    api.kill("SIGKILL");
    await exited;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);

    const after = await readItems();
    expect(after).toEqual(before);
    expect(itemFor(after, product.id)).toMatchObject({
      id: confirmed.item.id,
      quantity: "7",
      status: "ordered",
      version: confirmed.item.version,
    });
  }, 60_000);

  it("7. rolls back the row, audit, and result together when recording fails", async () => {
    const product = await createProduct("Reorder rollback", "60", 1);
    const added = await add(product.id);
    const body = transitionBody(added.item.version);
    const beforeCommandResults = await confirmCommandResultCount();
    await installConfirmFault();
    let failed: ApiResponse;
    try {
      failed = await request(
        "POST",
        reorderItemConfirmationsPath(added.item.id),
        body,
      );
    } finally {
      await removeConfirmFault();
    }
    expect(failed.status, diagnostics(failed)).toBe(500);

    const afterFailure = itemFor(await readItems(), product.id);
    expect(afterFailure).toMatchObject({
      id: added.item.id,
      status: "basket",
      version: added.item.version,
    });
    expect(await confirmCommandResultCount()).toBe(beforeCommandResults);
    expect(await committedAuditCount(body.idempotencyKey)).toBe("0");

    const retry = await request(
      "POST",
      reorderItemConfirmationsPath(added.item.id),
      body,
    );
    expect(retry.status, diagnostics(retry)).toBe(200);
    expect((retry.body as ReorderResponse).item.status).toBe("ordered");
    expect(await confirmCommandResultCount()).toBe(
      String(BigInt(beforeCommandResults) + 1n),
    );
    expect(await committedAuditCount(body.idempotencyKey)).toBe("1");
  }, 60_000);

  async function add(productId: string): Promise<ReorderResponse> {
    const response = await request("POST", reorderItemsPath(), {
      idempotencyKey: uuidV7(),
      productId,
    });
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as ReorderResponse;
  }

  async function update(
    _productId: string,
    itemId: string,
    quantity: string,
    expectedVersion: string,
  ): Promise<ReorderResponse> {
    const response = await request("PUT", reorderItemPath(itemId), {
      expectedVersion,
      idempotencyKey: uuidV7(),
      quantity,
    });
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as ReorderResponse;
  }

  async function removeItem(
    itemId: string,
    expectedVersion: string,
  ): Promise<ApiResponse> {
    return await request(
      "POST",
      reorderItemRemovalsPath(itemId),
      transitionBody(expectedVersion),
    );
  }

  async function confirm(
    itemId: string,
    expectedVersion: string,
  ): Promise<ReorderResponse> {
    const response = await request(
      "POST",
      reorderItemConfirmationsPath(itemId),
      transitionBody(expectedVersion),
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as ReorderResponse;
  }

  async function returnItem(
    itemId: string,
    expectedVersion: string,
  ): Promise<ReorderResponse> {
    const response = await request(
      "POST",
      reorderItemReturnsPath(itemId),
      transitionBody(expectedVersion),
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as ReorderResponse;
  }

  async function readItems(): Promise<readonly ReorderItem[]> {
    const response = await request("GET", reorderBasketPath());
    expect(response.status, diagnostics(response)).toBe(200);
    return (response.body as { items: readonly ReorderItem[] }).items;
  }

  async function createProduct(
    name: string,
    maximumLevel: string | null,
    purchasePacks: number,
  ): Promise<Product> {
    const created = await request(
      "POST",
      "/catalog/products",
      productRequest(name, maximumLevel),
    );
    expect(created.status, diagnostics(created)).toBe(201);
    const product = created.body as Product;
    if (purchasePacks > 0)
      await purchaseProduct(product, String(purchasePacks));
    return product;
  }

  /**
   * A posted purchase advances the product revision (retail price sync), so
   * an archive must carry the current revision, not the creation one.
   */
  async function archiveProduct(productId: string): Promise<ApiResponse> {
    const current = await request("GET", productPath(productId));
    expect(current.status, diagnostics(current)).toBe(200);
    return await request("POST", productArchivePath(productId), {
      expectedRevision: (current.body as Product).revision,
      idempotencyKey: uuidV7(),
    });
  }

  async function purchaseProduct(
    product: Product,
    enteredQuantity: string,
  ): Promise<void> {
    const draftResponse = await request("POST", "/purchases/drafts", {
      idempotencyKey: uuidV7(),
      invoiceDate: "2026-06-15",
      settlementContext: "debt",
      supplierId: await ensureSupplier(),
      supplierInvoiceNumber: `REORDER-${String(++invoiceSequence)}`,
    });
    expect(draftResponse.status, diagnostics(draftResponse)).toBe(201);
    let draft = (draftResponse.body as { draft: PurchaseDraft }).draft;
    const rowResponse = await request("POST", purchaseDraftRowsPath(draft.id), {
      costFils: "1000",
      enteredQuantity,
      expectedVersion: draft.version,
      expiryDate: "2029-12-31",
      idempotencyKey: uuidV7(),
      itemId: product.id,
      lotNumber: `REORDER-LOT-${String(invoiceSequence)}`,
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
    expect(result.posted.rows[0]).toBeDefined();
  }

  async function ensureSupplier(): Promise<string> {
    if (cachedSupplierId !== "") return cachedSupplierId;
    const response = await request("POST", "/suppliers", {
      allowanceEffectiveFrom: "2026-01-01",
      defaultAllowancePercentage: "0",
      idempotencyKey: uuidV7(),
      name: "Inventory Reorder Integration Supplier",
      terms: "Net 30",
    });
    expect(response.status, diagnostics(response)).toBe(201);
    cachedSupplierId = String((response.body as { id: string }).id);
    return cachedSupplierId;
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

  async function installConfirmFault(): Promise<void> {
    await administrator.query(
      `create function reorder_test_fault() returns trigger language plpgsql as $$
       begin
         if new.command_name = 'inventory.reorder.item.confirm' then
           raise exception 'reorder test injected failure' using errcode = 'P0001';
         end if;
         return new;
       end; $$`,
    );
    await administrator.query(
      `create trigger reorder_test_fault_trigger before insert
       on posting_command_results for each row
       execute function reorder_test_fault()`,
    );
  }

  async function removeConfirmFault(): Promise<void> {
    await administrator.query(
      `drop trigger reorder_test_fault_trigger on posting_command_results`,
    );
    await administrator.query("drop function reorder_test_fault()");
  }

  async function confirmCommandResultCount(): Promise<string> {
    const result = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
       where pharmacy_id = $1 and command_name = 'inventory.reorder.item.confirm'`,
      [pharmacyId],
    );
    return result.rows[0]?.count ?? "0";
  }

  async function committedAuditCount(idempotencyKey: string): Promise<string> {
    const result = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where pharmacy_id = $1 and correlation_id = $2 and outcome = 'committed'`,
      [pharmacyId, idempotencyKey],
    );
    return result.rows[0]?.count ?? "0";
  }
});

function productRequest(
  tradeName: string,
  maximumLevel: string | null,
): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار سلة الطلبات",
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
    stockLevels: {
      maximumLevel,
      // Catalog refuses a maximum below the minimum, so a small maximum
      // (the balance-above-maximum case) carries proportionally small levels.
      minimumLevel:
        maximumLevel === null ? null : BigInt(maximumLevel) >= 20n ? "10" : "1",
      reorderPoint:
        maximumLevel === null ? null : BigInt(maximumLevel) >= 20n ? "20" : "2",
    },
  };
}

function removedRowVersion(versionBeforeRemoval: string): string {
  return String(BigInt(versionBeforeRemoval) + 1n);
}

function transitionBody(expectedVersion: string) {
  return { expectedVersion, idempotencyKey: uuidV7() };
}

function itemFor(
  items: readonly ReorderItem[],
  productId: string,
): ReorderItem {
  const item = items.find((candidate) => candidate.productId === productId);
  if (item === undefined) throw new Error(`Missing reorder item ${productId}`);
  return item;
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
