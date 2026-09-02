import { AxeBuilder } from "@axe-core/playwright";
import {
  TERMINAL_PAIRING_FAILURE_REASONS,
  type BreevDesktopApi,
  type DesktopManualEndpointRequest,
  type DesktopPairingInvitationRequest,
  type TerminalPairingFailureReason,
  type TerminalPairingState,
} from "@breev/contracts/desktop-preload";
import {
  FREE_CORE_CAPABILITY_NAMES,
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  type IdentityAuthenticatedState,
} from "@breev/contracts/local-rest";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { evidencePath } from "./evidence-path.js";

const PHARMACY_ID = "019b0000-0000-7000-8000-000000000401";
const INSTALLATION_ID = "019b0000-0000-7000-8000-000000000402";
const DEVICE_ID = "019b0000-0000-7000-8000-000000000403";
const FINGERPRINT_DIGITS = "483920175613";
const INVITATION =
  "breev-pair://1/eyJ2IjoxLCJpIjoiMDE5YjAwMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwNDAyIn0";

type TerminalMode = "main-unavailable" | "pass";

interface TerminalRenderer {
  readonly origin: string;
  readonly server: Server;
  setMode(mode: TerminalMode): void;
}

interface TerminalScreen {
  readonly context: BrowserContext;
  readonly page: Page;
  submissions(): Promise<readonly Record<string, unknown>[]>;
}

/**
 * The Additional POS Terminal's own screens.
 *
 * The Electron main process is the thing that really talks TLS to the Main
 * Pharmacy Computer, so here it is a canned desktop fake: every stage of the
 * pairing state machine, every failure reason, and the blocking state a
 * terminal shows when the LAN goes away are driven straight through the preload
 * surface, which is exactly what the renderer is allowed to see.
 */
test.describe("terminal pairing screen", () => {
  let renderer: TerminalRenderer;

  test.beforeAll(async () => {
    await mkdir(evidenceDirectory(), { recursive: true });
    renderer = await startTerminalRenderer();
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      renderer.server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  test("shows a distinct screen for every stage before a certificate exists", async ({
    browser,
  }) => {
    const expectations = [
      {
        pairing: awaitingInvitation(),
        text: "Scan the pairing invitation",
      },
      {
        pairing: { ...inProgress(), stage: "validating-endpoint" as const },
        text: "Verifying the Main Pharmacy Computer",
      },
      {
        pairing: { ...inProgress(), stage: "generating-key" as const },
        text: "Creating the device key",
      },
      {
        pairing: { ...inProgress(), stage: "joining" as const },
        text: "Sending the join request",
      },
      {
        pairing: awaitingConfirmation(),
        text: "Waiting for confirmation on the Main computer",
      },
      {
        pairing: fetchingCertificate(),
        text: "Collecting the device certificate",
      },
      {
        pairing: failedWith("endpoint-unreachable"),
        text: "Pairing stopped",
      },
    ] as const;

    for (const expectation of expectations) {
      const screen = await openTerminal(browser, renderer.origin, {
        pairing: expectation.pairing,
      });
      await expect(screen.page.getByTestId("shell-state")).toHaveText(
        "Terminal not paired",
      );
      await expect(screen.page.getByTestId("terminal-pairing")).toHaveAttribute(
        "data-pairing-stage",
        expectation.pairing.stage,
      );
      await expect(
        screen.page.getByText(expectation.text).first(),
      ).toBeVisible();
      const accessibility = await new AxeBuilder({
        page: screen.page,
      }).analyze();
      expect(accessibility.violations).toEqual([]);
      if (expectation.pairing.stage === "joining") {
        await captureSpread(screen.page, "terminal-progress");
      }
      await screen.context.close();
    }
  });

  test("shows the same twelve confirmation digits in four groups in both locales", async ({
    browser,
  }) => {
    for (const locale of ["en", "ar"] as const) {
      const screen = await openTerminal(browser, renderer.origin, {
        locale,
        pairing: awaitingConfirmation(),
      });
      const digits = screen.page.getByTestId("pairing-fingerprint");
      await expect(digits).toHaveAttribute("dir", "ltr");
      await expect(digits.locator("span")).toHaveText([
        "483",
        "920",
        "175",
        "613",
      ]);
      await expect(screen.page.getByText("Counter 2")).toBeVisible();
      if (locale === "en") {
        await captureSpread(screen.page, "terminal-confirmation");
      }
      await screen.context.close();
    }
  });

  test("gives every pairing failure its own explanation and its honest next step", async ({
    browser,
  }) => {
    const seen = new Map<TerminalPairingFailureReason, string>();
    for (const reason of TERMINAL_PAIRING_FAILURE_REASONS) {
      const screen = await openTerminal(browser, renderer.origin, {
        pairing: failedWith(reason),
      });
      const alert = screen.page.locator(".pairing-failure");
      await expect(alert).toBeVisible();
      const message = (await alert.locator("p").innerText()).trim();
      expect(message.length).toBeGreaterThan(0);
      seen.set(reason, message);

      if (reason === "key-protection-unavailable") {
        // This one is not recoverable on this machine: a second attempt would
        // meet the same refusal, so the screen offers the repair instead of a
        // button that cannot work, and withholds the invitation form with it.
        await expect(alert).toHaveAttribute("data-retryable", "false");
        await expect(alert.locator("strong")).toHaveText(
          "This computer cannot be paired",
        );
        await expect(
          screen.page.getByRole("button", { name: "Try again" }),
        ).toHaveCount(0);
        await expect(
          screen.page.getByRole("heading", {
            name: "Scan the pairing invitation",
          }),
        ).toHaveCount(0);
        await expect(screen.page.getByLabel("Invitation link")).toHaveCount(0);
        await captureSpread(screen.page, "terminal-key-unprotected");
        await screen.context.close();
        continue;
      }

      // Every other failure is recoverable from the terminal itself.
      await expect(alert).toHaveAttribute("data-retryable", "true");
      await expect(alert.locator("strong")).toHaveText("Pairing stopped");
      const retry = screen.page.getByRole("button", { name: "Try again" });
      await retry.focus();
      await screen.page.keyboard.press("Enter");
      await expect(
        screen.page.getByRole("heading", {
          name: "Scan the pairing invitation",
        }),
      ).toBeVisible();
      await screen.context.close();
    }
    expect(seen.size).toBe(TERMINAL_PAIRING_FAILURE_REASONS.length);
    expect(new Set(seen.values()).size).toBe(seen.size);
    expect(seen.get("seat-unavailable")).toBe(
      "No seat is available within the permitted device count. Release a seat on the Main Pharmacy Computer, then try again.",
    );
    expect(seen.get("server-identity-rejected")).toBe(
      "The identity of the Main Pharmacy Computer could not be verified. Nothing was sent. Try again with a new invitation.",
    );
    expect(seen.get("session-expired")).toBe(
      "The pairing session expired. Start a new session on the Main Pharmacy Computer.",
    );
    expect(seen.get("key-protection-unavailable")).toBe(
      "This computer's key store cannot protect the terminal key, and Breev will not store that key unprotected. Trying again will not change this. Sign in to this computer's user account with its password in the normal way, make sure the operating system's credential protection service is running, then restart Breev and pair again. If it keeps failing, use a different computer for this terminal.",
    );
  });

  test("translates every pairing failure into Arabic as well", async ({
    browser,
  }) => {
    const seen = new Set<string>();
    for (const reason of TERMINAL_PAIRING_FAILURE_REASONS) {
      const screen = await openTerminal(browser, renderer.origin, {
        locale: "ar",
        pairing: failedWith(reason),
      });
      await expect(
        screen.page.getByRole("heading", { name: "إقران نقطة البيع الإضافية" }),
      ).toBeVisible();
      const message = (
        await screen.page.locator(".pairing-failure p").innerText()
      ).trim();
      expect(message).not.toMatch(/[A-Za-z]{4}/u);
      seen.add(message);
      if (reason === "seat-unavailable") {
        await captureSpread(screen.page, "terminal-failure");
      }
      await screen.context.close();
    }
    expect(seen.size).toBe(TERMINAL_PAIRING_FAILURE_REASONS.length);
  });

  test("accepts a scanned invitation from the keyboard and refuses anything else", async ({
    browser,
  }) => {
    const screen = await openTerminal(browser, renderer.origin, {
      pairing: awaitingInvitation(),
    });
    const page = screen.page;
    await captureSpread(page, "terminal-invitation");

    const invitation = page.getByLabel("Invitation link");
    await invitation.focus();
    await expect(invitation).toBeFocused();
    await page.keyboard.type("https://example.invalid/pair");
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(
        "The invitation link must start with breev-pair://1/ exactly as shown on the Main Pharmacy Computer.",
      ),
    ).toBeVisible();
    expect(await screen.submissions()).toEqual([]);
    await expect(invitation).toBeFocused();

    await page.keyboard.press("Control+A");
    await page.keyboard.type(INVITATION);
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Sending the join request").first(),
    ).toBeVisible();
    expect(await screen.submissions()).toEqual([
      { invitation: INVITATION, kind: "invitation" },
    ]);
    await screen.context.close();
  });

  test("lets a discovered address fill the manual form without replacing the invitation", async ({
    browser,
  }) => {
    const screen = await openTerminal(browser, renderer.origin, {
      pairing: awaitingInvitation([
        {
          host: "192.168.1.40",
          installationId: INSTALLATION_ID,
          name: "breev-019b0000",
          port: 31_311,
        },
      ]),
    });
    const page = screen.page;
    await expect(
      page.getByText(
        "Discovery only suggests an address. The scanned invitation remains the only source of trust.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use this address" }).click();
    await expect(page.getByLabel("Main Pharmacy Computer address")).toHaveValue(
      "192.168.1.40",
    );
    await expect(page.getByLabel("Port")).toHaveValue("31311");

    // An address alone cannot start a ceremony: the invitation carries the
    // session, the join secret, and the authority pin, and nothing here can
    // substitute for it.
    await page.getByRole("button", { name: "Connect to this address" }).click();
    await expect(
      page.getByText(
        "The invitation link must start with breev-pair://1/ exactly as shown on the Main Pharmacy Computer.",
      ),
    ).toBeVisible();
    expect(await screen.submissions()).toEqual([]);

    await page.getByLabel("Invitation link").fill(INVITATION);
    await page.getByRole("button", { name: "Connect to this address" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Sending the join request").first(),
    ).toBeVisible();
    expect(await screen.submissions()).toEqual([
      {
        host: "192.168.1.40",
        invitation: INVITATION,
        kind: "endpoint",
        port: 31_311,
      },
    ]);
    await screen.context.close();
  });

  test("blocks a paired terminal when the LAN drops and recovers without a datastore", async ({
    browser,
  }) => {
    renderer.setMode("pass");
    const screen = await openTerminal(browser, renderer.origin, {
      locale: "en",
      pairing: paired(),
      theme: "light",
    });
    const page = screen.page;
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");
    await expect(page.getByTestId("terminal-pairing")).toHaveCount(0);

    renderer.setMode("main-unavailable");
    await expect(page.getByTestId("shell-state")).toHaveText(
      "Main unavailable",
    );
    await expectBrowserStorageToContainPreferencesOnly(page);
    await captureSpread(page, "terminal-main-unavailable");

    renderer.setMode("pass");
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");
    await expectBrowserStorageToContainPreferencesOnly(page);
    await screen.context.close();
  });
});

function awaitingInvitation(
  candidates: TerminalPairingState["candidates"] = [],
): TerminalPairingState {
  return { candidates: [...candidates], stage: "awaiting-invitation" };
}

function inProgress(): {
  readonly candidates: [];
  readonly endpoint: { readonly host: string; readonly port: number };
} {
  return { candidates: [], endpoint: { host: "192.168.1.40", port: 31_311 } };
}

function awaitingConfirmation(): TerminalPairingState {
  return {
    ...inProgress(),
    deviceName: "Counter 2",
    fingerprintDigits: FINGERPRINT_DIGITS,
    stage: "awaiting-confirmation",
  };
}

function fetchingCertificate(): TerminalPairingState {
  return {
    ...inProgress(),
    fingerprintDigits: FINGERPRINT_DIGITS,
    stage: "fetching-certificate",
  };
}

function paired(): TerminalPairingState {
  return {
    ...inProgress(),
    deviceId: DEVICE_ID,
    installationId: INSTALLATION_ID,
    stage: "paired",
  };
}

function failedWith(
  reason: TerminalPairingFailureReason,
): TerminalPairingState {
  return {
    candidates: [],
    endpoint: { host: "192.168.1.40", port: 31_311 },
    reason,
    stage: "failed",
  };
}

/**
 * Opens the shell in the terminal role with a canned pairing state. Submissions
 * the screen makes through the preload surface are recorded so a test can prove
 * what did — and did not — leave the renderer.
 */
async function openTerminal(
  browser: Browser,
  origin: string,
  options: {
    readonly locale?: "ar" | "en";
    readonly pairing: TerminalPairingState;
    readonly theme?: "dark" | "light";
  },
): Promise<TerminalScreen> {
  const context = await browser.newContext({
    viewport: { height: 768, width: 1_024 },
  });
  const page = await context.newPage();
  const recorded: Record<string, unknown>[] = [];
  await page.exposeFunction(
    "breevRecordPairingSubmission",
    (submission: Record<string, unknown>) => {
      recorded.push(submission);
    },
  );
  await page.addInitScript(
    ({ locale, pairing, target, theme }) => {
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
      const record = (
        globalThis as unknown as {
          breevRecordPairingSubmission(
            submission: Record<string, unknown>,
          ): Promise<void>;
        }
      ).breevRecordPairingSubmission;
      let current: TerminalPairingState = pairing;
      const joining: TerminalPairingState = {
        candidates: [],
        endpoint: { host: "192.168.1.40", port: 31_311 },
        stage: "joining",
      };
      const desktopApi: BreevDesktopApi = Object.freeze({
        cancelTerminalPairing: async () => {
          current = { candidates: [], stage: "awaiting-invitation" };
          return current;
        },
        getStartupConfig: async () => ({
          localApiOrigin: target,
          role: "terminal" as const,
        }),
        getTerminalPairingState: async () => current,
        submitManualEndpoint: async (request: DesktopManualEndpointRequest) => {
          await record({ ...request, kind: "endpoint" });
          current = joining;
          return current;
        },
        submitPairingInvitation: async (
          request: DesktopPairingInvitationRequest,
        ) => {
          await record({ ...request, kind: "invitation" });
          current = joining;
          return current;
        },
      });
      Object.defineProperty(globalThis, "breevDesktop", {
        configurable: false,
        value: desktopApi,
        writable: false,
      });
    },
    {
      locale: options.locale,
      pairing: options.pairing,
      target: origin,
      theme: options.theme,
    },
  );
  await page.goto(origin);
  return {
    context,
    page,
    submissions: async () => {
      // The recording crosses a binding, so let the queued call settle before
      // a test decides that nothing was submitted.
      await page.waitForTimeout(100);
      return recorded;
    },
  };
}

async function captureSpread(page: Page, name: string): Promise<void> {
  const initialLocale =
    (await page.locator("html").getAttribute("lang")) === "ar" ? "ar" : "en";
  const initialTheme =
    (await page.locator("html").getAttribute("data-theme")) === "dark"
      ? "dark"
      : "light";
  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await setPreferences(page, locale, theme);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: path.join(evidenceDirectory(), `${name}-${locale}-${theme}.png`),
      });
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
    await pressButton(
      page,
      currentLocale === "ar" ? "التبديل إلى الإنجليزية" : "Switch to Arabic",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
  const currentTheme = await page.locator("html").getAttribute("data-theme");
  if (currentTheme !== theme) {
    await pressButton(
      page,
      locale === "ar"
        ? theme === "dark"
          ? "استخدام الوضع الداكن"
          : "استخدام الوضع الفاتح"
        : theme === "dark"
          ? "Use dark theme"
          : "Use light theme",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
}

async function pressButton(page: Page, name: string): Promise<void> {
  const button = page.getByRole("button", { name });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
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

function evidenceDirectory(): string {
  return evidencePath("issue-42/after");
}

async function startTerminalRenderer(): Promise<TerminalRenderer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  let mode: TerminalMode = "pass";
  const server = createServer(async (request, response) => {
    try {
      const url = request.url ?? "/";
      if (url === "/health") {
        if (mode === "main-unavailable") {
          response.writeHead(502, { "content-type": "application/json" });
          response.end("{}");
          return;
        }
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
      if (url === "/identity/state") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(terminalIdentityState()));
        return;
      }
      if (url === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      const pathname = url === "/" ? "/index.html" : url;
      if (pathname.includes("..")) {
        response.writeHead(403).end();
        return;
      }
      const filePath = path.resolve(rendererRoot, `.${pathname}`);
      const extension = path.extname(filePath);
      const file = await readFile(filePath);
      response.writeHead(200, {
        "content-type":
          extension === ".html"
            ? "text/html; charset=utf-8"
            : extension === ".css"
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8",
      });
      response.end(file);
    } catch {
      response.writeHead(502, { "content-type": "application/json" });
      response.end("{}");
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
    setMode(next) {
      mode = next;
    },
  };
}

function terminalIdentityState(): IdentityAuthenticatedState {
  return {
    allowedPermissions: [],
    attendance: null,
    entitlement: {
      capabilities: [...FREE_CORE_CAPABILITY_NAMES],
      licence: null,
      status: "free-core",
    },
    pharmacy: { id: PHARMACY_ID, name: "Breev Terminal Pharmacy" },
    session: {
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "019b0000-0000-7000-8000-000000000404",
    },
    settings: { attendanceEnabled: false, revision: "1" },
    state: "authenticated",
    user: {
      displayName: "Terminal Cashier",
      id: "019b0000-0000-7000-8000-000000000405",
      revision: "1",
      role: "sales_employee",
      status: "active",
      username: "terminal.cashier",
    },
  };
}
