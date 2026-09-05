import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  CATALOG_CONTRACTS,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  productArchivePath,
  productMergePath,
  productPath,
  type Product,
  type ProductCreateRequest,
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
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { CatalogService } from "./catalog.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "catalog.owner";
const OWNER_PASSWORD = "catalog owner password stays in this test";
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: Record<string, unknown> | undefined;
  readonly status: number;
}

interface SnapshotRow {
  readonly display_name: string;
  readonly id: string;
  readonly inventory_unit_name: string;
  readonly margin_percentage: string | null;
  readonly price_rounding: string | null;
  readonly pricing_method: string;
  readonly product_id: string;
  readonly retail_price_fils: string;
  readonly third_unit_name: string | null;
  readonly wholesale_price_fils: string | null;
}

describe.sequential("Catalog PostgreSQL and HTTP seam", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin: string;
  let apiOutput = "";
  let apiPort: number;
  let application: Pool;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let editableProduct: Product;
  let immutableSnapshotId = "";
  let pharmacyId = "";
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    application = new Pool({ connectionString: databaseRoles.applicationUrl });

    const bootstrapped = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Catalog Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Catalog Test Pharmacy",
    });
    expect(bootstrapped.status, failureContext([bootstrapped])).toBe(201);
    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.status, failureContext([login])).toBe(200);
    pharmacyId = String(
      (login.body?.pharmacy as { id?: string } | undefined)?.id ?? "",
    );
    expect(pharmacyId).toMatch(UUID_V7_PATTERN);
  }, 120_000);

  afterAll(async () => {
    await stopProcess(api);
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("stores Product description without a stock balance, expiry, or unique display name", async () => {
    const columns = await administrator.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'catalog_products'
       order by ordinal_position`,
    );
    const names = columns.rows.map(({ column_name }) => column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "pharmacy_id",
        "definition_mode",
        "display_name",
        "name_template_version",
        "arabic_search_name",
        "status",
        "merged_into_product_id",
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        "balance",
        "expiry",
        "expiry_date",
        "quantity",
        "stock",
        "stock_quantity",
      ]),
    );

    const uniqueDisplayName = await administrator.query<{ count: string }>(
      `select count(*)::text as count
       from pg_index index_row
       join pg_class table_row on table_row.oid = index_row.indrelid
       join pg_attribute column_row
         on column_row.attrelid = table_row.oid
        and column_row.attnum = any(index_row.indkey)
       where table_row.relname = 'catalog_products'
         and index_row.indisunique
         and column_row.attname = 'display_name'`,
    );
    expect(uniqueDisplayName.rows[0]?.count).toBe("0");

    const body = medicationRequest("Panadol", []);
    const first = await request("POST", "/catalog/products", body);
    const retry = await request("POST", "/catalog/products", body);
    const second = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Panadol", []),
    );
    expect(first.status, failureContext([first])).toBe(201);
    expect(retry).toEqual(first);
    expect(second.status, failureContext([second])).toBe(201);
    expect(first.body?.id).toMatch(UUID_V7_PATTERN);
    expect(second.body?.id).toMatch(UUID_V7_PATTERN);
    expect(second.body?.id).not.toBe(first.body?.id);
    expect(first.body).toMatchObject({
      arabicSearchName: "بانادول",
      displayName: "Panadol 500 mg tablet GSK",
      nameTemplateVersion: 1,
      packaging: body.packaging,
      pricing: body.pricing,
      status: "active",
    });
    expect(first.body?.displayName).not.toContain("بانادول");
    editableProduct = first.body as unknown as Product;

    const stored = await administrator.query<{ count: string }>(
      "select count(*)::text as count from catalog_products where display_name = $1",
      ["Panadol 500 mg tablet GSK"],
    );
    expect(stored.rows[0]?.count).toBe("2");

    expect(await request("GET", productPath(editableProduct.id))).toMatchObject(
      {
        status: 200,
        body: { packaging: body.packaging, pricing: body.pricing },
      },
    );
    expect(await request("GET", "/catalog/products")).toMatchObject({
      status: 200,
      body: {
        products: expect.arrayContaining([
          expect.objectContaining({ id: editableProduct.id }),
        ]),
      },
    });
  });

  it("calculates and stores exact percentage pricing for every rounding setting", async () => {
    const cases = [
      { rounding: "off", costFils: "80000", retailPriceFils: "100000" },
      {
        rounding: "nearest-250-iqd",
        costFils: "300000",
        retailPriceFils: "500000",
      },
      {
        rounding: "nearest-500-iqd",
        costFils: "200000",
        retailPriceFils: "500000",
      },
      {
        rounding: "nearest-1000-iqd",
        costFils: "400000",
        retailPriceFils: "1000000",
      },
    ] as const;

    for (const testCase of cases) {
      const body: ProductCreateRequest = {
        ...medicationRequest(`Percentage ${testCase.rounding}`, []),
        pricing: {
          costFils: testCase.costFils,
          marginPercentage: "20",
          method: "by-percentage",
          rounding: testCase.rounding,
          wholesalePriceFils: "75000",
        },
      };
      const created = await request("POST", "/catalog/products", body);
      expect(created.status, failureContext([created])).toBe(201);
      expect(created.body?.pricing).toEqual({
        marginPercentage: "20",
        method: "by-percentage",
        retailPriceFils: testCase.retailPriceFils,
        rounding: testCase.rounding,
        wholesalePriceFils: "75000",
      });
      expect(created.body?.pricing).not.toHaveProperty("costFils");

      const stored = await administrator.query<{
        retail_price_fils: string;
        wholesale_price_fils: string | null;
      }>(
        `select retail_price_fils::text, wholesale_price_fils::text
         from catalog_products where id = $1`,
        [created.body?.id],
      );
      expect(stored.rows[0]).toEqual({
        retail_price_fils: testCase.retailPriceFils,
        wholesale_price_fils: "75000",
      });
    }
  });

  it("enforces default-unit, ratio, Third Unit, and pricing constraints in PostgreSQL", async () => {
    const defaults = await administrator.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `select column_name, is_nullable
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'catalog_products'
         and column_name in (
           'count_default_unit_id',
           'purchase_default_unit_id',
           'sale_default_unit_id'
         )
       order by column_name`,
    );
    expect(defaults.rows).toEqual([
      { column_name: "count_default_unit_id", is_nullable: "NO" },
      { column_name: "purchase_default_unit_id", is_nullable: "NO" },
      { column_name: "sale_default_unit_id", is_nullable: "NO" },
    ]);

    for (const [index, ratio, code] of [
      [0, "0", "23514"],
      [1, "-1", "23514"],
      [2, "4.5", "22P02"],
    ] as const) {
      await expectRejectedInRollback(
        `insert into catalog_product_units (
           pharmacy_id, product_id, kind, name, ordinal, base_units_per_package
         ) values ($1, $2, 'package', $3, 5, $4)`,
        [pharmacyId, editableProduct.id, `Invalid ${String(index)}`, ratio],
        code,
      );
    }

    // The Third Unit is stored with no unit id and no ratio column at all, so
    // there is nothing on it for a stock-affecting row or a default unit to
    // reference. These three assertions prove that structurally rather than by
    // trusting a flag the application checks.
    const third = await administrator.query<{ product_id: string }>(
      "select product_id from catalog_product_third_units where product_id = $1",
      [editableProduct.id],
    );
    expect(third.rows[0]?.product_id).toBe(editableProduct.id);
    const thirdUnitColumns = await administrator.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'catalog_product_third_units'
       order by column_name`,
    );
    expect(thirdUnitColumns.rows.map((row) => row.column_name)).toEqual([
      "name",
      "pharmacy_id",
      "product_id",
    ]);
    await expectRejectedWhenDeferredChecksRun(
      `update catalog_products
       set count_default_unit_id = $2, revision = revision + 1,
           updated_at = statement_timestamp()
       where id = $1`,
      [editableProduct.id, third.rows[0]?.product_id],
      "23503",
    );
    await expectRejectedInRollback(
      `insert into catalog_product_units (
         pharmacy_id, product_id, kind, name, ordinal, base_units_per_package
       ) values ($1, $2, 'third', 'Treatment day', 1, null)`,
      [pharmacyId, editableProduct.id],
      "22P02",
    );
    await expectRejectedInRollback(
      `update catalog_products
       set pricing_method = 'by-percentage',
           margin_percentage = '20.0000001', price_rounding = 'off',
           revision = revision + 1, updated_at = statement_timestamp()
       where id = $1`,
      [editableProduct.id],
      "23514",
    );

    const privilege = await administrator.query<{ allowed: boolean }>(
      `select has_table_privilege(
         'breev_app', 'catalog_product_snapshot_package_units', 'insert'
       ) as allowed`,
    );
    expect(privilege.rows[0]?.allowed).toBe(false);
  });

  it("rejects locked pricing fields at their exact API paths without editing the Product", async () => {
    const percentageWithRetail = await request(
      "PUT",
      productPath(editableProduct.id),
      {
        ...medicationRequest("Locked Retail", []),
        expectedRevision: editableProduct.revision,
        pricing: {
          costFils: "80000",
          marginPercentage: "20",
          method: "by-percentage",
          retailPriceFils: "1",
          rounding: "off",
          wholesalePriceFils: null,
        },
      },
    );
    expect(percentageWithRetail).toMatchObject({
      status: 400,
      body: {
        code: "body-invalid",
        fieldErrors: [
          { code: "unknown-field", path: ["pricing", "retailPriceFils"] },
        ],
      },
    });

    const priceWithMargin = await request(
      "PUT",
      productPath(editableProduct.id),
      {
        ...medicationRequest("Unavailable Margin", []),
        expectedRevision: editableProduct.revision,
        pricing: {
          costFils: "80000",
          marginPercentage: "20",
          method: "by-price",
          retailPriceFils: "100000",
          rounding: "off",
          wholesalePriceFils: null,
        },
      },
    );
    expect(priceWithMargin.status).toBe(400);
    expect(priceWithMargin.body?.fieldErrors).toEqual(
      expect.arrayContaining([
        { code: "unknown-field", path: ["pricing", "costFils"] },
        { code: "unknown-field", path: ["pricing", "marginPercentage"] },
        { code: "unknown-field", path: ["pricing", "rounding"] },
      ]),
    );

    expect(await request("GET", productPath(editableProduct.id))).toMatchObject(
      {
        status: 200,
        body: { displayName: "Panadol 500 mg tablet GSK", revision: "1" },
      },
    );
  });

  it("editing a field regenerates the current name while the posted snapshot name stays frozen", async () => {
    const snapshot = await insertSnapshot(editableProduct.id);
    immutableSnapshotId = snapshot.id;
    expect(snapshot.display_name).toBe("Panadol 500 mg tablet GSK");
    expect(snapshot).toMatchObject({
      inventory_unit_name: "Strip",
      margin_percentage: null,
      price_rounding: null,
      pricing_method: "by-price",
      retail_price_fils: "100000",
      third_unit_name: "Treatment day",
      wholesale_price_fils: "90000",
    });
    expect(await snapshotPackageUnits(snapshot.id)).toEqual([
      { base_units_per_package: "4", name: "Pack" },
    ]);

    const edited = await request("PUT", productPath(editableProduct.id), {
      ...medicationRequest("Panadol Extra", ["5012345678900"]),
      expectedRevision: editableProduct.revision,
      packaging: {
        ...editableProduct.packaging,
        packageUnits: [{ baseUnitsPerPackage: "8", name: "Pack" }],
      },
      pricing: {
        costFils: "80000",
        marginPercentage: "20",
        method: "by-percentage",
        rounding: "off",
        wholesalePriceFils: "70000",
      },
    });
    expect(edited.status, failureContext([edited])).toBe(200);
    expect(edited.body).toMatchObject({
      barcodes: ["5012345678900"],
      displayName: "Panadol Extra 500 mg tablet GSK",
      packaging: {
        packageUnits: [{ baseUnitsPerPackage: "8", name: "Pack" }],
      },
      pricing: { method: "by-percentage", retailPriceFils: "100000" },
      revision: "2",
    });
    editableProduct = edited.body as unknown as Product;

    expect(await snapshotById(snapshot.id)).toMatchObject({
      display_name: "Panadol 500 mg tablet GSK",
      product_id: editableProduct.id,
    });
    expect(await snapshotPackageUnits(snapshot.id)).toEqual([
      { base_units_per_package: "4", name: "Pack" },
    ]);
  });

  it("rejects an update attempt on a posted Product snapshot", async () => {
    await expect(
      administrator.query(
        "update catalog_product_snapshots set display_name = 'rewritten' where id = $1",
        [immutableSnapshotId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    expect((await snapshotById(immutableSnapshotId)).display_name).toBe(
      "Panadol 500 mg tablet GSK",
    );
  });

  it("rejects a delete attempt on a posted Product snapshot", async () => {
    await expect(
      administrator.query(
        "delete from catalog_product_snapshots where id = $1",
        [immutableSnapshotId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    expect((await snapshotById(immutableSnapshotId)).id).toBe(
      immutableSnapshotId,
    );
  });

  it("switches mode by clearing abandoned fields and surfaces that outcome", async () => {
    const switched = await request("PUT", productPath(editableProduct.id), {
      ...generalItemRequest("Bioderma"),
      expectedRevision: editableProduct.revision,
    });
    expect(switched.status, failureContext([switched])).toBe(200);
    expect(switched.body).toMatchObject({
      definition: {
        mode: "general-item",
        fields: {
          company: "Bioderma",
          subBrand: "Atoderm",
          typeOfUse: "cream",
          property: "intensive",
          targetAudience: "dry skin",
          size: "200 ml",
        },
      },
      displayName: "Bioderma Atoderm cream intensive dry skin 200 ml",
    });
    editableProduct = switched.body as unknown as Product;

    const row = await administrator.query<{
      general_company: string | null;
      medication_dosage_form: string | null;
      medication_manufacturer: string | null;
      medication_strength: string | null;
      medication_trade_name: string | null;
    }>(
      `select general_company, medication_trade_name, medication_strength,
              medication_dosage_form, medication_manufacturer
       from catalog_products where id = $1`,
      [editableProduct.id],
    );
    expect(row.rows[0]).toEqual({
      general_company: "Bioderma",
      medication_dosage_form: null,
      medication_manufacturer: null,
      medication_strength: null,
      medication_trade_name: null,
    });
    const audit = await administrator.query<{ after_state: unknown }>(
      `select after_state from posting_audit_records
       where target_id = $1 and action = 'catalog.product.edit'
       order by occurred_at desc, id desc limit 1`,
      [editableProduct.id],
    );
    expect(audit.rows[0]?.after_state).toMatchObject({
      modeSwitchOutcome: "cleared-abandoned-fields",
    });
    expect(switched.body?.definition).not.toHaveProperty("medication");
  });

  it("archives a referenced Product and every existing reference still resolves", async () => {
    const product = await createdProduct(medicationRequest("Archive Me", []));
    const snapshot = await insertSnapshot(product.id);
    const archived = await request("POST", productArchivePath(product.id), {
      expectedRevision: product.revision,
      idempotencyKey: createUuidV7(),
    });
    expect(archived.status, failureContext([archived])).toBe(201);
    expect(archived.body).toMatchObject({ id: product.id, status: "archived" });

    const reference = await administrator.query<{
      display_name: string;
      product_id: string;
      status: string;
    }>(
      `select snapshot.display_name, snapshot.product_id, product_row.status
       from catalog_product_snapshots snapshot
       join catalog_products product_row
         on product_row.id = snapshot.product_id
        and product_row.pharmacy_id = snapshot.pharmacy_id
       where snapshot.id = $1`,
      [snapshot.id],
    );
    expect(reference.rows[0]).toEqual({
      display_name: "Archive Me 500 mg tablet GSK",
      product_id: product.id,
      status: "archived",
    });
    expect(await request("GET", productPath(product.id))).toMatchObject({
      status: 200,
      body: { id: product.id, status: "archived" },
    });
  });

  it("merges a referenced Product, redirects future references, and keeps history readable", async () => {
    const source = await createdProduct(medicationRequest("Merge Source", []));
    const survivor = await createdProduct(
      medicationRequest("Merge Survivor", ["7290010000001"]),
    );
    const historical = await insertSnapshot(source.id);

    const merged = await request("POST", productMergePath(source.id), {
      expectedRevision: source.revision,
      idempotencyKey: createUuidV7(),
      survivorProductId: survivor.id,
    });
    expect(merged.status, failureContext([merged])).toBe(201);
    expect(merged.body).toMatchObject({
      id: source.id,
      mergedIntoProductId: survivor.id,
      status: "merged",
    });

    const future = await insertSnapshot(source.id);
    expect(future).toMatchObject({
      display_name: "Merge Survivor 500 mg tablet GSK",
      product_id: survivor.id,
    });
    expect(await snapshotById(historical.id)).toMatchObject({
      display_name: "Merge Source 500 mg tablet GSK",
      product_id: source.id,
    });
    expect(await request("GET", productPath(source.id))).toMatchObject({
      status: 200,
      body: {
        displayName: "Merge Source 500 mg tablet GSK",
        id: source.id,
        mergedIntoProductId: survivor.id,
        status: "merged",
      },
    });
  });

  it("has no hard-delete path in the schema, service, controller, repair, or cleanup surfaces", async () => {
    const product = await createdProduct(medicationRequest("Never Delete", []));
    const privileges = await administrator.query<{ allowed: boolean }>(
      `select has_table_privilege(
         'breev_app', 'catalog_products', 'delete'
       ) as allowed`,
    );
    expect(privileges.rows[0]?.allowed).toBe(false);
    await expect(
      application.query("delete from catalog_products where id = $1", [
        product.id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      administrator.query("delete from catalog_products where id = $1", [
        product.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });

    expect(
      CATALOG_CONTRACTS.every(({ method }) => String(method) !== "DELETE"),
    ).toBe(true);
    expect(Object.getOwnPropertyNames(CatalogService.prototype)).not.toEqual(
      expect.arrayContaining(["cleanup", "delete", "hardDelete", "repair"]),
    );
    expect(await request("DELETE", productPath(product.id), {})).toMatchObject({
      status: 404,
    });
    expect(
      await request("POST", `${productPath(product.id)}/cleanup`, {}),
    ).toMatchObject({ status: 404 });
    expect(
      await request("POST", `${productPath(product.id)}/repair`, {}),
    ).toMatchObject({ status: 404 });
    expect(await request("GET", productPath(product.id))).toMatchObject({
      status: 200,
      body: { id: product.id },
    });
  });

  it("denies and audits a direct Product balance write at the server boundary", async () => {
    const attempt = await request("PUT", productPath(editableProduct.id), {
      ...generalItemRequest("Bioderma"),
      expectedRevision: editableProduct.revision,
      quantity: 999,
    });
    expect(attempt.status, failureContext([attempt])).toBe(400);
    expect(attempt.body).toMatchObject({
      code: "body-invalid",
      fieldErrors: [
        {
          code: "unknown-field",
          path: ["quantity"],
        },
      ],
      status: "denied",
    });
    const audit = await administrator.query<{
      action: string;
      id: string;
      outcome: string;
    }>(
      `select id, action, outcome from posting_audit_records
       where id = $1`,
      [attempt.body?.requestId],
    );
    expect(audit.rows[0]).toEqual({
      action: "catalog.product.edit",
      id: attempt.body?.requestId,
      outcome: "body-invalid",
    });
    expect(
      await request("PUT", `${productPath(editableProduct.id)}/balance`, {
        quantity: 999,
      }),
    ).toMatchObject({ status: 404 });
  });

  it("enforces tenant-safe Product references in PostgreSQL", async () => {
    await expect(
      administrator.query(
        `insert into catalog_product_snapshots (
           pharmacy_id, product_id, display_name, name_template_version
         ) values ($1, $2, 'wrong tenant', 1)`,
        [createUuidV7(), editableProduct.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

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
    child.stdout.on("data", collectOutput);
    child.stderr.on("data", collectOutput);
    return child;
  }

  function collectOutput(chunk: Buffer): void {
    apiOutput += chunk.toString();
  }

  async function createdProduct(body: ProductCreateRequest): Promise<Product> {
    const response = await request("POST", "/catalog/products", body);
    expect(response.status, failureContext([response])).toBe(201);
    return response.body as unknown as Product;
  }

  async function insertSnapshot(productId: string): Promise<SnapshotRow> {
    const result = await administrator.query<SnapshotRow>(
      `insert into catalog_product_snapshots (
         pharmacy_id, product_id, display_name, name_template_version
       ) values ($1, $2, 'server replaces this', 1)
       returning id, product_id, display_name, inventory_unit_name,
                 third_unit_name, pricing_method, retail_price_fils::text,
                 wholesale_price_fils::text, margin_percentage::text,
                 price_rounding`,
      [pharmacyId, productId],
    );
    const snapshot = result.rows[0];
    if (snapshot === undefined) {
      throw new Error("The posted Product snapshot was not created");
    }
    return snapshot;
  }

  async function snapshotById(snapshotId: string): Promise<SnapshotRow> {
    const result = await administrator.query<SnapshotRow>(
      `select id, product_id, display_name, inventory_unit_name,
              third_unit_name, pricing_method, retail_price_fils::text,
              wholesale_price_fils::text, margin_percentage::text,
              price_rounding
       from catalog_product_snapshots where id = $1`,
      [snapshotId],
    );
    const snapshot = result.rows[0];
    if (snapshot === undefined) {
      throw new Error("The posted Product snapshot is missing");
    }
    return snapshot;
  }

  async function snapshotPackageUnits(
    snapshotId: string,
  ): Promise<readonly { base_units_per_package: string; name: string }[]> {
    const result = await administrator.query<{
      base_units_per_package: string;
      name: string;
    }>(
      `select name, base_units_per_package::text
       from catalog_product_snapshot_package_units
       where snapshot_id = $1
       order by name`,
      [snapshotId],
    );
    return result.rows;
  }

  async function expectRejectedInRollback(
    sql: string,
    values: readonly unknown[],
    code: string,
  ): Promise<void> {
    const client = await administrator.connect();
    try {
      await client.query("begin");
      await expect(client.query(sql, [...values])).rejects.toMatchObject({
        code,
      });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  /**
   * The three default-unit foreign keys are `deferrable initially deferred`, so
   * a statement that breaks one is accepted and the constraint answers later.
   * Asserting on the statement itself would therefore prove nothing at all;
   * this forces the check with `set constraints all immediate` and asserts on
   * that, which is the same decision the transaction would reach at commit.
   */
  async function expectRejectedWhenDeferredChecksRun(
    sql: string,
    values: readonly unknown[],
    code: string,
  ): Promise<void> {
    const client = await administrator.connect();
    try {
      await client.query("begin");
      await client.query(sql, [...values]);
      await expect(
        client.query("set constraints all immediate"),
      ).rejects.toMatchObject({ code });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  function failureContext(responses: readonly ApiResponse[]): string {
    return `${apiOutput}\n${JSON.stringify(responses)}`;
  }

  async function request(
    method: "DELETE" | "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: requestHeaders(credentials, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body:
        text.length === 0
          ? undefined
          : (JSON.parse(text) as Record<string, unknown>),
      status: response.status,
    };
  }
});

function medicationRequest(
  tradeName: string,
  barcodes: readonly string[],
): ProductCreateRequest {
  return {
    arabicSearchName: "بانادول",
    barcodes: [...barcodes],
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
    idempotencyKey: createUuidV7(),
    instructions: {
      foodTiming: "after-food",
      usesPerDay: 3,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    packaging: {
      defaultUnits: {
        count: { kind: "inventory-unit" },
        purchase: { kind: "package-unit", packageUnitName: "Pack" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Strip",
      packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
      thirdUnit: { name: "Treatment day" },
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: "90000",
    },
    scientificName: "Paracetamol",
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: "blue" },
  };
}

function generalItemRequest(company: string): ProductCreateRequest {
  return {
    arabicSearchName: "بيوديرما أتوديرم",
    barcodes: ["3401399372926"],
    category: "Dermocosmetic",
    definition: {
      fields: {
        company,
        property: "intensive",
        size: "200 ml",
        subBrand: "Atoderm",
        targetAudience: "dry skin",
        typeOfUse: "cream",
      },
      mode: "general-item",
    },
    idempotencyKey: createUuidV7(),
    instructions: {
      foodTiming: null,
      usesPerDay: null,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    packaging: {
      defaultUnits: {
        count: { kind: "inventory-unit" },
        purchase: { kind: "package-unit", packageUnitName: "Box" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Piece",
      packageUnits: [{ baseUnitsPerPackage: "12", name: "Box" }],
      thirdUnit: null,
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "250000",
      wholesalePriceFils: null,
    },
    scientificName: null,
    sharing: { aiSharingAllowed: true, externallyVisible: false },
    stateColours: { coldStorageRequired: false, manual: null },
  };
}

function requestHeaders(
  credentials: MainDeviceCredentials,
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

function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: createUuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function createUuidV7(): string {
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
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).status === 200) {
        return;
      }
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
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
