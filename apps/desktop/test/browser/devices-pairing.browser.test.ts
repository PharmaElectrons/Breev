import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  type StepUpAction,
} from "@breev/contracts/local-rest";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
  type SeparatedDatabaseRoles,
} from "../database-roles.js";
import { mintLicence, TEST_ISSUER_PUBLIC_KEYS } from "../licence-issuer.js";
import {
  spawnLocalApiProcess,
  stopProcess,
  waitForHealth as waitForLocalApiHealth,
} from "../local-api-process.js";
import {
  collectTerminalCertificate,
  joinAsTerminal,
  type JoinedTerminal,
} from "../terminal-role.js";
import { evidencePath } from "./evidence-path.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_PASSWORD = "browser owner password is private";
const APPROVER_PASSWORD = "browser approver password is private";
const FIRST_TERMINAL_NAME = "Counter 2";
const SECOND_TERMINAL_NAME = "Counter 3";

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResult {
  readonly body: Record<string, unknown>;
  readonly status: number;
}

/**
 * How the renderer's proxy treats the devices routes. The two failure modes are
 * separated because the screen owes the operator different things for each: a
 * command that never answered is an unknown outcome, while a poll that stopped
 * answering is data that must stop being acted on.
 */
type DevicesMode = "fail-commands" | "fail-polls" | "pass";

interface PairingRenderer {
  readonly origin: string;
  readonly server: Server;
  setDevicesMode(mode: DevicesMode): void;
}

/**
 * The Main pairing screen against the real local API and a real terminal.
 *
 * Nothing here is stubbed between the screen and the ceremony: the local API
 * runs as a child process with its LAN listener enabled, the terminal half is
 * played over that listener by test/terminal-role.ts — real TLS, a real
 * keypair, a real certificate request, real transcript signatures — and the
 * twelve digits the screen shows are compared with digits this test derives
 * independently.
 */
test.describe.serial("Main pairing screen", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin: string;
  let apiPort: number;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let lanPort: number;
  let pharmacyId: string;
  let postgres: StartedPostgreSqlContainer;
  let renderer: PairingRenderer;
  let terminal: JoinedTerminal;
  let terminalDeviceName: string;

  test.beforeAll(async () => {
    await mkdir(evidenceDirectory(), { recursive: true });
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    lanPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = spawnLocalApi(apiPort, lanPort, databaseRoles, credentials);
    await waitForLocalApiHealth(apiOrigin, "healthy", api, 30_000);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    renderer = await startPairingRenderer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("pairs a terminal over the LAN channel with the digits both screens compare", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);

    await expect(
      page.getByRole("heading", { name: "Set up this pharmacy" }),
    ).toBeVisible();
    await page.getByLabel("Pharmacy name").focus();
    await page.keyboard.type("Breev Devices Pharmacy");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Devices Owner");
    await page.keyboard.press("Tab");
    await page.keyboard.type("devices.owner");
    await page.keyboard.press("Tab");
    await page.keyboard.type(OWNER_PASSWORD);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Create pharmacy and owner" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Welcome, Devices Owner" }),
    ).toBeVisible();

    // The devices section exists for a user who holds devices.pair AND the
    // additional-device-pos entitlement. On Free Core, it is completely absent.
    await expect(
      page.getByRole("heading", { name: "Additional POS terminals" }),
    ).not.toBeVisible();
    await expect(page.getByText("Seats in use")).not.toBeVisible();

    pharmacyId = await readPharmacyId(apiOrigin, credentials);
    await installLicence(apiOrigin, credentials, {
      mainDeviceId: credentials.deviceId,
      permittedDeviceCount: 4,
      pharmacyId,
    });

    // Once the licence is installed, the capability is granted and the panel appears.
    await expect(
      page.getByRole("heading", { name: "Additional POS terminals" }),
    ).toBeVisible();
    await expect(page.getByText("Seats in use")).toBeVisible();
    await expect(seatUsage(page)).toHaveText("1 / 4");

    // Starting a session is a reauthenticated act, reached by keyboard alone.
    const startPairing = page.getByRole("button", { name: "Start pairing" });
    await startPairing.focus();
    await page.keyboard.press("Enter");
    const stepUpPassword = page.getByRole("dialog").getByLabel("Password");
    await expect(stepUpPassword).toBeFocused();
    await page.keyboard.type(OWNER_PASSWORD);
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("img", {
        name: "Pairing code — scan it with the terminal's scanner",
      }),
    ).toBeVisible();
    const invitationUri = (
      await page.locator("code.pairing-uri").innerText()
    ).trim();
    expect(invitationUri.startsWith("breev-pair://1/")).toBe(true);
    await expect(page.getByText("Expires in")).toBeVisible();
    await captureSpread(page, "pairing-invitation");

    // The terminal half, over the LAN listener: pin the authority out of the
    // invitation, generate a key, prove possession, derive the digits.
    terminalDeviceName = FIRST_TERMINAL_NAME;
    terminal = await joinAsTerminal({
      deviceName: terminalDeviceName,
      qrUri: invitationUri,
    });
    expect(terminal.response).toEqual({
      body: { status: "bound" },
      statusCode: 200,
    });

    await expect(
      page.getByRole("heading", { name: "Waiting for your confirmation" }),
    ).toBeVisible();
    await expect(page.getByText(terminalDeviceName)).toBeVisible();
    await expectFingerprintGroups(page, terminal.fingerprintDigits);
    await captureSpread(page, "pairing-confirmation");
    // The comparison artefact is identical in both locales: the digits are the
    // same characters, in the same four groups, isolated left to right.
    await setPreferences(page, "ar", "dark");
    await expectFingerprintGroups(page, terminal.fingerprintDigits);
    await setPreferences(page, "en", "light");

    const confirm = page.getByRole("button", { name: "Confirm pairing" });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("The terminal is paired and its certificate was issued."),
    ).toBeVisible();

    const collected = await collectTerminalCertificate(terminal);
    expect(collected.statusCode).toBe(200);
    expect(String(collected.body.certificatePem)).toContain(
      "-----BEGIN CERTIFICATE-----",
    );
    expect(collected.body.installationId).toBe(
      terminal.invitation.installationId,
    );

    await page.getByRole("button", { name: "Paired devices" }).click();
    const device = deviceRow(page, terminalDeviceName);
    await expect(device).toBeVisible();
    await expect(device.getByText("Active")).toBeVisible();
    await expect(seatUsage(page)).toHaveText("2 / 4");
    await captureSpread(page, "device-list");
  });

  test("names an unanswered command and stops acting on data it cannot refresh", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Devices Owner" }),
    ).toBeVisible();
    const startAgain = page.getByRole("button", {
      name: "Start a new session",
    });
    await expect(startAgain).toBeEnabled();

    // A command that never comes back is not a denial and has no request
    // reference: the screen has to say the outcome is unknown rather than
    // returning to idle as though nothing was asked.
    renderer.setDevicesMode("fail-commands");
    await startAgain.click();
    await page.getByRole("dialog").getByLabel("Password").fill(OWNER_PASSWORD);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();
    await expect(page.getByText("Action could not be completed")).toBeVisible();
    await expect(
      page.getByText(
        "The Main Pharmacy Computer did not answer this action, so it may or may not have been applied. Refresh and check the device state before trying again.",
      ),
    ).toBeVisible();
    await captureSpread(page, "devices-command-failed");
    await page.locator(".devices-failure .dismiss-button").click();
    await expect(page.getByText("Action could not be completed")).toHaveCount(
      0,
    );

    // A poll that stops answering leaves the last known state on screen, and
    // that state must stop being actionable until it is confirmed again.
    renderer.setDevicesMode("fail-polls");
    const staleNotice = page.getByText(
      "The device status could not be refreshed and may be out of date. Actions stay unavailable until it refreshes.",
    );
    await expect(staleNotice).toBeVisible();
    await expect(startAgain).toBeDisabled();
    await page.getByRole("button", { name: "Paired devices" }).click();
    await expect(
      page.getByRole("button", {
        name: `Revoke device: ${terminalDeviceName}`,
      }),
    ).toBeDisabled();
    await captureSpread(page, "devices-stale");

    renderer.setDevicesMode("pass");
    await expect(staleNotice).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: `Revoke device: ${terminalDeviceName}`,
      }),
    ).toBeEnabled();
    // Nothing was started while the command was failing.
    await page.getByRole("button", { name: "Pair a terminal" }).click();
    await expect(
      page.getByText("The terminal is paired and its certificate was issued."),
    ).toBeVisible();
  });

  test("shows the devices section only to a user who has been granted devices.pair", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Devices Owner" }),
    ).toBeVisible();

    await createUser(apiOrigin, credentials, {
      displayName: "Devices Approver",
      password: APPROVER_PASSWORD,
      role: "manager",
      username: "devices.approver",
    });

    await signIn(page, "devices.approver", APPROVER_PASSWORD);
    await expect(
      page.getByRole("heading", { name: "Welcome, Devices Approver" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Additional POS terminals" }),
    ).toHaveCount(0);
    const denied = (await page.evaluate(async () => {
      const response = await fetch("/devices", {
        headers: { Accept: "application/json" },
      });
      return {
        body: (await response.json()) as { code?: string },
        status: response.status,
      };
    })) as { body: { code?: string }; status: number };
    expect(denied).toEqual({
      body: expect.objectContaining({ code: "permission-denied" }),
      status: 403,
    });

    await signIn(page, "devices.owner", OWNER_PASSWORD);
    await page
      .getByRole("navigation", { name: "Roles" })
      .getByRole("button", { name: "Manager" })
      .click();
    const managerRole = page.getByRole("region", { name: "Manager" });
    await expect(managerRole).toBeVisible();
    await managerRole
      .getByLabel("Pair and manage terminals", { exact: true })
      .check();
    await managerRole.getByRole("button", { name: "Save permissions" }).click();
    await page.getByRole("dialog").getByLabel("Password").fill(OWNER_PASSWORD);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await signIn(page, "devices.approver", APPROVER_PASSWORD);
    await expect(
      page.getByRole("heading", { name: "Additional POS terminals" }),
    ).toBeVisible();
    await signIn(page, "devices.owner", OWNER_PASSWORD);
  });

  test("revokes a terminal and frees its seat only after a second user approves", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Devices Owner" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Paired devices" }).click();

    const device = deviceRow(page, terminalDeviceName);
    const revoke = page.getByRole("button", {
      name: `Revoke device: ${terminalDeviceName}`,
    });
    await revoke.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Revocation reason")).toBeFocused();
    await page.keyboard.type("Counter retired");
    await page.getByRole("button", { name: "Confirm revocation" }).click();
    await page.getByRole("dialog").getByLabel("Password").fill(OWNER_PASSWORD);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();

    await expect(device.getByText("Revoked")).toBeVisible();
    await expect(device.getByText("Counter retired")).toBeVisible();
    // Revocation blocks the device; it does not free the seat.
    await expect(
      device.getByText("Waiting for another user's approval"),
    ).toBeVisible();
    await expect(seatUsage(page)).toHaveText("2 / 4");
    await captureSpread(page, "device-revoked");

    await page
      .getByRole("button", {
        name: `Request seat release: ${terminalDeviceName}`,
      })
      .click();
    await page.getByRole("dialog").getByLabel("Password").fill(OWNER_PASSWORD);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm password" })
      .click();

    const approval = page.getByRole("dialog");
    await expect(
      approval.getByRole("heading", { name: "Approve the seat release" }),
    ).toBeVisible();
    await expect(approval.getByLabel("Approver username")).toBeFocused();
    await captureSpread(page, "seat-release-approval");

    // The requester cannot approve their own release: the second user is the
    // whole point of the policy.
    await approval.getByLabel("Approver username").fill("devices.owner");
    await approval.getByLabel("Approver password").fill(OWNER_PASSWORD);
    await approval
      .getByRole("button", { name: "Approve seat release" })
      .click();
    await expect(
      approval.getByText(
        "A seat release must be approved by a different active user who can pair devices, with correct credentials.",
      ),
    ).toBeVisible();
    await expect(seatUsage(page)).toHaveText("2 / 4");

    await approval.locator(".denial-alert .dismiss-button").click();
    await approval.getByLabel("Approver username").fill("devices.approver");
    await approval.getByLabel("Approver password").fill(APPROVER_PASSWORD);
    await approval
      .getByRole("button", { name: "Approve seat release" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(device.getByText("Seat released")).toBeVisible();
    await expect(seatUsage(page)).toHaveText("1 / 4");
    await captureSpread(page, "seat-released");
  });

  test("cancels a session as a fingerprint mismatch and says so in both locales", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Devices Owner" }),
    ).toBeVisible();

    const invitationUri = await startPairingSession(page);
    const mismatched = await joinAsTerminal({
      deviceName: SECOND_TERMINAL_NAME,
      qrUri: invitationUri,
    });
    expect(mismatched.response.statusCode).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Waiting for your confirmation" }),
    ).toBeVisible();

    const mismatch = page.getByRole("button", { name: "Digits do not match" });
    await mismatch.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(
        "The session was cancelled because the verification digits did not match. Check which device tried to connect, then start a new session.",
      ),
    ).toBeVisible();
    await captureSpread(page, "pairing-mismatch");
    await setPreferences(page, "ar", "dark");
    await expect(
      page.getByText(
        "أُلغيت الجلسة لعدم تطابق أرقام التحقق. تحقق من الجهاز الذي يحاول الاتصال ثم ابدأ جلسة جديدة.",
      ),
    ).toBeVisible();
    await setPreferences(page, "en", "light");

    // A cancelled session never became a device and never took a seat.
    await page.getByRole("button", { name: "Paired devices" }).click();
    await expect(deviceRow(page, SECOND_TERMINAL_NAME)).toHaveCount(0);
    await expect(seatUsage(page)).toHaveText("1 / 4");
  });

  test("shows an expired session and refuses a seat the licence does not permit", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin);
    await page.goto(renderer.origin);
    await expect(
      page.getByRole("heading", { name: "Welcome, Devices Owner" }),
    ).toBeVisible();

    await startPairingSession(page);
    // The five-minute deadline is the server's, so the session is aged in the
    // database rather than waited out.
    await administrator.query(
      `update pairing_sessions
       set expires_at = created_at + interval '1 millisecond'
       where state in ('open', 'awaiting-confirmation')`,
    );
    await expect(
      page.getByText("The pairing session expired before it completed."),
    ).toBeVisible({ timeout: 15_000 });
    await captureSpread(page, "pairing-expired");

    // A different signed licence changes the permitted count with no code
    // change: one device permitted means the Main computer alone.
    await installLicence(apiOrigin, credentials, {
      mainDeviceId: credentials.deviceId,
      permittedDeviceCount: 1,
      pharmacyId,
    });
    await expect(seatUsage(page)).toHaveText("1 / 1");

    const invitationUri = await startPairingSession(page);
    const refused = await joinAsTerminal({
      deviceName: SECOND_TERMINAL_NAME,
      qrUri: invitationUri,
    });
    expect(refused.response.statusCode).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Waiting for your confirmation" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm pairing" }).click();
    await expect(
      page.getByText(
        "No seat is available within the permitted device count. Release a revoked device's seat first.",
      ),
    ).toBeVisible();
    await captureSpread(page, "seat-unavailable");

    await page.getByRole("button", { name: "Paired devices" }).click();
    await expect(deviceRow(page, SECOND_TERMINAL_NAME)).toHaveCount(0);
    await expect(seatUsage(page)).toHaveText("1 / 1");
  });
});

async function startPairingSession(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Pair a terminal" }).click();
  const start = page.getByRole("button", {
    name: /^(?:Start pairing|Start a new session)$/u,
  });
  await start.first().click();
  await page.getByRole("dialog").getByLabel("Password").fill(OWNER_PASSWORD);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm password" })
    .click();
  await expect(page.locator("code.pairing-uri")).toBeVisible();
  return (await page.locator("code.pairing-uri").innerText()).trim();
}

async function expectFingerprintGroups(
  page: Page,
  digits: string,
): Promise<void> {
  const groups = [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 9),
    digits.slice(9, 12),
  ];
  const rendered = page.getByTestId("pairing-fingerprint");
  await expect(rendered).toHaveAttribute("dir", "ltr");
  await expect(rendered.locator("span")).toHaveText(groups);
}

function deviceRow(page: Page, displayName: string): Locator {
  return page.locator(".device-list li").filter({ hasText: displayName });
}

function seatUsage(page: Page): Locator {
  return page.locator(".seat-usage strong");
}

async function signIn(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  const signOut = page.getByRole("button", { name: "Sign out" });
  if ((await signOut.count()) > 0) {
    await signOut.click();
  }
  await expect(
    page.getByRole("heading", { name: "Sign in to Breev" }),
  ).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: /^Welcome, /u }),
  ).toBeVisible();
}

/**
 * The bilingual, both-theme, accessibility-clean capture every device screen
 * has to pass. Preferences are restored so the caller keeps driving the screen
 * in the locale it started in.
 */
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

/**
 * Language and theme are switched from the keyboard rather than with a pointer:
 * these screens include modal dialogs whose backdrop covers the header, and the
 * keyboard is the path that has to keep working through them anyway.
 */
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

function evidenceDirectory(): string {
  return evidencePath("issue-42/after");
}

async function installDesktopFake(
  page: Page,
  localApiOrigin: string,
): Promise<void> {
  await page.addInitScript((origin) => {
    const unpaired = {
      candidates: [],
      stage: "awaiting-invitation" as const,
    };
    const desktopApi: BreevDesktopApi = Object.freeze({
      cancelTerminalPairing: async () => unpaired,
      getTerminalPairingState: async () => unpaired,
      submitManualEndpoint: async () => unpaired,
      submitPairingInvitation: async () => unpaired,
      getStartupConfig: async () => ({
        localApiOrigin: origin,
        role: "main" as const,
      }),
    });
    Object.defineProperty(globalThis, "breevDesktop", {
      configurable: false,
      value: desktopApi,
      writable: false,
    });
  }, localApiOrigin);
}

async function readPharmacyId(
  origin: string,
  mainDevice: MainDeviceCredentials,
): Promise<string> {
  const state = await apiRequest(origin, mainDevice, "GET", "/identity/state");
  const pharmacy = state.body.pharmacy;
  if (
    typeof pharmacy !== "object" ||
    pharmacy === null ||
    typeof (pharmacy as { id?: unknown }).id !== "string"
  ) {
    throw new Error("The bootstrapped pharmacy has no identifier");
  }
  return (pharmacy as { id: string }).id;
}

async function installLicence(
  origin: string,
  mainDevice: MainDeviceCredentials,
  input: {
    readonly mainDeviceId: string;
    readonly permittedDeviceCount: number;
    readonly pharmacyId: string;
  },
): Promise<void> {
  const challengeId = await approveStepUp(
    origin,
    mainDevice,
    "licensing.licence.install",
  );
  const installed = await apiRequest(
    origin,
    mainDevice,
    "POST",
    "/licensing/licences",
    {
      challengeId,
      encodedLicence: mintLicence({
        licenceId: createUuidV7(),
        mainDeviceId: input.mainDeviceId,
        permittedDeviceCount: input.permittedDeviceCount,
        pharmacyId: input.pharmacyId,
      }),
      idempotencyKey: randomUUID(),
    },
  );
  if (installed.status !== 201) {
    throw new Error(
      `The test licence was not installed: ${JSON.stringify(installed)}`,
    );
  }
}

async function createUser(
  origin: string,
  mainDevice: MainDeviceCredentials,
  input: {
    readonly displayName: string;
    readonly password: string;
    readonly role: string;
    readonly username: string;
  },
): Promise<void> {
  const challengeId = await approveStepUp(
    origin,
    mainDevice,
    "identity.user.create",
  );
  // Roles are assigned by id; the users list carries the assignable roles.
  const listed = await apiRequest(origin, mainDevice, "GET", "/identity/users");
  const roles =
    (listed.body as { roles?: { id: string; key?: string; kind: string }[] })
      .roles ?? [];
  const roleId = roles.find(
    (role) => role.kind === "built-in" && role.key === input.role,
  )?.id;
  if (roleId === undefined) {
    throw new Error(`The built-in ${input.role} role is missing`);
  }
  const created = await apiRequest(
    origin,
    mainDevice,
    "POST",
    "/identity/users",
    {
      challengeId,
      displayName: input.displayName,
      idempotencyKey: randomUUID(),
      password: input.password,
      roleId,
      username: input.username,
    },
  );
  if (created.status !== 201) {
    throw new Error(
      `The test user was not created: ${JSON.stringify(created)}`,
    );
  }
}

async function approveStepUp(
  origin: string,
  mainDevice: MainDeviceCredentials,
  action: StepUpAction,
): Promise<string> {
  const created = await apiRequest(
    origin,
    mainDevice,
    "POST",
    "/identity/step-up-challenges",
    { action, idempotencyKey: randomUUID() },
  );
  const challengeId = created.body.id;
  if (created.status !== 201 || typeof challengeId !== "string") {
    throw new Error(
      `The step-up challenge was refused: ${JSON.stringify(created)}`,
    );
  }
  const approved = await apiRequest(
    origin,
    mainDevice,
    "POST",
    `/identity/step-up-challenges/${challengeId}/approve`,
    { idempotencyKey: randomUUID(), password: OWNER_PASSWORD },
  );
  if (approved.status !== 200) {
    throw new Error(
      `The step-up challenge was not approved: ${JSON.stringify(approved)}`,
    );
  }
  return challengeId;
}

/**
 * Speaks to the loopback API exactly as the shell does: the Main device
 * binding, the browser-defence headers, and the identity session that binding
 * carries. Setup the screens already prove elsewhere runs through here so each
 * test stays about the devices surface.
 */
async function apiRequest(
  origin: string,
  mainDevice: MainDeviceCredentials,
  method: string,
  requestPath: string,
  body?: unknown,
): Promise<ApiResult> {
  const response = await fetch(new URL(requestPath, origin), {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      Accept: "application/json",
      Authorization: `Breev-Device ${mainDevice.deviceSecret}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
      [LOCAL_DEVICE_ID_HEADER]: mainDevice.deviceId,
      [LOCAL_DEVICE_SESSION_HEADER]: mainDevice.sessionToken,
      Origin: "breev://app",
    },
    method,
  });
  const raw = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = { raw };
  }
  return { body: parsed, status: response.status };
}

async function startPairingRenderer(
  origin: string,
  mainDevice: MainDeviceCredentials,
): Promise<PairingRenderer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  let devicesMode: DevicesMode = "pass";
  const server = createServer(async (request, response) => {
    try {
      const url = request.url ?? "/";
      const method = request.method ?? "GET";
      const devicesRoute = url === "/devices" || url.startsWith("/devices/");
      const blocked =
        devicesMode === "fail-polls"
          ? method === "GET"
          : devicesMode === "fail-commands" && method !== "GET";
      if (devicesRoute && blocked) {
        await readRequestBody(request);
        response.writeHead(502, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      if (
        url === "/health" ||
        url === "/devices" ||
        url.startsWith("/devices/") ||
        url.startsWith("/identity/") ||
        url.startsWith("/licensing/") ||
        url === "/pharmacy/settings" ||
        url === "/attendance/events"
      ) {
        const body = await readRequestBody(request);
        const upstream = await fetch(`${origin}${url}`, {
          ...(body.length === 0 ? {} : { body }),
          headers: {
            Accept: "application/json",
            Authorization: `Breev-Device ${mainDevice.deviceSecret}`,
            ...(body.length === 0
              ? {}
              : { "Content-Type": "application/json" }),
            [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
            [LOCAL_DEVICE_ID_HEADER]: mainDevice.deviceId,
            [LOCAL_DEVICE_SESSION_HEADER]: mainDevice.sessionToken,
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
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    server,
    setDevicesMode(mode) {
      devicesMode = mode;
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
  lanApiPort: number,
  roles: SeparatedDatabaseRoles,
  mainDevice: MainDeviceCredentials,
): ChildProcessWithoutNullStreams {
  return spawnLocalApiProcess(
    path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
    {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_INSTALLATION_STATE: "ready",
      BREEV_LAN_API_HOST: "127.0.0.1",
      BREEV_LAN_API_PORT: String(lanApiPort),
      BREEV_MAIN_DEVICE_ID: mainDevice.deviceId,
      BREEV_MAIN_DEVICE_SECRET: mainDevice.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: mainDevice.sessionToken,
      BREEV_TEST_LICENCE_PUBLIC_KEYS: JSON.stringify(TEST_ISSUER_PUBLIC_KEYS),
      DATABASE_MIGRATION_URL: roles.migrationUrl,
      DATABASE_URL: roles.applicationUrl,
    },
    [
      "--import",
      path.resolve(import.meta.dirname, "../licence-key-override.mjs"),
    ],
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
