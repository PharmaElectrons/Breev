import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  FREE_CORE_CAPABILITY_NAMES,
  PRODUCT_NAME_TEMPLATES,
  composeDisplayName,
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  type IdentityAuthenticatedState,
  type Product,
  type ProductCreateRequest,
  type ProductDefinitionMode,
  type ProductEditRequest,
} from "@breev/contracts/local-rest";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

const PHARMACY_ID = "019b0000-0000-7000-8000-000000000401";

function composeTestDisplayName(
  mode: ProductDefinitionMode,
  fields: Readonly<Record<string, string | null | undefined>>,
): string {
  return composeDisplayName(
    PRODUCT_NAME_TEMPLATES[CURRENT_PRODUCT_NAME_TEMPLATE_VERSION][mode],
    fields,
  );
}

interface CatalogTestRenderer {
  readonly origin: string;
  readonly server: Server;
}

/**
 * Single network boundary interception helper for Catalog routes.
 *
 * All catalog REST routes are intercepted exclusively through this helper so
 * that when the parallel server lane lands, this interception can be removed
 * or pointed at the real local API without altering test logic.
 */
export async function stubCatalogRoutes(
  page: Page,
  options?: {
    readonly failValidationOnTradeName?: boolean;
    readonly initialProducts?: Product[];
  },
): Promise<{ getProducts: () => Product[] }> {
  const products: Product[] = [...(options?.initialProducts ?? [])];

  await page.route("**/catalog/products**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/catalog/products") {
      await route.fulfill({
        json: { products },
        status: 200,
      });
      return;
    }

    if (method === "POST" && pathname === "/catalog/products") {
      const body = request.postDataJSON() as ProductCreateRequest;

      if (
        options?.failValidationOnTradeName &&
        body.definition.mode === "medication" &&
        body.definition.fields.tradeName.includes("INVALID")
      ) {
        await route.fulfill({
          json: {
            code: "body-invalid",
            fieldErrors: [
              {
                code: "invalid",
                path: ["definition", "fields", "tradeName"],
              },
            ],
            requestId: "019b0000-0000-7000-8000-000000000099",
            status: "denied",
          },
          status: 400,
        });
        return;
      }

      const displayName =
        body.definition.mode === "medication"
          ? composeTestDisplayName("medication", body.definition.fields)
          : composeTestDisplayName("general-item", body.definition.fields);

      const created: Product = {
        arabicSearchName: body.arabicSearchName,
        barcodes: body.barcodes,
        category: body.category,
        definition: body.definition,
        displayName,
        id: "019b0000-0000-7000-8000-000000000888",
        instructions: body.instructions,
        mergedIntoProductId: null,
        nameTemplateVersion: 1,
        revision: "1",
        scientificName: body.scientificName,
        sharing: body.sharing,
        stateColours: body.stateColours,
        status: "active",
      };
      products.push(created);

      await route.fulfill({
        json: created,
        status: 201,
      });
      return;
    }

    const itemMatch = pathname.match(/^\/catalog\/products\/([^/]+)$/);
    if (method === "GET" && itemMatch) {
      const id = itemMatch[1];
      const found = products.find((p) => p.id === id);
      if (found) {
        await route.fulfill({ json: found, status: 200 });
      } else {
        await route.fulfill({
          json: {
            code: "product-not-found",
            fieldErrors: [],
            requestId: "019b0000-0000-7000-8000-000000000098",
            status: "denied",
          },
          status: 404,
        });
      }
      return;
    }

    if (method === "PUT" && itemMatch) {
      const id = itemMatch[1];
      const body = request.postDataJSON() as ProductEditRequest;
      const index = products.findIndex((p) => p.id === id);
      const existing = products[index];
      if (!existing) {
        await route.fulfill({
          json: {
            code: "product-not-found",
            fieldErrors: [],
            requestId: "019b0000-0000-7000-8000-000000000097",
            status: "denied",
          },
          status: 404,
        });
        return;
      }

      const displayName =
        body.definition.mode === "medication"
          ? composeTestDisplayName("medication", body.definition.fields)
          : composeTestDisplayName("general-item", body.definition.fields);

      const updated: Product = {
        ...existing,
        arabicSearchName: body.arabicSearchName,
        barcodes: body.barcodes,
        category: body.category,
        definition: body.definition,
        displayName,
        instructions: body.instructions,
        revision: String(Number(existing.revision) + 1),
        scientificName: body.scientificName,
        sharing: body.sharing,
        stateColours: body.stateColours,
      };
      products[index] = updated;

      await route.fulfill({ json: updated, status: 200 });
      return;
    }

    const archiveMatch = pathname.match(
      /^\/catalog\/products\/([^/]+)\/archivals$/,
    );
    if (method === "POST" && archiveMatch) {
      const id = archiveMatch[1];
      const index = products.findIndex((p) => p.id === id);
      const existing = products[index];
      if (existing) {
        const updated: Product = {
          ...existing,
          revision: String(Number(existing.revision) + 1),
          status: "archived",
        };
        products[index] = updated;
        await route.fulfill({ json: updated, status: 201 });
      } else {
        await route.fulfill({ status: 404 });
      }
      return;
    }

    const mergeMatch = pathname.match(/^\/catalog\/products\/([^/]+)\/merges$/);
    if (method === "POST" && mergeMatch) {
      const id = mergeMatch[1];
      const body = request.postDataJSON() as { survivorProductId: string };
      const index = products.findIndex((p) => p.id === id);
      const existing = products[index];
      if (existing) {
        const updated: Product = {
          ...existing,
          mergedIntoProductId: body.survivorProductId,
          revision: String(Number(existing.revision) + 1),
          status: "merged",
        };
        products[index] = updated;
        await route.fulfill({ json: updated, status: 201 });
      } else {
        await route.fulfill({ status: 404 });
      }
      return;
    }

    await route.continue();
  });

  return {
    getProducts: () => products,
  };
}

function sampleMedicationProduct(): Product {
  return {
    arabicSearchName: "بنادول اكسترا باراسيتامول وكافيين",
    barcodes: ["5000167000001", "5000167000002"],
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
    displayName: "Panadol Extra 500mg/65mg Film Coated Tablet GSK",
    id: "019b0000-0000-7000-8000-000000000101",
    instructions: {
      foodTiming: "after-food",
      usesPerDay: 3,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    mergedIntoProductId: null,
    nameTemplateVersion: 1,
    revision: "1",
    scientificName: "Paracetamol + Caffeine",
    sharing: {
      aiSharingAllowed: true,
      externallyVisible: true,
    },
    stateColours: {
      coldStorageRequired: false,
      manual: "blue",
    },
    status: "active",
  };
}

function authenticatedIdentityState(): IdentityAuthenticatedState {
  return {
    allowedPermissions: [
      "attendance.record",
      "catalog.item.manage",
      "devices.pair",
      "identity.roles.manage",
      "identity.users.manage",
      "licensing.manage",
      "pharmacy.settings.manage",
    ],
    attendance: null,
    entitlement: {
      capabilities: [...FREE_CORE_CAPABILITY_NAMES],
      licence: null,
      status: "free-core",
    },
    pharmacy: {
      id: PHARMACY_ID,
      name: "Breev Catalog Pharmacy",
    },
    session: {
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "019b0000-0000-7000-8000-000000000405",
    },
    settings: { attendanceEnabled: false, revision: "1" },
    state: "authenticated",
    user: {
      displayName: "Pharmacist Manager",
      id: "019b0000-0000-7000-8000-000000000403",
      revision: "1",
      role: "pharmacist",
      status: "active",
      username: "pharmacist.lead",
    },
  };
}

async function startCatalogRenderer(): Promise<CatalogTestRenderer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  const authState = authenticatedIdentityState();

  const server = createServer(async (request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          apiVersion: LOCAL_API_VERSION,
          database: "available",
          schemaVersion: LOCAL_SCHEMA_VERSION,
          status: "healthy",
        }),
      );
      return;
    }

    if (request.url === "/identity/state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(authState));
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
    const file = path.resolve(rendererRoot, `.${cleanPath}`);
    const extension = path.extname(file);

    try {
      const content = await readFile(file);
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
      response.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve a renderer port");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function setupPage(
  page: Page,
  origin: string,
  options?: {
    readonly locale?: "ar" | "en";
    readonly theme?: "dark" | "light";
  },
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
        getStartupConfig: async () => ({
          localApiOrigin: apiOrigin,
          role: "main" as const,
        }),
        getTerminalPairingState: async () => unpairedState,
        submitManualEndpoint: async () => unpairedState,
        submitPairingInvitation: async () => unpairedState,
      });

      Object.defineProperty(globalThis, "breevDesktop", {
        configurable: false,
        value: desktopApi,
        writable: false,
      });
    },
    { apiOrigin: origin, initialLocale: locale, initialTheme: theme },
  );
}

test.describe.serial("Product catalog screens", () => {
  let renderer: CatalogTestRenderer;
  const evidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/issue-45/after",
  );
  const testResultsDir = path.resolve(
    import.meta.dirname,
    "../../../../test-results/desktop-browser",
  );

  test.beforeAll(async () => {
    await mkdir(evidenceDir, { recursive: true });
    await mkdir(testResultsDir, { recursive: true });
    renderer = await startCatalogRenderer();
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      renderer.server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  test("Keyboard-only entry of a full medication, start to submit — no mouse", async ({
    page,
  }) => {
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page);

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
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page);

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
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page, { failValidationOnTradeName: true });

    await page.goto(`${renderer.origin}#/catalog/products/new`);

    const tradeNameInput = page.getByLabel("Trade name *");
    await tradeNameInput.fill("INVALID_DRUG_NAME");
    const strengthInput = page.getByLabel("Strength");
    await strengthInput.fill("500mg");
    const arabicInput = page.getByLabel("Arabic search name");
    await arabicInput.fill("دواء تجريبي");

    const submitBtn = page.getByRole("button", { name: "Create product" });
    await submitBtn.click();

    // Verifies error alert is shown
    await expect(page.locator(".denial-alert")).toBeVisible();
    await expect(page.getByText("Invalid value.")).toBeVisible();
    await expect(
      page.getByText("The submitted product data is invalid."),
    ).toBeVisible();

    // Verifies entered values are RETAINED
    await expect(tradeNameInput).toHaveValue("INVALID_DRUG_NAME");
    await expect(strengthInput).toHaveValue("500mg");
    await expect(arabicInput).toHaveValue("دواء تجريبي");

    // Verifies focus is KEPT on the failing field
    await expect(tradeNameInput).toBeFocused();
    await expect(tradeNameInput).toHaveAttribute("aria-invalid", "true");
  });

  test("Mode switching displays confirmation dialog with abandoned fields", async ({
    page,
  }) => {
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page);

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
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page);

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
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page);

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
    const initialProduct = sampleMedicationProduct();
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page, { initialProducts: [initialProduct] });

    await page.goto(
      `${renderer.origin}#/catalog/products/${initialProduct.id}`,
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
    const product = sampleMedicationProduct();
    await setupPage(page, renderer.origin, { locale: "en", theme: "light" });
    await stubCatalogRoutes(page, { initialProducts: [product] });

    await page.goto(`${renderer.origin}#/catalog/products/${product.id}`);

    // Verify NO delete button exists in the DOM
    await expect(
      page.getByRole("button", { name: /delete|remove|destroy|purge/i }),
    ).toHaveCount(0);

    // Merge Action
    await page.getByRole("button", { name: "Merge product" }).click();
    const mergeDialog = page.getByRole("dialog");
    await expect(mergeDialog).toBeVisible();
    await page
      .getByLabel("Survivor Product ID (UUID)")
      .fill("019b0000-0000-7000-8000-000000000999");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm merge" })
      .click();

    await expect(page.getByTestId("product-status-chip")).toHaveText("Merged");
    await expect(
      page.getByText("019b0000-0000-7000-8000-000000000999"),
    ).toBeVisible();
  });

  test("All screens pass Arabic/RTL + English/LTR in both light and dark themes (WCAG 2.2 AA)", async ({
    browser,
  }) => {
    const medication = sampleMedicationProduct();
    const locales = ["en", "ar"] as const;
    const themes = ["light", "dark"] as const;

    for (const locale of locales) {
      for (const theme of themes) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await setupPage(page, renderer.origin, { locale, theme });
        await stubCatalogRoutes(page, { initialProducts: [medication] });

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
          `${renderer.origin}#/catalog/products/${medication.id}`,
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
});
