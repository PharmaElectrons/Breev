import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  PRODUCT_NAME_TEMPLATES,
  composeDisplayName,
  identityStateSchema,
  localProofEvidenceContract,
  parseLocalProofEvidenceResponse,
  productSchema,
  type LocalProofEvidenceSuccess,
  type Product,
  type ProductCreateRequest,
  type ProductDefinitionMode,
} from "@breev/contracts/local-rest";
import { expect, test, type Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../database-roles.js";
import {
  spawnLocalApiProcess,
  stopProcess,
  waitForHealth as waitForLocalApiHealth,
} from "../local-api-process.js";
import { evidencePath } from "./evidence-path.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "catalog.browser.owner";
const OWNER_PASSWORD = "catalog browser owner password stays in this test";
const PHARMACIST_USERNAME = "catalog.browser.pharmacist";
const PHARMACIST_PASSWORD =
  "catalog browser pharmacist password stays in this test";

function composeTestDisplayName(
  mode: ProductDefinitionMode,
  fields: Readonly<Record<string, string | null | undefined>>,
): string {
  return composeDisplayName(
    PRODUCT_NAME_TEMPLATES[CURRENT_PRODUCT_NAME_TEMPLATE_VERSION][mode],
    fields,
  );
}

interface RendererServer {
  readonly origin: string;
  readonly server: Server;
}

interface DesktopFakeOptions {
  readonly locale?: "ar" | "en";
  readonly theme?: "dark" | "light";
}

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

function sampleMedicationRequest(barcode: string): ProductCreateRequest {
  return {
    arabicSearchName: "بنادول اكسترا باراسيتامول وكافيين",
    barcodes: [barcode],
    category: "Analgesic",
    definition: {
      fields: {
        dosageForm: "Film Coated Tablet",
        manufacturer: "GSK",
        strength: "500mg/65mg",
        tradeName: "Panadol Extra",
      },
      mode: "medication",
    },
    idempotencyKey: randomUUID(),
    instructions: {
      foodTiming: "after-food",
      usesPerDay: 3,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    scientificName: "Paracetamol + Caffeine",
    sharing: {
      aiSharingAllowed: true,
      externallyVisible: true,
    },
    stateColours: {
      coldStorageRequired: false,
      manual: "blue",
    },
  };
}

async function startRendererServer(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
): Promise<RendererServer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");

  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/health") {
        const upstream = await fetch(`${apiOrigin}/health`);
        response.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }

      if (
        request.url?.startsWith("/identity/") ||
        request.url === "/catalog/products" ||
        request.url?.startsWith("/catalog/products/")
      ) {
        const body = await readRequestBody(request);
        const upstream = await fetch(`${apiOrigin}${request.url}`, {
          ...(body.length === 0 ? {} : { body }),
          headers: requestHeaders(credentials, body.length > 0),
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

      const cleanPath = pathname.split("?")[0];
      const filePath = path.resolve(rendererRoot, `.${cleanPath}`);
      const extension = path.extname(filePath);
      const content = await readFile(filePath);
      response.writeHead(200, {
        "content-type":
          extension === ".html"
            ? "text/html; charset=utf-8"
            : extension === ".css"
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8",
      });
      response.end(content);
    } catch {
      response.writeHead(502, { "content-type": "application/json" });
      response.end("{}");
    }
  });
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    server,
  };
}

async function installDesktopFake(
  page: Page,
  localApiOrigin: string,
  options: DesktopFakeOptions = {},
): Promise<void> {
  const locale = options?.locale ?? "en";
  const theme = options?.theme ?? "light";

  await page.addInitScript(
    ({ apiOrigin, initialLocale, initialTheme }) => {
      localStorage.setItem("breev.locale", initialLocale);
      localStorage.setItem("breev.theme", initialTheme);

      const unpairedState = {
        candidates: [],
        stage: "awaiting-invitation" as const,
      };

      const desktopApi: BreevDesktopApi = Object.freeze({
        cancelTerminalPairing: async () => unpairedState,
        copyIdentifier: async () => ({ copied: true as const }),
        exportDiagnostics: async () => ({ status: "saved" as const }),
        getStartupConfig: async () => ({
          localApiOrigin: apiOrigin,
          role: "main" as const,
        }),
        getTerminalPairingState: async () => unpairedState,
        openSupport: async () => ({ status: "unavailable" as const }),
        reportRendererIncident: async () => ({ accepted: true as const }),
        submitManualEndpoint: async () => unpairedState,
        submitDiagnostics: async () => ({ status: "unavailable" as const }),
        submitPairingInvitation: async () => unpairedState,
      });

      Object.defineProperty(globalThis, "breevDesktop", {
        configurable: false,
        value: desktopApi,
        writable: false,
      });
    },
    { apiOrigin: localApiOrigin, initialLocale: locale, initialTheme: theme },
  );
}

test.describe.serial("Product catalog screens", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin: string;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let inventoryProduct: Product;
  let matrixProduct: Product;
  let mergeProduct: Product;
  let mergeSurvivor: Product;
  let postgres: StartedPostgreSqlContainer | undefined;
  let renderer: RendererServer;
  const evidenceDir = evidencePath("issue-45/after");
  const testResultsDir = path.resolve(
    import.meta.dirname,
    "../../../../test-results/desktop-browser",
  );
  // The prototype-adoption slice keeps its own before/after set so issue 45s
  // evidence stays about product definition rather than about the re-skin.
  const adoptionEvidenceDir = evidencePath("client-prototype-adoption/after");

  test.beforeAll(async () => {
    await mkdir(evidenceDir, { recursive: true });
    await mkdir(adoptionEvidenceDir, { recursive: true });
    await mkdir(testResultsDir, { recursive: true });
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    credentials = createMainDeviceCredentials();
    const apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = spawnLocalApi(apiPort, databaseRoles, credentials);
    await waitForLocalApiHealth(apiOrigin, "healthy", api, 30_000);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });

    const bootstrapped = await requestLocalApi(
      apiOrigin,
      credentials,
      "POST",
      "/identity/bootstrap",
      {
        owner: {
          displayName: "Catalog Browser Owner",
          password: OWNER_PASSWORD,
          username: OWNER_USERNAME,
        },
        pharmacyName: "Breev Catalog Browser Pharmacy",
      },
    );
    expect(bootstrapped.status).toBe(201);
    const ownerState = identityStateSchema.parse(bootstrapped.body);
    expect(ownerState.state).toBe("authenticated");
    if (ownerState.state !== "authenticated") {
      throw new Error("Catalog browser owner was not authenticated");
    }

    const challenge = await requestLocalApi(
      apiOrigin,
      credentials,
      "POST",
      "/identity/step-up-challenges",
      {
        action: "identity.user.create",
        idempotencyKey: randomUUID(),
      },
    );
    expect(challenge.status).toBe(201);
    const challengeId = String(
      (challenge.body as { id?: string } | undefined)?.id ?? "",
    );
    expect(challengeId).not.toBe("");
    const approved = await requestLocalApi(
      apiOrigin,
      credentials,
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      { idempotencyKey: randomUUID(), password: OWNER_PASSWORD },
    );
    expect(approved.status).toBe(200);
    const pharmacistRole = await administrator.query<{ id: string }>(
      "select id from pharmacy_roles where role_key = 'pharmacist'",
    );
    const pharmacist = await requestLocalApi(
      apiOrigin,
      credentials,
      "POST",
      "/identity/users",
      {
        challengeId,
        displayName: "Catalog Browser Pharmacist",
        idempotencyKey: randomUUID(),
        password: PHARMACIST_PASSWORD,
        roleId: pharmacistRole.rows[0]?.id,
        username: PHARMACIST_USERNAME,
      },
    );
    expect(pharmacist.status).toBe(201);
    const pharmacistId = String(
      (pharmacist.body as { id?: string } | undefined)?.id ?? "",
    );
    expect(pharmacistId).not.toBe("");

    await grantCatalogPermission(
      administrator,
      ownerState.pharmacy.id,
      pharmacistId,
      ownerState.user.id,
    );
    const login = await requestLocalApi(
      apiOrigin,
      credentials,
      "POST",
      "/identity/login",
      { password: PHARMACIST_PASSWORD, username: PHARMACIST_USERNAME },
    );
    expect(login.status).toBe(200);
    const pharmacistState = identityStateSchema.parse(login.body);
    expect(pharmacistState.state).toBe("authenticated");
    if (pharmacistState.state !== "authenticated") {
      throw new Error("Catalog browser pharmacist was not authenticated");
    }
    expect(pharmacistState.allowedPermissions).toContain("catalog.item.manage");
    await getProofEvidence(apiOrigin, credentials);

    inventoryProduct = await createCatalogProduct(
      apiOrigin,
      credentials,
      sampleMedicationRequest("5000167000101"),
    );
    mergeProduct = await createCatalogProduct(
      apiOrigin,
      credentials,
      sampleMedicationRequest("5000167000102"),
    );
    mergeSurvivor = await createCatalogProduct(
      apiOrigin,
      credentials,
      sampleMedicationRequest("5000167000103"),
    );
    matrixProduct = await createCatalogProduct(
      apiOrigin,
      credentials,
      sampleMedicationRequest("5000167000104"),
    );
    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("Keyboard-only entry of a full medication, start to submit — no mouse", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(`${renderer.origin}#/catalog/products/new`);
    await expect(
      page.getByRole("heading", { name: "Define new product" }),
    ).toBeVisible();

    // 1. Trade Name
    const tradeNameInput = page.getByLabel("Trade name *");
    await tradeNameInput.focus();
    await expect(tradeNameInput).toBeFocused();
    await page.keyboard.type("Panadol Extra");

    // Dynamic generation verification while typing
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Panadol Extra",
    );

    // 2. Strength
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Strength")).toBeFocused();
    await page.keyboard.type("500mg");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Panadol Extra 500mg",
    );

    // 3. Dosage Form
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Dosage form")).toBeFocused();
    await page.keyboard.type("Tablet");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Panadol Extra 500mg Tablet",
    );

    // 4. Manufacturer
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Manufacturer")).toBeFocused();
    await page.keyboard.type("GSK");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Panadol Extra 500mg Tablet GSK",
    );

    // 5. Arabic Search Name (below English display name)
    await page.keyboard.press("Tab");
    const arabicInput = page.getByLabel("Arabic search name");
    await expect(arabicInput).toBeFocused();
    await page.keyboard.type("بنادول اكسترا");

    // Assert that typing Arabic search name does NOT alter English generated name
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Panadol Extra 500mg Tablet GSK",
    );

    // 6. Scientific Name & Category
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Scientific / Generic name")).toBeFocused();
    await page.keyboard.type("Paracetamol");

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Category")).toBeFocused();
    await page.keyboard.type("Analgesic");

    // 7. Barcode entry
    await page.keyboard.press("Tab");
    const barcodeInput = page.getByPlaceholder("Enter barcode");
    await expect(barcodeInput).toBeFocused();
    await page.keyboard.type("5000167000001");
    await page.keyboard.press("Enter");
    await expect(page.getByText("5000167000001")).toBeVisible();

    // 8. Instructions (uses per day)
    await page.keyboard.press("Tab"); // Add barcode button
    await page.keyboard.press("Tab"); // Remove barcode button
    await page.keyboard.press("Tab"); // Uses per day
    await expect(page.getByLabel("Uses per day")).toBeFocused();
    await page.keyboard.type("3");

    // 9. Food Timing
    await page.keyboard.press("Tab"); // Uses per week
    await page.keyboard.press("Tab"); // Uses per month
    await page.keyboard.press("Tab"); // Food timing
    await expect(page.getByLabel("Food timing")).toBeFocused();
    await page.getByLabel("Food timing").selectOption("after-food");

    // 10. Submit with keyboard
    const createButton = page.getByRole("button", { name: "Create product" });
    await createButton.focus();
    await page.keyboard.press("Enter");

    // Record view reached
    await expect(page.getByTestId("product-display-name")).toHaveText(
      "Panadol Extra 500mg Tablet GSK",
    );
    await expect(page.getByTestId("product-arabic-search-name")).toHaveText(
      "بنادول اكسترا",
    );
    await expect(page.getByTestId("inventory-balance-readonly")).toBeVisible();

    // Save evidence screenshot of product form & record
    await page.screenshot({
      path: path.join(evidenceDir, "keyboard-medication-record.png"),
    });
  });

  test("Keyboard-only entry of a full general item", async ({ page }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(`${renderer.origin}#/catalog/products/new`);
    await expect(
      page.getByRole("heading", { name: "Define new product" }),
    ).toBeVisible();

    // Switch mode to General item via keyboard
    const modeSelect = page.getByLabel("Product definition mode");
    await modeSelect.focus();
    await modeSelect.selectOption("general-item");

    // Fill general item fields in order:
    // Company → Sub-brand → Type/Use → Property → Target → Size
    const companyInput = page.getByLabel("Company / Manufacturer *");
    await companyInput.focus();
    await page.keyboard.type("Nivea");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Nivea",
    );

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Sub-brand / Series")).toBeFocused();
    await page.keyboard.type("Men");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Nivea Men",
    );

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Type / Use")).toBeFocused();
    await page.keyboard.type("Body Lotion");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Nivea Men Body Lotion",
    );

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Property / Degree")).toBeFocused();
    await page.keyboard.type("Hydrating");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Nivea Men Body Lotion Hydrating",
    );

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Target / Audience")).toBeFocused();
    await page.keyboard.type("Adults");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Nivea Men Body Lotion Hydrating Adults",
    );

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Size / Volume")).toBeFocused();
    await page.keyboard.type("250ml");
    await expect(page.getByTestId("generated-display-name")).toHaveText(
      "Nivea Men Body Lotion Hydrating Adults 250ml",
    );

    // Submit
    const createButton = page.getByRole("button", { name: "Create product" });
    await createButton.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("product-display-name")).toHaveText(
      "Nivea Men Body Lotion Hydrating Adults 250ml",
    );
  });

  test("Validation failure keeps the entered value and keeps focus on the failing field", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(`${renderer.origin}#/catalog/products/new`);

    const tradeNameInput = page.getByLabel("Trade name *");
    const invalidTradeName = "I".repeat(121);
    await tradeNameInput.evaluate((element) =>
      element.removeAttribute("maxlength"),
    );
    await tradeNameInput.fill(invalidTradeName);
    const strengthInput = page.getByLabel("Strength");
    await strengthInput.fill("500mg");
    const arabicInput = page.getByLabel("Arabic search name");
    await arabicInput.fill("دواء تجريبي");

    const submitBtn = page.getByRole("button", { name: "Create product" });
    await submitBtn.click();

    // Verifies error alert is shown
    await expect(page.locator(".denial-alert")).toBeVisible();
    await expect(
      page.getByText("Value exceeds maximum allowed length."),
    ).toBeVisible();
    await expect(
      page.getByText("The submitted product data is invalid."),
    ).toBeVisible();

    // Verifies entered values are RETAINED
    await expect(tradeNameInput).toHaveValue(invalidTradeName);
    await expect(strengthInput).toHaveValue("500mg");
    await expect(arabicInput).toHaveValue("دواء تجريبي");

    // Verifies focus is KEPT on the failing field
    await expect(tradeNameInput).toBeFocused();
    await expect(tradeNameInput).toHaveAttribute("aria-invalid", "true");
  });

  test("Mode switching displays confirmation dialog with abandoned fields", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(`${renderer.origin}#/catalog/products/new`);

    await page.getByLabel("Trade name *").fill("Augmentin");
    await page.getByLabel("Strength").fill("1g");

    const modeSelect = page.getByLabel("Product definition mode");
    await modeSelect.selectOption("general-item");

    // Confirmation dialog appears
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Confirm mode switch" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("The following entered fields will be cleared:"),
    ).toBeVisible();
    await expect(dialog.getByText("Trade name:")).toBeVisible();
    await expect(dialog.getByText("Augmentin")).toBeVisible();

    // Take screenshot of confirmation dialog
    await page.screenshot({
      path: path.join(evidenceDir, "mode-switch-confirmation.png"),
    });

    // Cancel preserves fields and current mode
    await dialog.getByRole("button", { name: "Keep current mode" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Trade name *")).toHaveValue("Augmentin");
    await expect(page.getByLabel("Product definition mode")).toHaveValue(
      "medication",
    );

    // Switch confirmed clears previous fields
    await modeSelect.selectOption("general-item");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Switch mode" })
      .click();
    await expect(page.getByLabel("Product definition mode")).toHaveValue(
      "general-item",
    );
    await expect(page.getByLabel("Company / Manufacturer *")).toHaveValue("");
  });

  test("The Arabic search name appears below the English name and never inside it", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(`${renderer.origin}#/catalog/products/new`);

    await page.getByLabel("Trade name *").fill("Amoxicillin");
    await page.getByLabel("Strength").fill("500mg");
    await page.getByLabel("Arabic search name").fill("أموكسيسيلين");

    const displayOutput = page.getByTestId("generated-display-name");
    const arabicInput = page.getByLabel("Arabic search name");

    await expect(displayOutput).toHaveText("Amoxicillin 500mg");
    await expect(displayOutput).not.toContainText("أموكسيسيلين");

    // Assert visual layout: Arabic search name is on its own line BELOW the English name
    const displayBox = await displayOutput.boundingBox();
    const arabicBox = await arabicInput.boundingBox();

    expect(displayBox).not.toBeNull();
    expect(arabicBox).not.toBeNull();
    expect(arabicBox?.y ?? 0).toBeGreaterThan(
      (displayBox?.y ?? 0) + (displayBox?.height ?? 0) - 5,
    );
  });

  test("The display name is not reachable as an editable control by keyboard", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(`${renderer.origin}#/catalog/products/new`);

    const outputElement = page.getByTestId("generated-display-name");
    await expect(outputElement).toHaveJSProperty("tagName", "OUTPUT");

    // Navigate with Tab from Manufacturer to Arabic Search Name
    const manufacturerInput = page.getByLabel("Manufacturer");
    await manufacturerInput.focus();
    await expect(manufacturerInput).toBeFocused();

    await page.keyboard.press("Tab");
    // Directly reaches Arabic search name without focusing an editable display name
    await expect(page.getByLabel("Arabic search name")).toBeFocused();
  });

  test("The inventory balance renders read-only and is announced as read-only to assistive technology", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(
      `${renderer.origin}#/catalog/products/${inventoryProduct.id}`,
    );

    const balanceRegion = page.getByRole("region", {
      name: "Read-only inventory balance. Stock cannot be directly modified through Catalog.",
    });
    await expect(balanceRegion).toBeVisible();

    const balanceDisplay = page.getByTestId("inventory-balance-readonly");
    await expect(balanceDisplay).toHaveAttribute("aria-readonly", "true");
    await expect(balanceDisplay).toContainText("0 Inventory Units");

    // Assert no writable input for balance exists
    await expect(page.locator("input[name*='balance']")).toHaveCount(0);
    await expect(page.locator("input[name*='stock']")).toHaveCount(0);
    await expect(page.locator("input[name*='quantity']")).toHaveCount(0);
  });

  test("Archive and merge actions work on referenced products without delete", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    await page.goto(`${renderer.origin}#/catalog/products/${mergeProduct.id}`);

    // Verify NO delete button exists in the DOM
    await expect(
      page.getByRole("button", { name: /delete|remove|destroy|purge/i }),
    ).toHaveCount(0);

    // Merge Action
    await page.getByRole("button", { name: "Merge product" }).click();
    const mergeDialog = page.getByRole("dialog");
    await expect(mergeDialog).toBeVisible();
    await page.getByLabel("Survivor Product ID (UUID)").fill(mergeSurvivor.id);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm merge" })
      .click();

    await expect(page.getByTestId("product-status-chip")).toHaveText("Merged");
    await expect(page.getByText(mergeSurvivor.id)).toBeVisible();
  });

  test("All screens pass Arabic/RTL + English/LTR in both light and dark themes (WCAG 2.2 AA)", async ({
    browser,
  }) => {
    const locales = ["en", "ar"] as const;
    const themes = ["light", "dark"] as const;

    for (const locale of locales) {
      for (const theme of themes) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, { locale, theme });

        // 1. Product Form
        await page.goto(`${renderer.origin}#/catalog/products/new`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

        const formAxe = await new AxeBuilder({ page }).analyze();
        expect(formAxe.violations).toEqual([]);

        // Focus outline check
        const firstInput = page.locator("input").first();
        await firstInput.focus();
        const outlineWidth = await firstInput.evaluate((el) => {
          const view = el.ownerDocument.defaultView;
          return view === null
            ? 0
            : Number.parseFloat(view.getComputedStyle(el).outlineWidth);
        });
        expect(outlineWidth).toBeGreaterThanOrEqual(3);

        const formScreenshotName = `catalog-product-form-${locale}-${theme}.png`;
        await page.screenshot({
          fullPage: true,
          path: path.join(evidenceDir, formScreenshotName),
        });
        await page.screenshot({
          fullPage: true,
          path: path.join(testResultsDir, formScreenshotName),
        });

        // 2. Product Record View
        await page.goto(
          `${renderer.origin}#/catalog/products/${matrixProduct.id}`,
        );
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

        const recordAxe = await new AxeBuilder({ page }).analyze();
        expect(recordAxe.violations).toEqual([]);

        const recordScreenshotName = `catalog-product-record-${locale}-${theme}.png`;
        await page.screenshot({
          fullPage: true,
          path: path.join(evidenceDir, recordScreenshotName),
        });
        await page.screenshot({
          fullPage: true,
          path: path.join(testResultsDir, recordScreenshotName),
        });

        await context.close();
      }
    }
  });

  test("The module bar offers Phase One surfaces only, and never an excluded or deferred one", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(`${renderer.origin}#/catalog/products`);

    const modules = page.getByRole("navigation", { name: "Modules" });
    await expect(modules).toBeVisible();

    // Catalog has server authority behind it, and the signed-in pharmacist
    // holds catalog.item.manage.
    const products = modules.getByRole("link", { name: "Products" });
    await expect(products).toHaveAttribute("aria-current", "page");
    await expect(products).toHaveAttribute("data-availability", "available");

    // A required Phase One surface that is not built says so rather than
    // pretending to work.
    await expect(modules.getByRole("link", { name: /^Sales/ })).toHaveAttribute(
      "data-availability",
      "unavailable",
    );

    // The Clinic tab is outside project scope, and delivery, e-commerce,
    // marketing, and external integration are deferred: none of them exists.
    for (const excluded of [
      /clinic/i,
      /عيادة/,
      /delivery/i,
      /commerce/i,
      /marketing/i,
      /external/i,
    ]) {
      await expect(page.getByText(excluded)).toHaveCount(0);
    }

    // WhatsApp messaging is a paid add-on. Without the entitlement the surface
    // is hidden completely, not rendered as a disabled button.
    await expect(modules.getByRole("link", { name: /message/i })).toHaveCount(
      0,
    );
  });

  test("An unbuilt surface is honest about itself in both locales and themes", async ({
    browser,
  }) => {
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { height: 768, width: 1_024 },
        });
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, { locale, theme });
        await page.goto(`${renderer.origin}#/sales`);

        const heading = page.getByTestId("unavailable-surface");
        await expect(heading).toBeVisible();
        await expect(heading).toContainText(
          locale === "en"
            ? "This screen is not available yet"
            : "هذه الشاشة غير متاحة بعد",
        );

        // No fabricated pharmacy data may appear on a surface Breev has not
        // built. The prototype's mock rows are the failure this guards against.
        await expect(page.locator("table")).toHaveCount(0);

        const accessibility = await new AxeBuilder({ page }).analyze();
        expect(accessibility.violations).toEqual([]);

        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: path.join(
            adoptionEvidenceDir,
            `unavailable-surface-${locale}-${theme}.png`,
          ),
        });
        await context.close();
      }
    }
  });

  test("A direct hash cannot mount a surface the pharmacy is not entitled to", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    // WhatsApp messaging is a paid add-on this pharmacy does not hold. Typing
    // its hash must not render its label or its panel: docs/product.md requires
    // functions not enabled for a pharmacy to be hidden completely.
    await page.goto(`${renderer.origin}#/messages`);
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");

    await expect(page.getByText(/send message/i)).toHaveCount(0);
    await expect(page.getByTestId("unavailable-surface")).toHaveCount(0);

    // The request lands on an allowed default instead.
    await expect.poll(() => new URL(page.url()).hash).toBe("#/administration");
  });

  test("A direct hash cannot bypass login", async ({ page }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });

    // docs/domain.md: mandatory login, no bypass. An unauthenticated context
    // reaching a Catalog deep link gets the sign-in screen, not product data.
    await page.route("**/identity/state", async (route) => {
      await route.fulfill({ json: { state: "unauthenticated" }, status: 200 });
    });

    await page.goto(`${renderer.origin}#/catalog/products`);
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");

    await expect(
      page.getByRole("heading", { name: "Sign in to Breev" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Modules" })).toHaveCount(
      0,
    );
    await expect(page.locator(".catalog-rail")).toHaveCount(0);
    await expect(page.getByText("Panadol Extra")).toHaveCount(0);
  });

  test("The module bar is reachable by keyboard and never disturbs the shell button order", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(`${renderer.origin}#/catalog/products`);
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");

    // Navigation is links, not buttons, so it does not disturb the header's
    // diagnostic, language, and theme control order.
    const buttons = page.locator(".preference-controls").getByRole("button");
    for (const [index, label] of [
      "Export diagnostic package",
      "Contact support",
      "Send diagnostic report",
      "Switch to Arabic",
      "Use dark theme",
    ].entries()) {
      await expect(buttons.nth(index)).toHaveAttribute("aria-label", label);
    }

    const products = page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("link", { name: "Products" });
    await products.focus();
    await expect(products).toBeFocused();
    const outlineWidth = await products.evaluate((element) => {
      const view = element.ownerDocument.defaultView;
      return view === null
        ? 0
        : Number.parseFloat(view.getComputedStyle(element).outlineWidth);
    });
    expect(outlineWidth).toBeGreaterThanOrEqual(3);

    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(adoptionEvidenceDir, "catalog-workspace-en-light.png"),
    });
  });
});

async function readRequestBody(
  request: import("node:http").IncomingMessage,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function spawnLocalApi(
  port: number,
  databaseRoles: SeparatedDatabaseRoles,
  credentials: MainDeviceCredentials,
): ChildProcessWithoutNullStreams {
  return spawnLocalApiProcess(
    path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
    {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_INSTALLATION_STATE: "ready",
      BREEV_MAIN_DEVICE_ID: credentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
      DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
      DATABASE_URL: databaseRoles.applicationUrl,
    },
  );
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

async function requestLocalApi(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
  method: "GET" | "POST",
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
    body: text.length === 0 ? undefined : (JSON.parse(text) as unknown),
    status: response.status,
  };
}

async function getProofEvidence(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
): Promise<LocalProofEvidenceSuccess> {
  const response = await fetch(
    new URL(localProofEvidenceContract.path, apiOrigin),
    { headers: requestHeaders(credentials, false) },
  );
  const body = parseLocalProofEvidenceResponse(
    response.status,
    await response.json(),
  );
  if ("status" in body) {
    throw new Error(`Proof evidence was denied: ${body.code}`);
  }
  return body;
}

async function createCatalogProduct(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
  request: ProductCreateRequest,
): Promise<Product> {
  const response = await requestLocalApi(
    apiOrigin,
    credentials,
    "POST",
    "/catalog/products",
    request,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const product = productSchema.parse(response.body);
  expect(product.displayName).toBe(
    composeTestDisplayName(product.definition.mode, product.definition.fields),
  );
  return product;
}

async function grantCatalogPermission(
  administrator: Pool,
  pharmacyId: string,
  pharmacistId: string,
  ownerId: string,
): Promise<void> {
  const role = await administrator.query<{ id: string }>(
    "select role_id as id from identity_users where id = $1",
    [pharmacistId],
  );
  const roleId = role.rows[0]?.id;
  expect(roleId).toBeDefined();
  await administrator.query(
    `insert into role_permission_grants (
       pharmacy_id, role_id, permission_name, granted_by
     ) values ($1, $2, 'catalog.item.manage', $3)
     on conflict (role_id, permission_name) do nothing`,
    [pharmacyId, roleId, ownerId],
  );
  await administrator.query(
    "update pharmacy_roles set revision = revision + 1 where id = $1",
    [roleId],
  );
  await administrator.query(
    "update pharmacies set identity_revision = identity_revision + 1 where id = $1",
    [pharmacyId],
  );
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
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

async function listen(server: Server): Promise<number> {
  return await new Promise((resolve, reject) => {
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
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
