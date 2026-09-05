import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APP_CONTENT_SECURITY_POLICY,
  addMainDeviceRequestHeaders,
  addTerminalBridgeRequestHeaders,
  createDesktopStartupConfig,
  createIdentifierCopyIpcGuard,
  createIpcGuard,
  createStartupConfigIpcGuard,
  createHardenedWindowOptions,
  normalizeFrameUrl,
  resolveAppAssetPath,
  resolveRendererEntry,
  readMainDeviceBinding,
  readInstallationId,
} from "./security.js";

describe("breev app protocol", () => {
  const rendererRoot = path.resolve("/opt/breev/renderer");

  it("resolves only packaged assets below the renderer root", () => {
    expect(resolveAppAssetPath(rendererRoot, "breev://app/")).toBe(
      path.join(rendererRoot, "index.html"),
    );
    expect(resolveAppAssetPath(rendererRoot, "breev://app/assets/app.js")).toBe(
      path.join(rendererRoot, "assets/app.js"),
    );
  });

  it("resolves app routes with client hash fragments to index.html", () => {
    expect(
      resolveAppAssetPath(rendererRoot, "breev://app/index.html#/purchases"),
    ).toBe(path.join(rendererRoot, "index.html"));
    expect(resolveAppAssetPath(rendererRoot, "breev://app/#/purchases")).toBe(
      path.join(rendererRoot, "index.html"),
    );
    expect(resolveAppAssetPath(rendererRoot, "breev://app/index.html#")).toBe(
      path.join(rendererRoot, "index.html"),
    );
  });

  it.each([
    "file:///etc/passwd",
    "breev://other/index.html",
    "breev://app/%2e%2e%2fpackage.json",
    "breev://app/%5c..%5cpackage.json",
    "breev://app/assets/app.js?source=outside",
    "breev://user@app/index.html",
  ])("rejects an invalid or traversing asset URL: %s", (requestUrl) => {
    expect(() => resolveAppAssetPath(rendererRoot, requestUrl)).toThrow();
  });
});

describe("startup configuration IPC", () => {
  const trustedInvocation = {
    senderFrame: {
      isMainFrame: true,
      origin: "breev://app",
      processId: 41,
      url: "breev://app/index.html",
    },
    senderId: 7,
  } as const;

  it("accepts the empty payload from the packaged main frame", () => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
      trustedProcessId: () => 41,
      trustedSenderId: 7,
    });

    expect(guard(trustedInvocation, {})).toEqual({});
    expect(
      guard(
        {
          ...trustedInvocation,
          senderFrame: {
            ...trustedInvocation.senderFrame,
            url: "breev://app/index.html#/dashboard",
          },
        },
        {},
      ),
    ).toEqual({});
  });

  it("accepts only UUID copy requests from the trusted main frame", () => {
    const guard = createIdentifierCopyIpcGuard({
      now: () => 1_000,
      trustedProcessId: () => 41,
      trustedSenderId: 7,
    });
    const request = {
      identifier: "0198dcbb-d7e3-7000-8000-000000000001",
    };

    expect(guard(trustedInvocation, request)).toEqual(request);
    expect(() =>
      createIdentifierCopyIpcGuard({
        now: () => 1_000,
        trustedProcessId: () => 41,
        trustedSenderId: 7,
      })(trustedInvocation, { identifier: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      createIdentifierCopyIpcGuard({
        now: () => 1_000,
        trustedProcessId: () => 41,
        trustedSenderId: 7,
      })({ ...trustedInvocation, senderId: 8 }, request),
    ).toThrow();
  });

  it("accepts invocation from a frame whose URL carries a client hash route", () => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
      trustedProcessId: () => 41,
      trustedSenderId: 7,
    });

    expect(
      guard(
        {
          ...trustedInvocation,
          senderFrame: {
            ...trustedInvocation.senderFrame,
            url: "breev://app/index.html#/purchases",
          },
        },
        {},
      ),
    ).toEqual({});
  });

  it.each([
    [{ ...trustedInvocation, senderFrame: null }, {}],
    [{ ...trustedInvocation, senderId: 8 }, {}],
    [
      {
        ...trustedInvocation,
        senderFrame: { ...trustedInvocation.senderFrame, processId: 42 },
      },
      {},
    ],
    [
      {
        ...trustedInvocation,
        senderFrame: {
          ...trustedInvocation.senderFrame,
          isMainFrame: false,
        },
      },
      {},
    ],
    [
      {
        ...trustedInvocation,
        senderFrame: {
          ...trustedInvocation.senderFrame,
          url: "breev://app/index.html?channel=generic#/dashboard",
        },
      },
      {},
    ],
    [
      {
        ...trustedInvocation,
        senderFrame: {
          ...trustedInvocation.senderFrame,
          origin: "null",
        },
      },
      {},
    ],
    [
      {
        ...trustedInvocation,
        senderFrame: {
          ...trustedInvocation.senderFrame,
          url: "https://attacker.example",
        },
      },
      {},
    ],
    [trustedInvocation, { channel: "generic" }],
    [trustedInvocation, { padding: "x".repeat(1_024) }],
  ])("denies invalid sender or payload information", (invocation, payload) => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
      trustedProcessId: () => 41,
      trustedSenderId: 7,
    });

    expect(() => guard(invocation, payload)).toThrow();
  });

  it("denies calls above the startup configuration rate", () => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
      trustedProcessId: () => 41,
      trustedSenderId: 7,
    });

    for (let count = 0; count < 4; count += 1) {
      expect(guard(trustedInvocation, {})).toEqual({});
    }
    expect(() => guard(trustedInvocation, {})).toThrow(/rate/i);
  });

  it("returns the validated local identifiers for Main and terminal roles", () => {
    const main = createDesktopStartupConfig({
      diagnosticReporting: "disabled",
      identity: {
        deviceId: "0198dcbb-d7e3-7000-8000-000000000001",
        installationId: "b7b6c3b5-dddf-4d1e-a03a-94a7cd2cfec4",
      },
      localApiOrigin: "http://127.0.0.1:31310",
      role: "main",
    });
    const terminal = createDesktopStartupConfig({
      diagnosticReporting: "manual",
      identity: {
        deviceId: "0198dcbb-d7e3-7000-8000-000000000002",
        installationId: "0198dcbb-d7e3-7000-8000-000000000003",
      },
      localApiOrigin: "http://127.0.0.1:41999",
      role: "terminal",
    });

    expect(main).toMatchObject({ role: "main" });
    expect(terminal).toMatchObject({ role: "terminal" });
    expect(main.deviceId).not.toBe(terminal.deviceId);
    expect(main.installationId).toBe("b7b6c3b5-dddf-4d1e-a03a-94a7cd2cfec4");
  });

  it("denies cyclic payloads that cannot pass the size guard", () => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
      trustedProcessId: () => 41,
      trustedSenderId: 7,
    });
    const payload: { self?: unknown } = {};
    payload.self = payload;

    expect(() => guard(trustedInvocation, payload)).toThrow(
      /non-serializable/i,
    );
  });
});

describe("Electron window security", () => {
  it("always selects the custom protocol for a packaged app", () => {
    expect(resolveRendererEntry(true, "https://attacker.example")).toEqual({
      origin: "breev://app",
      url: "breev://app/index.html",
    });
  });

  it("normalizes only a loopback HTTP development renderer", () => {
    expect(resolveRendererEntry(false, "http://localhost:5173")).toEqual({
      origin: "http://localhost:5173",
      url: "http://localhost:5173/",
    });
    for (const invalidUrl of [
      "https://localhost:5173/",
      "http://attacker.example:5173/",
      "file:///tmp/index.html",
      "http://user:secret@localhost:5173/",
    ]) {
      expect(() => resolveRendererEntry(false, invalidUrl)).toThrow();
    }
  });

  it("uses the required production web preferences", () => {
    const options = createHardenedWindowOptions(
      "/opt/breev/preload/index.cjs",
      true,
    );

    expect(options.webPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      preload: "/opt/breev/preload/index.cjs",
      sandbox: true,
      webSecurity: true,
    });
  });

  it("sets a strict CSP without inline script or style execution", () => {
    expect(APP_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(APP_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(APP_CONTENT_SECURITY_POLICY).toContain("style-src 'self'");
    expect(APP_CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(APP_CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    expect(APP_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it("keeps the development meta policy identical to the protocol header", () => {
    const rendererHtml = readFileSync(
      path.resolve(import.meta.dirname, "../renderer/index.html"),
      "utf8",
    );

    expect(rendererHtml).toContain(`content="${APP_CONTENT_SECURITY_POLICY}"`);
  });
});

describe("Main device request binding", () => {
  const binding = {
    deviceId: "0198dcbb-d7e3-7000-8000-000000000001",
    deviceSecret: "A".repeat(43),
    sessionToken: "B".repeat(43),
  } as const;

  it("accepts only a complete high-entropy Main binding", () => {
    expect(
      readMainDeviceBinding({
        BREEV_MAIN_DEVICE_ID: binding.deviceId,
        BREEV_MAIN_DEVICE_SECRET: binding.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: binding.sessionToken,
      }),
    ).toEqual(binding);
    expect(readMainDeviceBinding({})).toBeUndefined();
    expect(() =>
      readMainDeviceBinding({ BREEV_MAIN_DEVICE_ID: binding.deviceId }),
    ).toThrow();
    expect(() =>
      readMainDeviceBinding({
        BREEV_MAIN_DEVICE_ID: "b7b6c3b5-dddf-4d1e-a03a-94a7cd2cfec4",
        BREEV_MAIN_DEVICE_SECRET: binding.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: binding.sessionToken,
      }),
    ).toThrow();
  });

  it("reads the binding from the file named by BREEV_MAIN_DEVICE_FILE", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const configRoot = await mkdtemp(join(tmpdir(), "breev-binding-"));
    const filePath = join(configRoot, "main-device.json");
    await writeFile(filePath, JSON.stringify(binding), "utf8");

    expect(readMainDeviceBinding({ BREEV_MAIN_DEVICE_FILE: filePath })).toEqual(
      binding,
    );

    await writeFile(filePath, JSON.stringify({ deviceId: binding.deviceId }));
    expect(() =>
      readMainDeviceBinding({ BREEV_MAIN_DEVICE_FILE: filePath }),
    ).toThrow();

    // A configured path that does not resolve is an installation defect and
    // must fail loudly rather than silently starting without a binding.
    expect(() =>
      readMainDeviceBinding({
        BREEV_MAIN_DEVICE_FILE: join(configRoot, "missing.json"),
      }),
    ).toThrow("missing or unreadable");
  });

  it("reads only a valid non-empty installation ID from installation metadata", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const configRoot = await mkdtemp(join(tmpdir(), "breev-installation-"));
    const filePath = join(configRoot, "installation.json");
    const installationId = "b7b6c3b5-dddf-4d1e-a03a-94a7cd2cfec4";

    await writeFile(filePath, JSON.stringify({ installationId }), "utf8");
    expect(readInstallationId({ BREEV_INSTALLATION_FILE: filePath })).toBe(
      installationId,
    );

    await writeFile(filePath, JSON.stringify({ installationId: " " }), "utf8");
    expect(
      readInstallationId({ BREEV_INSTALLATION_FILE: filePath }),
    ).toBeUndefined();
    expect(
      readInstallationId({
        BREEV_INSTALLATION_FILE: join(configRoot, "missing.json"),
      }),
    ).toBeUndefined();
  });

  it("injects binding headers only into the trusted window's exact API origin", () => {
    expect(
      addMainDeviceRequestHeaders(
        {
          requestHeaders: { Accept: "application/json" },
          url: "http://127.0.0.1:31310/security/device-session-proof",
          webContentsId: 7,
        },
        {
          binding,
          localApiOrigin: "http://127.0.0.1:31310",
          trustedWebContentsId: 7,
        },
      ),
    ).toEqual({
      Accept: "application/json",
      Authorization: `Breev-Device ${binding.deviceSecret}`,
      "X-Breev-Device-Id": binding.deviceId,
      "X-Breev-Device-Session": binding.sessionToken,
    });
  });

  it.each([
    ["http://127.0.0.1:31311/security/device-session-proof", 7],
    ["https://attacker.example/security/device-session-proof", 7],
    ["http://127.0.0.1:31310/security/device-session-proof", 8],
  ])(
    "does not attach secrets to URL %s from web contents %i",
    (url, webContentsId) => {
      expect(
        addMainDeviceRequestHeaders(
          { requestHeaders: {}, url, webContentsId },
          {
            binding,
            localApiOrigin: "http://127.0.0.1:31310",
            trustedWebContentsId: 7,
          },
        ),
      ).toEqual({});
    },
  );
});

describe("terminal bridge request token", () => {
  const bridgeOrigin = "http://127.0.0.1:41999";
  const token = "T".repeat(43);

  it("attaches the boot token only to the trusted window's bridge origin", () => {
    expect(
      addTerminalBridgeRequestHeaders(
        {
          requestHeaders: { Accept: "application/json" },
          url: `${bridgeOrigin}/health`,
          webContentsId: 7,
        },
        { bridgeOrigin, token, trustedWebContentsId: 7 },
      ),
    ).toEqual({
      Accept: "application/json",
      "x-breev-bridge-token": token,
    });
  });

  it.each([
    ["http://127.0.0.1:41998/health", 7],
    ["https://attacker.example/health", 7],
    ["http://127.0.0.1:41999/health", 8],
  ])(
    "does not attach the token to %s from web contents %i",
    (url, webContentsId) => {
      expect(
        addTerminalBridgeRequestHeaders(
          { requestHeaders: {}, url, webContentsId },
          { bridgeOrigin, token, trustedWebContentsId: 7 },
        ),
      ).toEqual({});
    },
  );

  it("strips a token the renderer tried to supply itself", () => {
    expect(
      addTerminalBridgeRequestHeaders(
        {
          requestHeaders: { "X-Breev-Bridge-Token": "forged" },
          url: "https://attacker.example/health",
          webContentsId: 7,
        },
        { bridgeOrigin, token, trustedWebContentsId: 7 },
      ),
    ).toEqual({});
  });
});

describe("shared IPC guard", () => {
  const trusted = {
    senderFrame: {
      isMainFrame: true,
      origin: "breev://app",
      processId: 41,
      url: "breev://app/index.html",
    },
    senderId: 7,
  };

  function guardFor(maximumPayloadBytes = 64) {
    return createIpcGuard({
      maximumCalls: 2,
      maximumPayloadBytes,
      name: "pairing invitation",
      now: () => 1_000,
      parse: (payload: unknown) => payload as { invitation?: string },
      trustedProcessId: () => 41,
      trustedSenderId: 7,
    });
  }

  it("names the channel it denied so the failure is traceable", () => {
    expect(() => guardFor()({ ...trusted, senderId: 8 }, {})).toThrow(
      /pairing invitation IPC from this frame/u,
    );
  });

  it("bounds the payload of each channel separately", () => {
    expect(() => guardFor(16)(trusted, { invitation: "x".repeat(64) })).toThrow(
      /oversized pairing invitation/u,
    );
    expect(guardFor(4_096)(trusted, { invitation: "x".repeat(64) })).toEqual({
      invitation: "x".repeat(64),
    });
  });

  it("bounds the rate of each channel separately", () => {
    const guard = guardFor();
    expect(guard(trusted, {})).toEqual({});
    expect(guard(trusted, {})).toEqual({});
    expect(() => guard(trusted, {})).toThrow(/rate/iu);
  });

  it("counts malformed calls toward the channel rate limit", () => {
    const guard = guardFor(16);
    expect(() => guard(trusted, { invitation: "x".repeat(64) })).toThrow(
      /oversized/iu,
    );
    expect(() => guard(trusted, { invitation: "x".repeat(64) })).toThrow(
      /oversized/iu,
    );
    expect(() => guard(trusted, {})).toThrow(/rate/iu);
  });
});

describe("frame URL normalization", () => {
  it.each([
    ["breev://app", "breev://app/index.html"],
    ["breev://app/", "breev://app/index.html"],
    ["breev://app/index.html", "breev://app/index.html"],
    ["breev://app/index.html#/purchases", "breev://app/index.html"],
    ["breev://app/#/purchases", "breev://app/index.html"],
    ["http://127.0.0.1:5173/", "http://127.0.0.1:5173/"],
    ["http://127.0.0.1:5173/#/purchases", "http://127.0.0.1:5173/"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeFrameUrl(input)).toBe(expected);
  });
});
