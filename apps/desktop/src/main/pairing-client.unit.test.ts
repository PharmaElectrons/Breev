import { describe, expect, it } from "vitest";

import {
  PairingFailure,
  SESSION_POLL_INTERVAL_MS,
  SESSION_POLL_RATE_LIMITED_BACKOFF_MS,
  decidePairingPoll,
  mapPairingDenial,
  mapPairingSessionState,
  parseIssuedCertificate,
} from "./pairing-client.js";

const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const deviceId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0e";

const issued = {
  caCertificatePem:
    "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----",
  certificatePem:
    "-----BEGIN CERTIFICATE-----\nBB==\n-----END CERTIFICATE-----",
  deviceId,
  installationId,
};

describe("pairing denial mapping", () => {
  it.each([
    ["pairing-attempts-exceeded", "attempts-exceeded"],
    ["pairing-entitlement-missing", "entitlement-missing"],
    ["pairing-seat-unavailable", "seat-unavailable"],
    ["pairing-session-expired", "session-expired"],
  ])("gives %s its own retryable state", (code, reason) => {
    expect(mapPairingDenial(code)).toBe(reason);
  });

  it.each([
    "pairing-session-missing",
    "pairing-session-replayed",
    "pairing-signature-invalid",
    "pairing-session-conflict",
    "something-new",
    undefined,
    42,
  ])("denies without guessing for %s", (code) => {
    expect(mapPairingDenial(code)).toBe("session-denied");
  });
});

describe("pairing session state mapping", () => {
  it.each(["open", "awaiting-confirmation"])(
    "keeps waiting while the session is %s",
    (state) => {
      expect(mapPairingSessionState(state)).toEqual({ kind: "waiting" });
    },
  );

  it("proceeds only once the user confirmed", () => {
    expect(mapPairingSessionState("confirmed")).toEqual({ kind: "confirmed" });
  });

  it.each([
    ["cancelled", "session-cancelled"],
    ["expired", "session-expired"],
    ["failed", "attempts-exceeded"],
    ["something-new", "session-denied"],
    [undefined, "session-denied"],
  ])("ends on %s", (state, reason) => {
    expect(mapPairingSessionState(state)).toEqual({ kind: "failed", reason });
  });
});

describe("confirmation poll decisions", () => {
  const minute = 60_000;

  it("polls slowly enough to stay inside the channel's state allowance", () => {
    expect(SESSION_POLL_INTERVAL_MS).toBe(3_000);
    expect(minute / SESSION_POLL_INTERVAL_MS).toBeLessThanOrEqual(90);
    expect(SESSION_POLL_RATE_LIMITED_BACKOFF_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("keeps waiting while the session is still open", () => {
    expect(
      decidePairingPoll({
        payload: { state: "open" },
        remainingMs: minute,
        status: 200,
      }),
    ).toEqual({ kind: "retry", waitMs: SESSION_POLL_INTERVAL_MS });
  });

  it("treats a rate-limited poll as busy, not as a denial", () => {
    expect(
      decidePairingPoll({
        payload: { code: "rate-limit-exceeded" },
        remainingMs: minute,
        status: 429,
      }),
    ).toEqual({
      kind: "retry",
      waitMs: SESSION_POLL_RATE_LIMITED_BACKOFF_MS,
    });
  });

  it("never sleeps past the ceremony deadline", () => {
    expect(
      decidePairingPoll({ payload: {}, remainingMs: 4_000, status: 429 }),
    ).toEqual({ kind: "retry", waitMs: 4_000 });
    expect(
      decidePairingPoll({
        payload: { state: "open" },
        remainingMs: 1_000,
        status: 200,
      }),
    ).toEqual({ kind: "retry", waitMs: 1_000 });
  });

  it.each([0, -1, -60_000])(
    "ends the ceremony once the deadline has passed: %s left",
    (remainingMs) => {
      expect(
        decidePairingPoll({ payload: {}, remainingMs, status: 429 }),
      ).toEqual({ kind: "failed", reason: "session-expired" });
      expect(
        decidePairingPoll({
          payload: { state: "awaiting-confirmation" },
          remainingMs,
          status: 200,
        }),
      ).toEqual({ kind: "failed", reason: "session-expired" });
    },
  );

  it("proceeds as soon as the Main installation confirms", () => {
    expect(
      decidePairingPoll({
        payload: { state: "confirmed" },
        remainingMs: minute,
        status: 200,
      }),
    ).toEqual({ kind: "confirmed" });
  });

  it.each([
    [403, "pairing-session-expired", "session-expired"],
    [403, "pairing-attempts-exceeded", "attempts-exceeded"],
    [404, "pairing-session-missing", "session-denied"],
    [500, undefined, "session-denied"],
  ])("keeps every non-429 denial terminal: %s %s", (status, code, reason) => {
    expect(
      decidePairingPoll({ payload: { code }, remainingMs: minute, status }),
    ).toEqual({ kind: "failed", reason });
  });

  it("ends on a session the Main installation has already closed", () => {
    expect(
      decidePairingPoll({
        payload: { state: "cancelled" },
        remainingMs: minute,
        status: 200,
      }),
    ).toEqual({ kind: "failed", reason: "session-cancelled" });
  });
});

describe("issued certificate payload", () => {
  it("accepts the response shape the pairing channel publishes", () => {
    expect(parseIssuedCertificate(issued, installationId)).toEqual(issued);
  });

  it.each([
    ["another installation", { ...issued, installationId: deviceId }],
    [
      "a version 4 device",
      { ...issued, deviceId: "0192f0a0-1c2d-4e3f-8a4b-5c6d7e8f9a0e" },
    ],
    ["no certificate", { ...issued, certificatePem: undefined }],
    ["no authority", { ...issued, caCertificatePem: undefined }],
    ["a numeric certificate", { ...issued, certificatePem: 1 }],
    ["nothing at all", undefined],
    ["an array", []],
  ])("refuses a response carrying %s", (_label, payload) => {
    expect(() => parseIssuedCertificate(payload, installationId)).toThrow(
      PairingFailure,
    );
  });

  it("names the state the renderer must show", () => {
    try {
      parseIssuedCertificate(undefined, installationId);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PairingFailure);
      expect((error as PairingFailure).reason).toBe("certificate-invalid");
    }
  });
});
