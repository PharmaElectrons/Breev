import { AxeBuilder } from "@axe-core/playwright";
import type {
  BreevDesktopApi,
  DesktopDeviceRole,
  TerminalPairingState,
} from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  FREE_CORE_CAPABILITY_NAMES,
  LOCAL_API_VERSION,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  LOCAL_SCHEMA_VERSION,
  localProofEvidenceContract,
  localProofMutationContract,
  parseLocalProofEvidenceResponse,
  type LocalProofEvidenceSuccess,
} from "@breev/contracts/local-rest";
import { expect, test, type Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../database-roles.js";
import {
  spawnLocalApiProcess,
  stopProcess,
  waitForHealth,
} from "../local-api-process.js";
import { evidencePath } from "./evidence-path.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

type BackendMode =
  | "connecting"
  | "incompatible-version"
  | "main-unavailable"
  | "pass"
  | "repair-required";

interface RendererServer {
  readonly origin: string;
  readonly server: Server;
  setMode(mode: BackendMode): void;
}

interface DesktopFakeOptions {
  readonly configDelayMs?: number;
  readonly locale?: "ar" | "en";
  readonly pairing?: TerminalPairingState;
  readonly role?: DesktopDeviceRole;
  readonly theme?: "dark" | "light";
}

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface IdentityStateMatrix {
  readonly arabicHeading: string;
  readonly englishHeading: string;
  readonly evidenceName: string;
  readonly focusLabel: { readonly ar: string; readonly en: string };
}

test.describe.serial("bilingual desktop shell", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin: string;
  let apiPort: number;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer;
  let renderer: RendererServer;

  test.beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = spawnLocalApi(apiPort, databaseRoles, "ready", credentials);
    await waitForHealth(apiOrigin, "healthy", api);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("the real local API reaches the English light Ready shell", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);

    await expect(page.getByTestId("shell-state")).toHaveText("Ready");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("API loss never creates a fallback and recovers automatically", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "ar",
      theme: "dark",
    });
    await page.goto(renderer.origin);
    await expect(page.getByTestId("shell-state")).toHaveText("جاهز");

    await stopProcess(api);
    api = undefined;
    await expect(page.getByTestId("shell-state")).toHaveText(
      "الحاسبة الرئيسية غير متاحة",
    );
    await expectBrowserStorageToContainPreferencesOnly(page);

    api = spawnLocalApi(apiPort, databaseRoles, "ready", credentials);
    await waitForHealth(apiOrigin, "healthy", api);
    await expect(page.getByTestId("shell-state")).toHaveText("جاهز");
  });

  test("version mismatch and the typed repair signal remain distinct", async ({
    page,
  }) => {
    renderer.setMode("incompatible-version");
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    await expect(page.getByTestId("shell-state")).toHaveText(
      "Incompatible version",
    );

    renderer.setMode("pass");
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");

    await stopProcess(api);
    api = spawnLocalApi(apiPort, databaseRoles, "repair-required", credentials);
    await waitForHealth(apiOrigin, "repair-required", api);
    await expect(page.getByTestId("shell-state")).toHaveText("Repair required");

    await stopProcess(api);
    api = spawnLocalApi(apiPort, databaseRoles, "ready", credentials);
    await waitForHealth(apiOrigin, "healthy", api);
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");
  });

  test("all seven states pass the locale and theme matrix", async ({
    browser,
  }) => {
    const expectedTitles = {
      ar: {
        starting: "جارٍ البدء",
        connecting: "جارٍ الاتصال",
        ready: "جاهز",
        "main-unavailable": "الحاسبة الرئيسية غير متاحة",
        "incompatible-version": "الإصدار غير متوافق",
        "repair-required": "الإصلاح مطلوب",
        unpaired: "نقطة البيع غير مقترنة",
      },
      en: {
        starting: "Starting",
        connecting: "Connecting",
        ready: "Ready",
        "main-unavailable": "Main unavailable",
        "incompatible-version": "Incompatible version",
        "repair-required": "Repair required",
        unpaired: "Terminal not paired",
      },
    } as const;
    const states = Object.keys(expectedTitles.en) as Array<
      keyof (typeof expectedTitles)["en"]
    >;

    for (const locale of ["ar", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        for (const state of states) {
          const context = await browser.newContext({
            viewport: { height: 768, width: 1_024 },
          });
          const page = await context.newPage();
          renderer.setMode(modeForState(state));
          await installDesktopFake(page, renderer.origin, {
            configDelayMs: state === "starting" ? 1_500 : 0,
            locale,
            // A terminal without a certificate never reaches the health
            // handshake, so 'unpaired' is driven by the device role rather
            // than by a backend mode.
            ...(state === "unpaired" ? { role: "terminal" as const } : {}),
            theme,
          });
          await page.goto(renderer.origin);
          await expect(page.getByTestId("shell-state")).toHaveText(
            expectedTitles[locale][state],
          );
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expect(page.locator("html")).toHaveAttribute(
            "dir",
            locale === "ar" ? "rtl" : "ltr",
          );
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );

          const accessibility = await new AxeBuilder({ page }).analyze();
          expect(accessibility.violations).toEqual([]);
          const buttons = page.getByRole("button");
          await buttons.nth(0).focus();
          await expect(buttons.nth(0)).toBeFocused();
          await page.keyboard.press("Tab");
          await expect(buttons.nth(1)).toBeFocused();
          if (state !== "starting" && state !== "connecting") {
            await page.keyboard.press("Tab");
            await expect(buttons.nth(2)).toBeFocused();
          }
          const focusOutlineWidth = await page
            .locator(":focus")
            .evaluate((element) => {
              const view = element.ownerDocument.defaultView;
              return view === null
                ? 0
                : Number.parseFloat(
                    view.getComputedStyle(element).outlineWidth,
                  );
            });
          expect(focusOutlineWidth).toBeGreaterThanOrEqual(3);
          // The six connection states are issue #33's evidence and keep its
          // naming and framing; the pairing state this issue adds is filed
          // under #42 in that issue's <state>-<locale>-<theme> house style.
          await (state === "unpaired"
            ? page.screenshot({
                animations: "disabled",
                fullPage: true,
                path: evidencePath(
                  `issue-42/after/unpaired-${locale}-${theme}.png`,
                ),
              })
            : page.screenshot({
                animations: "disabled",
                path: evidencePath(
                  `issue-33/after/${locale}-${theme}-${state}.png`,
                ),
              }));
          await context.close();
        }
      }
    }
    renderer.setMode("pass");
  });

  test("RTL mirrors visually without changing keyboard focus order", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");
    await expect(
      page.getByRole("heading", { name: "Set up this pharmacy" }),
    ).toBeVisible();

    const language = page.getByRole("button", { name: "Switch to Arabic" });
    const theme = page.getByRole("button", { name: "Use dark theme" });
    const check = page.getByRole("button", { name: "Check now" });
    await language.focus();
    await expect(language).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(theme).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(check).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(check).toBeFocused();

    const ltrLanguageBox = await language.boundingBox();
    const ltrThemeBox = await theme.boundingBox();
    expect(ltrLanguageBox?.x).toBeLessThan(ltrThemeBox?.x ?? 0);

    await language.click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const arabicLanguage = page.getByRole("button", {
      name: "التبديل إلى الإنجليزية",
    });
    const arabicTheme = page.getByRole("button", {
      name: "استخدام الوضع الداكن",
    });
    const arabicCheck = page.getByRole("button", { name: "تحقق الآن" });
    await arabicLanguage.focus();
    await page.keyboard.press("Tab");
    await expect(arabicTheme).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(arabicCheck).toBeFocused();

    const rtlLanguageBox = await arabicLanguage.boundingBox();
    const rtlThemeBox = await arabicTheme.boundingBox();
    expect(rtlLanguageBox?.x).toBeGreaterThan(rtlThemeBox?.x ?? 0);

    await arabicLanguage.focus();
    const focusOutline = await arabicLanguage.evaluate((element) => {
      const styles = (
        globalThis as unknown as {
          getComputedStyle(target: unknown): {
            outlineStyle: string;
            outlineWidth: string;
          };
        }
      ).getComputedStyle(element);
      return { style: styles.outlineStyle, width: styles.outlineWidth };
    });
    expect(focusOutline.style).not.toBe("none");
    expect(Number.parseFloat(focusOutline.width)).toBeGreaterThanOrEqual(3);
  });

  test("200% text and minimum targets preserve shell content", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "ar",
      theme: "dark",
    });
    await page.goto(renderer.origin);
    await expect(page.getByTestId("shell-state")).toHaveText("جاهز");
    await page.evaluate("document.documentElement.style.fontSize = '200%'");

    await expect(page.getByTestId("shell-state")).toBeVisible();
    await expect(page.getByRole("button", { name: "تحقق الآن" })).toBeVisible();
    const dimensions = (await page.evaluate(
      "({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })",
    )) as { clientWidth: number; scrollWidth: number };
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(24);
      expect(box?.width).toBeGreaterThanOrEqual(24);
    }
  });

  test("bootstraps the pharmacy through the real API with keyboard-only English light interaction", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Set up this pharmacy" }),
    ).toBeVisible();
    await expectIdentityStateMatrix(page, {
      arabicHeading: "إعداد الصيدلية",
      englishHeading: "Set up this pharmacy",
      evidenceName: "bootstrap",
      focusLabel: { ar: "اسم الصيدلية", en: "Pharmacy name" },
    });
    await expect(page.getByRole("heading", { name: "Attendance" })).toHaveCount(
      0,
    );

    const pharmacyName = page.getByLabel("Pharmacy name");
    await pharmacyName.focus();
    await page.keyboard.type("Breev Browser Pharmacy");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Display name")).toBeFocused();
    await page.keyboard.type("Browser Owner");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Username")).toBeFocused();
    await page.keyboard.type("browser.owner");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    const focusOutlineWidth = await page
      .getByLabel("Password")
      .evaluate((element) => {
        const view = element.ownerDocument.defaultView;
        return view === null
          ? 0
          : Number.parseFloat(view.getComputedStyle(element).outlineWidth);
      });
    expect(focusOutlineWidth).toBeGreaterThanOrEqual(3);
    await page.keyboard.type("browser owner password is private");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Create pharmacy and owner" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Configure role permissions" }),
    ).toBeVisible();
    await expectBrowserStorageToContainPreferencesOnly(page);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-38/after/en-light-owner.png"),
    });
  });

  test("shows generic login denial and Arabic dark authenticated states", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to Breev" }),
    ).toBeVisible();
    await expectIdentityStateMatrix(page, {
      arabicHeading: "تسجيل الدخول إلى بريف",
      englishHeading: "Sign in to Breev",
      evidenceName: "login",
      focusLabel: { ar: "اسم المستخدم", en: "Username" },
    });

    await page.getByLabel("Username").fill("browser.owner");
    await page.getByLabel("Password").fill("wrong password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("The username or password is incorrect."),
    ).toBeVisible();
    await expect(page.getByLabel("Username")).toHaveValue("browser.owner");
    await expect(page.getByLabel("Password")).toHaveValue("wrong password");
    await expect(page.getByLabel("Password")).toBeFocused();
    await expectIdentityStateMatrix(page, {
      arabicHeading: "تسجيل الدخول إلى بريف",
      englishHeading: "Sign in to Breev",
      evidenceName: "wrong-password",
      focusLabel: { ar: "كلمة المرور", en: "Password" },
    });
    await page.locator(".denial-alert .dismiss-button").click();
    await page.getByLabel("Username").fill("browser.owner");
    await page.getByLabel("Password").fill("browser owner password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await page.getByRole("button", { name: "استخدام الوضع الداكن" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("heading", { name: "مرحباً, Browser Owner" }),
    ).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-38/after/ar-dark-owner.png"),
    });

    await page.getByRole("button", { name: "التبديل إلى الإنجليزية" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
  });

  test("hides unlicensed paid functions while Free Core survives expiry in both locales and themes", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();

    for (const capability of ["Local sales", "Backup", "Licence renewal"]) {
      await expect(
        page.getByRole("button", { name: capability }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "One-way cloud sync" }),
    ).toHaveCount(0);
    const directDenial = (await page.evaluate(async () => {
      const response = await fetch("/licensing/capability-proof", {
        body: JSON.stringify({ capability: "one-way-cloud-sync" }),
        headers: {
          "Content-Type": "application/json",
          "X-Breev-CSRF": "1",
        },
        method: "POST",
      });
      return {
        body: (await response.json()) as { code?: string },
        status: response.status,
      };
    })) as { body: { code?: string }; status: number };
    expect(directDenial).toEqual({
      body: expect.objectContaining({ code: "entitlement-denied" }),
      status: 403,
    });

    const authenticated = (await page.evaluate(
      async () => await (await fetch("/identity/state")).json(),
    )) as Record<string, unknown>;
    const licensedState = {
      ...authenticated,
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
          licenceId: "019b0000-0000-7000-8000-000000000201",
          mainDeviceId: credentials.deviceId,
          permittedDeviceCount: 3,
          pharmacyId: (authenticated.pharmacy as { id: string }).id,
          plan: "professional",
        },
        status: "licensed",
      },
    };
    await page.route("**/identity/state", async (route) => {
      await route.fulfill({ json: licensedState, status: 200 });
    });
    await page.reload();
    const cloudSync = page.getByRole("button", { name: "One-way cloud sync" });
    await expect(cloudSync).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Purchase-invoice OCR" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "AI services" })).toHaveCount(
      0,
    );
    await cloudSync.focus();
    await expect(cloudSync).toBeFocused();
    expect(
      await cloudSync.evaluate((element) => {
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
      path: evidencePath("issue-39/after/licensed-en-light.png"),
    });

    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await page.getByRole("button", { name: "استخدام الوضع الداكن" }).click();
    await expect(
      page.getByRole("button", { name: "المزامنة السحابية أحادية الاتجاه" }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-39/after/licensed-ar-dark.png"),
    });

    await page.unroute("**/identity/state");
    await page.route("**/identity/state", async (route) => {
      await route.fulfill({
        json: {
          ...licensedState,
          entitlement: {
            capabilities: [...FREE_CORE_CAPABILITY_NAMES],
            licence: null,
            status: "expired",
          },
        },
        status: 200,
      });
    });
    await page.reload();
    await expect(
      page.getByText("انتهى الترخيص — الوظائف المجانية فقط"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "المزامنة السحابية أحادية الاتجاه" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "المبيعات المحلية" }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-39/after/expired-ar-dark.png"),
    });
    await page.unroute("**/identity/state");
  });

  test("requires Step-Up to create a default-deny user and enforces denial through the API", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();

    await expectStepUpStateMatrix(page);
    const addUser = page.getByRole("button", { name: "Add user" });
    await expect(addUser).toBeVisible();
    await expect(addUser).toBeEnabled();
    await addUser.focus();
    await page.keyboard.press("Enter");
    const stepUpPassword = page.getByRole("dialog").getByLabel("Password");
    await expect(stepUpPassword).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Cancel" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(stepUpPassword).toBeFocused();
    await page.keyboard.type("wrong password");
    await page.keyboard.press("Enter");
    await expect(page.getByText("The password is incorrect.")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(stepUpPassword).toHaveValue("wrong password");
    await expect(stepUpPassword).toBeFocused();
    await page
      .getByRole("dialog")
      .locator(".denial-alert .dismiss-button")
      .click();
    await stepUpPassword.fill("browser owner password is private");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Create user" }),
    ).toBeVisible();
    await page
      .getByLabel("Display name", { exact: true })
      .last()
      .fill("Browser Manager");
    await page
      .getByLabel("Username", { exact: true })
      .last()
      .fill("browser.manager");
    await page
      .getByLabel("Password", { exact: true })
      .last()
      .fill("browser manager password is private");
    // Roles are chosen by their localized name; the wire carries the role id.
    await page
      .getByRole("combobox", { name: "Role", exact: true })
      .selectOption({ label: "Manager" });
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText("Browser Manager")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill("browser.manager");
    await page
      .getByLabel("Password")
      .fill("browser manager password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Manager" }),
    ).toBeVisible();
    // The built-in manager role is seeded with role administration and
    // nothing else: the role editor is offered, user management is not, and
    // the permission summary names the one permission in plain words.
    await expect(
      page.getByRole("heading", { name: "User management" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Configure role permissions" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".permission-summary")
        .getByText("Manage roles and permissions", { exact: true }),
    ).toBeVisible();
    const directApi = (await page.evaluate(async () => {
      const response = await fetch("/identity/users", {
        headers: { Accept: "application/json" },
      });
      return {
        body: (await response.json()) as { code?: string },
        status: response.status,
      };
    })) as { body: { code?: string }; status: number };
    expect(directApi).toEqual({
      body: expect.objectContaining({ code: "permission-denied" }),
      status: 403,
    });
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-38/after/en-light-default-deny.png"),
    });

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill("browser.owner");
    await page.getByLabel("Password").fill("browser owner password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
  });

  test("edits a display name and rotates credentials with keyboard-safe controls", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();

    const managerRow = page
      .locator(".user-list li")
      .filter({ hasText: "Browser Manager" });
    const displayName = managerRow.getByLabel("Display name: browser.manager");
    await displayName.fill("Browser Manager Renamed");
    const saveName = managerRow.getByRole("button", { name: "Save name" });
    await saveName.click();
    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();
    await expect(managerRow.getByText("Browser Manager Renamed")).toBeVisible();
    await expect(saveName).toBeFocused();

    const resetPassword = "browser manager reset password is private";
    await managerRow
      .getByLabel("New password: browser.manager")
      .fill(resetPassword);
    const reset = managerRow.getByRole("button", { name: "Reset password" });
    await reset.click();
    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();
    await expect(reset).toBeFocused();

    await administrator.query(
      "delete from identity_auth_rate_windows where device_id = $1",
      [credentials.deviceId],
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill("browser.manager");
    await page.getByLabel("Password").fill(resetPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Manager Renamed" }),
    ).toBeVisible();

    const selfChange = page
      .getByRole("heading", { name: "Change my password" })
      .locator("../..");
    const selfChangedPassword = "browser manager self changed password";
    await selfChange.getByLabel("Current password").fill(resetPassword);
    await selfChange.getByLabel("New password").fill(selfChangedPassword);
    const change = selfChange.getByRole("button", {
      name: "Change my password",
    });
    await change.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Password changed.")).toBeVisible();
    await expect(change).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill("browser.manager");
    await page.getByLabel("Password").fill(resetPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("The username or password is incorrect."),
    ).toBeVisible();
    await page.getByLabel("Password").fill(selfChangedPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Manager Renamed" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await expect(
      page.getByRole("heading", { name: "تغيير كلمة مروري" }),
    ).toBeVisible();
    await expect(page.getByLabel("كلمة المرور الحالية")).toBeVisible();
    await page.getByRole("button", { name: "التبديل إلى الإنجليزية" }).click();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill("browser.owner");
    await page.getByLabel("Password").fill("browser owner password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();
    await administrator.query(
      "delete from identity_auth_rate_windows where device_id = $1",
      [credentials.deviceId],
    );
  });

  test("reassigns a user's role with keyboard controls and handles last-owner denial", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();

    const managerRow = page
      .locator(".user-list li")
      .filter({ hasText: "Browser Manager Renamed" });

    await expect(
      managerRow.getByText("browser.manager · Manager"),
    ).toBeVisible();

    await managerRow
      .getByRole("combobox", { name: "Role: browser.manager" })
      .selectOption({ label: "Pharmacist" });
    const saveRole = managerRow.getByRole("button", { name: "Save role" });
    await saveRole.click();

    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();

    await expect(
      managerRow.getByText("browser.manager · Pharmacist"),
    ).toBeVisible();
    await expect(saveRole).toBeFocused();

    const usersResponse = (await page.evaluate(async () => {
      const response = await fetch("/identity/users", {
        headers: { Accept: "application/json" },
      });
      return await response.json();
    })) as { users: { username: string; role: { key?: string } }[] };
    const managerUser = usersResponse.users.find(
      (u) => u.username === "browser.manager",
    );
    expect(managerUser?.role).toEqual(
      expect.objectContaining({ key: "pharmacist", kind: "built-in" }),
    );

    const ownerRow = page
      .locator(".user-list li")
      .filter({ hasText: "Browser Owner" });

    await ownerRow
      .getByRole("combobox", { name: "Role: browser.owner" })
      .selectOption({ label: "Manager" });
    await ownerRow.getByRole("button", { name: "Save role" }).click();

    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();

    await expect(
      page.getByText("At least one active owner must remain."),
    ).toBeVisible();
    await page.locator(".denial-alert .dismiss-button").click();
    // The selector shows the real server value again, not the refused one.
    await expect(
      ownerRow
        .getByRole("combobox", { name: "Role: browser.owner" })
        .locator("option:checked"),
    ).toHaveText("Owner");

    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await page.getByRole("button", { name: "استخدام الوضع الداكن" }).click();

    await expect(
      managerRow.getByText("browser.manager · الصيدلي"),
    ).toBeVisible();
    await expect(
      managerRow.getByRole("combobox", { name: "الدور: browser.manager" }),
    ).toBeVisible();
    await expect(
      managerRow.getByRole("button", { name: "حفظ الدور" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "التبديل إلى الإنجليزية" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
  });

  test("creates a custom role with only the chosen permissions and assigns it by name in both locales", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();

    // The editor names every permission in plain words; no internal id such
    // as "identity.roles.manage" is visible anywhere in it.
    const editor = page.locator(".role-editor");
    await expect(editor).toBeVisible();
    expect(await editor.innerText()).not.toMatch(
      /\b[a-z]+\.[a-z_]+(?:\.[a-z_]+)?\b/u,
    );
    const roleList = page.getByRole("navigation", { name: "Roles" });
    await expect(
      roleList.getByRole("button", { name: "Owner 7 of 7 permissions" }),
    ).toBeVisible();

    // Keyboard-only creation: Enter on Add role focuses the name field.
    const addRole = page.getByRole("button", { name: "Add role" });
    await addRole.focus();
    await page.keyboard.press("Enter");
    const newRole = page.getByRole("region", { name: "New role" });
    await expect(newRole.getByLabel("Role name")).toBeFocused();
    await page.keyboard.type("Senior cashier");
    await newRole.getByLabel("Manage products", { exact: true }).check();
    const createRole = newRole.getByRole("button", { name: "Create role" });
    await createRole.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page.keyboard.press("Enter");

    // The new role is selected, shows exactly the chosen grant, and Save
    // stays disabled until something changes.
    const details = page.getByRole("region", { name: "Senior cashier" });
    await expect(details).toBeVisible();
    await expect(
      details.getByText("Custom role of this pharmacy"),
    ).toBeVisible();
    await expect(
      details.getByLabel("Manage products", { exact: true }),
    ).toBeChecked();
    await expect(
      details.getByLabel("Manage users", { exact: true }),
    ).not.toBeChecked();
    await expect(
      details.getByRole("button", { name: "Save permissions" }),
    ).toBeDisabled();
    await expect(
      roleList.getByRole("button", {
        name: "Senior cashier 1 of 7 permissions",
      }),
    ).toBeVisible();

    // Assignment by name, through the ordinary user controls.
    const managerRow = page
      .locator(".user-list li")
      .filter({ hasText: "Browser Manager Renamed" });
    await managerRow
      .getByRole("combobox", { name: "Role: browser.manager" })
      .selectOption({ label: "Senior cashier" });
    const saveRole = managerRow.getByRole("button", { name: "Save role" });
    await saveRole.click();
    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();
    await expect(
      managerRow.getByText("browser.manager · Senior cashier"),
    ).toBeVisible();
    await expect(saveRole).toBeFocused();
    const usersResponse = (await page.evaluate(async () => {
      const response = await fetch("/identity/users", {
        headers: { Accept: "application/json" },
      });
      return await response.json();
    })) as { users: { username: string; role: { name?: string } }[] };
    expect(
      usersResponse.users.find((u) => u.username === "browser.manager")?.role,
    ).toEqual(
      expect.objectContaining({ kind: "custom", name: "Senior cashier" }),
    );
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-roles/after/en-light-custom-role.png"),
    });

    // Arabic: built-in roles carry Breev's Arabic names; the custom role keeps
    // the pharmacy's own spelling in both languages.
    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await page.getByRole("button", { name: "استخدام الوضع الداكن" }).click();
    const arabicRoleList = page.getByRole("navigation", { name: "الأدوار" });
    await expect(
      arabicRoleList.getByRole("button", { name: "المدير" }),
    ).toBeVisible();
    await expect(
      arabicRoleList.getByRole("button", { name: "Senior cashier" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Senior cashier" }),
    ).toBeVisible();
    await expect(
      managerRow.getByText("browser.manager · Senior cashier"),
    ).toBeVisible();
    expect(await editor.innerText()).not.toMatch(
      /\b[a-z]+\.[a-z_]+(?:\.[a-z_]+)?\b/u,
    );
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-roles/after/ar-dark-custom-role.png"),
    });

    await page.getByRole("button", { name: "التبديل إلى الإنجليزية" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
  });

  test("configures attendance and roles with Step-Up, then presents a locked login generically", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "light",
    });
    await page.goto(renderer.origin);
    await page
      .getByRole("navigation", { name: "Roles" })
      .getByRole("button", { name: "Manager" })
      .click();
    const managerRole = page.getByRole("region", { name: "Manager" });
    await expect(managerRole).toBeVisible();
    await expect(
      managerRole.getByRole("button", { name: "Save permissions" }),
    ).toBeDisabled();
    for (const permission of [
      "Record attendance",
      "Change pharmacy settings",
    ]) {
      await managerRole.getByLabel(permission, { exact: true }).check();
    }
    await managerRole.getByRole("button", { name: "Save permissions" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();

    await expect(page.getByRole("heading", { name: "Attendance" })).toHaveCount(
      0,
    );
    const settings = page
      .getByRole("heading", { name: "Pharmacy settings" })
      .locator("..");
    await settings.getByRole("checkbox").check();
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("heading", { name: "Attendance" }),
    ).toBeVisible();
    await expectIdentityStateMatrix(page, {
      arabicHeading: "مرحباً, Browser Owner",
      englishHeading: "Welcome, Browser Owner",
      evidenceName: "attendance-enabled",
      focusLabel: {
        ar: "تفعيل تسجيل الحضور والانصراف اليدوي",
        en: "Enable manual check-in and check-out",
      },
    });
    await page.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByRole("button", { name: "Check out" })).toBeVisible();

    const managerRow = page
      .locator(".user-list li")
      .filter({ hasText: "Browser Manager" });
    await managerRow.getByRole("button", { name: "Lock user" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Password")
      .fill("browser owner password is private");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();
    await expect(managerRow.getByText("Locked")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill("browser.manager");
    await page
      .getByLabel("Password")
      .fill("browser manager password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("The username or password is incorrect."),
    ).toBeVisible();
    await expectIdentityStateMatrix(page, {
      arabicHeading: "تسجيل الدخول إلى بريف",
      englishHeading: "Sign in to Breev",
      evidenceName: "locked-user",
      focusLabel: { ar: "كلمة المرور", en: "Password" },
    });
  });

  test("surfaces session expiry and removes attendance when its setting is disabled", async ({
    page,
  }) => {
    renderer.setMode("pass");
    await installDesktopFake(page, renderer.origin, {
      locale: "en",
      theme: "dark",
    });
    await page.goto(renderer.origin);
    await page.getByLabel("Username").fill("browser.owner");
    await page.getByLabel("Password").fill("browser owner password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Attendance" }),
    ).toBeVisible();

    await administrator.query(
      `update identity_sessions
       set expires_at = created_at + interval '1 millisecond'
       where revoked_at is null`,
    );
    await expect(
      page.getByRole("heading", { name: "Session expired" }),
    ).toBeVisible({ timeout: 10_000 });
    await expectIdentityStateMatrix(page, {
      arabicHeading: "انتهت الجلسة",
      englishHeading: "Session expired",
      evidenceName: "session-expired",
      focusLabel: { ar: "اسم المستخدم", en: "Username" },
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("issue-38/after/en-dark-session-expired.png"),
    });

    await page.getByLabel("Username").fill("browser.owner");
    await page.getByLabel("Password").fill("browser owner password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome, Browser Owner" }),
    ).toBeVisible();
    await administrator.query(
      `update identity_sessions
       set revoked_at = statement_timestamp(), revocation_reason = 'administrative'
       where revoked_at is null`,
    );
    await expect(
      page.getByRole("heading", { name: "Session ended" }),
    ).toBeVisible({ timeout: 10_000 });
    await expectIdentityStateMatrix(page, {
      arabicHeading: "تم إنهاء الجلسة",
      englishHeading: "Session ended",
      evidenceName: "session-revoked",
      focusLabel: { ar: "اسم المستخدم", en: "Username" },
    });
    await page.getByLabel("Username").fill("browser.owner");
    await page.getByLabel("Password").fill("browser owner password is private");
    await page.getByRole("button", { name: "Sign in" }).click();
    const settings = page
      .getByRole("heading", { name: "Pharmacy settings" })
      .locator("..");
    await settings.getByRole("checkbox").uncheck();
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Attendance" })).toHaveCount(
      0,
    );
    await expectIdentityStateMatrix(page, {
      arabicHeading: "مرحباً, Browser Owner",
      englishHeading: "Welcome, Browser Owner",
      evidenceName: "attendance-disabled",
      focusLabel: {
        ar: "تفعيل تسجيل الحضور والانصراف اليدوي",
        en: "Enable manual check-in and check-out",
      },
    });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("a plain browser cannot mutate through form, fetch, forged headers, or rebound DNS", async ({
    browser,
    page,
  }) => {
    expect(browser.version()).toContain("151.0.7922.34");
    renderer.setMode("pass");
    await page.route(`${apiOrigin}/health`, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          apiVersion: LOCAL_API_VERSION,
          schemaVersion: LOCAL_SCHEMA_VERSION,
          status: "healthy",
          database: "available",
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await installDesktopFake(page, apiOrigin);
    await page.goto(renderer.origin);
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");

    const before = await getProofEvidence(apiOrigin, credentials);
    await page.getByRole("button", { name: "Verify Main device" }).click();
    await expect(
      page.getByText("The device binding check could not complete."),
    ).toBeVisible();
    const afterTypedFetch = await waitForDenialCount(
      apiOrigin,
      credentials,
      "origin-not-allowed",
      denialCount(before, "origin-not-allowed") + 1,
    );
    expect(afterTypedFetch.mutationCount).toBe(before.mutationCount);

    const attackerPage = await page.context().newPage();
    await attackerPage.goto(`${renderer.origin}/attacker.html`);
    await submitCrossSiteForm(
      attackerPage,
      `${apiOrigin}${localProofMutationContract.path}`,
    );
    const afterForm = await waitForDenialCount(
      apiOrigin,
      credentials,
      "origin-not-allowed",
      denialCount(afterTypedFetch, "origin-not-allowed") + 1,
    );
    expect(afterForm.mutationCount).toBe(before.mutationCount);

    await attackerPage.evaluate(
      async ({ path: proofPath, target }) => {
        await fetch(`${target}${proofPath}`, {
          body: '{"increment":1}',
          headers: {
            "Content-Type": "text/plain",
            Host: "127.0.0.1",
            Origin: "breev://app",
          },
          method: "POST",
          mode: "no-cors",
        });
      },
      { path: localProofMutationContract.path, target: apiOrigin },
    );
    const afterForbiddenHeaders = await waitForDenialCount(
      apiOrigin,
      credentials,
      "origin-not-allowed",
      denialCount(afterForm, "origin-not-allowed") + 1,
    );
    expect(afterForbiddenHeaders.mutationCount).toBe(before.mutationCount);

    await submitCrossSiteForm(
      attackerPage,
      `http://rebound.test:${apiPort}${localProofMutationContract.path}`,
    );
    const afterRebound = await waitForDenialCount(
      apiOrigin,
      credentials,
      "host-not-allowed",
      denialCount(afterForbiddenHeaders, "host-not-allowed") + 1,
    );
    expect(afterRebound.mutationCount).toBe(before.mutationCount);

    await attackerPage.evaluate(
      async ({ path: proofPath, sessionToken, target }) => {
        try {
          await fetch(`${target}${proofPath}`, {
            body: '{"increment":1}',
            headers: {
              "Content-Type": "application/json",
              "X-Breev-CSRF": "1",
              "X-Breev-Device-Session": sessionToken,
            },
            method: "POST",
          });
        } catch {
          // The server denial is proved through its audit evidence below.
        }
      },
      {
        path: localProofMutationContract.path,
        sessionToken: credentials.sessionToken,
        target: apiOrigin,
      },
    );
    const afterStolenSession = await waitForDenialCount(
      apiOrigin,
      credentials,
      "origin-not-allowed",
      denialCount(afterForbiddenHeaders, "origin-not-allowed") + 1,
    );
    expect(afterStolenSession.mutationCount).toBe(before.mutationCount);
    await attackerPage.close();
  });
});

async function expectIdentityStateMatrix(
  page: Page,
  state: IdentityStateMatrix,
): Promise<void> {
  const initialLocale =
    (await page.locator("html").getAttribute("lang")) === "ar" ? "ar" : "en";
  const initialTheme =
    (await page.locator("html").getAttribute("data-theme")) === "dark"
      ? "dark"
      : "light";
  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await setPreferences(page, locale, theme);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("heading", {
          name: locale === "ar" ? state.arabicHeading : state.englishHeading,
        }),
      ).toBeVisible();
      const focusTarget = page.getByLabel(state.focusLabel[locale]).last();
      await focusTarget.focus();
      await expect(focusTarget).toBeFocused();
      const outlineWidth = await focusTarget.evaluate((element) => {
        const view = element.ownerDocument.defaultView;
        return view === null
          ? 0
          : Number.parseFloat(view.getComputedStyle(element).outlineWidth);
      });
      expect(outlineWidth).toBeGreaterThanOrEqual(3);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: evidencePath(
          `issue-38/after/${state.evidenceName}-${locale}-${theme}.png`,
        ),
      });
    }
  }
  await setPreferences(page, initialLocale, initialTheme);
}

async function expectStepUpStateMatrix(page: Page): Promise<void> {
  const initialLocale =
    (await page.locator("html").getAttribute("lang")) === "ar" ? "ar" : "en";
  const initialTheme =
    (await page.locator("html").getAttribute("data-theme")) === "dark"
      ? "dark"
      : "light";

  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await setPreferences(page, locale, theme);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const addUser = page.getByRole("button", {
        name: locale === "ar" ? "إضافة مستخدم" : "Add user",
      });
      await expect(addUser).toBeVisible();
      await expect(addUser).toBeEnabled();
      await addUser.focus();
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog");
      const password = dialog.getByLabel(
        locale === "ar" ? "كلمة المرور" : "Password",
      );
      const cancel = dialog.getByRole("button", {
        name: locale === "ar" ? "إلغاء" : "Cancel",
      });
      await expect(
        dialog.getByRole("heading", {
          name: locale === "ar" ? "تأكيد كلمة المرور" : "Confirm password",
        }),
      ).toBeVisible();
      await expect(password).toBeFocused();
      const outlineWidth = await password.evaluate((element) => {
        const view = element.ownerDocument.defaultView;
        return view === null
          ? 0
          : Number.parseFloat(view.getComputedStyle(element).outlineWidth);
      });
      expect(outlineWidth).toBeGreaterThanOrEqual(3);
      await page.keyboard.press("Shift+Tab");
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(password).toBeFocused();
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: evidencePath(`issue-38/after/step-up-${locale}-${theme}.png`),
      });
      await cancel.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(addUser).toBeFocused();
    }
  }

  await setPreferences(page, initialLocale, initialTheme);
}

async function setPreferences(
  page: Page,
  locale: "ar" | "en",
  theme: "dark" | "light",
): Promise<void> {
  const currentLocale = await page.locator("html").getAttribute("lang");
  if (currentLocale !== locale) {
    await page
      .getByRole("button", {
        name:
          currentLocale === "ar"
            ? "التبديل إلى الإنجليزية"
            : "Switch to Arabic",
      })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
  const currentTheme = await page.locator("html").getAttribute("data-theme");
  if (currentTheme !== theme) {
    await page
      .getByRole("button", {
        name:
          locale === "ar"
            ? theme === "dark"
              ? "استخدام الوضع الداكن"
              : "استخدام الوضع الفاتح"
            : theme === "dark"
              ? "Use dark theme"
              : "Use light theme",
      })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
}

function modeForState(
  state:
    | "connecting"
    | "incompatible-version"
    | "main-unavailable"
    | "ready"
    | "repair-required"
    | "starting"
    | "unpaired",
): BackendMode {
  if (state === "ready" || state === "starting" || state === "unpaired") {
    return "pass";
  }
  return state;
}

async function installDesktopFake(
  page: Page,
  localApiOrigin: string,
  options: DesktopFakeOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({ configDelayMs, locale, origin, pairing, role, theme }) => {
      try {
        if (
          locale !== undefined &&
          localStorage.getItem("breev.locale") === null
        ) {
          localStorage.setItem("breev.locale", locale);
        }
        if (
          theme !== undefined &&
          localStorage.getItem("breev.theme") === null
        ) {
          localStorage.setItem("breev.theme", theme);
        }
      } catch {
        // The real shell owns fallback behavior when storage is unavailable.
      }
      const cancelled: TerminalPairingState = {
        candidates: [],
        stage: "awaiting-invitation",
      };
      const desktopApi: BreevDesktopApi = Object.freeze({
        cancelTerminalPairing: async () => cancelled,
        getTerminalPairingState: async () => pairing,
        submitManualEndpoint: async () => pairing,
        submitPairingInvitation: async () => pairing,
        getStartupConfig: async () => {
          if (configDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, configDelayMs));
          }
          return { localApiOrigin: origin, role };
        },
      });
      Object.defineProperty(globalThis, "breevDesktop", {
        configurable: false,
        value: desktopApi,
        writable: false,
      });
    },
    {
      configDelayMs: options.configDelayMs ?? 0,
      locale: options.locale,
      origin: localApiOrigin,
      pairing: options.pairing ?? {
        candidates: [],
        stage: "awaiting-invitation" as const,
      },
      role: options.role ?? ("main" as const),
      theme: options.theme,
    },
  );
}

async function expectBrowserStorageToContainPreferencesOnly(
  page: Page,
): Promise<void> {
  const evidence = (await page.evaluate(`(async () => ({
    localKeys: Object.keys(localStorage).sort(),
    sessionKeys: Object.keys(sessionStorage),
    databases: (await indexedDB.databases()).map((database) => database.name),
    caches: await caches.keys()
  }))()`)) as {
    caches: string[];
    databases: Array<string | undefined>;
    localKeys: string[];
    sessionKeys: string[];
  };

  expect(evidence).toEqual({
    caches: [],
    databases: [],
    localKeys: ["breev.locale", "breev.theme"],
    sessionKeys: [],
  });
}

async function startRendererServer(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
): Promise<RendererServer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  let mode: BackendMode = "pass";
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/attacker.html") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end("<!doctype html><html><body>attack page</body></html>");
        return;
      }
      if (request.url === "/health") {
        const requestMode = mode;
        if (requestMode === "connecting") {
          await delay(1_500);
        }
        if (requestMode === "main-unavailable") {
          response.writeHead(502, { "content-type": "application/json" });
          response.end("{}");
          return;
        }
        if (requestMode === "incompatible-version") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              apiVersion: "1",
              schemaVersion: LOCAL_SCHEMA_VERSION,
              status: "healthy",
              database: "available",
            }),
          );
          return;
        }
        if (requestMode === "repair-required") {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              apiVersion: LOCAL_API_VERSION,
              schemaVersion: LOCAL_SCHEMA_VERSION,
              status: "repair-required",
              repair: { code: "installation-state-invalid" },
            }),
          );
          return;
        }

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
        request.url?.startsWith("/licensing/") ||
        request.url === "/devices" ||
        request.url?.startsWith("/devices/") ||
        request.url === "/pharmacy/settings" ||
        request.url === "/attendance/events" ||
        request.url === localProofMutationContract.path
      ) {
        const body = await readRequestBody(request);
        const upstream = await fetch(`${apiOrigin}${request.url}`, {
          ...(body.length === 0 ? {} : { body }),
          headers: {
            Accept: "application/json",
            Authorization: `Breev-Device ${credentials.deviceSecret}`,
            ...(body.length === 0
              ? {}
              : { "Content-Type": "application/json" }),
            [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
            [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
            [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
            Origin: "breev://app",
          },
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

      const pathname = request.url === "/" ? "/index.html" : request.url;
      if (pathname === undefined || pathname.includes("..")) {
        response.writeHead(403).end();
        return;
      }
      const filePath = path.resolve(rendererRoot, `.${pathname}`);
      const extension = path.extname(filePath);
      const contentType =
        extension === ".html"
          ? "text/html; charset=utf-8"
          : extension === ".css"
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8";
      // Read before the head is written: a missing file must fall through to
      // the 502 below rather than crash the server after a 200 is on the wire.
      const file = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType });
      response.end(file);
    } catch {
      response.writeHead(502, { "content-type": "application/json" });
      response.end("{}");
    }
  });
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    server,
    setMode(nextMode) {
      mode = nextMode;
    },
  };
}

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
  installationState: "ready" | "repair-required" = "ready",
  credentials?: MainDeviceCredentials,
): ChildProcessWithoutNullStreams {
  return spawnLocalApiProcess(
    path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
    {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_INSTALLATION_STATE: installationState,
      BREEV_MAIN_DEVICE_ID: credentials?.deviceId,
      BREEV_MAIN_DEVICE_SECRET: credentials?.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: credentials?.sessionToken,
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

async function getProofEvidence(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
): Promise<LocalProofEvidenceSuccess> {
  const response = await fetch(
    new URL(localProofEvidenceContract.path, apiOrigin),
    {
      headers: {
        Authorization: `Breev-Device ${credentials.deviceSecret}`,
        [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
        [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
        [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
        Origin: "breev://app",
      },
    },
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

function denialCount(
  evidence: LocalProofEvidenceSuccess,
  code: string,
): number {
  return Number(
    evidence.denials.find((denial) => denial.code === code)?.count ?? "0",
  );
}

async function waitForDenialCount(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
  code: string,
  expected: number,
): Promise<LocalProofEvidenceSuccess> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const evidence = await getProofEvidence(apiOrigin, credentials);
    if (denialCount(evidence, code) >= expected) {
      return evidence;
    }
    await delay(50);
  }
  throw new Error(`The API did not audit ${code}`);
}

async function submitCrossSiteForm(page: Page, action: string): Promise<void> {
  await page.locator("body").evaluate((body, target) => {
    const document = body.ownerDocument;
    const frame = document.createElement("iframe");
    frame.name = `attack-${crypto.randomUUID()}`;
    frame.hidden = true;
    document.body.append(frame);
    const form = document.createElement("form");
    form.action = target;
    form.method = "POST";
    form.target = frame.name;
    const input = document.createElement("input");
    input.name = "increment";
    input.value = "1";
    form.append(input);
    document.body.append(form);
    form.submit();
  }, action);
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
