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
    await mkdir(
      path.resolve(import.meta.dirname, "../../../../evidence/issue-39/after"),
      { recursive: true },
    );
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
    await page.addInitScript((origin) => {
      const desktopApi: BreevDesktopApi = Object.freeze({
        getStartupConfig: async () => ({ localApiOrigin: origin }),
      });
      Object.defineProperty(globalThis, "breevDesktop", {
        configurable: false,
        value: desktopApi,
        writable: false,
      });
    }, renderer.origin);
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
    await page
      .getByRole("button", { name: "التبديل إلى الإنجليزية" })
      .click();
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
});

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
      role: "owner",
      status: "active",
      username: "licence.owner",
    },
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
      licence: {
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
      },
      status: "licensed",
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
  return path.resolve(
    import.meta.dirname,
    `../../../../evidence/issue-39/after/${name}`,
  );
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
