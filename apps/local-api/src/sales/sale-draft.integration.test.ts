import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityDenialSchema,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  productArchivePath,
  reorderItemsPath,
  saleDraftPath,
  saleDraftLinesPath,
  saleDraftMiscLinesPath,
  saleDraftLineChangesPath,
  saleDraftLinePriceOverridePath,
  saleDraftDiscountPath,
  saleDraftSuspensionsPath,
  saleDraftDiscardsPath,
  saleDraftResumptionsPath,
  saleDraftsPath,
  saleProductSearchPath,
  saleProductContextPath,
  saleProductContextContract,
  saleQuickAccessPath,
  type SaleQuickAccess,
  type Product,
  type ProductCreateRequest,
  type SaleDraft,
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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../licensing/licence-keys.js", async () => {
  const issuer = await import("../devices/test-helpers/licence-issuer.test.js");
  return {
    OFFLINE_LICENCE_PUBLIC_KEYS: {
      [issuer.TEST_ISSUER_KEY_ID]: issuer.TEST_ISSUER_PUBLIC_KEY_PEM,
    },
  };
});

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { addDays, businessDateOf } from "../inventory/business-date.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "sale.draft.integration.owner";
const OWNER_PASSWORD =
  "sale draft integration owner password stays in this test";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface SaleDraftRow {
  readonly created_at: string;
  readonly created_by: string;
  readonly device_id: string;
  readonly id: string;
  readonly pharmacy_id: string;
  readonly status: string;
  readonly updated_at: string;
  readonly updated_by: string;
  readonly version: string;
}

describe.sequential("Sale Draft PostgreSQL seam", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId = "";
  let ownerRoleId = "";

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
        displayName: "Sale Draft Integration Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Sale Draft Integration Pharmacy",
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
    const role = await administrator.query<{ id: string }>(
      `select role.id from pharmacy_roles role
       join identity_users identity_user on identity_user.role_id = role.id
       where identity_user.pharmacy_id = $1 and identity_user.username = $2`,
      [pharmacyId, OWNER_USERNAME],
    );
    ownerRoleId = role.rows[0]?.id ?? "";
    expect(ownerRoleId).not.toBe("");
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("1. creates, lists, and reads the minimal active draft", async () => {
    const draft = await createDraft();
    expect(draft).toMatchObject({ status: "active", version: "1" });
    const listed = await listDrafts();
    expect(listed).toContainEqual(draft);
    expect(await readDraft(draft.id)).toEqual(draft);
  });

  it("2. resumes at the expected version and preserves creation facts", async () => {
    const draft = await createDraft();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const resumed = await resumeDraft(draft.id, {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(resumed).toMatchObject({ status: "active", version: "2" });
    expect(resumed.createdAt).toBe(draft.createdAt);
    expect(resumed.createdBy).toEqual(draft.createdBy);
    expect(new Date(resumed.updatedAt).getTime()).toBeGreaterThan(
      new Date(draft.updatedAt).getTime(),
    );
  });

  it("3. survives a killed local API and resumes exactly", async () => {
    const draft = await createDraft();
    const resumed = await resumeDraft(draft.id, {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    const before = {
      draft: await readDraft(resumed.id),
      list: await listDrafts(),
    };

    const exited = new Promise<void>((resolve) =>
      api.once("exit", () => resolve()),
    );
    api.kill("SIGKILL");
    await exited;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);

    expect({
      draft: await readDraft(resumed.id),
      list: await listDrafts(),
    }).toEqual(before);
  }, 60_000);

  it("4. lets exactly one concurrent resume advance one version", async () => {
    const draft = await createDraft();
    const expectedVersion = draft.version;
    const responses = await Promise.all([
      request("POST", saleDraftResumptionsPath(draft.id), {
        expectedVersion,
        idempotencyKey: uuidV7(),
      }),
      request("POST", saleDraftResumptionsPath(draft.id), {
        expectedVersion,
        idempotencyKey: uuidV7(),
      }),
    ]);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body).toMatchObject({ code: "version-conflict" });
    expect((await readDraft(draft.id)).version).toBe("2");
  });

  it("5. replays an idempotent resume and rejects a changed request", async () => {
    const draft = await createDraft();
    const body = { expectedVersion: draft.version, idempotencyKey: uuidV7() };
    const first = await request(
      "POST",
      saleDraftResumptionsPath(draft.id),
      body,
    );
    const replay = await request(
      "POST",
      saleDraftResumptionsPath(draft.id),
      body,
    );
    expect(first.status, diagnostics(first)).toBe(200);
    expect(replay).toEqual(first);
    const conflict = await request("POST", saleDraftResumptionsPath(draft.id), {
      expectedVersion: "999",
      idempotencyKey: body.idempotencyKey,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "idempotency-conflict" });
    const results = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
       where pharmacy_id = $1 and command_name = 'sale.draft.resume'
         and idempotency_key = $2`,
      [pharmacyId, body.idempotencyKey],
    );
    expect(results.rows[0]?.count).toBe("1");
  });

  it("6. rejects direct Sale Draft deletion and immutable-fact mutation", async () => {
    const draft = await createDraft();
    const mutations: (() => Promise<unknown>)[] = [
      () =>
        administrator.query(
          "delete from sale_drafts where pharmacy_id = $1 and id = $2",
          [pharmacyId, draft.id],
        ),
      () =>
        administrator.query(
          `update sale_drafts set version = version + 2
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, draft.id],
        ),
      () =>
        administrator.query(
          `update sale_drafts set created_by = updated_by
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, draft.id],
        ),
    ];
    for (const mutation of mutations) {
      await expect(mutation()).rejects.toMatchObject({ code: "55000" });
    }
  });

  it("7. lets every basket outcome leave the Sale Draft byte-identical", async () => {
    const draft = await createDraft();
    const product = await createProduct("Sale draft basket proof");

    await assertDraftUntouched(draft.id, async () => {
      const response = await request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: product.id,
      });
      expect(response.status, diagnostics(response)).toBe(200);
      expect(response.body).toMatchObject({ outcome: "added" });
    });

    await administrator.query(
      `delete from role_permission_grants
       where pharmacy_id = $1 and role_id = $2
         and permission_name = 'inventory.reorder.manage'`,
      [pharmacyId, ownerRoleId],
    );
    await assertDraftUntouched(draft.id, async () => {
      const response = await request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: product.id,
      });
      expect(response.status).toBe(403);
      const denial = identityDenialSchema.parse(response.body);
      const audit = await administrator.query<{
        action: string;
        outcome: string;
      }>("select action, outcome from identity_audit_records where id = $1", [
        denial.requestId,
      ]);
      expect(audit.rows[0]).toEqual({
        action: "identity.authorization",
        outcome: "denied",
      });
    });
    await administrator.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) select $1, $2, 'inventory.reorder.manage', identity_user.id
         from identity_users identity_user
         where identity_user.pharmacy_id = $1
           and identity_user.role_id = $2
       on conflict (role_id, permission_name) do nothing`,
      [pharmacyId, ownerRoleId],
    );
    const archive = await request("POST", productArchivePath(product.id), {
      expectedRevision: product.revision,
      idempotencyKey: uuidV7(),
    });
    expect(archive.status, diagnostics(archive)).toBe(201);
    await assertDraftUntouched(draft.id, async () => {
      const response = await request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: product.id,
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "reorder-product-inactive" });
      const requestId = String(
        (response.body as { requestId?: string }).requestId,
      );
      const audit = await administrator.query(
        "select id from posting_audit_records where id = $1",
        [requestId],
      );
      expect(audit.rows).toHaveLength(1);
    });
  }, 60_000);

  it("8. saves sale lines and totals across API restart, with exact idempotent edits", async () => {
    const draft = await createDraft();
    const product = await createProduct("Durable sale line");
    const addBody = {
      productId: product.id,
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    };
    const addedResponse = await request(
      "POST",
      saleDraftLinesPath(draft.id),
      addBody,
    );
    expect(addedResponse.status, diagnostics(addedResponse)).toBe(200);
    const added = addedResponse.body as SaleDraft;
    expect(added.lines).toHaveLength(1);
    expect(added.lines[0]).toMatchObject({
      productId: product.id,
      quantity: "1",
      unitPriceFils: "100000",
      totalFils: "100000",
    });
    expect(added.totals.totalFils).toBe("100000");
    expect(
      await request("POST", saleDraftLinesPath(draft.id), addBody),
    ).toEqual(addedResponse);
    expect((await readDraft(draft.id)).lines).toHaveLength(1);

    const line = added.lines[0];
    if (line === undefined) throw new Error("Sale line missing");
    const changedResponse = await request(
      "POST",
      saleDraftLineChangesPath(draft.id, line.id),
      {
        expectedVersion: added.version,
        idempotencyKey: uuidV7(),
        quantity: "3",
        lineDiscountPercentage: "10",
      },
    );
    expect(changedResponse.status, diagnostics(changedResponse)).toBe(200);
    const changed = changedResponse.body as SaleDraft;
    expect(changed.lines[0]).toMatchObject({
      quantity: "3",
      grossFils: "300000",
      discountFils: "30000",
      totalFils: "270000",
    });
    const discountedResponse = await request(
      "POST",
      saleDraftDiscountPath(draft.id),
      {
        expectedVersion: changed.version,
        idempotencyKey: uuidV7(),
        invoiceDiscountFils: "5000",
      },
    );
    expect(discountedResponse.status, diagnostics(discountedResponse)).toBe(
      200,
    );
    const discounted = discountedResponse.body as SaleDraft;
    expect(discounted.totals).toMatchObject({
      grossFils: "300000",
      lineDiscountFils: "30000",
      invoiceDiscountFils: "5000",
      totalFils: "265000",
    });

    const before = await readDraft(draft.id);
    const exited = new Promise<void>((resolve) =>
      api.once("exit", () => resolve()),
    );
    api.kill("SIGKILL");
    await exited;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    expect(await readDraft(draft.id)).toEqual(before);
    expect(await listDrafts()).toContainEqual(before);
  }, 60_000);

  it("adds a miscellaneous line without a catalog or inventory link", async () => {
    const draft = await createDraft();
    const response = await request("POST", saleDraftMiscLinesPath(draft.id), {
      displayName: "Delivery service",
      unitName: "service",
      quantity: "2",
      unitPriceFils: "12500",
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(response.status, diagnostics(response)).toBe(200);
    const added = response.body as SaleDraft;
    expect(added.lines[0]).toMatchObject({
      kind: "misc",
      productId: null,
      unitId: null,
      displayName: "Delivery service",
      quantity: "2",
      unitPriceFils: "12500",
      totalFils: "25000",
      priceSource: "misc",
    });
    expect(added.totals.totalFils).toBe("25000");
    const row = await administrator.query<{
      product_id: string | null;
      cost_fils: string;
    }>(
      "select product_id, cost_fils::text from sale_draft_lines where draft_id=$1",
      [draft.id],
    );
    expect(row.rows).toEqual([{ product_id: null, cost_fils: "0" }]);
    expect(await readDraft(draft.id)).toEqual(added);
    const line = added.lines[0];
    if (line === undefined) throw new Error("Misc line missing");
    const changed = await request(
      "POST",
      saleDraftLineChangesPath(draft.id, line.id),
      {
        expectedVersion: added.version,
        idempotencyKey: uuidV7(),
        quantity: "3",
      },
    );
    expect(changed.status, diagnostics(changed)).toBe(200);
    expect((changed.body as SaleDraft).totals.totalFils).toBe("37500");
  }, 60_000);

  it("adds a configured package unit at its captured retail conversion in one revision", async () => {
    const draft = await createDraft();
    const product = await createProduct("Package sale line");
    const units = await administrator.query<{ id: string }>(
      "select id from catalog_product_units where product_id=$1 and base_units_per_package=4",
      [product.id],
    );
    const unitId = units.rows[0]?.id;
    if (unitId === undefined) throw new Error("Package unit missing");
    const response = await request("POST", saleDraftLinesPath(draft.id), {
      productId: product.id,
      unitId,
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(response.status, diagnostics(response)).toBe(200);
    const added = response.body as SaleDraft;
    expect(added.version).toBe(String(BigInt(draft.version) + 1n));
    expect(added.lines[0]).toMatchObject({
      unitId,
      unitName: "Pack",
      quantity: "1",
      unitPriceFils: "400000",
      totalFils: "400000",
    });
  }, 60_000);

  it("records a reasoned manual price, replays it once, and restores retail pricing on unit change", async () => {
    const draft = await createDraft();
    const product = await createProduct("Reasoned price override");
    const addedResponse = await request("POST", saleDraftLinesPath(draft.id), {
      productId: product.id,
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(addedResponse.status, diagnostics(addedResponse)).toBe(200);
    const added = addedResponse.body as SaleDraft;
    const line = added.lines[0];
    if (line === undefined) throw new Error("Sale line missing");
    const route = saleDraftLinePriceOverridePath(draft.id, line.id);
    const body = {
      expectedVersion: added.version,
      idempotencyKey: uuidV7(),
      unitPriceFils: "75000",
      reason: "  Manager approved  ",
    };
    const response = await request("POST", route, body);
    expect(response.status, diagnostics(response)).toBe(200);
    const overridden = response.body as SaleDraft;
    expect(overridden.lines[0]).toMatchObject({
      unitPriceFils: "75000",
      priceSource: "manual",
      priceOverrideReason: "Manager approved",
      totalFils: "75000",
    });
    expect(overridden.totals.totalFils).toBe("75000");
    expect(await request("POST", route, body)).toEqual(response);
    expect(await readDraft(draft.id)).toEqual(overridden);
    const audit = await administrator.query<{
      before_price: string;
      after_price: string;
      reason: string;
    }>(
      `select before_state->>'unitPriceFils' as before_price,
              after_state->>'unitPriceFils' as after_price, reason
       from posting_audit_records
       where pharmacy_id=$1 and target_id=$2
         and action='sale.draft.line.price-override' and outcome='committed'`,
      [pharmacyId, draft.id],
    );
    expect(audit.rows).toEqual([
      {
        before_price: "100000",
        after_price: "75000",
        reason: "Manager approved",
      },
    ]);

    const packageUnits = await administrator.query<{ id: string }>(
      "select id from catalog_product_units where product_id=$1 and base_units_per_package=4",
      [product.id],
    );
    const packageUnitId = packageUnits.rows[0]?.id;
    if (packageUnitId === undefined) throw new Error("Package unit missing");
    const changedResponse = await request(
      "POST",
      saleDraftLineChangesPath(draft.id, line.id),
      {
        expectedVersion: overridden.version,
        idempotencyKey: uuidV7(),
        unitId: packageUnitId,
        quantity: "1",
      },
    );
    expect(changedResponse.status, diagnostics(changedResponse)).toBe(200);
    const changed = changedResponse.body as SaleDraft;
    expect(changed.lines[0]).toMatchObject({
      unitPriceFils: "400000",
      priceSource: "retail",
      priceOverrideReason: null,
    });
    expect((await readDraft(draft.id)).lines[0]).toEqual(changed.lines[0]);
  }, 60_000);

  it("9. rejects invalid edits without changing the draft and locks suspended or discarded drafts", async () => {
    const draft = await createDraft();
    const product = await createProduct("Sale failure proof");
    const addedResponse = await request("POST", saleDraftLinesPath(draft.id), {
      productId: product.id,
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(addedResponse.status, diagnostics(addedResponse)).toBe(200);
    const added = addedResponse.body as SaleDraft;
    const line = added.lines[0];
    if (line === undefined) throw new Error("Sale line missing");

    const tooMuchDiscount = await request(
      "POST",
      saleDraftDiscountPath(draft.id),
      {
        expectedVersion: added.version,
        idempotencyKey: uuidV7(),
        invoiceDiscountFils: "100001",
      },
    );
    expect(tooMuchDiscount.status).toBe(400);
    expect(tooMuchDiscount.body).toMatchObject({
      code: "sale-discount-invalid",
    });
    expect(await readDraft(draft.id)).toEqual(added);

    const stale = await request(
      "POST",
      saleDraftLineChangesPath(draft.id, line.id),
      {
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
        quantity: "2",
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      code: "version-conflict",
      currentDraft: added,
    });
    expect(await readDraft(draft.id)).toEqual(added);

    const suspendedResponse = await request(
      "POST",
      saleDraftSuspensionsPath(draft.id),
      {
        expectedVersion: added.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(suspendedResponse.status, diagnostics(suspendedResponse)).toBe(200);
    const suspended = suspendedResponse.body as SaleDraft;
    expect(suspended.status).toBe("suspended");
    const blocked = await request(
      "POST",
      saleDraftLineChangesPath(draft.id, line.id),
      {
        expectedVersion: suspended.version,
        idempotencyKey: uuidV7(),
        quantity: "2",
      },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: "sale-draft-inactive" });
    expect(await readDraft(draft.id)).toEqual(suspended);

    const resumed = await resumeDraft(draft.id, {
      expectedVersion: suspended.version,
      idempotencyKey: uuidV7(),
    });
    expect(resumed.lines).toEqual(suspended.lines);
    const discardedResponse = await request(
      "POST",
      saleDraftDiscardsPath(draft.id),
      {
        expectedVersion: resumed.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(discardedResponse.status, diagnostics(discardedResponse)).toBe(200);
    const discarded = discardedResponse.body as SaleDraft;
    expect(discarded.status).toBe("discarded");
    const deniedResume = await request(
      "POST",
      saleDraftResumptionsPath(draft.id),
      {
        expectedVersion: discarded.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(deniedResume.status).toBe(409);
    expect(await readDraft(draft.id)).toEqual(discarded);
  });

  it("10. limits Sale search to retail facts and excludes wholesale and cost", async () => {
    const product = await createProduct("Retail search boundary");
    const response = await request(
      "GET",
      `${saleProductSearchPath()}?query=Retail%20search%20boundary`,
    );
    expect(response.status, diagnostics(response)).toBe(200);
    const results = (
      response.body as { results: { product: Record<string, unknown> }[] }
    ).results;
    expect(results).toHaveLength(1);
    expect(results[0]?.product).toEqual({
      id: product.id,
      displayName: product.displayName,
      arabicSearchName: product.arabicSearchName,
      retailPriceFils: product.pricing.retailPriceFils,
    });
    expect(JSON.stringify(response.body)).not.toContain("wholesalePriceFils");
    expect(JSON.stringify(response.body)).not.toContain("costFils");

    const context = await request("GET", saleProductContextPath(product.id));
    expect(context.status, diagnostics(context)).toBe(200);
    expect(context.body).toMatchObject({
      id: product.id,
      displayName: product.displayName,
      currentRetailPriceFils: product.pricing.retailPriceFils,
      inventoryUnitName: "Strip",
      inventory: {
        onHandBaseUnits: null,
        estimatedSurplusBaseUnits: null,
        batches: [],
      },
    });
    expect(
      saleProductContextContract.responses[200].parse(context.body),
    ).toEqual(context.body);
    expect(JSON.stringify(context.body)).not.toContain("wholesalePriceFils");
    expect(JSON.stringify(context.body)).not.toContain("costFils");
  });

  it("returns positive batch positions, business-date expiry and estimated surplus", async () => {
    const product = await createProduct("Sale context stocked item");
    const owner = await administrator.query<{ id: string }>(
      `select id from identity_users where pharmacy_id=$1 and username=$2`,
      [pharmacyId, OWNER_USERNAME],
    );
    const ownerId = owner.rows[0]?.id;
    if (ownerId === undefined) throw new Error("Owner fixture missing");
    const zone = await administrator.query<{ business_time_zone: string }>(
      `select business_time_zone from pharmacies where id=$1`,
      [pharmacyId],
    );
    const today = businessDateOf(
      new Date(),
      zone.rows[0]?.business_time_zone ?? "Asia/Baghdad",
    );
    const expiryDate = addDays(today, 10);
    for (const [quantity, lotNumber] of [
      [50, "SALE-LOT-A"],
      [30, "SALE-LOT-B"],
      [1, "SALE-EMPTY"],
    ] as const) {
      const batchId = uuidV7();
      await administrator.query(
        `insert into inventory_batches (
           id, pharmacy_id, product_id, lot_number, expiry_date, quantity, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          batchId,
          pharmacyId,
          product.id,
          lotNumber,
          expiryDate,
          quantity,
          ownerId,
        ],
      );
      if (lotNumber !== "SALE-EMPTY") {
        await administrator.query(
          `insert into inventory_movements (
             pharmacy_id, product_id, batch_id, reason, quantity,
             carrying_amount_fils, source_document_type, source_document_id,
             source_row_ordinal, created_by
           ) values ($1,$2,$3,'purchase-receipt',$4,$5,'purchase-invoice',$6,1,$7)`,
          [
            pharmacyId,
            product.id,
            batchId,
            quantity,
            quantity * 100,
            uuidV7(),
            ownerId,
          ],
        );
      }
    }
    const response = await request("GET", saleProductContextPath(product.id));
    expect(response.status, diagnostics(response)).toBe(200);
    const context = saleProductContextContract.responses[200].parse(
      response.body,
    );
    expect(context.inventory).toMatchObject({
      onHandBaseUnits: "80",
      estimatedSurplusBaseUnits: "20",
      batches: [
        {
          balanceBaseUnits: "50",
          effectiveExpiryDate: expiryDate,
          daysRemaining: 10,
          lotNumber: "SALE-LOT-A",
        },
        {
          balanceBaseUnits: "30",
          effectiveExpiryDate: expiryDate,
          daysRemaining: 10,
          lotNumber: "SALE-LOT-B",
        },
      ],
    });
    expect(context.inventory.batches).toHaveLength(2);
    expect(JSON.stringify(context)).not.toMatch(/cost|valuat|wholesale/i);
  });

  it("requires Sale permission to read product context", async () => {
    const product = await createProduct("Sale context permission item");
    await administrator.query(
      `delete from role_permission_grants
       where pharmacy_id=$1 and role_id=$2 and permission_name='sales.drafts.manage'`,
      [pharmacyId, ownerRoleId],
    );
    try {
      const response = await request("GET", saleProductContextPath(product.id));
      expect(response.status, diagnostics(response)).toBe(403);
      expect(identityDenialSchema.parse(response.body).code).toBe(
        "permission-denied",
      );
    } finally {
      await administrator.query(
        `insert into role_permission_grants (
           pharmacy_id, role_id, permission_name, granted_by
         ) select $1,$2,'sales.drafts.manage',id
           from identity_users where pharmacy_id=$1 and username=$3
         on conflict (role_id, permission_name) do nothing`,
        [pharmacyId, ownerRoleId, OWNER_USERNAME],
      );
    }
    const absent = await request("GET", saleProductContextPath(uuidV7()));
    expect(absent.status).toBe(404);
    expect(JSON.stringify(absent.body)).not.toContain("inventory");
  });

  it("stores a versioned quick-access grid with current unit pricing and preserves archived tiles", async () => {
    const empty = await request("GET", saleQuickAccessPath());
    expect(empty.status, diagnostics(empty)).toBe(200);
    const initial = empty.body as SaleQuickAccess;
    expect(initial).toEqual({ version: "1", categories: [] });

    const product = await createProduct("Quick access package");
    const units = await administrator.query<{ id: string }>(
      "select id from catalog_product_units where product_id=$1 and base_units_per_package=4",
      [product.id],
    );
    const unitId = units.rows[0]?.id;
    if (unitId === undefined) throw new Error("Package unit missing");
    const body = {
      expectedVersion: initial.version,
      idempotencyKey: uuidV7(),
      categories: [
        { name: "Frequent", tiles: [{ productId: product.id, unitId }] },
      ],
    };
    const saved = await request("POST", saleQuickAccessPath(), body);
    expect(saved.status, diagnostics(saved)).toBe(200);
    expect(saved.body).toMatchObject({
      version: "2",
      categories: [
        {
          name: "Frequent",
          tiles: [
            {
              productId: product.id,
              unitId,
              available: true,
              unitName: "Pack",
              currentUnitPriceFils: "400000",
            },
          ],
        },
      ],
    });
    await stopProcess(api);
    apiOutput = "";
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    expect((await request("GET", saleQuickAccessPath())).body).toEqual(
      saved.body,
    );
    expect(await request("POST", saleQuickAccessPath(), body)).toEqual(saved);
    const stale = await request("POST", saleQuickAccessPath(), {
      ...body,
      idempotencyKey: uuidV7(),
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "version-conflict" });
    const invalidUnit = await request("POST", saleQuickAccessPath(), {
      expectedVersion: "2",
      idempotencyKey: uuidV7(),
      categories: [
        {
          name: "Frequent",
          tiles: [{ productId: product.id, unitId: uuidV7() }],
        },
      ],
    });
    expect(invalidUnit.status).toBe(400);
    expect(invalidUnit.body).toMatchObject({
      code: "sale-quick-access-invalid",
    });
    expect((await request("GET", saleQuickAccessPath())).body).toEqual(
      saved.body,
    );

    const archive = await request("POST", productArchivePath(product.id), {
      expectedRevision: product.revision,
      idempotencyKey: uuidV7(),
    });
    expect(archive.status, diagnostics(archive)).toBe(201);
    const archived = await request("GET", saleQuickAccessPath());
    expect(archived.body).toMatchObject({
      version: "2",
      categories: [
        {
          tiles: [
            {
              productId: product.id,
              unitId,
              available: false,
              displayName: null,
              currentUnitPriceFils: null,
            },
          ],
        },
      ],
    });
    const cleared = await request("POST", saleQuickAccessPath(), {
      expectedVersion: "2",
      idempotencyKey: uuidV7(),
      categories: [],
    });
    expect(cleared.status, diagnostics(cleared)).toBe(200);
    expect(cleared.body).toEqual({ version: "3", categories: [] });
  }, 60_000);

  async function createDraft(): Promise<SaleDraft> {
    const response = await request("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as SaleDraft;
  }

  async function resumeDraft(
    draftId: string,
    body: { readonly expectedVersion: string; readonly idempotencyKey: string },
  ): Promise<SaleDraft> {
    const response = await request(
      "POST",
      saleDraftResumptionsPath(draftId),
      body,
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as SaleDraft;
  }

  async function listDrafts(): Promise<readonly SaleDraft[]> {
    const response = await request("GET", saleDraftsPath());
    expect(response.status, diagnostics(response)).toBe(200);
    return (response.body as { drafts: readonly SaleDraft[] }).drafts;
  }

  async function readDraft(draftId: string): Promise<SaleDraft> {
    const response = await request("GET", saleDraftPath(draftId));
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as SaleDraft;
  }

  async function assertDraftUntouched(
    draftId: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const before = {
      auditFacts: await draftAuditFactCount(draftId),
      commandResults: await saleDraftCommandResultCount(),
      draft: await readDraft(draftId),
      raw: await rawDraft(draftId),
    };
    await action();
    expect({
      auditFacts: await draftAuditFactCount(draftId),
      commandResults: await saleDraftCommandResultCount(),
      draft: await readDraft(draftId),
      raw: await rawDraft(draftId),
    }).toEqual(before);
  }

  async function rawDraft(draftId: string): Promise<SaleDraftRow | undefined> {
    const result = await administrator.query<SaleDraftRow>(
      `select id, pharmacy_id, status::text, version::text, created_at::text,
              created_by, updated_at::text, updated_by, device_id
       from sale_drafts where pharmacy_id = $1 and id = $2`,
      [pharmacyId, draftId],
    );
    return result.rows[0];
  }

  async function draftAuditFactCount(draftId: string): Promise<string> {
    const result = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where pharmacy_id = $1 and target_id = $2`,
      [pharmacyId, draftId],
    );
    return result.rows[0]?.count ?? "";
  }

  async function saleDraftCommandResultCount(): Promise<string> {
    const result = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
       where pharmacy_id = $1 and command_name like 'sale.draft.%'`,
      [pharmacyId],
    );
    return result.rows[0]?.count ?? "";
  }

  async function createProduct(tradeName: string): Promise<Product> {
    const response = await request(
      "POST",
      "/catalog/products",
      productRequest(tradeName),
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as Product;
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
    method: "GET" | "POST",
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

function productRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "مسودة بيع",
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
    stockLevels: { maximumLevel: "60", minimumLevel: "10", reorderPoint: "20" },
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
