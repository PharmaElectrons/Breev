import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import { expect, test, type Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
} from "@breev/contracts/local-rest";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../database-roles.js";
import {
  spawnLocalApiProcess,
  stopProcess,
  waitForHealth,
} from "../local-api-process.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "patients.browser.owner";
const OWNER_PASSWORD = "patients browser owner password";

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface RendererServer {
  readonly origin: string;
  readonly server: Server;
}

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

/* ── Module-level state, set once by beforeAll ───────────────────────── */

let requestOrigin = "";
let requestCredentials: Credentials | undefined;

function apiOriginForRequests(): string {
  return requestOrigin;
}

function credentialsForRequests(): Credentials {
  if (requestCredentials === undefined)
    throw new Error("Browser fixture is not ready");
  return requestCredentials;
}

test.describe.serial("patient profiles and exact arithmetic", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let pharmacyId = "";
  let postgres: StartedPostgreSqlContainer | undefined;
  let renderer: RendererServer;

  test.beforeAll("patient test fixture", async () => {
    test.setTimeout(180_000);
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    await administrator
      .query(
        "truncate table main_devices cascade; truncate table pharmacies cascade;",
      )
      .catch(() => undefined);
    credentials = createCredentials();
    requestCredentials = credentials;

    const apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    requestOrigin = apiOrigin;
    api = startApi(apiPort, credentials, databaseRoles);
    await waitForHealth(apiOrigin, "healthy", api, 45_000);

    // Bootstrap pharmacy + owner
    const bootstrap = await apiRequest("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Patient Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Patient Browser Pharmacy",
    });
    expect(bootstrap.status).toBe(201);
    pharmacyId = String(
      (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
    expect(pharmacyId).toMatch(/^\S+$/u);

    // Login as owner for subsequent API calls
    await login(OWNER_USERNAME, OWNER_PASSWORD);

    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("enforces exact arithmetic and cumulative history invariants (Task 11)", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    page.on("console", (msg) =>
      console.log("PAGE CONSOLE:", msg.type(), msg.text()),
    );
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err));
    page.on("response", (res) =>
      console.log("PAGE RES:", res.status(), res.url()),
    );
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients`);

    // Wait for the shell to render
    const shell = page.locator(".shell-page");
    await expect(shell).toBeVisible({ timeout: 30_000 });

    // Create Patient
    await page.getByTestId("create-patient-button").click();
    await expect(page.getByTestId("edit-patient-button")).toBeVisible({
      timeout: 10_000,
    });

    // Edit Patient Profile to set details
    await page.getByTestId("edit-patient-button").click();
    await page.getByTestId("input-first-name").fill("John");
    await page.getByTestId("input-last-name").fill("Doe");
    await page.getByTestId("input-phone").fill("0123456789");
    await page.getByTestId("input-height").fill("180");
    await page.getByTestId("input-discount").fill("12.50");
    await page.getByTestId("input-dnd").check({ force: true });
    await page
      .getByTestId("input-notes")
      .fill("No known drug allergies, penicillin sensitive");
    await page.getByTestId("input-conditions").fill("Hypertension, Asthma");
    await page.getByTestId("save-patient-button").click();

    // Verify fields updated
    await expect(page.getByTestId("view-phone")).toHaveText("0123456789");
    await expect(page.getByTestId("view-height")).toHaveText("180");
    await expect(page.getByTestId("view-discount")).toHaveText("12.5");
    await expect(page.getByTestId("view-dnd")).toHaveText("Yes");
    await expect(page.getByTestId("view-notes")).toHaveText(
      "No known drug allergies, penicillin sensitive",
    );
    await expect(page.getByTestId("view-conditions")).toContainText(
      "Hypertension",
    );
    await expect(page.getByTestId("view-conditions")).toContainText("Asthma");

    // B1: Exact decimal round-trip verification & B2: DND toggle verification
    await page.getByTestId("edit-patient-button").click();
    await expect(page.getByTestId("input-discount")).toHaveValue("12.50");
    await page.getByTestId("input-dnd").uncheck({ force: true });
    await page.getByTestId("save-patient-button").click();
    await expect(page.getByTestId("view-dnd")).toHaveText("No");

    await page.getByTestId("edit-patient-button").click();
    await page.getByTestId("input-dnd").check({ force: true });
    await page.getByTestId("save-patient-button").click();
    await expect(page.getByTestId("view-dnd")).toHaveText("Yes");

    // Add weight #1: 75.5 kg
    await page.getByTestId("input-weight").fill("75.5");
    await page.getByTestId("add-weight-button").click();
    await expect(page.getByTestId("weight-history-table")).toContainText(
      "75.5",
    );

    // Add weight #2: 76.1 kg
    await page.getByTestId("input-weight").fill("76.1");
    await page.getByTestId("add-weight-button").click();
    await expect(page.getByTestId("weight-history-table")).toContainText(
      "76.1",
    );

    // Reload
    await page.reload();
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    // Search to get back to patient
    await page.getByTestId("patient-search-input").fill("John");
    const sidebarItem = page
      .locator(".patient-list-item")
      .filter({ hasText: "John Doe" });
    await expect(sidebarItem).toBeVisible({ timeout: 10_000 });
    await sidebarItem.click();

    // Verify cumulative history exists and notes persisted across reload (B3)
    await expect(page.getByTestId("view-notes")).toHaveText(
      "No known drug allergies, penicillin sensitive",
    );
    const historyRows = page
      .getByTestId("weight-history-table")
      .locator("tbody tr");
    await expect(historyRows).toHaveCount(2);

    const rowTexts = await historyRows.allInnerTexts();
    expect(rowTexts.some((t) => t.includes("75.5"))).toBe(true);
    expect(rowTexts.some((t) => t.includes("76.1"))).toBe(true);

    // The exact arithmetic BMI calculation check
    // Height: 180 cm (1.8 m), Weight: 76.1 kg
    // BMI = 76.1 / (1.8^2) = 76.1 / 3.24 = 23.48765... -> 23.5 (Normal weight)
    await expect(page.getByTestId("view-bmi")).toContainText("23.5");
    await expect(page.getByTestId("view-bmi")).toContainText("Normal weight");

    // Assert no delete controls exist
    const deleteButtons = page.locator("button:has-text('Delete')");
    await expect(deleteButtons).toHaveCount(0);
    const editButtons = page.locator("button:has-text('Edit Weight')");
    await expect(editButtons).toHaveCount(0);

    // Axe Accessibility scan
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("supports Arabic locale (RTL) and dark theme", async ({ page }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "ar", "dark");
    await page.goto(`${renderer.origin}#/patients/`);

    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    // Verify document root dir
    const htmlDir = await page.getAttribute("html", "dir");
    expect(htmlDir).toBe("rtl");

    // Verify Arabic UI headings and buttons
    await expect(page.locator("h2#patients-title")).toContainText("المرضى");
    await expect(page.getByTestId("create-patient-button")).toContainText(
      "إضافة مريض",
    );

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("verifies permission denial states and zero-leakage", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);

    const rolesRes = await apiRequest("GET", "/identity/roles");
    expect(rolesRes.status).toBe(200);
    const roles = (
      rolesRes.body as {
        roles: Array<{ id: string; key?: string; roleKey?: string }>;
      }
    ).roles;
    const salesRole = roles.find(
      (r) => r.key === "sales_employee" || r.roleKey === "sales_employee",
    );
    expect(salesRole).toBeDefined();

    const SALES_USERNAME = "patients.sales.user";
    const SALES_PASSWORD = "patients sales password 123";

    const challenge = await apiRequest("POST", "/identity/step-up-challenges", {
      action: "identity.user.create",
      idempotencyKey: uuidV7(),
    });
    expect(challenge.status).toBe(201);
    const challengeId = String((challenge.body as { id?: string }).id ?? "");
    const approval = await apiRequest(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approval.status).toBe(200);

    const userRes = await apiRequest("POST", "/identity/users", {
      challengeId,
      displayName: "Sales User",
      idempotencyKey: uuidV7(),
      password: SALES_PASSWORD,
      roleId: salesRole!.id,
      username: SALES_USERNAME,
    });
    expect(userRes.status).toBe(201);

    // Login as sales user
    await login(SALES_USERNAME, SALES_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    // Verify module is hidden from navigation for unauthorized user
    await expect(page.locator("a[data-module='patients']")).toHaveCount(0);

    // Verify navigating to #/patients is redirected away and patient content is not leaked
    await expect(page).not.toHaveURL(/#\/patients/);
    await expect(page.getByTestId("patient-search-input")).toHaveCount(0);
    await expect(page.getByTestId("patient-profile-view")).toHaveCount(0);

    // Verify zero-leakage direct API access (GET /patients returns empty items)
    const apiRes = await apiRequest("GET", "/patients");
    expect(apiRes.status).toBe(200);
    expect(apiRes.body).toMatchObject({ items: [], total: 0 });

    // Verify direct API mutation is forbidden (POST /patients returns 403)
    const createRes = await apiRequest("POST", "/patients", {
      firstName: "Unauthorized",
      idempotencyKey: uuidV7(),
      lastName: "Patient",
    });
    expect(createRes.status).toBe(403);
    expect((createRes.body as { code?: string })?.code).toBe(
      "permission-denied",
    );
  });

  test("handles 409 optimistic locking conflict with appropriate error message", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    const patientRes = await apiRequest("POST", "/patients", {
      firstName: "Concurrent",
      lastName: "Tester",
    });
    expect(patientRes.status).toBe(201);
    const patient = patientRes.body as { id: string; updatedAt: string };

    await page.goto(`${renderer.origin}#/patients/${patient.id}`);
    await expect(page.getByTestId("edit-patient-button")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("edit-patient-button").click();
    await expect(page.getByTestId("input-first-name")).toHaveValue(
      "Concurrent",
    );

    // Concurrent modification on server
    const conflictUpdate = await apiRequest(
      "PATCH",
      `/patients/${patient.id}`,
      {
        firstName: "Concurrent External",
        updatedAt: patient.updatedAt,
      },
    );
    expect(conflictUpdate.status).toBe(200);

    // Stale submit from UI
    await page.getByTestId("input-first-name").fill("Stale Submit");
    await page.getByTestId("save-patient-button").click();

    // Verify 409 conflict message
    const alert = page.locator(".denial-alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("modified in another session");
  });

  test("supports keyboard navigation in patient form", async ({ page }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients/new`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("input-first-name").focus();
    await page.keyboard.type("Keyboard");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("input-last-name")).toBeFocused();
    await page.keyboard.type("User");

    page.on("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/#\/patients$/);
  });

  test("displays no BMI when height is absent", async ({ page }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");

    const patientRes = await apiRequest("POST", "/patients", {
      firstName: "NoHeight",
      lastName: "Patient",
    });
    expect(patientRes.status).toBe(201);
    const patient = patientRes.body as { id: string };

    await page.goto(`${renderer.origin}#/patients/${patient.id}`);
    await expect(page.getByTestId("view-bmi")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("view-bmi")).toHaveText("—");

    await page.getByTestId("input-weight").fill("80");
    await page.getByTestId("add-weight-button").click();
    await expect(page.getByTestId("weight-history-table")).toContainText("80");

    // Still no BMI because height is absent
    await expect(page.getByTestId("view-bmi")).toHaveText("—");

    // Add height via edit
    await page.getByTestId("edit-patient-button").click();
    await page.getByTestId("input-height").fill("200");
    await page.getByTestId("save-patient-button").click();

    // BMI now calculated: 80 / (2^2) = 20
    await expect(page.getByTestId("view-bmi")).toContainText("20");
    await expect(page.getByTestId("view-bmi")).toContainText("Normal weight");
  });

  test("patient allergy toggle, drug family picker, and persistence across reload", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "ar", "light");
    await page.goto(`${renderer.origin}#/patients`);

    const shell = page.locator(".shell-page");
    await expect(shell).toBeVisible({ timeout: 30_000 });

    // Click Create Patient
    await page.getByTestId("create-patient-button").click();
    await page.getByTestId("input-first-name").fill("Ali");
    await page.getByTestId("input-last-name").fill("Hassan");
    await page.getByTestId("input-phone").fill("01112223334");

    // Enter height and weight during patient creation
    await page.getByTestId("input-height").fill("180");
    await page.getByTestId("input-weight").fill("75.5");

    // BMI live preview shows 23.3 (75.5 / 1.8^2)
    await expect(page.getByTestId("view-bmi")).toContainText("23.3");

    // Initially allergy picker is not visible
    await expect(page.getByTestId("allergy-picker")).toHaveCount(0);

    // Click Allergy Toggle in PatientForm
    const allergyToggle = page.getByTestId("input-allergy-toggle");
    await allergyToggle.click();

    // AllergyPicker is now visible
    const picker = page.getByTestId("allergy-picker");
    await expect(picker).toBeVisible();

    // The options dropdown displays common drug families immediately
    const firstOption = picker.locator(".allergy-option-item").first();
    await expect(firstOption).toBeVisible();
    await firstOption.click(); // Selects Penicillins

    // Search and add a custom allergy tag
    const searchInput = page.getByTestId("input-allergy-search");
    await searchInput.fill("Ibuprofen");
    await page.getByTestId("add-allergy-button").click();

    // Verify 2 tags are rendered in picker
    const tags = picker.locator(".tag-chip-rose");
    await expect(tags).toHaveCount(2);

    // Save Patient
    await page.getByTestId("save-patient-button").click();

    // Wait for PatientProfileView
    await expect(page.getByTestId("patient-profile-view")).toBeVisible({
      timeout: 10_000,
    });

    // Verify height, weight, and BMI were recorded on create
    await expect(page.getByTestId("view-height")).toHaveText("180");
    await expect(page.getByTestId("view-bmi")).toContainText("23.3");

    // In profile view, the allergy toggle is active (indicator)
    const viewAllergyToggle = page.getByTestId("view-allergy-toggle");
    await expect(viewAllergyToggle).toHaveClass(/active/);

    // The tags are rendered in the profile view as read-only tags (no remove buttons)
    const profileTags = page
      .getByTestId("patient-profile-view")
      .locator(".tag-chip-rose");
    await expect(profileTags).toHaveCount(2);
    await expect(profileTags.filter({ hasText: "Ibuprofen" })).toBeVisible();
    await expect(
      page.getByTestId("patient-profile-view").locator(".tag-chip-remove"),
    ).toHaveCount(0);

    // Reload the page and reselect patient
    await page.reload();
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("patient-search-input").fill("Ali");
    const sidebarItem = page
      .locator(".patient-list-item")
      .filter({ hasText: "Ali Hassan" });
    await expect(sidebarItem).toBeVisible({ timeout: 10_000 });
    await sidebarItem.click();

    // Verify allergies persisted across reload
    await expect(page.getByTestId("view-allergy-toggle")).toHaveClass(/active/);
    const reloadedTags = page
      .getByTestId("patient-profile-view")
      .locator(".tag-chip-rose");
    await expect(reloadedTags).toHaveCount(2);

    // In view mode, clicking allergy indicator does NOT mutate or toggle anything
    await page.getByTestId("view-allergy-toggle").click();
    await expect(page.getByTestId("view-allergy-toggle")).toHaveClass(/active/);

    // Now press Edit to modify allergies
    await page.getByTestId("edit-patient-button").click();
    await expect(page.getByTestId("allergy-picker")).toBeVisible();

    // In edit mode, tags have remove buttons
    const editTags = page
      .getByTestId("allergy-picker")
      .locator(".tag-chip-rose");
    const removeBtn = editTags
      .filter({ hasText: "Ibuprofen" })
      .locator(".tag-chip-remove");
    await removeBtn.click();
    await expect(
      page.getByTestId("allergy-picker").locator(".tag-chip-rose"),
    ).toHaveCount(1);

    // Save modified patient
    await page.getByTestId("save-patient-button").click();
    await expect(page.getByTestId("patient-profile-view")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("patient-profile-view").locator(".tag-chip-rose"),
    ).toHaveCount(1);

    // Edit again to toggle off allergies completely
    await page.getByTestId("edit-patient-button").click();
    await page.getByTestId("input-allergy-toggle").click();
    await page.getByTestId("save-patient-button").click();

    await expect(page.getByTestId("patient-profile-view")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("view-allergy-toggle")).not.toHaveClass(
      /active/,
    );
    await expect(
      page.getByTestId("patient-profile-view").locator(".tag-chip-rose"),
    ).toHaveCount(0);

    // Verify accessibility
    const axeResults = await new AxeBuilder({ page }).analyze();
    expect(axeResults.violations).toEqual([]);
  });

  test("validates weight, height, and discount inputs and preserves weight during history select", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients/new`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    // Verify inputMode="decimal" on height, weight
    const heightInput = page.getByTestId("input-height");
    const weightInput = page.getByTestId("input-weight");
    await expect(heightInput).toHaveAttribute("inputmode", "decimal");
    await expect(weightInput).toHaveAttribute("inputmode", "decimal");

    // Enter invalid height -> shows validation error
    await heightInput.fill("abc");
    await expect(
      page
        .locator(".patient-field-error")
        .filter({ hasText: "Height must be a number" }),
    ).toBeVisible();

    // Fix height
    await heightInput.fill("175.5");
    await expect(
      page
        .locator(".patient-field-error")
        .filter({ hasText: "Height must be a number" }),
    ).toHaveCount(0);

    // Enter invalid weight -> shows validation error
    await weightInput.fill("9999");
    await expect(
      page
        .locator(".patient-field-error")
        .filter({ hasText: "Weight must be a number" }),
    ).toBeVisible();

    // Fix weight
    await weightInput.fill("70.5");
    await expect(
      page
        .locator(".patient-field-error")
        .filter({ hasText: "Weight must be a number" }),
    ).toHaveCount(0);

    // Fill valid identity and save
    await page.getByTestId("input-first-name").fill("Validation");
    await page.getByTestId("input-last-name").fill("Patient");
    await page.getByTestId("save-patient-button").click();

    await expect(page.getByTestId("patient-profile-view")).toBeVisible({
      timeout: 10_000,
    });

    // In profile view, InlineWeightInput has inputMode="decimal"
    const inlineWeight = page.getByTestId("input-weight");
    await expect(inlineWeight).toHaveAttribute("inputmode", "decimal");

    // Add another weight
    await inlineWeight.fill("72.0");
    await page.getByTestId("add-weight-button").click();
    await expect(page.getByTestId("weight-history-table")).toContainText("72");

    // Now type a new weight draft in the input
    await inlineWeight.fill("73.5");

    // Select historical weight from the select dropdown
    const select = page.locator(".patient-weight-select");
    const options = await select.locator("option").all();
    const secondOption = options[1];
    if (secondOption !== undefined) {
      const pastVal = await secondOption.getAttribute("value");
      if (pastVal) {
        await select.selectOption(pastVal);
      }
    }

    // The new weight draft "73.5" is NOT overwritten by the select!
    await expect(inlineWeight).toHaveValue("73.5");

    // And selected measurement info note is visible
    await expect(page.locator(".patient-selected-weight-note")).toBeVisible();
  });
});

/* ── Helper functions ────────────────────────────────────────────────── */

import { Pool } from "pg";

async function login(username: string, password: string): Promise<void> {
  const response = await apiRequest("POST", "/identity/login", {
    password,
    username,
  });
  expect(response.status).toBe(200);
}

async function apiRequest(
  method: "GET" | "POST" | "PUT" | "PATCH",
  route: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${apiOriginForRequests()}${route}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: requestHeaders(credentialsForRequests(), body !== undefined),
    method,
  });
  const text = await response.text();
  return {
    body: text === "" ? undefined : (JSON.parse(text) as unknown),
    status: response.status,
  };
}

function requestHeaders(
  currentCredentials: Credentials,
  json: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Breev-Device ${currentCredentials.deviceSecret}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: currentCredentials.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: currentCredentials.sessionToken,
    Origin: "breev://app",
  };
}

async function startRendererServer(
  currentApiOrigin: string,
  currentCredentials: Credentials,
): Promise<RendererServer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/health") {
        const upstream = await fetch(`${currentApiOrigin}/health`);
        response.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (isApiRoute(request.url)) {
        const body = await readBody(request);
        const upstream = await fetch(`${currentApiOrigin}${request.url}`, {
          ...(body.length === 0 ? {} : { body }),
          headers: requestHeaders(currentCredentials, body.length > 0),
          method: request.method ?? "GET",
        });
        response.writeHead(upstream.status, {
          "cache-control": "no-store",
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (request.url === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      const pathname = request.url === "/" ? "/index.html" : request.url;
      if (pathname === undefined || pathname.includes("..")) {
        response.writeHead(403).end();
        return;
      }
      const filePath = path.resolve(rendererRoot, `.${pathname.split("?")[0]}`);
      const extension = path.extname(filePath);
      response.writeHead(200, {
        "content-type":
          extension === ".html"
            ? "text/html; charset=utf-8"
            : extension === ".css"
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8",
      });
      response.end(await readFile(filePath));
    } catch {
      if (!response.headersSent) response.writeHead(502).end("{}");
      else response.destroy();
    }
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${String(port)}`, server };
}

function isApiRoute(url: string | undefined): boolean {
  return (
    url?.startsWith("/identity/") === true ||
    url?.startsWith("/catalog/") === true ||
    url?.startsWith("/inventory/") === true ||
    url?.startsWith("/sales/") === true ||
    url?.startsWith("/patients") === true
  );
}

async function installDesktopFake(
  page: Page,
  currentApiOrigin: string,
  locale: "ar" | "en",
  theme: "dark" | "light",
): Promise<void> {
  await page.addInitScript(
    ({ apiOrigin: origin, locale: savedLocale, theme: savedTheme }) => {
      localStorage.setItem("breev.locale", savedLocale);
      localStorage.setItem("breev.theme", savedTheme);
      const pairing = { candidates: [], stage: "awaiting-invitation" as const };
      const desktopApi: BreevDesktopApi = Object.freeze({
        cancelTerminalPairing: async () => pairing,
        copyIdentifier: async () => ({ copied: true as const }),
        exportDiagnostics: async () => ({ status: "saved" as const }),
        getStartupConfig: async () => ({
          diagnosticReporting: "disabled" as const,
          localApiOrigin: origin,
          role: "main" as const,
        }),
        getTerminalPairingState: async () => pairing,
        openSupport: async () => ({ status: "unavailable" as const }),
        printBarcodeLabel: async () => ({ status: "handed-off" as const }),
        reportRendererIncident: async () => ({ accepted: true as const }),
        saveInventoryExport: async () => ({ status: "saved" as const }),
        submitDiagnostics: async () => ({ status: "unavailable" as const }),
        submitManualEndpoint: async () => pairing,
        submitPairingInvitation: async () => pairing,
      });
      Object.defineProperty(globalThis, "breevDesktop", {
        configurable: false,
        value: desktopApi,
        writable: false,
      });
    },
    { apiOrigin: currentApiOrigin, locale, theme },
  );
}

function startApi(
  port: number,
  currentCredentials: Credentials,
  currentDatabaseRoles: SeparatedDatabaseRoles,
): ChildProcessWithoutNullStreams {
  return spawnLocalApiProcess(
    path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
    {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_INSTALLATION_STATE: "ready",
      BREEV_MAIN_DEVICE_ID: currentCredentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: currentCredentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: currentCredentials.sessionToken,
      DATABASE_MIGRATION_URL: currentDatabaseRoles.migrationUrl,
      DATABASE_URL: currentDatabaseRoles.applicationUrl,
    },
  );
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

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function listen(server: Server): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not listen for the renderer"));
      } else {
        resolve(address.port);
      }
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
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
