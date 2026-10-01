import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  listPatientWeightsResponseSchema,
  patientProfileResponseSchema,
  searchPatientsResponseSchema,
  type PatientProfileResponse,
} from "@breev/contracts/local-rest";
import { patientMessages } from "../../src/renderer/src/patients/patient-messages.js";

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
const LOCALE_THEME_CASES = [
  { locale: "en", theme: "light" },
  { locale: "en", theme: "dark" },
  { locale: "ar", theme: "light" },
  { locale: "ar", theme: "dark" },
] as const;
type PatientLocale = keyof typeof patientMessages;

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

test.describe("patient profiles and exact arithmetic", () => {
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
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients`);

    // Wait for the shell to render
    const shell = page.locator(".shell-page");
    await expect(shell).toBeVisible({ timeout: 30_000 });

    // Create Patient. The create route opens the same profile form directly.
    await page.getByTestId("create-patient-button").click();
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

  for (const { locale, theme } of LOCALE_THEME_CASES) {
    test(`profile accessibility in ${locale}/${theme}`, async ({
      page,
    }, testInfo) => {
      const privateNote = `denial-ui-private-note-${locale}-${theme}`;
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      const patient = await createPatientProfile(
        `Locale${locale}${theme}`,
        "Patient",
        {
          allergies: "Penicillins",
          chronicConditions: ["Seasonal allergies"],
          chronicMedications: ["Example medication"],
          otherNotes: privateNote,
          smoking: "Occasional",
        },
      );
      await installDesktopFake(page, renderer.origin, locale, theme);
      const identityStateResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/identity/state" &&
          response.request().method() === "GET",
        { timeout: 15_000 },
      );
      await page.goto(`${renderer.origin}#/patients/${patient.id}`);
      const identityResponse = await identityStateResponse;
      expect(identityResponse.status()).toBe(200);
      const identityState = (await identityResponse.json()) as {
        readonly allowedPermissions?: readonly string[];
        readonly state?: string;
      };
      expect(identityState.state).toBe("authenticated");
      expect(identityState.allowedPermissions).toContain("patients.view");

      await expect(page.locator(".shell-page")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("patient-profile-view")).toBeVisible();
      const copy = patientMessages[locale];
      const expectedDirection = locale === "ar" ? "rtl" : "ltr";
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        expectedDirection,
      );
      await expect(page.locator(".patient-profile")).toHaveAttribute(
        "dir",
        expectedDirection,
      );
      await expect(page.locator("h2#patients-title")).toHaveText(copy.title);
      await expect(
        page.getByRole("heading", {
          name: `${patient.firstName} ${patient.lastName}`,
        }),
      ).toBeVisible();
      await expect(page.getByTestId("view-dnd")).toHaveText(copy.dndDisabled);
      await expect(page.getByTestId("view-bmi")).toHaveText(
        copy.bmiNeedsHeight,
      );

      const undersizedTargets = await page
        .locator(
          ".patients-screen button, .patients-screen input:not([type=checkbox]), .patients-screen select, .patients-screen textarea",
        )
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const bounds = element.getBoundingClientRect();
              return bounds.width < 24 || bounds.height < 24;
            })
            .map((element) => element.outerHTML),
        );
      expect(undersizedTargets).toEqual([]);

      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
      await attachPatientScreenshot(
        testInfo,
        page,
        `patient-profile-${locale}-${theme}.png`,
      );

      await page.getByTestId("edit-patient-button").click();
      const dndSwitch = page.getByRole("switch", { name: copy.dnd });
      await expect(dndSwitch).not.toBeChecked();
      await expect(dndSwitch).toHaveAccessibleName(copy.dnd);
      const dndLabel = page
        .locator("label.patient-toggle-btn")
        .filter({ has: dndSwitch });
      await expect(dndLabel).toBeVisible();
      const dndHitArea = await dndLabel.evaluate((label) => {
        const bounds = label.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      });
      expect(dndHitArea.width).toBeGreaterThanOrEqual(24);
      expect(dndHitArea.height).toBeGreaterThanOrEqual(24);

      await page.route(`${renderer.origin}/patients**`, async (route) => {
        const requestUrl = new URL(route.request().url());
        if (
          route.request().method() !== "GET" ||
          (requestUrl.pathname !== "/patients" &&
            requestUrl.pathname !== `/patients/${patient.id}`)
        ) {
          await route.continue();
          return;
        }
        await route.fulfill({
          body: JSON.stringify({
            code: "permission-denied",
            requestId: uuidV7(),
            requiredPermission: "patients.view",
            status: "denied",
          }),
          contentType: "application/json",
          status: 403,
        });
      });
      await page.reload();
      const profileDeniedAlert = page
        .locator(".patients-denied-panel")
        .getByRole("alert");
      await expect(profileDeniedAlert).toHaveText(copy.permissionDenied);
      await expect(profileDeniedAlert).toHaveAttribute(
        "aria-live",
        "assertive",
      );
      await expect(page.locator(".patients-denied-panel")).toHaveAttribute(
        "dir",
        expectedDirection,
      );
      const searchDeniedAlert = page.locator(".patients-list-error");
      await expect(searchDeniedAlert).toHaveAttribute("role", "alert");
      await expect(searchDeniedAlert).toContainText(copy.searchDenied);
      await expect(page.getByTestId("patient-profile-view")).toHaveCount(0);
      await expect(page.getByTestId("input-dnd")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(patient.firstName);
      await expect(page.locator("body")).not.toContainText(
        `${patient.firstName} ${patient.lastName}`,
      );
      await expect(page.locator("body")).not.toContainText(privateNote);

      const deniedAccessibility = await new AxeBuilder({ page }).analyze();
      expect(deniedAccessibility.violations).toEqual([]);
      await attachPatientScreenshot(
        testInfo,
        page,
        `patient-profile-denied-${locale}-${theme}.png`,
      );
    });

    test(`patient search loading, empty, and error states in ${locale}/${theme}`, async ({
      page,
    }, testInfo) => {
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      await installDesktopFake(page, renderer.origin, locale, theme);
      const copy = patientMessages[locale];
      const expectedDirection = locale === "ar" ? "rtl" : "ltr";
      let forceEmptyDirectory = true;
      await page.route(`${renderer.origin}/patients?*`, async (route) => {
        const requestUrl = new URL(route.request().url());
        const query = requestUrl.searchParams.get("q");
        if (
          (query === null || query === "") &&
          route.request().method() === "GET" &&
          forceEmptyDirectory
        ) {
          forceEmptyDirectory = false;
          await route.fulfill({
            body: JSON.stringify(
              searchPatientsResponseSchema.parse({
                items: [],
                total: 0,
                page: 1,
                limit: 20,
                totalPages: 0,
              }),
            ),
            contentType: "application/json",
            status: 200,
          });
          return;
        }
        await route.continue();
      });
      await page.goto(`${renderer.origin}#/patients`);
      await expect(page.locator(".shell-page")).toBeVisible({
        timeout: 30_000,
      });
      const search = page.getByTestId("patient-search-input");
      const listStatus = page.locator(".patients-list-region [role=status]");

      await expect(listStatus).toHaveText(copy.emptyList);
      await expect(listStatus).toHaveAttribute("role", "status");
      await expect(listStatus).toHaveAttribute("aria-live", "polite");
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        expectedDirection,
      );
      await expect(page.locator(".patients-screen")).toHaveAttribute(
        "dir",
        expectedDirection,
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".patients-list")).toHaveCount(0);
      const emptyListAccessibility = await new AxeBuilder({ page }).analyze();
      expect(emptyListAccessibility.violations).toEqual([]);
      await attachPatientScreenshot(
        testInfo,
        page,
        `patient-directory-empty-list-${locale}-${theme}.png`,
      );

      let announceLoading!: () => void;
      let releaseLoading!: () => void;
      const loadingStarted = new Promise<void>((resolve) => {
        announceLoading = resolve;
      });
      const loadingReleased = new Promise<void>((resolve) => {
        releaseLoading = resolve;
      });
      let forceError = true;
      await page.route(`${renderer.origin}/patients?*`, async (route) => {
        const requestUrl = new URL(route.request().url());
        const query = requestUrl.searchParams.get("q");
        if (query === "patient-loading-proof") {
          announceLoading();
          await loadingReleased;
          await route.continue();
          return;
        }
        if (query === "patient-error-proof" && forceError) {
          forceError = false;
          await route.fulfill({
            body: JSON.stringify({ message: "private upstream diagnostic" }),
            contentType: "application/json",
            status: 503,
          });
          return;
        }
        await route.continue();
      });

      await search.fill("patient-loading-proof");
      await expect(listStatus).toContainText(copy.loading);
      await loadingStarted;
      const loadingAccessibility = await new AxeBuilder({ page }).analyze();
      expect(loadingAccessibility.violations).toEqual([]);
      await attachPatientScreenshot(
        testInfo,
        page,
        `patient-directory-loading-${locale}-${theme}.png`,
      );
      releaseLoading();
      await expect(listStatus).toContainText(copy.emptyResults);
      const emptyAccessibility = await new AxeBuilder({ page }).analyze();
      expect(emptyAccessibility.violations).toEqual([]);
      await attachPatientScreenshot(
        testInfo,
        page,
        `patient-directory-empty-${locale}-${theme}.png`,
      );

      await search.fill("patient-error-proof");
      const listError = page.locator(".patients-list-region [role=alert]");
      await expect(listError).toContainText(copy.searchUnavailable);
      await expect(listError).not.toContainText("private upstream diagnostic");
      const errorAccessibility = await new AxeBuilder({ page }).analyze();
      expect(errorAccessibility.violations).toEqual([]);
      await attachPatientScreenshot(
        testInfo,
        page,
        `patient-directory-error-${locale}-${theme}.png`,
      );

      await page
        .locator(".patients-list-region")
        .getByRole("button", { name: copy.retryAction })
        .click();
      await expect(listStatus).toContainText(copy.emptyResults);
    });
  }

  test("an older patient search response cannot replace the latest query", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await createPatientProfile("SearchOldUnique", "Patient");
    await createPatientProfile("SearchNewUnique", "Patient");
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    let releaseOldResponse!: () => void;
    let announceOldRequest!: () => void;
    let finishOldRoute!: () => void;
    const oldRequestStarted = new Promise<void>((resolve) => {
      announceOldRequest = resolve;
    });
    const oldResponseReleased = new Promise<void>((resolve) => {
      releaseOldResponse = resolve;
    });
    const oldRouteFinished = new Promise<void>((resolve) => {
      finishOldRoute = resolve;
    });
    await page.route(`${renderer.origin}/patients?*`, async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q");
      if (query !== "SearchOldUnique") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      announceOldRequest();
      await oldResponseReleased;
      try {
        await route.fulfill({ response });
      } catch {
        // The renderer may cancel this request after the newer query starts.
      } finally {
        finishOldRoute();
      }
    });

    const search = page.getByTestId("patient-search-input");
    await search.fill("SearchOldUnique");
    await oldRequestStarted;
    await search.fill("SearchNewUnique");
    const newPatientRow = page
      .locator(".patient-list-item")
      .filter({ hasText: "SearchNewUnique Patient" });
    await expect(newPatientRow).toBeVisible();
    releaseOldResponse();
    await oldRouteFinished;
    await expect
      .poll(
        async () => await page.locator(".patient-list-item").allTextContents(),
      )
      .toEqual([expect.stringContaining("SearchNewUnique Patient")]);
  });

  for (const { locale, theme } of LOCALE_THEME_CASES) {
    test(`profile detail loading and error retry in ${locale}/${theme}`, async ({
      page,
    }, testInfo) => {
      await login(OWNER_USERNAME, OWNER_PASSWORD);
      const privateNote = `profile-load-private-note-${locale}-${theme}`;
      const patient = await createPatientProfile(
        `ProfileRetry${locale}${theme}`,
        "Patient",
        { otherNotes: privateNote },
      );
      await installDesktopFake(page, renderer.origin, locale, theme);

      let announceProfileRead!: () => void;
      let releaseProfileRead!: () => void;
      const profileReadStarted = new Promise<void>((resolve) => {
        announceProfileRead = resolve;
      });
      const profileResponseReleased = new Promise<void>((resolve) => {
        releaseProfileRead = resolve;
      });
      let holdFirstProfileRead = true;
      await page.route(
        `${renderer.origin}/patients/${patient.id}`,
        async (route) => {
          if (route.request().method() === "GET" && holdFirstProfileRead) {
            holdFirstProfileRead = false;
            announceProfileRead();
            await profileResponseReleased;
            await route.fulfill({
              body: JSON.stringify({
                message: "private upstream diagnostic",
              }),
              contentType: "application/json",
              status: 503,
            });
            return;
          }
          await route.continue();
        },
      );

      await page.goto(`${renderer.origin}#/patients/${patient.id}`);
      const copy = patientMessages[locale];
      const expectedDirection = locale === "ar" ? "rtl" : "ltr";
      const loadingAnnouncement = page.locator(
        ".patient-profile-status[role='status']",
      );
      await profileReadStarted;
      try {
        await expect(loadingAnnouncement).toHaveText(copy.loading);
        await expect(loadingAnnouncement).toHaveAttribute(
          "aria-live",
          "polite",
        );
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          expectedDirection,
        );
        await expect(page.locator(".patients-screen")).toHaveAttribute(
          "dir",
          expectedDirection,
        );
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByTestId("patient-profile-view")).toHaveCount(0);
        await expect(page.locator(".patient-profile-title")).toHaveCount(0);
        await expect(page.getByText(privateNote, { exact: true })).toHaveCount(
          0,
        );
        const loadingAccessibility = await new AxeBuilder({
          page,
        }).analyze();
        expect(loadingAccessibility.violations).toEqual([]);
        await attachPatientScreenshot(
          testInfo,
          page,
          `patient-detail-loading-${locale}-${theme}.png`,
        );
      } finally {
        releaseProfileRead();
      }

      const failure = page.locator(".patients-denied-panel").getByRole("alert");
      await expect(failure).toHaveText(copy.profileLoadError);
      await expect(failure).not.toContainText("private upstream diagnostic");
      await expect(page.getByText(privateNote, { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          exact: true,
          name: copy.retryAction,
        }),
      ).toBeVisible();
      const accessibilityScanResults = await new AxeBuilder({
        page,
      }).analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
      await attachPatientScreenshot(
        testInfo,
        page,
        `patient-detail-error-${locale}-${theme}.png`,
      );

      await page
        .getByRole("button", { exact: true, name: copy.retryAction })
        .click();
      await expect(page.getByTestId("patient-profile-view")).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: `${patient.firstName} ${patient.lastName}`,
        }),
      ).toBeVisible();
      await expect(page.getByText(privateNote, { exact: true })).toBeVisible();
    });
  }

  test("a response lost after create retries the same atomic command", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    const suffix = randomUUID().slice(0, 8);
    const firstName = `Retry${suffix}`;
    const commandBodies: Record<string, unknown>[] = [];
    await page.route(`${renderer.origin}/patients`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      commandBodies.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
      const response = await route.fetch();
      if (commandBodies.length === 1) {
        expect(response.status()).toBe(201);
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({ response });
    });

    await page.getByTestId("create-patient-button").click();
    await page.getByTestId("input-first-name").fill(firstName);
    await page.getByTestId("input-last-name").fill("Retry");
    await page.getByTestId("input-weight").fill("64.2");
    await page.getByTestId("save-patient-button").click();

    const locale: PatientLocale = "en";
    const copy = patientMessages[locale];
    await expect(page.locator(".patient-form-status")).toContainText(
      copy.unknownSaveOutcome,
    );
    await expect(page.getByTestId("save-patient-button")).toHaveText(
      copy.retrySave,
    );
    await page.getByTestId("save-patient-button").click();
    await expect(page.getByTestId("patient-profile-view")).toBeVisible();
    expect(commandBodies).toHaveLength(2);
    expect(commandBodies[1]).toEqual(commandBodies[0]);
    expect(commandBodies[1]?.idempotencyKey).toBe(
      commandBodies[0]?.idempotencyKey,
    );

    const patientId = decodeURIComponent(
      new URL(page.url()).hash.slice("#/patients/".length),
    );
    const savedWeights = await getPatientWeights(patientId, 1, 50);
    expect(savedWeights.total).toBe(1);
    expect(savedWeights.items).toHaveLength(1);
    const query = new URLSearchParams({ limit: "50", page: "1", q: firstName });
    const search = await apiRequest("GET", `/patients?${query.toString()}`);
    expect(search.status).toBe(200);
    const searchResult = searchPatientsResponseSchema.parse(search.body);
    expect(
      searchResult.items.filter(
        (item) => item.firstName === firstName && item.lastName === "Retry",
      ),
    ).toHaveLength(1);
  });

  test("ordinary duplicate-looking patient creation remains allowed", async () => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const first = await createPatientProfile("SameName", "SamePatient");
    const second = await createPatientProfile("SameName", "SamePatient");
    expect(first.id).not.toBe(second.id);

    const query = new URLSearchParams({
      limit: "50",
      page: "1",
      q: "SameName",
    });
    const response = await apiRequest("GET", `/patients?${query.toString()}`);
    expect(response.status).toBe(200);
    const result = searchPatientsResponseSchema.parse(response.body);
    expect(
      result.items.filter(
        (item) =>
          item.firstName === "SameName" && item.lastName === "SamePatient",
      ),
    ).toHaveLength(2);
  });

  test("profile-only editors cannot see or overwrite protected fields", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const patient = await createPatientProfile("Protected", "Fields", {
      discountPercent: "17.25",
      otherNotes: "Confidential patient note",
    });
    const user = await createPatientRoleUser([
      "patients.view",
      "patients.manage",
    ]);
    await login(user.username, user.password);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients/${patient.id}`);
    await expect(page.getByTestId("patient-profile-view")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("patient-profile-view")).not.toContainText(
      "Confidential patient note",
    );
    await expect(page.getByTestId("view-discount")).toHaveCount(0);

    const updateBodies: Record<string, unknown>[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/patients/${patient.id}`
      ) {
        updateBodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });
    await page.getByTestId("edit-patient-button").click();
    await expect(page.getByTestId("input-notes")).toHaveCount(0);
    await expect(page.getByTestId("input-discount")).toHaveCount(0);
    await page.getByTestId("input-first-name").fill("ProtectedUpdated");
    await page.getByTestId("save-patient-button").click();
    await expect(page.getByTestId("patient-profile-view")).toContainText(
      "ProtectedUpdated Fields",
    );

    expect(updateBodies).toHaveLength(1);
    for (const protectedField of [
      "allergies",
      "chronicConditions",
      "chronicMedications",
      "discountPercent",
      "otherNotes",
      "sensitivities",
      "smoking",
    ]) {
      expect(updateBodies[0]).not.toHaveProperty(protectedField);
    }

    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const storedResponse = await apiRequest("GET", `/patients/${patient.id}`);
    expect(storedResponse.status).toBe(200);
    const storedPatient = patientProfileResponseSchema.parse(
      storedResponse.body,
    );
    expect(storedPatient.otherNotes).toBe("Confidential patient note");
    expect(storedPatient.discountPercent).toBe("17.25");
  });

  test("loads all weight pages and formats history in pharmacy time", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    let patient = await createPatientProfile("PagedWeights", "Patient");
    for (let index = 0; index < 51; index += 1) {
      patient = await updatePatientProfile(patient, {
        weightMeasurement: {
          measuredAt: new Date(Date.UTC(2025, 0, 1, 12, index)).toISOString(),
          weightKg: (50 + index / 10).toFixed(1),
        },
      });
    }

    const firstPage = await getPatientWeights(patient.id, 1, 50);
    expect(firstPage.total).toBe(51);
    expect(firstPage.totalPages).toBe(2);
    const latestMeasurement = firstPage.items[0];
    expect(latestMeasurement).toBeDefined();
    const businessTimeZone = firstPage.businessTimeZone;
    const overrideTimeZone = await page.evaluate(
      ({ businessTimeZone, instant }) => {
        const candidates = [
          "America/Los_Angeles",
          "Pacific/Honolulu",
          "Asia/Tokyo",
          "Europe/London",
          "UTC",
        ];
        const format = (timeZone: string) =>
          new Intl.DateTimeFormat("en-IQ", {
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            month: "short",
            timeZone,
            timeZoneName: "short",
            year: "numeric",
          }).format(new Date(instant));
        const configured = format(businessTimeZone);
        return candidates.find((candidate) => format(candidate) !== configured);
      },
      {
        businessTimeZone,
        instant: latestMeasurement!.measuredAt,
      },
    );
    expect(overrideTimeZone).toBeDefined();
    if (overrideTimeZone === undefined) {
      throw new Error(
        "No workstation timezone differs from the pharmacy timezone",
      );
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTimezoneOverride", {
      timezoneId: overrideTimeZone,
    });
    const display = await page.evaluate(
      ({ businessTimeZone, instant }) => {
        const options: Intl.DateTimeFormatOptions = {
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          month: "short",
          timeZoneName: "short",
          year: "numeric",
        };
        return {
          configured: new Intl.DateTimeFormat("en-IQ", {
            ...options,
            timeZone: businessTimeZone,
          }).format(new Date(instant)),
          workstation: new Intl.DateTimeFormat("en-IQ", options).format(
            new Date(instant),
          ),
          workstationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      },
      {
        businessTimeZone,
        instant: latestMeasurement!.measuredAt,
      },
    );
    expect(display.workstationTimeZone).toBe(overrideTimeZone);
    expect(display.configured).not.toBe(display.workstation);

    let releaseFirstPageTwo!: () => void;
    let announceFirstPageTwo!: () => void;
    const pageTwoStarted = new Promise<void>((resolve) => {
      announceFirstPageTwo = resolve;
    });
    const pageTwoReleased = new Promise<void>((resolve) => {
      releaseFirstPageTwo = resolve;
    });
    let pageTwoAttempts = 0;
    await page.route(
      `${renderer.origin}/patients/${patient.id}/weights?*`,
      async (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.searchParams.get("page") !== "2") {
          await route.continue();
          return;
        }
        pageTwoAttempts += 1;
        if (pageTwoAttempts === 1) {
          announceFirstPageTwo();
          await pageTwoReleased;
          await route.fulfill({
            body: JSON.stringify({ message: "private upstream diagnostic" }),
            contentType: "application/json",
            status: 503,
          });
          return;
        }
        await route.continue();
      },
    );

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients/${patient.id}`);
    await expect(page.getByTestId("weight-history-table")).toBeVisible({
      timeout: 30_000,
    });
    const table = page.getByTestId("weight-history-table");
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await expect(table).toContainText(display.configured);
    const undersizedHistoryTargets = await page
      .locator(
        ".patients-screen button, .patients-screen input:not([type=checkbox]), .patients-screen select, .patients-screen textarea",
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width < 24 || bounds.height < 24;
          })
          .map((element) => element.outerHTML),
      );
    expect(undersizedHistoryTargets).toEqual([]);

    const copy = patientMessages.en;
    const loadMoreButton = page.getByRole("button", {
      name: copy.loadMoreWeights,
    });
    await tabUntilFocused(page, loadMoreButton);
    await page.keyboard.press("Enter");
    const loading = page
      .locator(".patient-form-status")
      .filter({ hasText: copy.loadingWeights });
    await expect(loading).toContainText(copy.loadingWeights);
    await pageTwoStarted;
    releaseFirstPageTwo();
    const historyError = page.getByRole("alert");
    await expect(historyError).toContainText(copy.weightHistoryLoadError);
    await expect(historyError).not.toContainText("private upstream diagnostic");
    const errorAccessibility = await new AxeBuilder({ page }).analyze();
    expect(errorAccessibility.violations).toEqual([]);
    const retryHistoryButton = historyError.getByRole("button", {
      name: copy.retryAction,
    });
    await tabUntilFocused(page, retryHistoryButton);
    await page.keyboard.press("Enter");
    await expect(table.locator("tbody tr")).toHaveCount(51);
    await expect(table).toContainText("50");

    const oldMeasurement = (await getPatientWeights(patient.id, 2, 50))
      .items[0];
    expect(oldMeasurement).toBeDefined();
    const oldMeasurementDisplay = await page.evaluate(
      ({ businessTimeZone, instant }) =>
        new Intl.DateTimeFormat("en-IQ", {
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          month: "short",
          timeZone: businessTimeZone,
          timeZoneName: "short",
          year: "numeric",
        }).format(new Date(instant)),
      {
        businessTimeZone,
        instant: oldMeasurement!.measuredAt,
      },
    );
    const input = page.getByTestId("input-weight");
    await input.fill("72.5");
    await page
      .getByRole("combobox", { name: copy.weightHistoryHeading })
      .selectOption(oldMeasurement!.id);
    await expect(input).toHaveValue("72.5");
    await expect(page.locator(".patient-selected-weight-note")).toContainText(
      oldMeasurementDisplay,
    );
  });

  test("patient profile fields and actions remain usable at 200 percent text", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients/new`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    const textScale = await enlargePatientText(page);
    expect(textScale.some(({ before, after }) => after >= before * 1.99)).toBe(
      true,
    );
    const firstName = page.getByTestId("input-first-name");
    const save = page.getByTestId("save-patient-button");
    await expect(firstName).toBeVisible();
    await expect(save).toBeVisible();
    await firstName.fill("LargeText");
    await page.getByTestId("input-last-name").fill("Patient");

    await page.setViewportSize({ height: 768, width: 1024 });
    const layout = await page.locator(".patients-screen").evaluate((root) => ({
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
    }));
    const mainLayout = await page
      .locator(".patient-main-content")
      .evaluate((main) => ({
        clientWidth: main.clientWidth,
        scrollWidth: main.scrollWidth,
      }));
    expect(mainLayout.clientWidth).toBeGreaterThan(0);
    expect(layout.rootScrollWidth).toBeLessThanOrEqual(
      layout.rootClientWidth + 2,
    );

    const undersizedTargets = await page
      .locator(
        ".patients-screen button, .patients-screen input:not([type=checkbox]), .patients-screen select, .patients-screen textarea",
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width < 24 || bounds.height < 24;
          })
          .map((element) => element.outerHTML),
      );
    expect(undersizedTargets).toEqual([]);
    await expect(save).toBeVisible();
    await save.click();
    await expect(page.getByTestId("patient-profile-view")).toContainText(
      "LargeText Patient",
    );
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("supports Arabic locale (RTL) and dark theme", async ({ page }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "ar", "dark");
    await page.goto(`${renderer.origin}#/patients/`);
    const locale: PatientLocale = "ar";
    const copy = patientMessages[locale];

    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    // Verify document root dir
    const htmlDir = await page.getAttribute("html", "dir");
    expect(htmlDir).toBe("rtl");

    // Verify Arabic UI headings and buttons
    await expect(page.locator("h2#patients-title")).toContainText(copy.title);
    await expect(page.getByTestId("create-patient-button")).toContainText(
      copy.createPatient,
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

    // The real server denies both reads and writes for this role.
    const apiRes = await apiRequest("GET", "/patients");
    expect(apiRes.status).toBe(403);
    expect((apiRes.body as { code?: string })?.code).toBe("permission-denied");

    // Verify direct API mutation is forbidden (POST /patients returns 403)
    const createRes = await apiRequest("POST", "/patients", {
      firstName: "Unauthorized",
      idempotencyKey: randomUUID(),
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

    const patient = await createPatientProfile("Concurrent", "Tester");

    await page.goto(`${renderer.origin}#/patients/${patient.id}`);
    await expect(page.getByTestId("edit-patient-button")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("edit-patient-button").click();
    await expect(page.getByTestId("input-first-name")).toHaveValue(
      "Concurrent",
    );

    // Concurrent modification on server
    await updatePatientProfile(patient, { firstName: "Concurrent External" });

    // Stale submit from UI
    await page.getByTestId("input-first-name").fill("Stale Submit");
    await page.getByTestId("save-patient-button").click();

    // Verify 409 conflict message
    const alert = page.locator(".denial-alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("modified in another session");
    await page
      .getByRole("button", { name: patientMessages.en.reloadLatest })
      .click();
    await expect(page.getByTestId("input-first-name")).toHaveValue(
      "Stale Submit",
    );
    await expect(page.getByTestId("save-patient-button")).toBeEnabled();
    await page.getByTestId("save-patient-button").click();
    await expect(page.getByTestId("patient-profile-view")).toContainText(
      "Stale Submit Tester",
    );
  });

  test("supports keyboard-only create, find, edit, weight, picker, and cancel", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/patients`);
    await expect(page.locator(".shell-page")).toBeVisible({ timeout: 30_000 });

    const copy = patientMessages.en;
    const createButton = page.getByTestId("create-patient-button");
    await tabUntilFocused(page, createButton);
    await page.keyboard.press("Enter");
    const firstName = page.getByTestId("input-first-name");
    await expect(firstName).toBeFocused();
    await page.keyboard.type("Keyboard");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Profile");

    const phone = page.getByTestId("input-phone");
    await tabUntilFocused(page, phone);
    await page.keyboard.type("07900001111");

    const weight = page.getByTestId("input-weight");
    await tabUntilFocused(page, weight);
    await page.keyboard.type("71.4");

    const discount = page.getByTestId("input-discount");
    await tabUntilFocused(page, discount);
    await page.keyboard.type("12.50");

    const conditions = page.getByTestId("input-conditions");
    await tabUntilFocused(page, conditions);
    await page.keyboard.type("Asthma");
    await page.keyboard.press("Enter");

    const medications = page.locator("#medications-input");
    await tabUntilFocused(page, medications);
    await page.keyboard.type("Metformin");
    await page.keyboard.press("Enter");

    const interests = page.locator("#interests-input");
    await tabUntilFocused(page, interests);
    await page.keyboard.type("Reading");
    await page.keyboard.press("Enter");

    const notes = page.getByTestId("input-notes");
    await tabUntilFocused(page, notes);
    await page.keyboard.type("Keyboard-only important note");

    const dnd = page.getByRole("switch", { name: copy.dnd });
    await tabUntilFocused(page, dnd);
    await page.keyboard.press("Space");

    const allergyToggle = page.getByTestId("input-allergy-toggle");
    await tabUntilFocused(page, allergyToggle);
    await page.keyboard.press("Enter");
    const allergySearch = page.getByTestId("input-allergy-search");
    await tabUntilFocused(page, allergySearch);
    await page.keyboard.type("Pen");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(allergySearch).toHaveAttribute("aria-expanded", "false");
    await expect(allergySearch).toBeFocused();
    await page.keyboard.press("Backspace");
    await page.keyboard.type("n");
    await expect(allergySearch).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(allergySearch).toHaveAttribute("aria-activedescendant");
    await page.keyboard.press("Enter");
    await expect(allergySearch).toBeFocused();
    await expect(page.getByTestId("allergy-picker")).toContainText(
      "Penicillins",
    );

    await page.keyboard.press("Shift+Tab");
    const removePenicillins = page.getByRole("button", {
      name: `${copy.removeItem} Penicillins`,
    });
    await expect(removePenicillins).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(allergySearch).toBeFocused();
    await expect(
      page.getByTestId("allergy-picker").locator(".tag-chip-rose"),
    ).toHaveCount(0);
    await page.keyboard.type("Pen");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(
      page.getByTestId("allergy-picker").locator(".tag-chip-rose"),
    ).toHaveCount(1);

    const undersizedPickerTargets = await page
      .locator(
        ".patients-screen button, .patients-screen input:not([type=checkbox]), .patients-screen select, .patients-screen textarea",
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width < 24 || bounds.height < 24;
          })
          .map((element) => element.outerHTML),
      );
    expect(undersizedPickerTargets).toEqual([]);
    const undersizedPickerOptions = await page
      .locator(".allergy-option-item")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width < 24 || bounds.height < 24;
          })
          .map((element) => element.outerHTML),
      );
    expect(undersizedPickerOptions).toEqual([]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const transitionDuration = await allergySearch.evaluate((element) => {
      const browser = globalThis as typeof globalThis & {
        getComputedStyle(target: object): { transitionDuration: string };
      };
      return browser.getComputedStyle(element).transitionDuration;
    });
    expect(Number.parseFloat(transitionDuration)).toBeLessThan(0.001);
    const pickerAccessibility = await new AxeBuilder({ page }).analyze();
    expect(pickerAccessibility.violations).toEqual([]);

    const save = page.getByTestId("save-patient-button");
    await tabUntilFocused(page, save);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("patient-profile-view")).toBeVisible();
    const search = page.getByTestId("patient-search-input");
    await expect(search).toBeFocused();
    await page.keyboard.type("Keyboard Profile");
    const patientRow = page
      .locator(".patient-list-item")
      .filter({ hasText: "Keyboard Profile" });
    await expect(patientRow).toBeVisible();
    await tabUntilFocused(page, patientRow);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("patient-profile-view")).toBeVisible();
    await expect(page.getByTestId("edit-patient-button")).toBeFocused();

    const inlineWeight = page.getByTestId("input-weight");
    await tabUntilFocused(page, inlineWeight);
    await page.keyboard.type("72.5");
    await tabUntilFocused(page, page.getByTestId("add-weight-button"));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("weight-history-table")).toContainText(
      "72.5",
    );

    await page.keyboard.press("Shift+Tab");
    await expect(inlineWeight).toBeFocused();
    await page.keyboard.type("73.5");
    await page.keyboard.press("Shift+Tab");
    const historySelect = page.getByRole("combobox", {
      name: copy.weightHistoryHeading,
    });
    await expect(historySelect).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(inlineWeight).toHaveValue("73.5");

    const editButton = page.getByTestId("edit-patient-button");
    await tabUntilFocused(page, editButton);
    await page.keyboard.press("Enter");
    await expect(firstName).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("KeyboardEdited");
    const editDnd = page.getByRole("switch", { name: copy.dnd });
    await tabUntilFocused(page, editDnd);
    await page.keyboard.press("Space");
    await tabUntilFocused(page, save);
    await page.keyboard.press("Enter");
    await expect(editButton).toBeFocused();
    await expect(page.getByTestId("view-dnd")).toHaveText(copy.dndDisabled);
    await expect(
      page.getByTestId("weight-history-table").locator("tbody tr"),
    ).toHaveCount(2);

    await page.keyboard.press("Enter");
    await expect(firstName).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(editButton).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(firstName).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("DiscardedDraft");
    await page.keyboard.press("Escape");
    const keepEditing = page.getByRole("button", { name: copy.keepEditing });
    await expect(keepEditing).toBeFocused();
    await page.keyboard.press("Escape");
    const cancel = page.getByRole("button", { name: copy.cancel });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(keepEditing).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(editButton).toBeFocused();
    await expect(page.getByTestId("patient-profile-view")).not.toContainText(
      "DiscardedDraft",
    );

    const patientsNavigation = page.locator('a[data-module="patients"]');
    await tabUntilFocused(page, patientsNavigation);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/patients\/?$/u);
    const directorySearch = page.getByTestId("patient-search-input");
    await tabUntilFocused(page, directorySearch);
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    const directoryOpenButton = page
      .locator(".patient-directory-open")
      .filter({ hasText: "KeyboardEdited Profile" });
    await expect(directoryOpenButton).toBeVisible();
    await tabUntilFocused(page, directoryOpenButton);
    await expect(directoryOpenButton).toHaveAccessibleName(
      "KeyboardEdited Profile",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("edit-patient-button")).toBeFocused();
  });

  test("displays no BMI when height is absent", async ({ page }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");

    const copy = patientMessages.en;
    const patient = await createPatientProfile("NoHeight", "Patient");

    await page.goto(`${renderer.origin}#/patients/${patient.id}`);
    await expect(page.getByTestId("view-bmi")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("view-bmi")).toHaveText(copy.bmiNeedsHeight);

    await page.getByTestId("input-weight").fill("80");
    await page.getByTestId("add-weight-button").click();
    await expect(page.getByTestId("weight-history-table")).toContainText("80");

    // Still no BMI because height is absent
    await expect(page.getByTestId("view-bmi")).toHaveText(copy.bmiNeedsHeight);

    // Add height via edit
    await page.getByTestId("edit-patient-button").click();
    await page.getByTestId("input-height").fill("200");
    await page.getByTestId("save-patient-button").click();

    // BMI now calculated: 80 / (2^2) = 20
    await expect(page.getByTestId("view-bmi")).toContainText("20");
    await expect(page.getByTestId("view-bmi")).toContainText(
      copy.bmiCategory("normal"),
    );
    await expect(page.getByTestId("view-bmi")).not.toContainText(
      /NaN|Infinity/u,
    );
  });

  test("patient allergy toggle, drug family picker, and persistence across reload", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "ar", "light");
    const copy = patientMessages.ar;
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

    // BMI remains server-authoritative until the one atomic Save completes.
    await expect(page.locator(".bmi-card")).toContainText(copy.bmiAfterSave);

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

async function tabUntilFocused(
  page: Page,
  target: Locator,
  maximumTabs = 100,
): Promise<void> {
  for (let attempt = 0; attempt < maximumTabs; attempt += 1) {
    try {
      await expect(target).toBeFocused({ timeout: 25 });
      return;
    } catch {
      if (attempt + 1 < maximumTabs) await page.keyboard.press("Tab");
    }
  }
  throw new Error("The keyboard could not reach the expected patient control");
}

async function createPatientProfile(
  firstName: string,
  lastName: string,
  fields: Record<string, unknown> = {},
): Promise<PatientProfileResponse> {
  const response = await apiRequest("POST", "/patients", {
    ...fields,
    firstName,
    idempotencyKey: randomUUID(),
    lastName,
  });
  expect(response.status).toBe(201);
  return patientProfileResponseSchema.parse(response.body);
}

async function attachPatientScreenshot(
  testInfo: TestInfo,
  page: Page,
  name: string,
): Promise<void> {
  const screenshotPath = testInfo.outputPath(name);
  await page.screenshot({ fullPage: true, path: screenshotPath, type: "png" });
  await testInfo.attach(name, {
    contentType: "image/png",
    path: screenshotPath,
  });
}

async function updatePatientProfile(
  patient: Pick<PatientProfileResponse, "id" | "revision">,
  fields: Record<string, unknown>,
): Promise<PatientProfileResponse> {
  const response = await apiRequest("PUT", `/patients/${patient.id}`, {
    ...fields,
    expectedRevision: patient.revision,
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(200);
  return patientProfileResponseSchema.parse(response.body);
}

async function getPatientWeights(
  patientId: string,
  page: number,
  limit: number,
) {
  const query = new URLSearchParams({
    limit: String(limit),
    page: String(page),
  });
  const response = await apiRequest(
    "GET",
    `/patients/${patientId}/weights?${query.toString()}`,
  );
  expect(response.status).toBe(200);
  return listPatientWeightsResponseSchema.parse(response.body);
}

async function enlargePatientText(
  page: Page,
): Promise<Array<{ readonly before: number; readonly after: number }>> {
  type TextResizableElement = {
    readonly style: {
      setProperty(propertyName: string, value: string, priority?: string): void;
    };
  };
  type PatientScreen = {
    querySelectorAll(selector: string): Iterable<TextResizableElement>;
  };
  type BrowserGlobals = {
    getComputedStyle(element: TextResizableElement): { fontSize: string };
  };

  return await page.locator(".patients-screen").evaluate((root) => {
    const screen = root as PatientScreen;
    const browser = globalThis as typeof globalThis & BrowserGlobals;
    const elements = Array.from(screen.querySelectorAll("*"));
    const sizes = elements.map((element) => ({
      before: Number.parseFloat(browser.getComputedStyle(element).fontSize),
      element,
    }));
    for (const { before, element } of sizes) {
      element.style.setProperty(
        "font-size",
        `${String(before * 2)}px`,
        "important",
      );
    }
    return sizes
      .filter(({ before }) => Number.isFinite(before) && before > 0)
      .slice(0, 32)
      .map(({ before, element }) => ({
        after: Number.parseFloat(browser.getComputedStyle(element).fontSize),
        before,
      }));
  });
}

async function approvedStepUp(
  action: string,
  password: string,
  subjectId?: string,
): Promise<string> {
  const challenge = await apiRequest("POST", "/identity/step-up-challenges", {
    action,
    idempotencyKey: randomUUID(),
    ...(subjectId === undefined ? {} : { subjectId }),
  });
  expect(challenge.status).toBe(201);
  const challengeId = (challenge.body as { id?: string }).id;
  expect(challengeId).toBeDefined();

  const approval = await apiRequest(
    "POST",
    `/identity/step-up-challenges/${challengeId}/approve`,
    { idempotencyKey: randomUUID(), password },
  );
  expect(approval.status).toBe(200);
  return challengeId!;
}

async function createPatientRoleUser(permissions: readonly string[]): Promise<{
  readonly password: string;
  readonly roleId: string;
  readonly username: string;
}> {
  const suffix = randomBytes(4).toString("hex");
  const password = `patient role password ${suffix}`;
  const username = `patients.role.${suffix}`;
  const roleChallengeId = await approvedStepUp(
    "identity.role.create",
    OWNER_PASSWORD,
  );
  const role = await apiRequest("POST", "/identity/roles", {
    challengeId: roleChallengeId,
    idempotencyKey: randomUUID(),
    name: `Patient role ${suffix}`,
    permissions: [...permissions],
  });
  expect(role.status).toBe(201);
  const roleId = (role.body as { id?: string }).id;
  expect(roleId).toBeDefined();

  const userChallengeId = await approvedStepUp(
    "identity.user.create",
    OWNER_PASSWORD,
  );
  const user = await apiRequest("POST", "/identity/users", {
    challengeId: userChallengeId,
    displayName: `Patient Role ${suffix}`,
    idempotencyKey: randomUUID(),
    password,
    roleId,
    username,
  });
  expect(user.status).toBe(201);
  return { password, roleId: roleId!, username };
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
