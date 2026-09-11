import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  IMPLEMENTED_PERMISSION_NAMES,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  identityStepUpApprovePath,
  inventoryAllocationPreviewContract,
  inventoryBatchSafetyRunContract,
  inventoryBatchSafetyStatusContract,
  inventoryBatchStatusChangePath,
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
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { businessDateOf, addDays } from "./business-date.js";
import {
  allocateFefo,
  validateBatchAllocation,
} from "./inventory-persistence.js";
import { catchUp } from "./inventory-safety-evaluator.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "batch.safety.matrix.owner";
const OWNER_PASSWORD = "batch safety matrix owner password stays in this test";

const BUILT_IN_ACTORS = [
  "owner",
  "manager",
  "pharmacist",
  "sales_employee",
  "purchasing_employee",
  "inventory_employee",
  "accountant",
] as const;

const STEP_UP_STATES = [
  "none",
  "pending",
  "approved-correction",
  "approved-export",
] as const;

type StepUpState = (typeof STEP_UP_STATES)[number];
type HardBlockedStatus = "expired" | "recalled" | "quarantined";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ActorCredentials {
  readonly password: string;
  readonly username: string;
}

interface Actor extends ActorCredentials {
  readonly permissions: ReadonlySet<string>;
  readonly roleKey: string;
}

interface Target {
  readonly batchId: string;
  readonly status: HardBlockedStatus;
}

interface ChallengeResult {
  readonly approved: boolean;
  readonly created: boolean;
  readonly createStatus: number;
  readonly id: string | undefined;
}

describe.sequential("inventory batch-safety refusal matrix", () => {
  let administrator: Pool;
  let application: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId = "";
  let product: Product;
  let targets: readonly Target[] = [];
  let today = "";

  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({
      connectionString: databaseRoles.migrationUrl,
    });
    application = new Pool({ connectionString: databaseRoles.applicationUrl });
    credentials = createCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);

    const bootstrap = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Batch Safety Matrix Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Batch Safety Matrix Pharmacy",
    });
    expect(bootstrap.status, diagnostics(bootstrap)).toBe(201);
    pharmacyId = String(
      (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
    today = businessDateOf(new Date(), "Asia/Baghdad");

    await login({ password: OWNER_PASSWORD, username: OWNER_USERNAME });
    const supplier = await createSupplier();
    const created = await request(
      "POST",
      "/catalog/products",
      medicationRequest(),
    );
    expect(created.status, diagnostics(created)).toBe(201);
    product = created.body as Product;
    await postPurchase(supplier.id);

    const batches = await administrator.query<{
      expiry_date: string;
      id: string;
    }>(
      `select id, expiry_date::text
       from inventory_batches
       where pharmacy_id = $1 and product_id = $2
       order by expiry_date, id`,
      [pharmacyId, product.id],
    );
    const expectedTargets = [
      [addDays(today, -1), "expired"],
      [addDays(today, 300), "quarantined"],
      [addDays(today, 400), "recalled"],
    ] as const;
    targets = expectedTargets.map(([expiryDate, status]) => {
      const batch = batches.rows.find((row) => row.expiry_date === expiryDate);
      if (batch === undefined) {
        throw new Error(`Missing matrix batch with expiry ${expiryDate}`);
      }
      return { batchId: batch.id, status };
    });

    await changeStatus(targets[1]!.batchId, "quarantine");
    await changeStatus(targets[2]!.batchId, "recall");
    await triggerSafetyEvaluator();

    const detected = await administrator.query<{ kind: string }>(
      `select kind from inventory_batch_status_events
       where pharmacy_id = $1 and batch_id = $2 and kind = 'expired'`,
      [pharmacyId, targets[0]!.batchId],
    );
    expect(detected.rows).toHaveLength(1);
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("refuses every hard-blocked batch for every role and Step-Up state", async () => {
    const actors = await createActors();
    const rows: Array<{
      readonly httpNamed: string;
      readonly httpUnnamed: string;
      readonly inProcess: string;
      readonly role: string;
      readonly stepUp: string;
      readonly target: HardBlockedStatus;
    }> = [];

    for (const actor of actors) {
      await login(actor);
      for (const state of STEP_UP_STATES) {
        for (const target of targets) {
          const challenge = await prepareStepUp(actor, state, target.batchId);
          const named = await request(
            "POST",
            inventoryAllocationPreviewContract.path,
            {
              lines: [
                {
                  batchId: target.batchId,
                  productId: product.id,
                  quantity: "1",
                },
              ],
            },
          );
          const unnamed = await request(
            "POST",
            inventoryAllocationPreviewContract.path,
            { lines: [{ productId: product.id, quantity: "1" }] },
          );
          const inProcess = await assertInProcessRefusal(target);

          const hasReview = actor.permissions.has("inventory.review");
          if (hasReview) {
            expect(named.status, diagnostics(named)).toBe(409);
            expect(named.body).toMatchObject({
              code: "regulatory-hard-block",
              fieldErrors: [
                {
                  path: ["lines", 0, "batchId"],
                  rule: `inventory.batch.${target.status}`,
                },
              ],
            });
            expect(unnamed.status, diagnostics(unnamed)).toBe(200);
            const unnamedBody = unnamed.body as {
              allocations: Array<{ batchId: string }>;
              blocked: Array<{ batchId: string; status: string }>;
            };
            expect(
              unnamedBody.allocations.some(
                (allocation) => allocation.batchId === target.batchId,
              ),
            ).toBe(false);
            expect(unnamedBody.blocked).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  batchId: target.batchId,
                  status: target.status,
                }),
              ]),
            );
          } else {
            expect(named.status, diagnostics(named)).toBe(403);
            expect(unnamed.status, diagnostics(unnamed)).toBe(403);
          }

          if (state === "approved-correction" && challenge.id !== undefined) {
            const challengeState = await administrator.query<{
              consumed_at: Date | null;
            }>("select consumed_at from step_up_challenges where id = $1", [
              challenge.id,
            ]);
            expect(challengeState.rows[0]?.consumed_at).toBeNull();
          }

          rows.push({
            httpNamed: hasReview
              ? "409:regulatory-hard-block"
              : "403:identity-denied",
            httpUnnamed: hasReview
              ? "200:target-blocked"
              : "403:identity-denied",
            inProcess,
            role: actor.roleKey,
            stepUp:
              state === "none" ||
              (state === "pending" ? challenge.created : challenge.approved)
                ? state
                : `${state}:challenge-denied`,
            target: target.status,
          });
        }
      }
    }

    console.info(
      [
        "role\tstepUp\ttarget\thttpNamed\thttpUnnamed\tinProcess",
        ...rows.map((row) =>
          [
            row.role,
            row.stepUp,
            row.target,
            row.httpNamed,
            row.httpUnnamed,
            row.inProcess,
          ].join("\t"),
        ),
      ].join("\n"),
    );
    expect(rows).toHaveLength(
      actors.length * STEP_UP_STATES.length * targets.length,
    );
  }, 120_000);

  it("lists every expired and unresolved recalled or quarantined batch in the monthly review", async () => {
    await login({ password: OWNER_PASSWORD, username: OWNER_USERNAME });
    const review = await request("GET", "/inventory/batch-safety/review");
    expect(review.status, diagnostics(review)).toBe(200);
    const body = review.body as {
      readonly businessDate: string;
      readonly fields: { readonly valuation: "granted" | "denied" };
      readonly month: string;
      readonly rows: ReadonlyArray<{
        readonly batch: { readonly batchId: string; readonly status: string };
        readonly carryingAmountFils: string | null;
        readonly daysBlocked: string;
        readonly detectedOnBusinessDate: string;
      }>;
      readonly runs: { readonly completedBusinessDates: readonly string[] };
    };
    expect(body.month).toBe(today.slice(0, 7));
    expect(body.fields.valuation).toBe("granted");
    expect(body.runs.completedBusinessDates).toContain(today);
    // Exactly the three hard-blocked batches, nothing eligible or near-expiry.
    expect(
      body.rows
        .map((row) => [row.batch.batchId, row.batch.status] as const)
        .sort(),
    ).toEqual(
      targets.map((target) => [target.batchId, target.status] as const).sort(),
    );
    for (const row of body.rows) {
      expect(row.detectedOnBusinessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(row.daysBlocked).toMatch(/^\d+$/u);
      expect(row.carryingAmountFils).toMatch(/^-?\d+$/u);
    }
  });

  it("keeps safety source identifiers free of bypass-shaped escape hatches", async () => {
    const directory = path.resolve(import.meta.dirname);
    const files = (await readdir(directory)).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    const forbidden = ["fo" + "rce", "over" + "ride", "by" + "pass"];
    for (const file of files) {
      const source = await readFile(path.join(directory, file), "utf8");
      const withoutCommentsAndStrings = source
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/\/\/[^\n]*\n/gu, "\n")
        .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/gu, "");
      for (const word of forbidden) {
        expect(withoutCommentsAndStrings).not.toMatch(
          new RegExp(`\\b${word}\\b`, "u"),
        );
      }
    }
  });

  async function assertInProcessRefusal(target: Target): Promise<string> {
    const client = await application.connect();
    try {
      const input = {
        businessDate: today,
        lines: [
          { batchId: target.batchId, productId: product.id, quantity: 1n },
        ],
        nearExpiryDays: () => 90,
        pharmacyId,
      } as const;
      const preview = await allocateFefo(client, input, false);
      expect(preview).toMatchObject({
        batchId: target.batchId,
        kind: "regulatory-hard-block",
        productId: product.id,
        status: target.status,
      });
      const validation = await validateBatchAllocation(client, input);
      expect(validation).toMatchObject({
        batchId: target.batchId,
        kind: "regulatory-hard-block",
        productId: product.id,
        status: target.status,
      });
      return "regulatory-hard-block";
    } finally {
      client.release();
    }
  }

  async function prepareStepUp(
    actor: Actor,
    state: StepUpState,
    batchId: string,
  ): Promise<ChallengeResult> {
    if (state === "none") {
      return {
        approved: false,
        created: false,
        createStatus: 0,
        id: undefined,
      };
    }
    const action =
      state === "approved-export"
        ? "inventory.sensitive.export"
        : "inventory.batch_expiry.correct";
    const challenge = await createChallenge(
      actor,
      action,
      state === "approved-export" ? undefined : batchId,
      state !== "pending",
    );
    const requiredPermission =
      state === "approved-export"
        ? "inventory.valuation.view"
        : "inventory.batch_safety.manage";
    expect(challenge.createStatus).toBe(
      actor.permissions.has(requiredPermission) ? 201 : 403,
    );
    return challenge;
  }

  async function createChallenge(
    actor: ActorCredentials,
    action: string,
    subjectId: string | undefined,
    approve: boolean,
  ): Promise<ChallengeResult> {
    const created = await request("POST", "/identity/step-up-challenges", {
      action,
      ...(subjectId === undefined ? {} : { subjectId }),
      idempotencyKey: uuidV7(),
    });
    if (created.status !== 201) {
      return {
        approved: false,
        created: false,
        createStatus: created.status,
        id: undefined,
      };
    }
    const challengeId = String((created.body as { id?: string }).id ?? "");
    if (!approve) {
      expect(created.body).toMatchObject({
        id: challengeId,
        status: "pending",
      });
      return {
        approved: false,
        created: true,
        createStatus: created.status,
        id: challengeId,
      };
    }
    const approved = await request(
      "POST",
      identityStepUpApprovePath(challengeId),
      { idempotencyKey: uuidV7(), password: actor.password },
    );
    if (approved.status === 200) {
      expect(approved.body).toMatchObject({
        id: challengeId,
        status: "approved",
      });
    }
    return {
      approved: approved.status === 200,
      created: true,
      createStatus: created.status,
      id: challengeId,
    };
  }

  async function createActors(): Promise<Actor[]> {
    const actors: Actor[] = [];
    const owner: ActorCredentials = {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    };
    const customRoleId = await createCustomRole(owner);
    for (const roleKey of BUILT_IN_ACTORS) {
      const actor: ActorCredentials =
        roleKey === "owner"
          ? owner
          : {
              password: `batch safety ${roleKey} password stays in this test`,
              username: `batch.safety.matrix.${roleKey}`,
            };
      const roleId = await roleIdFor(roleKey);
      if (roleKey !== "owner") {
        await createUser(owner, actor, roleId);
      }
      actors.push({
        ...actor,
        permissions: await readRolePermissions(roleId),
        roleKey,
      });
    }
    const customActor: ActorCredentials = {
      password: "batch safety custom password stays in this test",
      username: "batch.safety.matrix.custom",
    };
    await createUser(owner, customActor, customRoleId);
    const customPermissions = await readRolePermissions(customRoleId);
    expect([...customPermissions].sort()).toEqual(
      [...IMPLEMENTED_PERMISSION_NAMES].sort(),
    );
    actors.push({
      ...customActor,
      permissions: customPermissions,
      roleKey: "custom-all-permissions",
    });
    return actors;
  }

  async function createCustomRole(owner: ActorCredentials): Promise<string> {
    await login(owner);
    const challenge = await createChallenge(
      owner,
      "identity.role.create",
      undefined,
      true,
    );
    expect(challenge.approved).toBe(true);
    const response = await request("POST", "/identity/roles", {
      challengeId: challenge.id,
      idempotencyKey: uuidV7(),
      name: "Batch Safety Matrix All Permissions",
      permissions: [...IMPLEMENTED_PERMISSION_NAMES],
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return String((response.body as { id?: string }).id ?? "");
  }

  async function createUser(
    owner: ActorCredentials,
    actor: ActorCredentials,
    roleId: string,
  ): Promise<void> {
    await login(owner);
    const challenge = await createChallenge(
      owner,
      "identity.user.create",
      undefined,
      true,
    );
    expect(challenge.approved).toBe(true);
    const response = await request("POST", "/identity/users", {
      challengeId: challenge.id,
      displayName: actor.username,
      idempotencyKey: uuidV7(),
      password: actor.password,
      roleId,
      username: actor.username,
    });
    expect(response.status, diagnostics(response)).toBe(201);
  }

  async function readRolePermissions(
    roleId: string,
  ): Promise<ReadonlySet<string>> {
    const grants = await administrator.query<{ permission_name: string }>(
      `select permission_name
       from role_permission_grants
       where pharmacy_id = $1 and role_id = $2
       order by permission_name`,
      [pharmacyId, roleId],
    );
    return new Set(grants.rows.map((row) => row.permission_name));
  }

  async function roleIdFor(roleKey: string): Promise<string> {
    const role = await administrator.query<{ id: string }>(
      "select id from pharmacy_roles where pharmacy_id = $1 and role_key = $2",
      [pharmacyId, roleKey],
    );
    const id = role.rows[0]?.id;
    if (id === undefined) throw new Error(`Missing role ${roleKey}`);
    return id;
  }

  async function changeStatus(
    batchId: string,
    kind: "quarantine" | "recall",
  ): Promise<void> {
    await login({ password: OWNER_PASSWORD, username: OWNER_USERNAME });
    const response = await request(
      "POST",
      inventoryBatchStatusChangePath(batchId),
      {
        evidence: `Batch safety ${kind} evidence`,
        idempotencyKey: uuidV7(),
        kind,
        reason: `Batch safety ${kind} reason`,
      },
    );
    expect(response.status, diagnostics(response)).toBe(201);
  }

  async function triggerSafetyEvaluator(): Promise<void> {
    await login({ password: OWNER_PASSWORD, username: OWNER_USERNAME });
    const trigger = await request(
      "POST",
      inventoryBatchSafetyRunContract.path,
      {},
    );
    expect(trigger.status, diagnostics(trigger)).toBe(202);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await request(
        "GET",
        inventoryBatchSafetyStatusContract.path,
      );
      if (
        status.status === 200 &&
        (status.body as { state?: string }).state === "current"
      ) {
        return;
      }
      await delay(100);
    }
    await catchUp(application, {
      pharmacyId,
      throughBusinessDate: today,
      trigger: "manual",
    });
    const status = await request(
      "GET",
      inventoryBatchSafetyStatusContract.path,
    );
    expect(status.status, diagnostics(status)).toBe(200);
    expect((status.body as { state?: string }).state).toBe("current");
  }

  async function createSupplier(): Promise<Supplier> {
    const response = await request("POST", "/suppliers", {
      allowanceEffectiveFrom: today,
      defaultAllowancePercentage: "0",
      idempotencyKey: uuidV7(),
      name: "Batch Safety Matrix Supplier",
      terms: "Net 30",
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as Supplier;
  }

  async function postPurchase(supplierId: string): Promise<string> {
    const draftResponse = await request("POST", "/purchases/drafts", {
      idempotencyKey: uuidV7(),
      invoiceDate: today,
      settlementContext: "debt",
      supplierId,
      supplierInvoiceNumber: "BATCH-SAFETY-MATRIX-1",
    });
    expect(draftResponse.status, diagnostics(draftResponse)).toBe(201);
    let draft = (draftResponse.body as { draft: PurchaseDraft }).draft;
    for (const [index, expiryDate] of [
      addDays(today, -1),
      addDays(today, 300),
      addDays(today, 400),
    ].entries()) {
      const row = await request("POST", purchaseDraftRowsPath(draft.id), {
        costFils: "1000",
        enteredQuantity: "5",
        expectedVersion: draft.version,
        expiryDate,
        idempotencyKey: uuidV7(),
        itemId: product.id,
        lotNumber: `MATRIX-LOT-${String(index)}`,
        notes: null,
        pricing: { method: "by-price", retailPriceFils: "999999" },
        unit: { kind: "inventory-unit" },
      });
      expect(row.status, diagnostics(row)).toBe(201);
      draft = (row.body as { draft: PurchaseDraft }).draft;
    }
    const posted = await request("POST", purchaseDraftPostingsPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(posted.status, diagnostics(posted)).toBe(201);
    return String(
      ((posted.body as PurchasePostResult).posted as { id: string }).id,
    );
  }

  async function login(actor: ActorCredentials): Promise<void> {
    const response = await request("POST", "/identity/login", {
      password: actor.password,
      username: actor.username,
    });
    expect(response.status, diagnostics(response)).toBe(200);
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

  function diagnostics(response: ApiResponse): string {
    return `${apiOutput}\n${JSON.stringify(response)}`;
  }
});

function medicationRequest(): ProductCreateRequest {
  return {
    arabicSearchName: "مصفوفة سلامة الدفعات",
    barcodes: [
      { kind: "product", value: randomBytes(6).toString("hex").slice(0, 13) },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName: "Batch Safety Matrix Item",
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
    stockLevels: { maximumLevel: "10", minimumLevel: "5", reorderPoint: "4" },
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
    await delay(100);
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
