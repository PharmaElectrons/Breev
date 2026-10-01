/* global window, document */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve(
  import.meta.dirname,
  "../../../.scratch/ui-screenshots",
);
await mkdir(OUT_DIR, { recursive: true });

const PHARMACY_ID = "019b0000-0000-7000-8000-000000000301";
const DEVICE_ID = "019b0000-0000-7000-8000-000000000302";

const ALL_PERMISSIONS = [
  "identity.users.manage",
  "identity.roles.manage",
  "pharmacy.settings.manage",
  "catalog.item.manage",
  "catalog.item.search",
  "sales.drafts.manage",
  "purchases.adjustments.manage",
  "purchases.drafts.manage",
  "purchases.posted.view",
  "purchases.returns.manage",
  "purchases.costs.view",
  "suppliers.manage",
  "inventory.review",
  "inventory.valuation.view",
  "inventory.batch_safety.manage",
  "inventory.counts.record",
  "inventory.counts.approve",
  "inventory.reorder.manage",
  "inventory.reorder.confirm",
  "attendance.record",
  "devices.pair",
  "licensing.manage",
];

const mockState = {
  allowedPermissions: ALL_PERMISSIONS,
  attendance: null,
  entitlement: {
    capabilities: [
      "renewal",
      "additional-device-pos",
      "one-way-cloud-sync",
      "purchase-invoice-ocr",
    ],
    licence: {
      expiresAt: "2099-01-01T00:00:00.000Z",
      features: ["additional-device-pos", "one-way-cloud-sync"],
      formatVersion: 1,
      founderOverrideGrants: ["purchase-invoice-ocr"],
      graceEndsAt: "2099-01-08T00:00:00.000Z",
      issuedAt: "2026-01-01T00:00:00.000Z",
      keyId: "browser-test",
      licenceId: "019b0000-0000-7000-8000-000000000305",
      mainDeviceId: DEVICE_ID,
      permittedDeviceCount: 3,
      pharmacyId: PHARMACY_ID,
      plan: "professional",
    },
    status: "licensed",
  },
  pharmacy: { id: PHARMACY_ID, name: "Al-Amal Central Pharmacy" },
  session: {
    expiresAt: "2099-01-01T00:00:00.000Z",
    id: "019b0000-0000-7000-8000-000000000303",
  },
  settings: { attendanceEnabled: true, revision: "1" },
  state: "authenticated",
  user: {
    displayName: "Dr. Ahmed Pharmacist",
    id: "019b0000-0000-7000-8000-000000000304",
    revision: "1",
    role: {
      id: "019b0000-0000-7000-8000-000000000010",
      key: "owner",
      kind: "built-in",
    },
    status: "active",
    username: "ahmed.owner",
  },
};

const mockRoles = {
  permissions: ALL_PERMISSIONS,
  roles: [
    {
      id: "019b0000-0000-7000-8000-000000000010",
      key: "owner",
      kind: "built-in",
      grants: ALL_PERMISSIONS,
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000011",
      key: "manager",
      kind: "built-in",
      grants: [
        "sales.drafts.manage",
        "purchases.drafts.manage",
        "inventory.review",
        "attendance.record",
      ],
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000012",
      key: "pharmacist",
      kind: "built-in",
      grants: [
        "catalog.item.manage",
        "catalog.item.search",
        "sales.drafts.manage",
        "inventory.review",
        "inventory.counts.record",
        "attendance.record",
      ],
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000013",
      key: "sales_employee",
      kind: "built-in",
      grants: ["sales.drafts.manage", "attendance.record"],
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000014",
      key: "purchasing_employee",
      kind: "built-in",
      grants: [
        "purchases.drafts.manage",
        "purchases.posted.view",
        "attendance.record",
      ],
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000015",
      key: "inventory_employee",
      kind: "built-in",
      grants: [
        "inventory.review",
        "inventory.counts.record",
        "attendance.record",
      ],
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000016",
      key: "accountant",
      kind: "built-in",
      grants: [
        "purchases.costs.view",
        "inventory.valuation.view",
        "attendance.record",
      ],
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000017",
      key: "support",
      kind: "built-in",
      grants: ["attendance.record"],
      revision: "1",
    },
    {
      id: "019b0000-0000-7000-8000-000000000099",
      kind: "custom",
      name: "Night Shift Leader",
      grants: ["sales.drafts.manage", "attendance.record"],
      revision: "1",
    },
  ],
};

const rendererRoot = path.resolve(import.meta.dirname, "../out/renderer");
const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        apiVersion: "18",
        database: "available",
        schemaVersion: "18",
        status: "healthy",
      }),
    );
    return;
  }
  if (req.url === "/identity/state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(mockState));
    return;
  }
  if (req.url === "/identity/roles") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(mockRoles));
    return;
  }
  if (req.url?.startsWith("/devices")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ devices: [], seatUsage: { permitted: 3, used: 1 } }),
    );
    return;
  }
  if (req.url === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }

  const pathname = req.url === "/" ? "/index.html" : req.url?.split("?")[0];
  const file = path.resolve(rendererRoot, `.${pathname}`);
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type":
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext.startsWith(".woff")
              ? "font/woff2"
              : "text/javascript; charset=utf-8",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
console.log(`Server listening on ${origin}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});

const page = await context.newPage();

await page.addInitScript(
  ({ apiOrigin }) => {
    localStorage.setItem("breev.locale", "en");
    localStorage.setItem("breev.theme", "light");
    const pairing = { candidates: [], stage: "awaiting-invitation" };
    const desktopApi = {
      cancelTerminalPairing: async () => pairing,
      copyIdentifier: async () => ({ copied: true }),
      exportDiagnostics: async () => ({ status: "saved" }),
      getStartupConfig: async () => ({
        deviceId: "019b0000-0000-7000-8000-000000000302",
        diagnosticReporting: "disabled",
        installationId: "019b0000-0000-7000-8000-000000000399",
        localApiOrigin: apiOrigin,
        role: "main",
      }),
      getTerminalPairingState: async () => pairing,
      openSupport: async () => ({ status: "unavailable" }),
      printBarcodeLabel: async () => ({ status: "handed-off" }),
      reportRendererIncident: async () => ({ accepted: true }),
      saveInventoryExport: async () => ({ status: "saved" }),
      submitDiagnostics: async () => ({ status: "unavailable" }),
      submitManualEndpoint: async () => pairing,
      submitPairingInvitation: async () => pairing,
    };
    Object.defineProperty(globalThis, "breevDesktop", {
      configurable: false,
      value: desktopApi,
      writable: false,
    });
  },
  { apiOrigin: origin },
);

page.on("console", (msg) => console.log("PAGE LOG:", msg.type(), msg.text()));
page.on("pageerror", (err) => console.error("PAGE ERROR:", err));

// 1. Visit Home (dashboard)
await page.goto(`${origin}/#/dashboard`);
await page.waitForSelector(".home-dashboard");
await page.screenshot({ path: path.join(OUT_DIR, "01-home-dashboard.png") });
console.log("Captured 01-home-dashboard.png");

// 2. Open Menu with Connection Status
const menuTrigger = page.locator("[data-testid='collapse-menu-trigger']");
await menuTrigger.click();
await page.waitForSelector(".collapse-menu-connection");
await page.screenshot({
  path: path.join(OUT_DIR, "02-menu-connection-open.png"),
});
console.log("Captured 02-menu-connection-open.png");

// Close menu
await menuTrigger.click();
await page.waitForTimeout(300);

// 3. Visit Settings -> Roles & Permissions
console.log("Navigating to settings/roles...");
await page.evaluate(() => {
  window.location.hash = "#/settings/roles";
});
try {
  await page.waitForSelector(".permission-subset-tabs", { timeout: 5000 });
} catch (e) {
  console.error("Failed to find .permission-subset-tabs. Current HTML:");
  const currentUrl = page.url();
  console.log("Current URL:", currentUrl);
  await page.screenshot({
    path: path.join(OUT_DIR, "debug-settings-failure.png"),
  });
  const html = await page.content();
  console.log("HTML snippet:", html.slice(0, 1000));
  throw e;
}
await page.screenshot({
  path: path.join(OUT_DIR, "03-settings-roles-owner.png"),
});
console.log("Captured 03-settings-roles-owner.png");

// 4. Click "Products" subset tab under roles
const productsSubtab = page.locator(
  "[data-testid='permission-subset-tab-products']",
);
await productsSubtab.click();
await page.waitForTimeout(300);
const tabsInfo = await page.evaluate(() => {
  const tabs = Array.from(
    document.querySelectorAll(".permission-subtab-trigger"),
  );
  return tabs.map((t) => ({
    text: t.textContent?.trim(),
    attributes: Array.from(t.attributes).map((a) => a.name + "=" + a.value),
  }));
});
console.log("Tabs info after click:", JSON.stringify(tabsInfo, null, 2));
await page.screenshot({
  path: path.join(OUT_DIR, "04-roles-products-subset.png"),
});
console.log("Captured 04-roles-products-subset.png");

// 5. Click "Purchasing and suppliers" subset tab
const purchasingSubtab = page.locator(
  "[data-testid='permission-subset-tab-purchasing']",
);
await purchasingSubtab.click();
await page.waitForTimeout(300);
const tabsInfo5 = await page.evaluate(() => {
  const tabs = Array.from(
    document.querySelectorAll(".permission-subtab-trigger"),
  );
  return tabs.map((t) => ({
    text: t.textContent?.trim(),
    attributes: Array.from(t.attributes).map((a) => a.name + "=" + a.value),
  }));
});
console.log(
  "Tabs info after purchasing click:",
  JSON.stringify(tabsInfo5, null, 2),
);
const saveBtnBox = await page
  .locator("button:has-text('Save permissions')")
  .boundingBox();
console.log("Save button bounding box:", saveBtnBox);
await page.screenshot({
  path: path.join(OUT_DIR, "05-roles-purchasing-subset.png"),
});
console.log("Captured 05-roles-purchasing-subset.png");

// 5b. Test Add Role Modal Popup Card
console.log("Clicking Add role button...");
await page.click("#add-role-button");
await page.waitForSelector(".new-role-dialog-card");
await page.screenshot({
  path: path.join(OUT_DIR, "13-add-role-popup-modal.png"),
});
console.log("Captured 13-add-role-popup-modal.png");

// Click Products subset inside the modal
const modalProductsTab = page.locator(
  ".new-role-dialog-card [data-testid='permission-subset-tab-products']",
);
await modalProductsTab.click();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(OUT_DIR, "14-add-role-modal-products-subset.png"),
});
console.log("Captured 14-add-role-modal-products-subset.png");

// Close modal with Cancel button
await page.click(".new-role-dialog-card button:has-text('Cancel')");
await page.waitForTimeout(300);

// 6. Visit Settings -> Connection status tab
const connectionTabTrigger = page.locator(
  ".settings-tab-list button[role='tab']",
  { hasText: "Connection status" },
);
await connectionTabTrigger.click();
await page.waitForTimeout(300);
const settingsTabsInfo = await page.evaluate(() => {
  const tabs = Array.from(
    document.querySelectorAll('.settings-tab-list button[role="tab"]'),
  );
  return tabs.map((t) => ({
    text: t.textContent?.trim(),
    attributes: Array.from(t.attributes).map((a) => a.name + "=" + a.value),
  }));
});
console.log(
  "Settings tabs info after connection click:",
  JSON.stringify(settingsTabsInfo, null, 2),
);
await page.waitForSelector(".system-overview");
await page.screenshot({
  path: path.join(OUT_DIR, "06-settings-connection-status.png"),
});
console.log("Captured 06-settings-connection-status.png");

// 7. Responsive testing at 1024px width
await page.setViewportSize({ width: 1024, height: 768 });
await page.goto(`${origin}/#/dashboard`);
await page.waitForSelector(".home-dashboard");
await page.screenshot({ path: path.join(OUT_DIR, "07-responsive-1024px.png") });
console.log("Captured 07-responsive-1024px.png");

// 8. Responsive testing at 800px width
await page.setViewportSize({ width: 800, height: 768 });
await page.screenshot({ path: path.join(OUT_DIR, "08-responsive-800px.png") });
console.log("Captured 08-responsive-800px.png");

// 9. Open menu at 800px to ensure menu is positioned nicely and doesn't overlap tabs
await menuTrigger.click();
await page.waitForSelector(".collapse-menu-connection");
await page.screenshot({
  path: path.join(OUT_DIR, "09-responsive-800px-menu-open.png"),
});
console.log("Captured 09-responsive-800px-menu-open.png");

// Close menu
await menuTrigger.click();
await page.waitForTimeout(300);

// 10. Responsive testing at 1260px width (user screenshot scenario)
await page.setViewportSize({ width: 1260, height: 800 });
await page.goto(`${origin}/#/dashboard`);
await page.waitForSelector(".home-dashboard");
await page.screenshot({ path: path.join(OUT_DIR, "10-responsive-1260px.png") });
console.log("Captured 10-responsive-1260px.png");

// 11. Responsive testing at 1260px in settings to match user screenshot exactly
await page.goto(`${origin}/#/settings/connection`);
await page.waitForSelector(".system-overview");
await page.screenshot({ path: path.join(OUT_DIR, "11-settings-1260px.png") });
console.log("Captured 11-settings-1260px.png");

// 12. Full-width testing at 1440px width (1-row mode)
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${origin}/#/dashboard`);
await page.waitForSelector(".home-dashboard");
await page.screenshot({ path: path.join(OUT_DIR, "12-fullwidth-1440px.png") });
console.log("Captured 12-fullwidth-1440px.png");

await browser.close();
server.close();
console.log(
  "All screenshots captured successfully in .scratch/ui-screenshots/",
);
