import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APP_CONTENT_SECURITY_POLICY,
  addMainDeviceRequestHeaders,
  createStartupConfigIpcGuard,
  createHardenedWindowOptions,
  resolveAppAssetPath,
  resolveRendererEntry,
  readMainDeviceBinding,
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
      url: "breev://app/index.html",
    },
    senderId: 7,
  } as const;

  it("accepts the empty payload from the packaged main frame", () => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
      trustedSenderId: 7,
    });

    expect(guard(trustedInvocation, {})).toEqual({});
  });

  it.each([
    [{ ...trustedInvocation, senderFrame: null }, {}],
    [{ ...trustedInvocation, senderId: 8 }, {}],
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
      trustedSenderId: 7,
    });

    expect(() => guard(invocation, payload)).toThrow();
  });

  it("denies calls above the startup configuration rate", () => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
      trustedSenderId: 7,
    });

    for (let count = 0; count < 4; count += 1) {
      expect(guard(trustedInvocation, {})).toEqual({});
    }
    expect(() => guard(trustedInvocation, {})).toThrow(/rate/i);
  });

  it("denies cyclic payloads that cannot pass the size guard", () => {
    const guard = createStartupConfigIpcGuard({
      now: () => 1_000,
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
