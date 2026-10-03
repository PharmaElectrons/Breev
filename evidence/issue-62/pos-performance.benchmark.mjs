import { createSeparatedDatabaseRolesFromUrl } from "../../apps/local-api/test/database-roles.ts";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const localApiRoot = path.join(repositoryRoot, "apps", "local-api");
const requireLocalApi = createRequire(path.join(localApiRoot, "package.json"));
const { Pool } = requireLocalApi("pg");

const SAMPLE_COUNT = positiveInteger(
  process.env.BREEV_BENCH_SAMPLE_COUNT,
  1_000,
);
const WARMUP_COUNT = Math.min(100, Math.max(25, Math.ceil(SAMPLE_COUNT / 10)));
const EXPECTED_COUNTS = {
  products: 10_000,
  suppliers: 1_000,
};
const SEARCH_TRADE_NAME = "Issue 62 Bench Product 10000";
const OWNER_USERNAME = "issue62.performance.owner";
const OWNER_PASSWORD = "issue 62 performance fixture password";
const RESET_ACKNOWLEDGEMENT = "issue-62-disposable-database-only";
const TARGETS_MS = {
  productSearch: 200,
  barcodeToLine: 300,
  durableDraftSave: 250,
};

let administratorUrl = "";
let databasePassword = "";
let apiOutput = "";
let apiProcess;
let administrator;
let apiOrigin = "";

async function main() {
  const database = await readDatabaseConfig();
  administratorUrl = database.url;
  databasePassword = database.password;

  const roles = await createSeparatedDatabaseRolesFromUrl(administratorUrl);
  administrator = new Pool({ connectionString: administratorUrl });
  const credentials = createCredentials();
  const apiPort = await reservePort();
  apiOrigin = `http://127.0.0.1:${String(apiPort)}`;

  try {
    apiProcess = startApi(apiPort, credentials, roles);
    await waitForHealth();

    const bootstrap = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Issue 62 Performance Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Issue 62 Performance Pharmacy",
    });
    assertStatus(bootstrap, 201, "bootstrap owner");

    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    assertStatus(login, 200, "owner login");
    const pharmacyId = login.body?.pharmacy?.id;
    if (typeof pharmacyId !== "string") {
      throw new Error("Owner login did not return a pharmacy identifier");
    }

    const owner = await administrator.query(
      `select id from identity_users
       where pharmacy_id = $1 and username = $2`,
      [pharmacyId, OWNER_USERNAME],
    );
    const ownerId = owner.rows[0]?.id;
    if (typeof ownerId !== "string") {
      throw new Error("Could not resolve the performance fixture owner");
    }

    const fixture = await seedDataset(pharmacyId, ownerId);
    await administrator.query("analyze catalog_products");
    await administrator.query("analyze catalog_product_barcodes");
    const countsBefore = await datasetCounts(pharmacyId);
    assertDatasetCounts(countsBefore);

    const readiness = await request("GET", "/health");
    assertStatus(readiness, 200, "pre-measurement health check");

    const search = await measureProductSearch(fixture);
    const barcodeToLine = await measureBarcodeToLine(fixture);
    const durableDraftSave = await measureDurableDraftSave(fixture);

    const afterSave = await request(
      "GET",
      `/sales/drafts/${durableDraftSave.draftId}`,
    );
    assertStatus(afterSave, 200, "draft read after save");
    if (
      afterSave.body?.version !== durableDraftSave.version ||
      afterSave.body?.lines?.[0]?.quantity !== durableDraftSave.quantity
    ) {
      throw new Error(
        "The final draft change was not visible after the save response",
      );
    }

    const healthAfter = await request("GET", "/health");
    assertStatus(healthAfter, 200, "post-measurement health check");
    const countsAfter = await datasetCounts(pharmacyId);

    const result = {
      capturedAt: new Date().toISOString(),
      benchmark: "Issue 62 Sale Draft API latency",
      measurementBoundary:
        "Loopback HTTP to the real local API, including response parsing. Barcode-to-line includes barcode search plus add-line. Draft save is a versioned quantity change whose HTTP response follows the transaction commit; a read-after-write check is outside the timed sample.",
      machine: machineProfile(),
      presentation: {
        locale: process.env.BREEV_BENCH_LOCALE ?? "en",
        theme: process.env.BREEV_BENCH_THEME ?? "light",
        note: "Recorded run context only; this API-only benchmark does not start the renderer.",
      },
      role: process.env.BREEV_BENCH_ROLE ?? "Main",
      networkState:
        process.env.BREEV_BENCH_NETWORK_STATE ??
        "Loopback API and local PostgreSQL; internet and peripherals not measured.",
      health: {
        beforeMeasurements: readiness.status,
        afterMeasurements: healthAfter.status,
      },
      database: {
        host: database.host,
        port: database.port,
        name: database.name,
        postgresVersion: await postgresVersion(),
      },
      dataset: {
        seeded: countsBefore,
        afterMeasurements: countsAfter,
        postedSaleDocuments: 0,
        inventoryBatches: 0,
        inventoryMovements: 0,
        saleDocumentHistoryDays: 0,
        qualityReferenceDatasetComplete: false,
        gaps: [
          "20,000 batches",
          "two years of history with 200,000 posted Sale Documents; issue 62 excludes posting",
        ],
      },
      sampling: {
        measuredSamplesPerOperation: SAMPLE_COUNT,
        warmupSamplesPerOperation: WARMUP_COUNT,
        percentileMethod: "nearest rank: sorted[ceil(p * n) - 1]",
        rawSampleValuesIncluded: true,
      },
      provisionalReferenceTargetsMs: TARGETS_MS,
      targetInterpretation:
        "The docs/quality.md targets are end-to-end interactions. These API-only results are a server-seam baseline and cannot establish target acceptance or minimum-profile certification.",
      operations: {
        search,
        barcodeToLine,
        durableDraftSave: durableDraftSave.summary,
      },
    };

    const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile(
      path.join(scriptDirectory, "performance-results.json"),
      serializedResult,
      "utf8",
    );
    process.stdout.write(serializedResult);
  } finally {
    await stopProcess(apiProcess);
    await administrator?.end().catch(() => undefined);
  }
}

async function readDatabaseConfig() {
  if (
    process.env.BREEV_BENCH_ALLOW_DESTRUCTIVE_RESET !== RESET_ACKNOWLEDGEMENT
  ) {
    throw new Error(
      `Refusing to reset PostgreSQL. Set BREEV_BENCH_ALLOW_DESTRUCTIVE_RESET=${RESET_ACKNOWLEDGEMENT} only for the isolated benchmark database.`,
    );
  }

  const host = process.env.BREEV_BENCH_POSTGRES_HOST ?? "127.0.0.1";
  const port = positiveInteger(process.env.BREEV_BENCH_POSTGRES_PORT, 56_462);
  const username = process.env.BREEV_BENCH_POSTGRES_USER ?? "breev_test_admin";
  const name =
    process.env.BREEV_BENCH_POSTGRES_DATABASE ?? "breev_issue_62_test";
  const passwordFile =
    process.env.BREEV_BENCH_POSTGRES_PASSWORD_FILE ??
    "D:\\Cefeldeen-clinic-pos\\issue-62-postgres\\password.txt";

  if (!isLoopback(host)) {
    throw new Error("Benchmark PostgreSQL must use a loopback host");
  }
  if (!/^breev_[a-z0-9_]+_(?:test|bench|perf)$/u.test(name)) {
    throw new Error(
      "Benchmark PostgreSQL database name must end in _test, _bench, or _perf",
    );
  }
  if (!/^[a-z_][a-z0-9_]*$/u.test(username)) {
    throw new Error("Benchmark PostgreSQL user name is invalid");
  }

  const password = (await readFile(passwordFile, "utf8")).trim();
  if (password.length === 0) {
    throw new Error("Benchmark PostgreSQL password file is empty");
  }
  const url = new URL("postgresql://localhost/");
  url.hostname = host;
  url.port = String(port);
  url.username = username;
  url.password = password;
  url.pathname = `/${name}`;
  return { host, name, password, port, url: url.toString() };
}

function isLoopback(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function startApi(port, credentials, roles) {
  const entrypoint = path.join(localApiRoot, "dist", "main.js");
  const child = spawn(process.execPath, [entrypoint], {
    cwd: localApiRoot,
    env: {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_MAIN_DEVICE_ID: credentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
      DATABASE_MIGRATION_URL: roles.migrationUrl,
      DATABASE_URL: roles.applicationUrl,
      HTTPS_PROXY: "http://127.0.0.1:1",
      HTTP_PROXY: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    apiOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    apiOutput += chunk.toString();
  });
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiOrigin}/health`);
      if (response.status === 200) return;
    } catch {
      // The compiled local API has not opened its listener yet.
    }
    await delay(100);
  }
  throw new Error(
    `Local API failed its startup health check. ${redact(apiOutput)}`,
  );
}

async function seedDataset(pharmacyId, ownerId) {
  const client = await administrator.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into suppliers (pharmacy_id, name, created_by, updated_by)
       select $1, 'Issue 62 Bench Supplier ' || lpad(n::text, 4, '0'), $2, $2
       from generate_series(1, $3::integer) as n`,
      [pharmacyId, ownerId, EXPECTED_COUNTS.suppliers],
    );
    await client.query(
      `create temporary table issue62_benchmark_products on commit drop as
       select n::integer as sequence,
              uuidv7() as product_id,
              uuidv7() as inventory_unit_id,
              '6297' || lpad(n::text, 9, '0') as barcode,
              'Issue 62 Bench Product ' || lpad(n::text, 5, '0') as trade_name
       from generate_series(1, $1::integer) as n`,
      [EXPECTED_COUNTS.products],
    );
    await client.query(
      `alter table issue62_benchmark_products
       add primary key (product_id),
       add unique (barcode),
       add unique (sequence)`,
    );
    await client.query(
      `insert into catalog_products (
         id, pharmacy_id, definition_mode, medication_trade_name,
         medication_strength, medication_dosage_form, medication_manufacturer,
         display_name, name_template_version, arabic_search_name,
         scientific_name, category, uses_per_day, food_timing,
         externally_visible, ai_sharing_allowed, cold_storage_required,
         count_default_unit_id, purchase_default_unit_id, sale_default_unit_id,
         pricing_method, retail_price_fils, wholesale_price_fils,
         created_by, updated_by
       )
       select product_id, $1, 'medication', trade_name, '500 mg', 'tablet',
              'Issue 62 Bench Labs', trade_name || ' 500 mg tablet Issue 62 Bench Labs',
              1, 'منتج تجريبي ' || lpad(sequence::text, 5, '0'),
              'Bench Ingredient ' || lpad((sequence % 250 + 1)::text, 3, '0'),
              'Bench Class ' || lpad((sequence % 20 + 1)::text, 2, '0'),
              3, 'after-food', true, false, false,
              inventory_unit_id, inventory_unit_id, inventory_unit_id,
              'by-price', 100000 + sequence, 90000 + sequence, $2, $2
       from issue62_benchmark_products`,
      [pharmacyId, ownerId],
    );
    await client.query(
      `insert into catalog_product_units (
         id, pharmacy_id, product_id, kind, name, ordinal
       )
       select inventory_unit_id, $1, product_id, 'inventory', 'Strip', 0
       from issue62_benchmark_products`,
      [pharmacyId],
    );
    await client.query(
      `insert into catalog_product_barcodes (
         pharmacy_id, product_id, barcode, kind, source, ordinal, recorded_by
       )
       select $1, product_id, barcode, 'product', 'provided', 0, $2
       from issue62_benchmark_products`,
      [pharmacyId, ownerId],
    );

    const target = await client.query(
      `select product_id, barcode
       from issue62_benchmark_products
       where sequence = $1`,
      [EXPECTED_COUNTS.products],
    );
    const productId = target.rows[0]?.product_id;
    const barcode = target.rows[0]?.barcode;
    if (typeof productId !== "string" || typeof barcode !== "string") {
      throw new Error("Could not resolve the benchmark product and barcode");
    }
    await client.query("commit");
    return { barcode, productId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function datasetCounts(pharmacyId) {
  const result = await administrator.query(
    `select
       (select count(*)::integer from catalog_products where pharmacy_id = $1) as products,
       (select count(*)::integer from suppliers where pharmacy_id = $1) as suppliers,
       (select count(*)::integer from inventory_batches where pharmacy_id = $1) as batches,
       (select count(*)::integer from inventory_movements where pharmacy_id = $1) as movements,
       (select count(*)::integer from sale_drafts where pharmacy_id = $1) as sale_drafts`,
    [pharmacyId],
  );
  return result.rows[0];
}

function assertDatasetCounts(counts) {
  for (const [key, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (counts?.[key] !== expected) {
      throw new Error(
        `Expected ${expected} synthetic ${key}, found ${String(counts?.[key])}`,
      );
    }
  }
}

async function measureProductSearch(fixture) {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT + WARMUP_COUNT; index += 1) {
    const startedAt = performance.now();
    const response = await request(
      "GET",
      `/sales/product-search?query=${encodeURIComponent(SEARCH_TRADE_NAME)}`,
    );
    assertStatus(response, 200, "product search");
    if (
      !response.body?.results?.some(
        (item) => item.product?.id === fixture.productId,
      )
    ) {
      throw new Error(
        "Product search did not return the expected benchmark product",
      );
    }
    if (index >= WARMUP_COUNT) samples.push(elapsedMs(startedAt));
  }
  return summarize(samples);
}

async function measureBarcodeToLine(fixture) {
  const drafts = await createDrafts(SAMPLE_COUNT + WARMUP_COUNT);
  const samples = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const startedAt = performance.now();
    const search = await request(
      "GET",
      `/sales/product-search?query=${encodeURIComponent(fixture.barcode)}`,
    );
    assertStatus(search, 200, "barcode search");
    const match = search.body?.results?.find(
      (item) =>
        item.matchedField === "barcode" &&
        item.product?.id === fixture.productId,
    );
    if (match === undefined) {
      throw new Error(
        "Barcode search did not return the expected benchmark product",
      );
    }
    const draft = drafts[index];
    if (draft === undefined)
      throw new Error("Benchmark draft fixture is missing");
    const added = await request("POST", `/sales/drafts/${draft.id}/lines`, {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
      productId: match.product.id,
    });
    assertStatus(added, 200, "barcode add-line");
    if (
      added.body?.lines?.length !== 1 ||
      added.body.lines[0]?.productId !== fixture.productId
    ) {
      throw new Error(
        "Barcode add-line did not persist exactly one expected line",
      );
    }
    if (index >= WARMUP_COUNT) samples.push(elapsedMs(startedAt));
  }
  return summarize(samples);
}

async function measureDurableDraftSave(fixture) {
  const draft = await createDraft();
  const added = await request("POST", `/sales/drafts/${draft.id}/lines`, {
    expectedVersion: draft.version,
    idempotencyKey: uuidV7(),
    productId: fixture.productId,
  });
  assertStatus(added, 200, "prepare draft line");
  const line = added.body?.lines?.[0];
  if (line === undefined)
    throw new Error("Could not prepare the durable-save line");

  let version = added.body.version;
  let quantity = 1;
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT + WARMUP_COUNT; index += 1) {
    quantity = quantity === 1 ? 2 : 1;
    const startedAt = performance.now();
    const response = await request(
      "POST",
      `/sales/drafts/${draft.id}/lines/${line.id}/changes`,
      {
        expectedVersion: version,
        idempotencyKey: uuidV7(),
        quantity: String(quantity),
      },
    );
    assertStatus(response, 200, "durable draft line save");
    const savedDraft = response.body;
    version = savedDraft.version;
    if (savedDraft.lines?.[0]?.quantity !== String(quantity)) {
      throw new Error(
        "Draft save response does not contain the requested quantity",
      );
    }
    if (index >= WARMUP_COUNT) samples.push(elapsedMs(startedAt));
  }

  return {
    draftId: draft.id,
    quantity: String(quantity),
    version,
    summary: summarize(samples),
  };
}

async function createDrafts(count) {
  const drafts = [];
  for (let index = 0; index < count; index += 1) {
    drafts.push(await createDraft());
  }
  return drafts;
}

async function createDraft() {
  const response = await request("POST", "/sales/drafts", {
    idempotencyKey: uuidV7(),
  });
  assertStatus(response, 201, "create sale draft");
  return response.body;
}

function summarize(samples) {
  const sorted = samples.slice().sort((left, right) => left - right);
  const percentile = (percent) =>
    sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)] ?? null;
  return {
    count: samples.length,
    minMs: roundMs(sorted[0] ?? null),
    p50Ms: roundMs(percentile(50)),
    p95Ms: roundMs(percentile(95)),
    p99Ms: roundMs(percentile(99)),
    maxMs: roundMs(sorted.at(-1) ?? null),
    sampleValuesMs: samples,
  };
}

function elapsedMs(startedAt) {
  return performance.now() - startedAt;
}

function roundMs(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

async function request(method, route, body) {
  const response = await fetch(new URL(route, apiOrigin), {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      Accept: "application/json",
      Authorization: `Breev-Device ${currentCredentials.deviceSecret}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Breev-CSRF": "1",
      "X-Breev-Device-Id": currentCredentials.deviceId,
      "X-Breev-Device-Session": currentCredentials.sessionToken,
      Origin: "breev://app",
    },
    method,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    throw new Error(
      `Local API returned non-JSON content for ${method} ${route}`,
    );
  }
  return { body: parsed, status: response.status };
}

let currentCredentials;

function assertStatus(response, expected, operation) {
  if (response.status !== expected) {
    throw new Error(
      `${operation} returned HTTP ${response.status}; expected ${expected}: ${JSON.stringify(response.body)}`,
    );
  }
}

async function postgresVersion() {
  const result = await administrator.query("show server_version");
  return result.rows[0]?.server_version ?? "unknown";
}

function machineProfile() {
  const cpus = os.cpus();
  return {
    classification: "development workstation; not minimum-certified evidence",
    os: `${process.env.BREEV_BENCH_OS_DESCRIPTION ?? os.type()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0]?.model ?? "unknown",
    logicalProcessors: cpus.length,
    memoryBytes: os.totalmem(),
    node: process.version,
    hardwareProfile:
      process.env.BREEV_BENCH_HARDWARE_PROFILE ?? "development-only",
  };
}

function createCredentials() {
  currentCredentials = {
    deviceId: uuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
  return currentCredentials;
}

function uuidV7() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function reservePort() {
  const server = createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve an API loopback port"));
      } else {
        resolve(address.port);
      }
    });
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

async function stopProcess(child) {
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      "Benchmark sample count and PostgreSQL port must be positive integers",
    );
  }
  return parsed;
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redact(value) {
  let result = String(value);
  for (const secret of [databasePassword, administratorUrl].filter(Boolean)) {
    result = result.replaceAll(secret, "[redacted]");
  }
  return result;
}

const directInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (directInvocation) {
  main().catch((error) => {
    process.stderr.write(
      `${redact(error instanceof Error ? (error.stack ?? error.message) : error)}\n`,
    );
    process.exitCode = 1;
  });
}
