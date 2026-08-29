import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_API_VERSION,
  parseLocalHealthResponse,
} from "@breev/contracts/local-rest";
import { afterAll, describe, expect, it } from "vitest";

import {
  BRIDGE_APP_ORIGIN,
  BRIDGE_TOKEN_HEADER,
  authorizeBridgeRequest,
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  mainUnavailableBody,
  startTerminalBridge,
  type TerminalBridge,
} from "./terminal-bridge.js";

const token = "a".repeat(43);
const authority = "127.0.0.1:31500";
const origin = "breev://app";

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    expectedAuthority: authority,
    expectedOrigin: origin,
    headers: {
      host: authority,
      origin,
      [BRIDGE_TOKEN_HEADER]: token,
      ...(overrides.headers as Record<string, unknown> | undefined),
    },
    method: "GET",
    token,
    ...overrides,
  } as Parameters<typeof authorizeBridgeRequest>[0];
}

describe("terminal bridge authorization", () => {
  it("admits the trusted renderer carrying this boot's token", () => {
    expect(authorizeBridgeRequest(invocation())).toEqual({ allowed: true });
  });

  it("admits a request that carries no origin header", () => {
    expect(
      authorizeBridgeRequest(
        invocation({
          headers: {
            host: authority,
            [BRIDGE_TOKEN_HEADER]: token,
            origin: undefined,
          },
        }),
      ),
    ).toEqual({ allowed: true });
  });

  it.each([
    ["no token", { [BRIDGE_TOKEN_HEADER]: undefined }],
    ["an empty token", { [BRIDGE_TOKEN_HEADER]: "" }],
    ["a near-miss token", { [BRIDGE_TOKEN_HEADER]: `${"a".repeat(42)}b` }],
    ["a longer token", { [BRIDGE_TOKEN_HEADER]: `${token}a` }],
    ["a list of tokens", { [BRIDGE_TOKEN_HEADER]: [token, token] }],
  ])("denies a request with %s", (_label, headers) => {
    expect(
      authorizeBridgeRequest(
        invocation({ headers: { host: authority, origin, ...headers } }),
      ),
    ).toEqual({ allowed: false, reason: "token-invalid", status: 403 });
  });

  it("denies a rebound host name", () => {
    expect(
      authorizeBridgeRequest(
        invocation({
          headers: {
            host: "breev.attacker.example",
            origin,
            [BRIDGE_TOKEN_HEADER]: token,
          },
        }),
      ),
    ).toEqual({ allowed: false, reason: "host-mismatch", status: 403 });
  });

  it("denies another origin", () => {
    expect(
      authorizeBridgeRequest(
        invocation({
          headers: {
            host: authority,
            origin: "https://attacker.example",
            [BRIDGE_TOKEN_HEADER]: token,
          },
        }),
      ),
    ).toEqual({ allowed: false, reason: "origin-mismatch", status: 403 });
  });

  it.each(["TRACE", "CONNECT", "OPTIONS", undefined])(
    "denies the method %s",
    (method) => {
      expect(authorizeBridgeRequest(invocation({ method }))).toEqual({
        allowed: false,
        reason: "method-not-allowed",
        status: 405,
      });
    },
  );
});

describe("terminal bridge header rewriting", () => {
  it("speaks for the device rather than forwarding what the caller chose", () => {
    const headers = buildUpstreamHeaders({
      accept: "application/json",
      authorization: "Breev-Device stolen",
      cookie: "session=stolen",
      host: authority,
      origin: "https://attacker.example",
      "x-breev-bridge-token": token,
      [BREEV_CSRF_HEADER]: "0",
      "x-breev-device-id": "spoofed",
      "x-forwarded-for": "10.0.0.9",
    });

    expect(headers).toEqual({
      accept: "application/json",
      origin: BRIDGE_APP_ORIGIN,
      [BREEV_CSRF_HEADER.toLowerCase()]: BREEV_CSRF_VALUE,
    });
  });

  it("owns the cross-origin policy of its own responses", () => {
    const headers = buildDownstreamHeaders(
      {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
        "set-cookie": ["session=leaked"],
        "transfer-encoding": "chunked",
      },
      origin,
    );

    expect(headers["access-control-allow-origin"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Origin"]).toBe(origin);
    expect(headers["set-cookie"]).toBeUndefined();
    expect(headers["transfer-encoding"]).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
  });

  it("reports a lost Main installation as the health state the shell knows", () => {
    const payload = mainUnavailableBody("/health");
    const health = parseLocalHealthResponse(503, JSON.parse(payload.body));

    expect(health.status).toBe("degraded");
    expect(health.apiVersion).toBe(LOCAL_API_VERSION);
    expect(mainUnavailableBody("/identity/session").body).not.toContain(
      "degraded",
    );
  });
});

describe("terminal bridge listener", () => {
  const bridges: TerminalBridge[] = [];

  afterAll(async () => {
    await Promise.all(bridges.map(async (bridge) => bridge.close()));
  });

  async function listening(): Promise<TerminalBridge> {
    const bridge = await startTerminalBridge({ allowedOrigin: origin });
    bridges.push(bridge);
    return bridge;
  }

  it("listens on a loopback origin the renderer may use unchanged", async () => {
    const bridge = await listening();
    expect(bridge.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(bridge.token).toHaveLength(43);
  });

  it("mints a different token for every boot", async () => {
    const first = await listening();
    const second = await listening();
    expect(first.token).not.toBe(second.token);
  });

  it("denies a loopback caller that cannot present the token", async () => {
    const bridge = await listening();
    const response = await fetch(`${bridge.origin}/health`, {
      headers: { origin },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "token-invalid" });
  });

  it("reports the blocking state while no Main installation is reachable", async () => {
    const bridge = await listening();
    const response = await fetch(`${bridge.origin}/health`, {
      headers: { origin, [BRIDGE_TOKEN_HEADER]: bridge.token },
    });

    expect(response.status).toBe(503);
    expect(
      parseLocalHealthResponse(response.status, await response.json()).status,
    ).toBe("degraded");
  });

  it("answers a preflight for the trusted renderer only", async () => {
    const bridge = await listening();
    const allowed = await fetch(`${bridge.origin}/identity/session`, {
      headers: { origin },
      method: "OPTIONS",
    });
    const denied = await fetch(`${bridge.origin}/identity/session`, {
      headers: { origin: "https://attacker.example" },
      method: "OPTIONS",
    });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
