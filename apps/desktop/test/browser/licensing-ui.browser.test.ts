import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  FREE_CORE_CAPABILITY_NAMES,
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  type IdentityAuthenticatedState,
} from "@breev/contracts/local-rest";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { evidencePath as sharedEvidencePath } from "./evidence-path.js";

const PHARMACY_ID = "019b0000-0000-7000-8000-000000000301";
const DEVICE_ID = "019b0000-0000-7000-8000-000000000302";
const CHALLENGE_ID = "019b0000-0000-7000-8000-000000000306";

interface LicensingRenderer {
  readonly origin: string;
  readonly server: Server;
  setState(state: IdentityAuthenticatedState): void;
}

test.describe("offline licence feature hiding", () => {
  let renderer: LicensingRenderer;

  test.beforeAll(async () => {
    renderer = await startLicensingRenderer(freeCoreState());
    await mkdir(sharedEvidencePath("issue-39/after"), { recursive: true });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      renderer.server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  test("keeps Free Core visible and adds only signed paid capabilities", async ({
    page,
  }) => {
    renderer.setState(freeCoreState());
    await installMainDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);

    await expect(
      page
        .getByRole("region", { name: "Licence status" })
        .getByText("Free Core"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Local sales" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "One-way cloud sync" }),
    ).toHaveCount(0);

    renderer.setState(licensedState());
    await page.reload();
    const paid = page.getByRole("button", { name: "One-way cloud sync" });
    await expect(paid).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Purchase-invoice OCR" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "AI services" })).toHaveCount(
      0,
    );
    await focusWithKeyboard(page, paid);
    await expect(paid).toBeFocused();
    expect(
      await paid.evaluate((element) => {
        const view = element.ownerDocument.defaultView;
        return view === null
          ? 0
          : Number.parseFloat(view.getComputedStyle(element).outlineWidth);
      }),
    ).toBeGreaterThanOrEqual(3);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("licensed-en-light.png"),
    });

    const removeLicence = page.getByRole("button", {
      name: "Remove licence",
    });
    await focusWithKeyboard(page, removeLicence);
    await page.keyboard.press("Enter");
    const stepUp = page.getByRole("dialog");
    await stepUp.getByLabel("Password").fill("browser test password");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "One-way cloud sync" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Local sales" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Licence status" })
        .getByText("Free Core"),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("button", { name: "One-way cloud sync" }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("button", { name: "المبيعات المحلية" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "المزامنة السحابية أحادية الاتجاه",
      }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "استخدام الوضع الفاتح" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "التبديل إلى الإنجليزية" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    renderer.setState(licensedState());
    await page.reload();

    await page.getByRole("button", { name: "Use dark theme" }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("licensed-en-dark.png"),
    });
    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await expect(
      page.getByRole("button", {
        name: "المزامنة السحابية أحادية الاتجاه",
      }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("licensed-ar-dark.png"),
    });

    await page.getByRole("button", { name: "استخدام الوضع الفاتح" }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("licensed-ar-light.png"),
    });
    await page.getByRole("button", { name: "استخدام الوضع الداكن" }).click();

    renderer.setState(expiredState());
    await page.reload();
    await expect(
      page.getByText("انتهى الترخيص — الوظائف المجانية فقط"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "المزامنة السحابية أحادية الاتجاه",
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "المبيعات المحلية" }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("expired-ar-dark.png"),
    });
  });

  test("shows the owner the licence dates, days left, plan versus founder grants, and refuses new pairing during grace", async ({
    page,
  }) => {
    renderer.setState(licensedState());
    await installMainDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    const card = page.getByRole("region", { name: "Licence status" });
    for (const fact of [
      "Issued",
      "Expires",
      "Grace period until",
      "Days remaining",
      "Permitted devices",
    ]) {
      await expect(card.getByText(fact, { exact: true })).toBeVisible();
    }
    const planFeatures = card
      .getByRole("heading", { name: "Plan features" })
      .locator("..");
    await expect(planFeatures.getByText("One-way cloud sync")).toBeVisible();
    await expect(planFeatures.getByText("Purchase-invoice OCR")).toHaveCount(0);
    const founderGrants = card
      .getByRole("heading", { name: "Founder grants" })
      .locator("..");
    await expect(founderGrants.getByText("Purchase-invoice OCR")).toBeVisible();
    await expect(
      card.getByText("Renew it to keep paid functions running"),
    ).toHaveCount(0);
    const renew = card.getByRole("button", {
      name: "Renew or install licence",
    });
    await expect(renew).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Ten days left: the warning names the count. Renewal is reached by
    // keyboard, and focus returns to Renew once Step-Up completes.
    renderer.setState(expiringSoonState());
    await page.reload();
    await expect(
      card.getByText(
        "The licence expires in 10 days. Renew it to keep paid functions running.",
      ),
    ).toBeVisible();
    await card.getByLabel("Signed licence document").fill("renewed-licence");
    await focusWithKeyboard(page, renew);
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser test password");
    await page.keyboard.press("Enter");
    await expect(renew).toBeFocused();
    await expect(
      card.getByText("Renew it to keep paid functions running"),
    ).toHaveCount(0);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("panel-en-light.png"),
    });

    // A licensed pharmacy may start pairing; the same pharmacy in grace keeps
    // its paid functions but is told it cannot pair a new terminal.
    renderer.setState(pairableState());
    await page.reload();
    await expect(
      founderGrants.getByText("No additional grants", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start pairing" }),
    ).toBeVisible();
    renderer.setState(graceState());
    await page.reload();
    await expect(
      card.getByText("Licence expired — within the grace period"),
    ).toBeVisible();
    await expect(
      card.getByText(
        "The licence has expired and paid functions continue during the grace period.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "One-way cloud sync" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start pairing" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "The licence is in its grace period. Paired terminals keep working",
        {
          exact: false,
        },
      ),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("grace-en-light.png"),
    });

    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await expect(
      page.getByText("انتهى الترخيص — ضمن فترة السماح"),
    ).toBeVisible();
    await expect(
      page.getByText("فترة السماح حتى", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("منح المؤسس", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "بدء الإقران" })).toHaveCount(
      0,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("grace-ar-dark.png"),
    });
    await page.getByRole("button", { name: "التبديل إلى الإنجليزية" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
  });

  test("hides licence renewal without licensing management permission", async ({
    page,
  }) => {
    renderer.setState(licensedWithoutLicensingManagementState());
    await installMainDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);

    const card = page.getByRole("region", { name: "Licence status" });
    await expect(card.getByText("professional", { exact: true })).toBeVisible();
    await expect(card.locator(".licence-form")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Renew or install licence" }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Remove licence" }),
    ).toHaveCount(0);
  });
});

async function installMainDesktopFake(
  page: Page,
  origin: string,
): Promise<void> {
  await page.addInitScript((localApiOrigin) => {
    const unpairedState = {
      candidates: [],
      stage: "awaiting-invitation" as const,
    };
    const desktopApi: BreevDesktopApi = Object.freeze({
      cancelTerminalPairing: async () => unpairedState,
      exportDiagnostics: async () => ({ status: "saved" as const }),
      getTerminalPairingState: async () => unpairedState,
      openSupport: async () => ({ status: "unavailable" as const }),
      reportRendererIncident: async () => ({ accepted: true as const }),
      submitManualEndpoint: async () => unpairedState,
      submitDiagnostics: async () => ({ status: "unavailable" as const }),
      submitPairingInvitation: async () => unpairedState,
      getStartupConfig: async () => ({
        localApiOrigin,
        role: "main" as const,
      }),
    });
    Object.defineProperty(globalThis, "breevDesktop", {
      configurable: false,
      value: desktopApi,
      writable: false,
    });
  }, origin);
}

function freeCoreState(): IdentityAuthenticatedState {
  return {
    allowedPermissions: ["licensing.manage"],
    attendance: null,
    entitlement: {
      capabilities: [...FREE_CORE_CAPABILITY_NAMES],
      licence: null,
      status: "free-core",
    },
    pharmacy: { id: PHARMACY_ID, name: "Breev Licence Pharmacy" },
    session: {
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "019b0000-0000-7000-8000-000000000303",
    },
    settings: { attendanceEnabled: false, revision: "1" },
    state: "authenticated",
    user: {
      displayName: "Licence Owner",
      id: "019b0000-0000-7000-8000-000000000304",
      revision: "1",
      role: {
        id: "019b0000-0000-7000-8000-000000000307",
        key: "owner",
        kind: "built-in",
      },
      status: "active",
      username: "licence.owner",
    },
  };
}

function licensedLicence(): NonNullable<
  IdentityAuthenticatedState["entitlement"]["licence"]
> {
  return {
    expiresAt: "2099-01-01T00:00:00.000Z",
    features: ["one-way-cloud-sync"],
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
  };
}

function licensedState(): IdentityAuthenticatedState {
  return {
    ...freeCoreState(),
    entitlement: {
      capabilities: [
        ...FREE_CORE_CAPABILITY_NAMES,
        "one-way-cloud-sync",
        "purchase-invoice-ocr",
      ],
      licence: licensedLicence(),
      status: "licensed",
    },
  };
}

function licensedWithoutLicensingManagementState(): IdentityAuthenticatedState {
  return {
    ...licensedState(),
    allowedPermissions: [],
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ten and a half days before expiry: the panel warns about ten days. */
function expiringSoonState(): IdentityAuthenticatedState {
  const licensed = licensedState();
  return {
    ...licensed,
    entitlement: {
      ...licensed.entitlement,
      licence: {
        ...licensedLicence(),
        expiresAt: new Date(Date.now() + 10.5 * DAY_MS).toISOString(),
        graceEndsAt: new Date(Date.now() + 17.5 * DAY_MS).toISOString(),
      },
    },
  };
}

/** A licensed pharmacy whose owner may pair terminals. */
function pairableState(): IdentityAuthenticatedState {
  const licensed = licensedState();
  return {
    ...licensed,
    allowedPermissions: ["devices.pair", "licensing.manage"],
    entitlement: {
      capabilities: [
        ...FREE_CORE_CAPABILITY_NAMES,
        "additional-device-pos",
        "one-way-cloud-sync",
      ],
      licence: {
        ...licensedLicence(),
        features: ["additional-device-pos", "one-way-cloud-sync"],
        founderOverrideGrants: [],
      },
      status: "licensed",
    },
  };
}

/** The same pharmacy one day after its paid term ended, six days from grace end. */
function graceState(): IdentityAuthenticatedState {
  const pairable = pairableState();
  return {
    ...pairable,
    entitlement: {
      ...pairable.entitlement,
      licence: {
        ...licensedLicence(),
        expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
        features: ["additional-device-pos", "one-way-cloud-sync"],
        founderOverrideGrants: [],
        graceEndsAt: new Date(Date.now() + 6 * DAY_MS).toISOString(),
      },
      status: "grace",
    },
  };
}

function expiredState(): IdentityAuthenticatedState {
  return {
    ...freeCoreState(),
    entitlement: {
      capabilities: [...FREE_CORE_CAPABILITY_NAMES],
      licence: null,
      status: "expired",
    },
  };
}

async function startLicensingRenderer(
  initialState: IdentityAuthenticatedState,
): Promise<LicensingRenderer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  let state = initialState;
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
      response.end(JSON.stringify(state));
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/identity/step-up-challenges"
    ) {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          action: "licensing.licence.deactivate",
          expiresAt: "2099-01-01T00:00:00.000Z",
          id: CHALLENGE_ID,
          status: "pending",
        }),
      );
      return;
    }
    if (
      request.method === "POST" &&
      request.url === `/identity/step-up-challenges/${CHALLENGE_ID}/approve`
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          action: "licensing.licence.deactivate",
          expiresAt: "2099-01-01T00:00:00.000Z",
          id: CHALLENGE_ID,
          status: "approved",
        }),
      );
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/licensing/licence-deactivations"
    ) {
      state = freeCoreState();
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(state.entitlement));
      return;
    }
    if (request.method === "POST" && request.url === "/licensing/licences") {
      // A renewal installs a newer signed licence; the fake answers with the
      // far-future licensed state.
      state = licensedState();
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(state.entitlement));
      return;
    }
    if (request.url === "/devices") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ devices: [], seatUsage: { permitted: 3, used: 1 } }),
      );
      return;
    }
    if (request.url === "/devices/pairing-sessions/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ state: "none" }));
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
    const file = path.resolve(rendererRoot, `.${pathname}`);
    const extension = path.extname(file);
    response.writeHead(200, {
      "content-type":
        extension === ".html"
          ? "text/html; charset=utf-8"
          : extension === ".css"
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
    });
    response.end(await readFile(file));
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
    setState(next) {
      state = next;
    },
  };
}

function evidencePath(name: string): string {
  return sharedEvidencePath(`issue-39/after/${name}`);
}

async function focusWithKeyboard(page: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press("Tab");
    if (
      await target.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      )
    ) {
      return;
    }
  }
  throw new Error("Keyboard traversal did not reach the requested control");
}
