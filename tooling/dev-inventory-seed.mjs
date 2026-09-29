/**
 * Dev-only inventory QA seed.
 *
 * Stock is created only through the local API: product definition, posted
 * purchase receipts, count-session lines, variance application, batch status
 * changes, and the reorder basket. It does not write balances or movements.
 *
 * The script refuses any API or database host that is not loopback, and it
 * refuses any database other than breev_local. Re-running it skips work that
 * is already present. It does not delete posted stock or replace an existing
 * pharmacy.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const QA_USERNAME = "qa.inventory";
const QA_PASSWORD = "inventory qa owner password";
const QA_DISPLAY_NAME = "Inventory QA Owner";
const SUPPLIER_NAME = "Al-Rafidain QA Supplies";
const INVOICE_DATE = "2026-09-20";

const require = createRequire(
  path.join(root, "apps/local-api/package.json"),
);
const { Client } = require("pg");

const env = loadEnv();
const apiUrl = new URL(env.BREEV_LOCAL_API_URL);
const databaseUrl = new URL(env.DATABASE_MIGRATION_URL);
assertLoopback(apiUrl, "BREEV_LOCAL_API_URL");
assertLoopback(databaseUrl, "DATABASE_MIGRATION_URL");
if (databaseUrl.pathname !== "/breev_local") {
  throw new Error(
    "The inventory seed only runs against the local breev_local database",
  );
}

const deviceHeaders = {
  Accept: "application/json",
  Authorization: `Breev-Device ${env.BREEV_MAIN_DEVICE_SECRET}`,
  Origin: "breev://app",
  "X-Breev-CSRF": "1",
  "X-Breev-Device-Id": env.BREEV_MAIN_DEVICE_ID,
  "X-Breev-Device-Session": env.BREEV_MAIN_DEVICE_SESSION,
};

await waitForHealth();
await ensureSignedIn();
const supplierId = await ensureSupplier();
const products = await ensureProducts();
await ensurePurchases(supplierId, products);
await ensureSafety(products);
await ensureCounts(products);
await ensureBasket(products);
await verify(products);

function loadEnv() {
  const file = path.join(root, ".env");
  if (!existsSync(file)) {
    throw new Error("Missing .env. Copy .env.example and configure it first.");
  }
  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const key of [
    "BREEV_LOCAL_API_URL",
    "DATABASE_MIGRATION_URL",
    "BREEV_MAIN_DEVICE_ID",
    "BREEV_MAIN_DEVICE_SECRET",
    "BREEV_MAIN_DEVICE_SESSION",
  ]) {
    if (typeof parsed[key] !== "string" || parsed[key] === "") {
      throw new Error(`Missing ${key} in .env`);
    }
  }
  return parsed;
}

function assertLoopback(url, label) {
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${label} must use a loopback host for this dev seed`);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/health", apiUrl), {
        headers: deviceHeaders,
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`Local API did not become healthy: ${lastError}`);
}

async function ensureSignedIn() {
  const state = await api("GET", "/identity/state");
  if (state.state === "bootstrap-required") {
    await api("POST", "/identity/bootstrap", {
      owner: {
        displayName: QA_DISPLAY_NAME,
        password: QA_PASSWORD,
        username: QA_USERNAME,
      },
      pharmacyName: "Breev Inventory QA Pharmacy",
    });
    console.log(`Bootstrapped pharmacy owner ${QA_USERNAME}`);
    return;
  }
  if (state.state === "authenticated") {
    await logoutIfNeeded();
  }
  await ensureQaUser();
  await api("POST", "/identity/login", {
    password: QA_PASSWORD,
    username: QA_USERNAME,
  });
  console.log(`Signed in as ${QA_USERNAME}`);
}

async function logoutIfNeeded() {
  await api("POST", "/identity/logout", {}, [204]);
}

async function ensureQaUser() {
  const { hashPassword } = await import(
    pathToFileURL(
      path.join(root, "apps/local-api/dist/identity-access/password.js"),
    ).href
  );
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      `select id from identity_users where username_key = $1`,
      [QA_USERNAME],
    );
    if (existing.rowCount === 0) {
      const pharmacies = await client.query(`select id from pharmacies`);
      if (pharmacies.rowCount !== 1) {
        throw new Error(
          "Expected exactly one local pharmacy before adding the QA user",
        );
      }
      const pharmacyId = pharmacies.rows[0].id;
      const owner = await client.query(
        `select identity_user.id
         from identity_users identity_user
         join pharmacy_roles role on role.id = identity_user.role_id
         where identity_user.pharmacy_id = $1
           and role.role_key = 'owner'
           and identity_user.status = 'active'
         limit 1`,
        [pharmacyId],
      );
      const ownerId = owner.rows[0]?.id;
      if (ownerId === undefined) {
        throw new Error("The local pharmacy has no active owner");
      }
      const role = await client.query(
        `select id from pharmacy_roles
         where pharmacy_id = $1 and role_key = 'owner'`,
        [pharmacyId],
      );
      const stored = await hashPassword(QA_PASSWORD);
      await client.query(
        `insert into identity_users (
           pharmacy_id, username, username_key, display_name, role_id,
           password_hash, password_algorithm, password_version,
           password_memory_kib, password_iterations, password_parallelism,
           created_by
         ) values ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          pharmacyId,
          QA_USERNAME,
          QA_DISPLAY_NAME,
          role.rows[0].id,
          stored.hash,
          stored.algorithm,
          stored.parameters.version,
          stored.parameters.memoryKiB,
          stored.parameters.iterations,
          stored.parameters.parallelism,
          ownerId,
        ],
      );
      console.log(`Created owner user ${QA_USERNAME}`);
    }
    await client.query(
      `insert into attendance_presence (pharmacy_id, user_id)
       select pharmacy_id, id from identity_users where username_key = $1
       on conflict (pharmacy_id, user_id) do nothing`,
      [QA_USERNAME],
    );
  } finally {
    await client.end();
  }
}

async function ensureSupplier() {
  const listed = await api("GET", "/suppliers");
  const found = listed.suppliers.find(
    (supplier) => supplier.name === SUPPLIER_NAME && supplier.status === "active",
  );
  if (found !== undefined) return found.id;
  const created = await api("POST", "/suppliers", {
    allowanceEffectiveFrom: "2026-01-01",
    defaultAllowancePercentage: "2.5",
    idempotencyKey: uuidV7(),
    name: SUPPLIER_NAME,
    terms: "Net 30",
  });
  return created.id;
}

async function ensureProducts() {
  const specs = productSpecs();
  const products = {};
  for (const spec of specs) {
    products[spec.key] = await ensureProduct(spec);
  }
  return products;
}

async function ensureProduct(spec) {
  const found = await findProduct(spec.barcode);
  if (found !== undefined) return found;
  return await api("POST", "/catalog/products", {
    arabicSearchName: spec.arabic,
    barcodes: [
      { kind: "product", value: spec.barcode },
      ...(spec.packageBarcode === undefined
        ? []
        : [{ kind: "package", value: spec.packageBarcode }]),
    ],
    category: "Inventory QA",
    definition: {
      fields: {
        dosageForm: spec.dosageForm,
        manufacturer: spec.manufacturer,
        strength: spec.strength,
        tradeName: spec.tradeName,
      },
      mode: "medication",
    },
    idempotencyKey: uuidV7(),
    instructions: {
      foodTiming: "after-food",
      usesPerDay: 1,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    packaging: {
      defaultUnits: {
        count: { kind: "inventory-unit" },
        purchase: spec.purchaseUnit,
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Strip",
      packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
      thirdUnit: null,
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "400000",
      wholesalePriceFils: null,
    },
    scientificName: spec.scientific,
    sharing: { aiSharingAllowed: false, externallyVisible: false },
    stateColours: { coldStorageRequired: false, manual: null },
    stockLevels: spec.levels,
  });
}

async function findProduct(barcode) {
  const search = await api(
    "GET",
    `/catalog/product-search?query=${encodeURIComponent(barcode)}&limit=20`,
  );
  return search.results.find((result) =>
    result.product.barcodes.some((item) => item.value === barcode),
  )?.product;
}

async function ensurePurchases(supplierId, products) {
  const posted = await api("GET", "/purchases/posted?query=QA-");
  const invoices = new Set(
    posted.purchases.map((purchase) => purchase.supplierInvoiceNumber),
  );
  for (const receipt of receipts(products)) {
    if (invoices.has(receipt.invoice)) continue;
    await postReceipt(supplierId, receipt);
    console.log(`Posted ${receipt.invoice}`);
  }
}

async function postReceipt(supplierId, receipt) {
  let draft = (
    await api("POST", "/purchases/drafts", {
      idempotencyKey: uuidV7(),
      invoiceDate: INVOICE_DATE,
      settlementContext: "debt",
      supplierId,
      supplierInvoiceNumber: receipt.invoice,
    })
  ).draft;
  for (const row of receipt.rows) {
    const committed = await api(
      "POST",
      `/purchases/drafts/${draft.id}/rows`,
      {
        costFils: row.unit.kind === "package-unit" ? "320000" : "80000",
        enteredQuantity: row.quantity,
        expectedVersion: draft.version,
        expiryDate: row.expiry,
        idempotencyKey: uuidV7(),
        itemId: row.productId,
        lotNumber: row.lot,
        notes: null,
        pricing: { method: "by-price", retailPriceFils: "400000" },
        unit: row.unit,
      },
    );
    draft = committed.draft;
  }
  await api("POST", `/purchases/drafts/${draft.id}/postings`, {
    expectedVersion: draft.version,
    idempotencyKey: uuidV7(),
  });
}

async function ensureSafety(products) {
  await markBatch(products.recalled.id, "recall", "QA-RECALL-1");
  await markBatch(products.quarantine.id, "quarantine", "QA-QUAR-1");
  const run = await api("POST", "/inventory/batch-safety/runs", {}, [202, 503]);
  if (run.status === 503) {
    console.log(
      "Batch-safety job was not queued. Expired rows still follow the expiry date.",
    );
  }
}

async function markBatch(productId, kind, lot) {
  const listed = await api("GET", `/inventory/items/${productId}/batches`);
  const batch = listed.batches.find((item) => item.lotNumber === lot);
  if (batch === undefined) {
    throw new Error(`Missing ${kind} batch ${lot}`);
  }
  const expected = kind === "recall" ? "recalled" : "quarantined";
  if (batch.status === expected) return;
  await api("POST", `/inventory/batches/${batch.batchId}/status-changes`, {
    evidence: `${kind} notice ${lot}`,
    idempotencyKey: uuidV7(),
    kind,
    reason: kind === "recall" ? "Supplier recall notice" : "Quarantine hold",
  });
  console.log(`Marked ${lot} ${expected}`);
}

async function ensureCounts(products) {
  await ensureAppliedCount(products.countApplied.id);
  await ensurePendingCount(products.countPending.id);
}

async function ensureAppliedCount(productId) {
  const history = await api(
    "GET",
    `/inventory/items/${productId}/movements`,
  );
  const applied = history.movements.some(
    (movement) => movement.kind === "count-variance",
  );
  const active = await api("GET", "/inventory/count-sessions?status=active");
  if (applied) {
    if (active.sessions.length === 1) {
      const session = await api(
        "GET",
        `/inventory/count-sessions/${active.sessions[0].id}`,
      );
      const ownsAppliedItem = session.lines.some(
        (line) => line.productId === productId,
      );
      if (ownsAppliedItem && session.pendingVarianceCount === "0") {
        await api(
          "POST",
          `/inventory/count-sessions/${session.id}/completions`,
          {
            expectedVersion: session.version,
            idempotencyKey: uuidV7(),
          },
        );
      }
    }
    return;
  }
  if (active.sessions.length > 0) {
    throw new Error(
      "An active count session already exists, so the seed will not start another one",
    );
  }
  let session = await api("POST", "/inventory/count-sessions", {
    idempotencyKey: uuidV7(),
  });
  const recorded = await api(
    "POST",
    `/inventory/count-sessions/${session.id}/lines`,
    {
      entries: [{ count: "20", unit: { kind: "inventory-unit" } }],
      expectedVersion: session.version,
      idempotencyKey: uuidV7(),
      productId,
    },
  );
  session = recorded.session;
  const appliedLine = await api(
    "POST",
    `/inventory/count-sessions/${session.id}/lines/${recorded.line.id}/variance-applications`,
    {
      evidence: "Shelf card QA-COUNT-APPLIED",
      expectedBalanceBefore: recorded.line.currentBalance,
      expectedVersion: session.version,
      idempotencyKey: uuidV7(),
      reason: "Counted twenty strips on the shelf",
    },
  );
  await api("POST", `/inventory/count-sessions/${session.id}/completions`, {
    expectedVersion: appliedLine.session.version,
    idempotencyKey: uuidV7(),
  });
  console.log("Completed the applied count session");
}

async function ensurePendingCount(productId) {
  const active = await api("GET", "/inventory/count-sessions?status=active");
  if (active.sessions.length > 1) {
    throw new Error("More than one active count session is already open");
  }
  if (active.sessions.length === 1) {
    const session = await api(
      "GET",
      `/inventory/count-sessions/${active.sessions[0].id}`,
    );
    if (session.lines.some((line) => line.productId === productId)) return;
    throw new Error(
      "The active count session belongs to other work, so the pending demo line was not added",
    );
  }
  const session = await api("POST", "/inventory/count-sessions", {
    idempotencyKey: uuidV7(),
  });
  await api("POST", `/inventory/count-sessions/${session.id}/lines`, {
    entries: [{ count: "11", unit: { kind: "inventory-unit" } }],
    expectedVersion: session.version,
    idempotencyKey: uuidV7(),
    productId,
  });
  console.log(`Left an active count session at ${session.id}`);
}

async function ensureBasket(products) {
  await ensureBasketItem(products.low.id, false);
  await ensureBasketItem(products.expiring.id, false);
  await ensureBasketItem(products.aboveMax.id, false);
  await ensureBasketItem(products.reorder.id, true);
}

async function ensureBasketItem(productId, confirm) {
  const ordered = await api("GET", "/inventory/reorder-basket?status=ordered");
  if (ordered.items.some((item) => item.productId === productId)) return;
  const added = await api("POST", "/inventory/reorder-basket/items", {
    idempotencyKey: uuidV7(),
    productId,
  });
  if (!confirm || added.outcome === "already-ordered") return;
  if (added.item.status === "ordered") return;
  await api(
    "POST",
    `/inventory/reorder-basket/items/${added.item.id}/confirmations`,
    {
      expectedVersion: added.item.version,
      idempotencyKey: uuidV7(),
    },
  );
}

async function verify(products) {
  const review = await api("GET", "/inventory/items");
  const byId = new Map(review.items.map((item) => [item.productId, item]));
  const expectations = [
    ["stable", "120"],
    ["low", "12"],
    ["reorder", "18"],
    ["aboveMax", "80"],
    ["expiring", "36"],
    ["expired", "16"],
    ["recalled", "24"],
    ["quarantine", "20"],
    ["fefo", "50"],
    ["pack", "12"],
    ["countApplied", "20"],
    ["countPending", "15"],
  ];
  const problems = [];
  for (const [key, balance] of expectations) {
    const item = byId.get(products[key].id);
    if (item === undefined) problems.push(`${key} is missing from inventory`);
    else if (item.balance !== balance) {
      problems.push(`${key} balance is ${item.balance}, expected ${balance}`);
    }
  }
  const fefoBatches = await api(
    "GET",
    `/inventory/items/${products.fefo.id}/batches`,
  );
  const fefoExpiries = fefoBatches.batches
    .map((batch) => batch.originalExpiryDate)
    .sort();
  if (fefoExpiries.join(",") !== "2027-03-31,2028-12-31") {
    problems.push(`FEFO expiries are ${fefoExpiries.join(", ")}`);
  }
  const recalled = await api(
    "GET",
    `/inventory/items/${products.recalled.id}/batches`,
  );
  if (recalled.batches[0]?.status !== "recalled") {
    problems.push("Recall batch is not recalled");
  }
  const quarantined = await api(
    "GET",
    `/inventory/items/${products.quarantine.id}/batches`,
  );
  if (quarantined.batches[0]?.status !== "quarantined") {
    problems.push("Quarantine batch is not quarantined");
  }
  const expired = await api(
    "GET",
    `/inventory/items/${products.expired.id}/batches`,
  );
  if (expired.batches[0]?.status !== "expired") {
    problems.push("Expired batch is not expired");
  }
  const expiring = await api(
    "GET",
    `/inventory/items/${products.expiring.id}/batches`,
  );
  if (expiring.batches[0]?.status !== "near-expiry") {
    problems.push("Expiring batch is not near expiry");
  }
  const arabic = await api(
    "GET",
    `/catalog/product-search?query=${encodeURIComponent("بندول")}&limit=20`,
  );
  if (
    !arabic.results.some((result) => result.product.id === products.stable.id)
  ) {
    problems.push("Arabic search did not find Panadol");
  }
  const barcode = await api(
    "GET",
    "/catalog/product-search?query=6281001000010&limit=20",
  );
  if (
    !barcode.results.some((result) => result.product.id === products.pack.id)
  ) {
    problems.push("Pack barcode search failed");
  }
  const sessions = await api("GET", "/inventory/count-sessions?status=active");
  if (sessions.sessions.length !== 1) {
    problems.push(
      `Expected one active count session, found ${sessions.sessions.length}`,
    );
  }
  const completed = await api(
    "GET",
    "/inventory/count-sessions?status=completed",
  );
  if (completed.sessions.length < 1) {
    problems.push("Expected a completed count session");
  }
  const basket = await api("GET", "/inventory/reorder-basket?status=basket");
  const ordered = await api("GET", "/inventory/reorder-basket?status=ordered");
  if (basket.items.length < 3) {
    problems.push(`Basket has ${basket.items.length} items`);
  }
  if (!ordered.items.some((item) => item.productId === products.reorder.id)) {
    problems.push("Reorder item is not in Ordered Items");
  }
  const movements = await api(
    "GET",
    `/inventory/items/${products.countApplied.id}/movements`,
  );
  if (
    !movements.movements.some((movement) => movement.kind === "purchase-receipt") ||
    !movements.movements.some((movement) => movement.kind === "count-variance")
  ) {
    problems.push("Applied count item is missing receipt or count movement");
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
  const activeId = sessions.sessions[0].id;
  console.log("");
  console.log("Inventory QA data is ready.");
  console.log(`Active count session: ${activeId}`);
  for (const spec of productSpecs()) {
    const item = byId.get(products[spec.key].id);
    console.log(
      `${spec.key}: ${item.displayName} | barcode ${spec.barcode} | balance ${item.balance} | Arabic ${spec.arabic}`,
    );
  }
}

function productSpecs() {
  const strip = { kind: "inventory-unit" };
  const pack = { kind: "package-unit", packageUnitName: "Pack" };
  return [
    spec("stable", "Panadol", "بندول", "6281001000001", "Paracetamol", {
      maximumLevel: "200",
      minimumLevel: "20",
      reorderPoint: "40",
    }),
    spec("low", "Amoxicillin", "أموكسيسيلين", "6281001000002", "Amoxicillin", {
      maximumLevel: "120",
      minimumLevel: "40",
      reorderPoint: "50",
    }),
    spec("reorder", "Brufen", "بروفين", "6281001000003", "Ibuprofen", {
      maximumLevel: "100",
      minimumLevel: "10",
      reorderPoint: "30",
    }),
    spec("aboveMax", "Vitamin D", "فيتامين د", "6281001000004", "Cholecalciferol", {
      maximumLevel: "40",
      minimumLevel: "5",
      reorderPoint: "10",
    }),
    spec("expiring", "Cough Syrup", "شراب السعال", "6281001000005", "Dextromethorphan", {
      maximumLevel: "100",
      minimumLevel: "10",
      reorderPoint: "20",
    }, { dosageForm: "syrup", strength: "100 ml" }),
    spec("expired", "Aspirin", "أسبرين", "6281001000006", "Acetylsalicylic acid", {
      maximumLevel: "80",
      minimumLevel: "10",
      reorderPoint: "20",
    }),
    spec("recalled", "Losartan", "لوسارتان", "6281001000007", "Losartan", {
      maximumLevel: "80",
      minimumLevel: "8",
      reorderPoint: "16",
    }),
    spec("quarantine", "Omeprazole", "أوميبرازول", "6281001000008", "Omeprazole", {
      maximumLevel: "80",
      minimumLevel: "8",
      reorderPoint: "16",
    }),
    spec("fefo", "Paracetamol", "باراسيتامول", "6281001000009", "Paracetamol", {
      maximumLevel: "120",
      minimumLevel: "15",
      reorderPoint: "25",
    }),
    spec(
      "pack",
      "Augmentin",
      "أوجمنتين",
      "6281001000010",
      "Amoxicillin and clavulanate",
      { maximumLevel: "40", minimumLevel: "4", reorderPoint: "8" },
      { packageBarcode: "6281001000011", purchaseUnit: pack },
    ),
    spec(
      "countApplied",
      "Cetirizine",
      "سيتيريزين",
      "6281001000012",
      "Cetirizine",
      { maximumLevel: "60", minimumLevel: "8", reorderPoint: "16" },
    ),
    spec(
      "countPending",
      "Metformin",
      "ميتفورمين",
      "6281001000013",
      "Metformin",
      { maximumLevel: "40", minimumLevel: "4", reorderPoint: "8" },
    ),
  ].map((item) => ({ ...item, purchaseUnit: item.purchaseUnit ?? strip }));
}

function spec(key, tradeName, arabic, barcode, scientific, levels, extra = {}) {
  return {
    arabic,
    barcode,
    dosageForm: extra.dosageForm ?? "tablet",
    key,
    levels,
    manufacturer: "QA Demo",
    packageBarcode: extra.packageBarcode,
    purchaseUnit: extra.purchaseUnit,
    scientific,
    strength: extra.strength ?? "500 mg",
    tradeName,
  };
}

function receipts(products) {
  const strip = { kind: "inventory-unit" };
  const pack = { kind: "package-unit", packageUnitName: "Pack" };
  const row = (product, quantity, expiry, lot, unit = strip) => ({
    expiry,
    lot,
    productId: product.id,
    quantity,
    unit,
  });
  return [
    {
      invoice: "QA-STABLE-A",
      rows: [row(products.stable, "70", "2029-06-30", "QA-STABLE-A")],
    },
    {
      invoice: "QA-STABLE-B",
      rows: [row(products.stable, "50", "2029-08-31", "QA-STABLE-B")],
    },
    {
      invoice: "QA-LOW",
      rows: [row(products.low, "12", "2028-01-31", "QA-LOW-1")],
    },
    {
      invoice: "QA-REORDER",
      rows: [row(products.reorder, "18", "2028-02-28", "QA-REORDER-1")],
    },
    {
      invoice: "QA-ABOVE-MAX",
      rows: [row(products.aboveMax, "80", "2028-03-31", "QA-MAX-1")],
    },
    {
      invoice: "QA-EXPIRING",
      rows: [row(products.expiring, "36", "2026-11-15", "QA-EXPIRING-1")],
    },
    {
      invoice: "QA-EXPIRED",
      rows: [row(products.expired, "16", "2026-08-01", "QA-EXPIRED-1")],
    },
    {
      invoice: "QA-RECALLED",
      rows: [row(products.recalled, "24", "2028-04-30", "QA-RECALL-1")],
    },
    {
      invoice: "QA-QUARANTINE",
      rows: [row(products.quarantine, "20", "2028-05-31", "QA-QUAR-1")],
    },
    {
      invoice: "QA-FEFO-EARLY",
      rows: [row(products.fefo, "30", "2027-03-31", "QA-FEFO-EARLY")],
    },
    {
      invoice: "QA-FEFO-LATE",
      rows: [row(products.fefo, "20", "2028-12-31", "QA-FEFO-LATE")],
    },
    {
      invoice: "QA-PACK",
      rows: [row(products.pack, "3", "2029-01-31", "QA-PACK-1", pack)],
    },
    {
      invoice: "QA-COUNT-APPLIED",
      rows: [row(products.countApplied, "24", "2028-06-30", "QA-COUNT-APPLIED")],
    },
    {
      invoice: "QA-COUNT-PENDING",
      rows: [row(products.countPending, "15", "2028-07-31", "QA-COUNT-PENDING")],
    },
  ];
}

async function api(method, route, body, accepted = [200, 201]) {
  const response = await fetch(new URL(route, apiUrl), {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...deviceHeaders,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
  });
  const text = await response.text();
  const parsed = text === "" ? undefined : JSON.parse(text);
  if (!accepted.includes(response.status)) {
    throw new Error(
      `${method} ${route} returned ${response.status}: ${text.slice(0, 800)}`,
    );
  }
  if (accepted.includes(503)) return { status: response.status, body: parsed };
  return parsed;
}

function uuidV7() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
