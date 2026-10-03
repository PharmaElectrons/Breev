import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  inventoryItemListContract,
  inventoryMovementHistoryPath,
  inventoryReportPath,
  inventoryReportProtectedExportContract,
  inventoryReportSchema,
  INVENTORY_REPORT_KINDS,
  inventoryReportActivityPageSchema,
  inventoryReportExportSchema,
  inventoryReportQueryFor,
  inventorySensitiveExportContract,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  purchasePostedPath,
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
import { readInventoryReportPage } from "../inventory/inventory-report-query.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "inventory.auth.owner";
const OWNER_PASSWORD = "inventory auth owner password stays in this test";
const MANAGER_USERNAME = "inventory.auth.manager";
const MANAGER_PASSWORD = "inventory auth manager password stays in this test";
const PHARMACIST_USERNAME = "inventory.auth.pharmacist";
const PHARMACIST_PASSWORD =
  "inventory auth pharmacist password stays in this test";
const CUSTOM_USERNAME = "inventory.auth.custom";
const CUSTOM_PASSWORD = "inventory auth custom password stays in this test";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

describe.sequential(
  "Inventory review server-boundary authorization matrix",
  () => {
    let administrator: Pool;
    let api: ChildProcessWithoutNullStreams;
    let apiOrigin = "";
    let apiOutput = "";
    let apiPort = 0;
    let credentials: Credentials;
    let databaseRoles: SeparatedDatabaseRoles;
    let postgres: StartedPostgreSqlContainer | undefined;
    let pharmacyId = "";
    let product: Product;
    let postedPurchaseId = "";

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
      credentials = createCredentials();
      apiPort = await reservePort();
      apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
      api = startApi();
      await waitForHealth(apiOrigin, () => apiOutput);

      const bootstrap = await request("POST", "/identity/bootstrap", {
        owner: {
          displayName: "Inventory Authorization Owner",
          password: OWNER_PASSWORD,
          username: OWNER_USERNAME,
        },
        pharmacyName: "Breev Inventory Authorization Pharmacy",
      });
      expect(bootstrap.status, diagnostics(bootstrap)).toBe(201);
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      pharmacyId = String(
        (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
      );
      const supplier = await createSupplier();
      const created = await request(
        "POST",
        "/catalog/products",
        medicationRequest(),
      );
      expect(created.status, diagnostics(created)).toBe(201);
      product = created.body as Product;
      postedPurchaseId = await postPurchase(supplier.id);

      await createUser(MANAGER_USERNAME, MANAGER_PASSWORD, "manager");
      await createUser(PHARMACIST_USERNAME, PHARMACIST_PASSWORD, "pharmacist");
      const customRoleId = await createCustomRole();
      await createUser(CUSTOM_USERNAME, CUSTOM_PASSWORD, customRoleId);
    }, 180_000);

    afterAll(async () => {
      await stopProcess(api);
      await administrator?.end().catch(() => undefined);
      await postgres?.stop().catch(() => undefined);
    });

    it("filters valuation by permission while every review role can read the item", async () => {
      const permitted = [
        [OWNER_USERNAME, OWNER_PASSWORD, true],
        [MANAGER_USERNAME, MANAGER_PASSWORD, true],
        [PHARMACIST_USERNAME, PHARMACIST_PASSWORD, false],
        [CUSTOM_USERNAME, CUSTOM_PASSWORD, false],
      ] as const;
      for (const [username, password, valuationGranted] of permitted) {
        await login(username, password);
        const response = await request("GET", inventoryItemListContract.path);
        expect(response.status, diagnostics(response)).toBe(200);
        const body = response.body as {
          fields: { valuation: "granted" | "denied" };
          items: Array<{
            averageUnitCostFils: string | null;
            valueFils: string | null;
          }>;
        };
        expect(body.fields.valuation).toBe(
          valuationGranted ? "granted" : "denied",
        );
        expect(body.items[0]?.averageUnitCostFils).toEqual(
          valuationGranted ? expect.any(String) : null,
        );
        expect(body.items[0]?.valueFils).toEqual(
          valuationGranted ? expect.any(String) : null,
        );
      }
    });

    it("gates the original posted purchase drill-down independently of movement access", async () => {
      await login(PHARMACIST_USERNAME, PHARMACIST_PASSWORD);
      const pharmacistHistory = await request(
        "GET",
        inventoryMovementHistoryPath(product.id),
      );
      expect(pharmacistHistory.status, diagnostics(pharmacistHistory)).toBe(
        200,
      );
      expect(
        (
          pharmacistHistory.body as {
            movements: Array<{
              reference: { openable: boolean };
              valueFils: string | null;
            }>;
          }
        ).movements[0]?.reference.openable,
      ).toBe(false);
      expect(
        (
          pharmacistHistory.body as {
            movements: Array<{ valueFils: string | null }>;
          }
        ).movements[0]?.valueFils,
      ).toBeNull();
      const denied = await request("GET", purchasePostedPath(postedPurchaseId));
      expect(denied.status, diagnostics(denied)).toBe(403);
      await expectAudit(denied);

      await login(CUSTOM_USERNAME, CUSTOM_PASSWORD);
      const customHistory = await request(
        "GET",
        inventoryMovementHistoryPath(product.id),
      );
      expect(customHistory.status, diagnostics(customHistory)).toBe(200);
      expect(
        (
          customHistory.body as {
            movements: Array<{ reference: { openable: boolean } }>;
          }
        ).movements[0]?.reference.openable,
      ).toBe(true);
      const allowed = await request(
        "GET",
        purchasePostedPath(postedPurchaseId),
      );
      expect(allowed.status, diagnostics(allowed)).toBe(200);
    });

    it("separates report view, ordinary export, valuation, and owner-only sensitive export", async () => {
      await login(PHARMACIST_USERNAME, PHARMACIST_PASSWORD);
      const noView = await request("GET", inventoryReportPath("quantity"));
      expect(noView.status, diagnostics(noView)).toBe(403);
      await expectAudit(noView);

      await login(CUSTOM_USERNAME, CUSTOM_PASSWORD);
      const quantity = await request("GET", inventoryReportPath("quantity"));
      expect(quantity.status, diagnostics(quantity)).toBe(200);
      const report = inventoryReportSchema.parse(quantity.body);
      expect(report.sensitivity).toBe("redacted");
      expect(report.rows[0]?.cells.closingValueFils).toBeUndefined();
      expect(report.rows[0]?.source?.openable).toBe(true);
      const noValuation = await request("GET", inventoryReportPath("value"));
      expect(noValuation.status, diagnostics(noValuation)).toBe(403);
      const sensitiveSort = await request(
        "GET",
        `${inventoryReportPath("stocktake-movements")}?query=${encodeURIComponent(JSON.stringify({ sort: "activityValueFils" }))}`,
      );
      expect(sensitiveSort.status, diagnostics(sensitiveSort)).toBe(403);
      const ordinary = await request(
        "GET",
        `${inventoryReportPath("quantity")}/export`,
      );
      expect(ordinary.status, diagnostics(ordinary)).toBe(200);
      const protectedAttempt = await request(
        "POST",
        inventoryReportProtectedExportContract.path,
        {
          kind: "value",
          query: {
            from: "2020-01-01T00:00:00.000Z",
            to: "2026-01-01T00:00:00.000Z",
          },
          challengeId: uuidV7(),
          idempotencyKey: uuidV7(),
        },
      );
      expect(protectedAttempt.status, diagnostics(protectedAttempt)).toBe(403);
      expect(protectedAttempt.body).toMatchObject({
        code: "owner-role-required",
      });

      await login(MANAGER_USERNAME, MANAGER_PASSWORD);
      const managerNoView = await request(
        "GET",
        inventoryReportPath("quantity"),
      );
      expect(managerNoView.status, diagnostics(managerNoView)).toBe(403);
    });

    it("allows preferences for review roles and audits all protected export decisions", async () => {
      await login(PHARMACIST_USERNAME, PHARMACIST_PASSWORD);
      const preferences = await request("GET", "/inventory/review-preferences");
      expect(preferences.status, diagnostics(preferences)).toBe(200);
      const updated = await request("PUT", "/inventory/review-preferences", {
        columns: (
          preferences.body as {
            columns: Array<{ field: string; visible: boolean }>;
          }
        ).columns,
        expectedRevision: (preferences.body as { revision: string }).revision,
        idempotencyKey: uuidV7(),
      });
      expect(updated.status, diagnostics(updated)).toBe(200);

      const pharmacistExport = await request(
        "POST",
        inventorySensitiveExportContract.path,
        { challengeId: uuidV7(), idempotencyKey: uuidV7() },
      );
      expect(pharmacistExport.status, diagnostics(pharmacistExport)).toBe(403);
      await expectAudit(pharmacistExport);

      await login(OWNER_USERNAME, OWNER_PASSWORD);
      const ownerWithoutStepUp = await request(
        "POST",
        inventorySensitiveExportContract.path,
        { challengeId: uuidV7(), idempotencyKey: uuidV7() },
      );
      expect(ownerWithoutStepUp.status, diagnostics(ownerWithoutStepUp)).toBe(
        404,
      );
      await expectAudit(ownerWithoutStepUp);

      const wrongAction = await createChallenge(
        "identity.user.create",
        OWNER_PASSWORD,
      );
      const wrongActionExport = await request(
        "POST",
        inventorySensitiveExportContract.path,
        { challengeId: wrongAction, idempotencyKey: uuidV7() },
      );
      expect(wrongActionExport.status, diagnostics(wrongActionExport)).toBe(
        403,
      );
      await expectAudit(wrongActionExport);

      const approvedChallenge = await createChallenge(
        "inventory.sensitive.export",
        OWNER_PASSWORD,
      );
      const allowed = await request(
        "POST",
        inventorySensitiveExportContract.path,
        {
          challengeId: approvedChallenge,
          idempotencyKey: uuidV7(),
        },
      );
      expect(allowed.status, diagnostics(allowed)).toBe(201);
      const replay = await request(
        "POST",
        inventorySensitiveExportContract.path,
        {
          challengeId: approvedChallenge,
          idempotencyKey: uuidV7(),
        },
      );
      expect(replay.status, diagnostics(replay)).toBe(409);
      await expectAudit(replay);
      const committed = await administrator.query<{ count: string }>(
        `select count(*)::text as count from posting_audit_records
       where pharmacy_id = $1 and action = 'inventory.sensitive-export'
         and outcome = 'committed'`,
        [pharmacyId],
      );
      expect(committed.rows[0]?.count).toBe("1");

      await login(MANAGER_USERNAME, MANAGER_PASSWORD);
      const managerChallenge = await createChallenge(
        "inventory.sensitive.export",
        MANAGER_PASSWORD,
      );
      const managerExport = await request(
        "POST",
        inventorySensitiveExportContract.path,
        { challengeId: managerChallenge, idempotencyKey: uuidV7() },
      );
      expect(managerExport.status, diagnostics(managerExport)).toBe(403);
      expect(managerExport.body).toMatchObject({ code: "owner-role-required" });
      await expectAudit(managerExport, "posting_audit_records");
    });

    async function expectAudit(
      response: ApiResponse,
      table:
        | "identity_audit_records"
        | "posting_audit_records" = "identity_audit_records",
    ): Promise<void> {
      const requestId = (response.body as { requestId?: string } | undefined)
        ?.requestId;
      expect(requestId).toBeTruthy();
      const found = await administrator.query(
        `select id from ${table} where id = $1`,
        [requestId],
      );
      expect(found.rows).toHaveLength(1);
    }

    it("rechecks all seven report, activity and export paths for each role and revoked sessions", async () => {
      const query = {
        from: "2020-01-01T00:00:00Z",
        to: new Date().toISOString(),
      };
      for (const [username, password, view, valuation] of [
        [OWNER_USERNAME, OWNER_PASSWORD, true, true],
        [CUSTOM_USERNAME, CUSTOM_PASSWORD, true, false],
        [PHARMACIST_USERNAME, PHARMACIST_PASSWORD, false, false],
      ] as const) {
        await login(username, password);
        for (const kind of INVENTORY_REPORT_KINDS) {
          const authorized =
            view &&
            (valuation || (kind !== "value" && kind !== "average-cost"));
          const endpoints = [
            `${inventoryReportPath(kind)}?query=${encodeURIComponent(JSON.stringify(query))}`,
            `${inventoryReportPath(kind)}/export?query=${encodeURIComponent(JSON.stringify(query))}`,
            `${inventoryReportPath(kind)}/activity?query=${encodeURIComponent(JSON.stringify({ query, rowId: product.id, pageSize: 1 }))}`,
          ];
          for (const endpoint of endpoints) {
            const response = await request("GET", endpoint);
            expect(
              response.status,
              `${username} ${endpoint}: ${diagnostics(response)}`,
            ).toBe(authorized ? 200 : 403);
            if (authorized && endpoint.includes("/activity?")) {
              const page = inventoryReportActivityPageSchema.parse(
                response.body,
              );
              expect(page.rows.length).toBeLessThanOrEqual(1);
              if (!valuation)
                expect(page.rows.every((a) => a.valueFils === null)).toBe(true);
            } else if (authorized && endpoint.includes("/export?")) {
              const bundle = inventoryReportExportSchema.parse(response.body);
              expect(bundle.sensitivity).toBe("redacted");
              expect(
                bundle.rows.every(
                  (r) => r.cells.activityValueFils === undefined,
                ),
              ).toBe(true);
            }
          }
        }
      }
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      for (const filter of [
        "openingValueFils",
        "closingValueFils",
        "activityValueFils",
      ] as const) {
        const response = await request(
          "GET",
          `${inventoryReportPath("value")}/export?query=${encodeURIComponent(
            JSON.stringify({
              ...query,
              filters: [{ column: filter, operator: "gte", value: "0" }],
            }),
          )}`,
        );
        expect(response.status, diagnostics(response)).toBe(403);
        expect(response.body).toMatchObject({ code: "sensitive-query-denied" });
      }
      const foreignActivity = await request(
        "GET",
        `${inventoryReportPath("quantity")}/activity?query=${encodeURIComponent(JSON.stringify({ query, rowId: uuidV7() }))}`,
      );
      expect(foreignActivity.status, diagnostics(foreignActivity)).toBe(200);
      expect(
        inventoryReportActivityPageSchema.parse(foreignActivity.body).totalRows,
      ).toBe(0);
      await administrator.query(
        "update identity_sessions set revoked_at = now(), revocation_reason = 'logout' where pharmacy_id = $1 and revoked_at is null",
        [pharmacyId],
      );
      for (const kind of INVENTORY_REPORT_KINDS) {
        for (const suffix of ["", "/export", "/activity"]) {
          const response = await request(
            "GET",
            `${inventoryReportPath(kind)}${suffix}`,
          );
          expect(response.status, diagnostics(response)).toBe(401);
        }
      }
    });

    it("rechecks owner grants and rejects a foreign device binding on every report seam", async () => {
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      const query = {
        from: "2020-01-01T00:00:00Z",
        to: new Date().toISOString(),
      };
      const command = {
        kind: "quantity",
        query,
        challengeId: uuidV7(),
        idempotencyKey: uuidV7(),
      };
      for (const permission of [
        "reports.inventory.view",
        "reports.inventory.export",
        "inventory.valuation.view",
      ] as const) {
        const removed = await administrator.query<{
          pharmacy_id: string;
          role_id: string;
          permission_name: string;
          granted_at: Date;
          granted_by: string;
        }>(
          `delete from role_permission_grants grant_row using pharmacy_roles role
            where grant_row.role_id = role.id and role.pharmacy_id = $1 and role.role_key = 'owner'
              and grant_row.permission_name = $2 returning grant_row.*`,
          [pharmacyId, permission],
        );
        expect(removed.rows).toHaveLength(1);
        try {
          for (const kind of INVENTORY_REPORT_KINDS) {
            for (const suffix of ["", "/export", "/activity"]) {
              const body =
                suffix === "/activity" ? { query, rowId: product.id } : query;
              const response = await request(
                "GET",
                `${inventoryReportPath(kind)}${suffix}?query=${encodeURIComponent(JSON.stringify(body))}`,
              );
              const denied =
                permission === "reports.inventory.view" ||
                (permission === "reports.inventory.export" &&
                  suffix === "/export") ||
                (permission === "inventory.valuation.view" &&
                  (kind === "value" || kind === "average-cost"));
              expect(
                response.status,
                `${permission} ${kind}${suffix}: ${diagnostics(response)}`,
              ).toBe(denied ? 403 : 200);
            }
          }
          const protectedExport = await request(
            "POST",
            inventoryReportProtectedExportContract.path,
            command,
          );
          expect(protectedExport.status, diagnostics(protectedExport)).toBe(
            403,
          );
        } finally {
          const grant = removed.rows[0]!;
          await administrator.query(
            `insert into role_permission_grants (pharmacy_id, role_id, permission_name, granted_at, granted_by)
            values ($1,$2,$3,$4,$5)`,
            [
              grant.pharmacy_id,
              grant.role_id,
              grant.permission_name,
              grant.granted_at,
              grant.granted_by,
            ],
          );
        }
      }
      for (const kind of INVENTORY_REPORT_KINDS) {
        for (const suffix of ["", "/export", "/activity"]) {
          const response = await request(
            "GET",
            `${inventoryReportPath(kind)}${suffix}`,
            undefined,
            { [LOCAL_DEVICE_ID_HEADER]: uuidV7() },
          );
          expect(response.status, diagnostics(response)).toBe(401);
        }
      }
      const foreignProtected = await request(
        "POST",
        inventoryReportProtectedExportContract.path,
        command,
        {
          [LOCAL_DEVICE_SESSION_HEADER]: randomBytes(32).toString("base64url"),
        },
      );
      expect(foreignProtected.status, diagnostics(foreignProtected)).toBe(401);
    });

    it("binds report facts to the authenticated pharmacy and refuses expired or mismatched protected Step-Up", async () => {
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      const query = {
        from: "2020-01-01T00:00:00Z",
        to: new Date().toISOString(),
      };
      const foreignPharmacy = uuidV7();
      const pool = new Pool({ connectionString: databaseRoles.applicationUrl });
      const client = await pool.connect();
      try {
        for (const kind of INVENTORY_REPORT_KINDS) {
          const foreign = await readInventoryReportPage(
            client,
            foreignPharmacy,
            kind,
            { ...inventoryReportQueryFor(kind).parse(query), ...query },
            "2026-10-01",
            false,
            24 * 1024 * 1024,
          );
          expect(foreign).toEqual({
            rows: [],
            totalRows: 0,
            groups: [],
            actors: [],
          });
          for (const suffix of ["", "/export", "/activity"]) {
            const injected = { ...query, pharmacyId: foreignPharmacy };
            const input =
              suffix === "/activity"
                ? { query: injected, rowId: product.id }
                : injected;
            const response = await request(
              "GET",
              `${inventoryReportPath(kind)}${suffix}?query=${encodeURIComponent(JSON.stringify(input))}`,
            );
            expect(response.status, diagnostics(response)).toBe(400);
          }
          const invalid = await request(
            "POST",
            inventoryReportProtectedExportContract.path,
            {
              kind,
              query,
              challengeId: uuidV7(),
              idempotencyKey: uuidV7(),
            },
          );
          expect(invalid.status, diagnostics(invalid)).toBe(404);
        }
      } finally {
        client.release();
        await pool.end();
      }
      const expired = await createChallenge(
        "inventory.sensitive.export",
        OWNER_PASSWORD,
      );
      await administrator.query(
        "update step_up_challenges set expires_at = created_at + interval '1 millisecond' where id = $1",
        [expired],
      );
      for (const kind of INVENTORY_REPORT_KINDS) {
        const response = await request(
          "POST",
          inventoryReportProtectedExportContract.path,
          {
            kind,
            query,
            challengeId: expired,
            idempotencyKey: uuidV7(),
          },
        );
        expect(response.status, diagnostics(response)).toBe(409);
        expect(response.body).toMatchObject({ code: "step-up-expired" });
      }
      const previousSession = await createChallenge(
        "inventory.sensitive.export",
        OWNER_PASSWORD,
      );
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      for (const kind of INVENTORY_REPORT_KINDS) {
        const response = await request(
          "POST",
          inventoryReportProtectedExportContract.path,
          {
            kind,
            query,
            challengeId: previousSession,
            idempotencyKey: uuidV7(),
          },
        );
        expect(response.status, diagnostics(response)).toBe(403);
        expect(response.body).toMatchObject({
          code: "step-up-context-mismatch",
        });
      }
    });

    async function createCustomRole(): Promise<string> {
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      const challengeId = await createChallenge(
        "identity.role.create",
        OWNER_PASSWORD,
      );
      const response = await request("POST", "/identity/roles", {
        challengeId,
        idempotencyKey: uuidV7(),
        name: "Inventory Review Custom",
        permissions: [
          "inventory.review",
          "purchases.posted.view",
          "reports.inventory.view",
          "reports.inventory.export",
        ],
      });
      expect(response.status, diagnostics(response)).toBe(201);
      return String((response.body as { id?: string }).id ?? "");
    }

    async function createUser(
      username: string,
      password: string,
      roleKeyOrId: string,
    ): Promise<void> {
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      const role = roleKeyOrId.startsWith("01")
        ? roleKeyOrId
        : String(
            (
              await administrator.query<{ id: string }>(
                "select id from pharmacy_roles where pharmacy_id = $1 and role_key = $2",
                [pharmacyId, roleKeyOrId],
              )
            ).rows[0]?.id ?? "",
          );
      const challengeId = await createChallenge(
        "identity.user.create",
        OWNER_PASSWORD,
      );
      const response = await request("POST", "/identity/users", {
        challengeId,
        displayName: username,
        idempotencyKey: uuidV7(),
        password,
        roleId: role,
        username,
      });
      expect(response.status, diagnostics(response)).toBe(201);
    }

    async function createChallenge(
      action: string,
      password: string,
    ): Promise<string> {
      await request("POST", "/identity/login", {
        password,
        username:
          password === OWNER_PASSWORD
            ? OWNER_USERNAME
            : password === MANAGER_PASSWORD
              ? MANAGER_USERNAME
              : PHARMACIST_USERNAME,
      });
      const challenge = await request("POST", "/identity/step-up-challenges", {
        action,
        idempotencyKey: uuidV7(),
      });
      expect(challenge.status, diagnostics(challenge)).toBe(201);
      const challengeId = String((challenge.body as { id?: string }).id ?? "");
      const approved = await request(
        "POST",
        `/identity/step-up-challenges/${challengeId}/approve`,
        { idempotencyKey: uuidV7(), password },
      );
      expect(approved.status, diagnostics(approved)).toBe(200);
      return challengeId;
    }

    async function login(username: string, password: string): Promise<void> {
      const response = await request("POST", "/identity/login", {
        password,
        username,
      });
      expect(response.status, diagnostics(response)).toBe(200);
      expect(response.body).toMatchObject({
        entitlement: { status: "free-core", licence: null },
      });
    }

    async function createSupplier(): Promise<Supplier> {
      const response = await request("POST", "/suppliers", {
        allowanceEffectiveFrom: "2026-01-01",
        defaultAllowancePercentage: "0",
        idempotencyKey: uuidV7(),
        name: "Authorization Supplier",
        terms: "Net 30",
      });
      expect(response.status, diagnostics(response)).toBe(201);
      return response.body as Supplier;
    }

    async function postPurchase(supplierId: string): Promise<string> {
      const draftResponse = await request("POST", "/purchases/drafts", {
        invoiceOffer: { mode: "none", value: "0" },
        idempotencyKey: uuidV7(),
        invoiceDate: "2026-06-15",
        settlementContext: "debt",
        supplierId,
        supplierInvoiceNumber: "AUTH-REVIEW-1",
      });
      expect(draftResponse.status, diagnostics(draftResponse)).toBe(201);
      let draft = (draftResponse.body as { draft: PurchaseDraft }).draft;
      const row = await request("POST", purchaseDraftRowsPath(draft.id), {
        costFils: "1000",
        enteredQuantity: "4",
        expectedVersion: draft.version,
        expiryDate: "2027-01-31",
        idempotencyKey: uuidV7(),
        itemId: product.id,
        lotNumber: "AUTH-LOT-1",
        notes: null,
        pricing: { method: "by-price", retailPriceFils: "999999" },
        unit: { kind: "inventory-unit" },
      });
      expect(row.status, diagnostics(row)).toBe(201);
      draft = (row.body as { draft: PurchaseDraft }).draft;
      const posted = await request(
        "POST",
        purchaseDraftPostingsPath(draft.id),
        {
          expectedVersion: draft.version,
          idempotencyKey: uuidV7(),
        },
      );
      expect(posted.status, diagnostics(posted)).toBe(201);
      return String(
        ((posted.body as PurchasePostResult).posted as { id: string }).id,
      );
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
      extraHeaders: Record<string, string> = {},
    ): Promise<ApiResponse> {
      const response = await fetch(`${apiOrigin}${route}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { ...headers(body !== undefined), ...extraHeaders },
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
  },
);

function medicationRequest(): ProductCreateRequest {
  return {
    arabicSearchName: "صلاحية المخزون",
    barcodes: [
      { kind: "product", value: randomBytes(6).toString("hex").slice(0, 13) },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName: "Authorization Inventory Item",
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
    supplierIds: [],
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
