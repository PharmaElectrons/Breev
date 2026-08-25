import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
} from "@breev/contracts/local-rest";
import { expect, test, type Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";

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
  readonly theme?: "dark" | "light";
}

test.describe.serial("bilingual desktop shell", () => {
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin: string;
  let apiPort: number;
  let postgres: StartedPostgreSqlContainer;
  let renderer: RendererServer;

  test.beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = spawnLocalApi(apiPort, postgres.getConnectionUri());
    await waitForHealth(apiOrigin, "healthy");
    renderer = await startRendererServer(apiOrigin);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
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

    api = spawnLocalApi(apiPort, postgres.getConnectionUri());
    await waitForHealth(apiOrigin, "healthy");
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
    api = spawnLocalApi(
      apiPort,
      postgres.getConnectionUri(),
      "repair-required",
    );
    await waitForHealth(apiOrigin, "repair-required");
    await expect(page.getByTestId("shell-state")).toHaveText("Repair required");

    await stopProcess(api);
    api = spawnLocalApi(apiPort, postgres.getConnectionUri());
    await waitForHealth(apiOrigin, "healthy");
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");
  });

  test("all six states pass the locale and theme matrix", async ({
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
      },
      en: {
        starting: "Starting",
        connecting: "Connecting",
        ready: "Ready",
        "main-unavailable": "Main unavailable",
        "incompatible-version": "Incompatible version",
        "repair-required": "Repair required",
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
          await page.screenshot({
            animations: "disabled",
            path: path.resolve(
              import.meta.dirname,
              `../../../../evidence/issue-33/after/${locale}-${theme}-${state}.png`,
            ),
          });
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
});

function modeForState(
  state:
    | "connecting"
    | "incompatible-version"
    | "main-unavailable"
    | "ready"
    | "repair-required"
    | "starting",
): BackendMode {
  if (state === "ready" || state === "starting") {
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
    ({ configDelayMs, locale, origin, theme }) => {
      try {
        if (locale !== undefined) {
          localStorage.setItem("breev.locale", locale);
        }
        if (theme !== undefined) {
          localStorage.setItem("breev.theme", theme);
        }
      } catch {
        // The real shell owns fallback behavior when storage is unavailable.
      }
      const desktopApi: BreevDesktopApi = Object.freeze({
        getStartupConfig: async () => {
          if (configDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, configDelayMs));
          }
          return { localApiOrigin: origin };
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

async function startRendererServer(apiOrigin: string): Promise<RendererServer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  let mode: BackendMode = "pass";
  const server = createServer(async (request, response) => {
    try {
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
      response.writeHead(200, { "content-type": contentType });
      response.end(await readFile(filePath));
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

function spawnLocalApi(
  port: number,
  databaseUrl: string,
  installationState: "ready" | "repair-required" = "ready",
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, "../../../local-api/dist/main.js")],
    {
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        BREEV_INSTALLATION_STATE: installationState,
        DATABASE_URL: databaseUrl,
      },
    },
  );
}

async function waitForHealth(
  baseUrl: string,
  status: "healthy" | "repair-required",
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const body = (await response.json()) as { status?: string };
      if (body.status === status) {
        return;
      }
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Local API did not report ${status} at ${baseUrl}`);
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

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
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
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
