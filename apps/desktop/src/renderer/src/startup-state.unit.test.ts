import {
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  LocalRestVersionMismatchError,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { messages } from "./messages";
import {
  stateFromHealth,
  stateFromStartupFailure,
  stateFromTerminalPairing,
} from "./startup-state";

const terminalEndpoint = { host: "192.168.1.10", port: 8443 };

describe("desktop startup state", () => {
  it("derives ready only from a healthy authoritative response", () => {
    expect(
      stateFromHealth({
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "healthy",
        database: "available",
      }),
    ).toBe("ready");
  });

  it("derives main unavailable from a reachable degraded API", () => {
    expect(
      stateFromHealth({
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "degraded",
        database: "unavailable",
      }),
    ).toBe("main-unavailable");
  });

  it("derives repair required only from the typed repair signal", () => {
    expect(
      stateFromHealth({
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "repair-required",
        repair: { code: "installation-state-invalid" },
      }),
    ).toBe("repair-required");
  });

  it("separates version mismatch from ordinary unavailability", () => {
    expect(
      stateFromStartupFailure(new LocalRestVersionMismatchError("1", "1")),
    ).toBe("incompatible-version");
    expect(stateFromStartupFailure(new TypeError("fetch failed"))).toBe(
      "main-unavailable",
    );
  });

  it("shows the pairing ceremony for a terminal without a certificate", () => {
    expect(
      stateFromTerminalPairing({
        candidates: [],
        stage: "awaiting-invitation",
      }),
    ).toBe("unpaired");
    expect(
      stateFromTerminalPairing({
        candidates: [],
        endpoint: terminalEndpoint,
        stage: "generating-key",
      }),
    ).toBe("unpaired");
    expect(
      stateFromTerminalPairing({
        candidates: [],
        deviceName: "Counter 2",
        endpoint: terminalEndpoint,
        fingerprintDigits: "012345678901",
        stage: "awaiting-confirmation",
      }),
    ).toBe("unpaired");
    expect(
      stateFromTerminalPairing({
        candidates: [],
        endpoint: null,
        reason: "session-expired",
        stage: "failed",
      }),
    ).toBe("unpaired");
  });

  it("hands a paired terminal back to the health handshake", () => {
    expect(
      stateFromTerminalPairing({
        candidates: [],
        deviceId: "0199c0de-0000-7000-8000-000000000001",
        endpoint: terminalEndpoint,
        installationId: "0199c0de-0000-7000-8000-000000000000",
        stage: "paired",
      }),
    ).toBe("connecting");
  });

  it("keeps the LAN-loss state distinct from the unpaired state", () => {
    expect(messages.en.status["main-unavailable"].title).toBe(
      "Main unavailable",
    );
    expect(messages.ar.status["main-unavailable"].title).toBe(
      "الحاسبة الرئيسية غير متاحة",
    );
    expect(messages.en.status.unpaired.title.length).toBeGreaterThan(0);
    expect(messages.ar.status.unpaired.title.length).toBeGreaterThan(0);
    expect(messages.en.status.unpaired.title).not.toBe(
      messages.en.status["main-unavailable"].title,
    );
  });
});
