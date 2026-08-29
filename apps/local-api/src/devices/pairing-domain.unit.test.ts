import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildFetchTranscript,
  buildFingerprintTranscript,
  buildJoinTranscript,
  decodePairingInvitation,
  deriveFingerprintDigits,
  describeSeatUsage,
  encodePairingBinding,
  encodePairingInvitation,
  evaluateCancellation,
  evaluateCertificateDelivery,
  evaluateConfirmation,
  evaluateJoinAttempt,
  evaluateSeatAllocation,
  fingerprintToBytes,
  uuidToBytes,
  PAIRING_TRANSCRIPT_LABELS,
  type PairingSessionSnapshot,
} from "./pairing-domain.js";

const SESSION_ID = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const INSTALLATION_ID = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const CA_FINGERPRINT =
  "1122334455667788990011223344556677889900112233445566778899001122";
// The same fixed SubjectPublicKeyInfo stand-in the terminal client pins, so
// both sides of the ceremony are compared against one published vector.
const SPKI = Buffer.from("30820122300d06092a864886f70d0101010500", "hex");
const BINDING = {
  caFingerprint: CA_FINGERPRINT,
  installationId: INSTALLATION_ID,
  sessionId: SESSION_ID,
  spkiDer: SPKI,
};

const NOW = new Date("2026-03-01T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-03-01T12:05:00.000Z");

function snapshot(
  overrides: Partial<PairingSessionSnapshot> = {},
): PairingSessionSnapshot {
  return {
    boundAt: undefined,
    consumedAt: undefined,
    expiresAt: EXPIRES_AT,
    joinAttemptCount: 0,
    maxJoinAttempts: 5,
    state: "open",
    ...overrides,
  };
}

describe("pairing transcripts and fingerprint digits", () => {
  it("reproduces the published transcript vectors byte for byte", () => {
    expect(
      createHash("sha256").update(buildJoinTranscript(BINDING)).digest("hex"),
    ).toBe("82deaea3fc62781a1946454e6f06ba996e46aa1dc46af44ad9979eb42d60d2a2");
    expect(
      createHash("sha256").update(buildFetchTranscript(BINDING)).digest("hex"),
    ).toBe("b9674994473797899604db60dc4c2c9698095bcad1e58955fd9e0b72cf21eb21");
    expect(deriveFingerprintDigits(buildFingerprintTranscript(BINDING))).toBe(
      "903205141592",
    );
  });

  it("separates the three transcripts by domain label and a zero byte", () => {
    const join = buildJoinTranscript(BINDING);
    const fetch = buildFetchTranscript(BINDING);
    const phrase = buildFingerprintTranscript(BINDING);
    for (const [transcript, label] of [
      [join, PAIRING_TRANSCRIPT_LABELS.join],
      [fetch, PAIRING_TRANSCRIPT_LABELS.fetch],
      [phrase, PAIRING_TRANSCRIPT_LABELS.fingerprint],
    ] as const) {
      expect(transcript.subarray(0, label.length).toString("utf8")).toBe(label);
      expect(transcript[label.length]).toBe(0);
    }
    expect(join).toEqual(
      Buffer.concat([
        Buffer.from(PAIRING_TRANSCRIPT_LABELS.join, "utf8"),
        Buffer.of(0),
        uuidToBytes(SESSION_ID),
        uuidToBytes(INSTALLATION_ID),
        fingerprintToBytes(CA_FINGERPRINT),
        SPKI,
      ]),
    );
    // The fetch transcript deliberately omits the CA fingerprint, so a join
    // signature can never be replayed as a certificate collection.
    expect(fetch.includes(fingerprintToBytes(CA_FINGERPRINT))).toBe(false);
  });

  it("changes the digits when any bound fact changes", () => {
    const digits = deriveFingerprintDigits(buildFingerprintTranscript(BINDING));
    const variants = [
      { ...BINDING, sessionId: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0d" },
      { ...BINDING, installationId: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0e" },
      { ...BINDING, caFingerprint: CA_FINGERPRINT.replace(/^11/u, "22") },
      { ...BINDING, spkiDer: Buffer.concat([SPKI, Buffer.of(1)]) },
    ];
    for (const variant of variants) {
      expect(
        deriveFingerprintDigits(buildFingerprintTranscript(variant)),
      ).not.toBe(digits);
    }
  });

  it.each([
    "",
    "not-a-uuid",
    "0192f0a0-1c2d-4e3f-8a4b-5c6d7e8f9a0b",
    "0192f0a0-1c2d-7e3f-0a4b-5c6d7e8f9a0b",
  ])("refuses an identifier that is not a UUIDv7: %s", (value) => {
    expect(() => uuidToBytes(value)).toThrow();
  });

  it.each(["", "11".repeat(31), "AB".repeat(32), "ZZ".repeat(32)])(
    "refuses a certificate authority pin that is not 32 lowercase hex bytes",
    (value) => {
      expect(() => fingerprintToBytes(value)).toThrow();
    },
  );
});

describe("pairing invitation and binding artifacts", () => {
  const invitation = {
    caFingerprint: CA_FINGERPRINT,
    host: "192.168.1.10",
    installationId: INSTALLATION_ID,
    joinSecret: "A".repeat(43),
    port: 31_311,
    sessionId: SESSION_ID,
  };

  it("round-trips the invitation through its canonical encoding", () => {
    const uri = encodePairingInvitation(invitation);
    expect(uri.startsWith("breev-pair://1/")).toBe(true);
    expect(decodePairingInvitation(uri)).toEqual(invitation);
  });

  it("refuses an invitation that was truncated or re-encoded", () => {
    const uri = encodePairingInvitation(invitation);
    expect(decodePairingInvitation(`${uri}=`)).toBeUndefined();
    expect(decodePairingInvitation(uri.slice(0, -4))).toBeUndefined();
    expect(
      decodePairingInvitation("breev-pair://1/not base64"),
    ).toBeUndefined();
    expect(decodePairingInvitation("https://example.test")).toBeUndefined();
  });

  it("publishes the terminal key digest without the join secret", () => {
    const binding = encodePairingBinding({
      caFingerprint: CA_FINGERPRINT,
      host: invitation.host,
      installationId: INSTALLATION_ID,
      port: invitation.port,
      sessionId: SESSION_ID,
      spkiSha256: createHash("sha256").update(SPKI).digest("hex"),
    });
    expect(binding.startsWith("breev-pair://2/")).toBe(true);
    const payload = Buffer.from(
      binding.slice("breev-pair://2/".length),
      "base64url",
    ).toString("utf8");
    expect(payload).toContain('"t"');
    expect(payload).not.toContain('"k"');
    expect(payload).not.toContain(invitation.joinSecret);
  });
});

describe("pairing session state machine", () => {
  it("binds a terminal that presents the right secret to an open session", () => {
    expect(
      evaluateJoinAttempt({
        now: NOW,
        secretMatches: true,
        snapshot: snapshot(),
      }),
    ).toEqual({ kind: "bind" });
  });

  it("counts a wrong secret without revealing that the session exists", () => {
    expect(
      evaluateJoinAttempt({
        now: NOW,
        secretMatches: false,
        snapshot: snapshot(),
      }),
    ).toEqual({
      kind: "deny",
      auditCode: "pairing-session-missing",
      nextState: undefined,
      recordAttempt: true,
      responseCode: "pairing-session-missing",
    });
  });

  it("fails the session on the attempt that exhausts the budget", () => {
    expect(
      evaluateJoinAttempt({
        now: NOW,
        secretMatches: false,
        snapshot: snapshot({ joinAttemptCount: 4 }),
      }),
    ).toEqual({
      kind: "deny",
      auditCode: "pairing-attempts-exceeded",
      nextState: "failed",
      recordAttempt: true,
      responseCode: "pairing-attempts-exceeded",
    });
  });

  it("refuses a further attempt once the budget is already spent", () => {
    expect(
      evaluateJoinAttempt({
        now: NOW,
        secretMatches: true,
        snapshot: snapshot({ joinAttemptCount: 5 }),
      }),
    ).toMatchObject({
      auditCode: "pairing-attempts-exceeded",
      kind: "deny",
      recordAttempt: false,
      responseCode: "pairing-attempts-exceeded",
    });
  });

  it("treats a second join as a replay and never rebinds the key", () => {
    for (const state of ["awaiting-confirmation", "confirmed"] as const) {
      expect(
        evaluateJoinAttempt({
          now: NOW,
          secretMatches: true,
          snapshot: snapshot({ boundAt: NOW, state }),
        }),
      ).toEqual({
        kind: "deny",
        auditCode: "pairing-session-replayed",
        nextState: undefined,
        recordAttempt: false,
        responseCode: "pairing-session-replayed",
      });
    }
  });

  it("expires an open session on the server clock rather than trusting it", () => {
    expect(
      evaluateJoinAttempt({
        now: EXPIRES_AT,
        secretMatches: true,
        snapshot: snapshot(),
      }),
    ).toEqual({
      kind: "deny",
      auditCode: "pairing-session-expired",
      nextState: "expired",
      recordAttempt: false,
      responseCode: "pairing-session-expired",
    });
  });

  it.each([
    ["cancelled", "pairing-session-conflict"],
    ["failed", "pairing-attempts-exceeded"],
  ] as const)(
    "refuses a join against a %s session with %s",
    (state, responseCode) => {
      expect(
        evaluateJoinAttempt({
          now: NOW,
          secretMatches: true,
          snapshot: snapshot({ state }),
        }),
      ).toMatchObject({ kind: "deny", responseCode });
    },
  );

  it("confirms only a session that a terminal has already bound", () => {
    expect(
      evaluateConfirmation({
        now: NOW,
        snapshot: snapshot({ boundAt: NOW, state: "awaiting-confirmation" }),
      }),
    ).toEqual({ kind: "allow" });
    expect(evaluateConfirmation({ now: NOW, snapshot: snapshot() })).toEqual({
      kind: "deny",
      code: "pairing-session-conflict",
    });
  });

  it.each([
    [
      "a second confirmation",
      snapshot({ boundAt: NOW, consumedAt: NOW, state: "confirmed" }),
      NOW,
      "pairing-session-replayed",
    ],
    [
      "an expired session",
      snapshot({ boundAt: NOW, state: "awaiting-confirmation" }),
      EXPIRES_AT,
      "pairing-session-expired",
    ],
    [
      "a cancelled session",
      snapshot({ boundAt: NOW, state: "cancelled" }),
      NOW,
      "pairing-session-conflict",
    ],
    [
      "a failed session",
      snapshot({ state: "failed" }),
      NOW,
      "pairing-session-conflict",
    ],
  ])("refuses confirmation of %s", (_name, current, now, code) => {
    expect(evaluateConfirmation({ now, snapshot: current })).toEqual({
      kind: "deny",
      code,
    });
  });

  it("cancels an open or awaiting session and nothing else", () => {
    expect(evaluateCancellation({ now: NOW, snapshot: snapshot() })).toEqual({
      kind: "allow",
    });
    expect(
      evaluateCancellation({
        now: NOW,
        snapshot: snapshot({ boundAt: NOW, state: "awaiting-confirmation" }),
      }),
    ).toEqual({ kind: "allow" });
    expect(
      evaluateCancellation({
        now: NOW,
        snapshot: snapshot({ consumedAt: NOW, state: "confirmed" }),
      }),
    ).toEqual({ kind: "deny", code: "pairing-session-replayed" });
    expect(
      evaluateCancellation({
        now: NOW,
        snapshot: snapshot({ state: "failed" }),
      }),
    ).toEqual({ kind: "deny", code: "pairing-session-conflict" });
    expect(
      evaluateCancellation({ now: EXPIRES_AT, snapshot: snapshot() }),
    ).toEqual({ kind: "deny", code: "pairing-session-expired" });
  });

  it("delivers a certificate only after confirmation, and keeps delivering it", () => {
    const confirmed = snapshot({ consumedAt: NOW, state: "confirmed" });
    expect(
      evaluateCertificateDelivery({ now: NOW, snapshot: confirmed }),
    ).toEqual({ kind: "allow" });
    // Expiry no longer applies: the certificate already exists, and a terminal
    // that lost the response must be able to collect it again.
    expect(
      evaluateCertificateDelivery({ now: EXPIRES_AT, snapshot: confirmed }),
    ).toEqual({ kind: "allow" });
    expect(
      evaluateCertificateDelivery({
        now: NOW,
        snapshot: snapshot({ boundAt: NOW, state: "awaiting-confirmation" }),
      }),
    ).toEqual({ kind: "deny", code: "pairing-session-conflict" });
    expect(
      evaluateCertificateDelivery({ now: EXPIRES_AT, snapshot: snapshot() }),
    ).toEqual({ kind: "deny", code: "pairing-session-expired" });
    expect(
      evaluateCertificateDelivery({
        now: NOW,
        snapshot: snapshot({ state: "cancelled" }),
      }),
    ).toEqual({ kind: "deny", code: "pairing-session-conflict" });
  });
});

describe("seat policy", () => {
  it("counts the Main Pharmacy Computer as one of the permitted devices", () => {
    expect(
      describeSeatUsage({
        allocatedTerminalSeats: 2,
        permittedDeviceCount: 4,
      }),
    ).toEqual({ permitted: 4, used: 3 });
  });

  /**
   * The permitted count is licence data. This proves the policy is a function
   * of that number alone across its whole legal range: no value is special, and
   * nothing in the code fixes the limit at four.
   */
  it.each([1, 2, 3, 4, 5, 9, 17, 64, 500, 10_000])(
    "allows exactly permitted-minus-one terminals for a licence permitting %i",
    (permittedDeviceCount) => {
      for (
        let allocatedTerminalSeats = 0;
        allocatedTerminalSeats <= permittedDeviceCount + 1;
        allocatedTerminalSeats += 1
      ) {
        const decision = evaluateSeatAllocation({
          allocatedTerminalSeats,
          permittedDeviceCount,
        });
        const shouldAllocate =
          1 + allocatedTerminalSeats + 1 <= permittedDeviceCount;
        expect(decision.kind).toBe(shouldAllocate ? "allocate" : "deny");
        if (decision.kind === "deny") {
          expect(decision.code).toBe("pairing-seat-unavailable");
        }
        expect(decision.usage.permitted).toBe(permittedDeviceCount);
      }
    },
  );

  it("reports the seat the pairing would take when it allows one", () => {
    expect(
      evaluateSeatAllocation({
        allocatedTerminalSeats: 1,
        permittedDeviceCount: 4,
      }),
    ).toEqual({ kind: "allocate", usage: { permitted: 4, used: 3 } });
  });

  it("keeps a revoked terminal's seat counted until it is released", () => {
    // The caller counts every device whose seat has not been released, revoked
    // or not, so a revoked terminal still occupies the seat it was given.
    expect(
      evaluateSeatAllocation({
        allocatedTerminalSeats: 3,
        permittedDeviceCount: 4,
      }),
    ).toMatchObject({ kind: "deny", code: "pairing-seat-unavailable" });
    expect(
      evaluateSeatAllocation({
        allocatedTerminalSeats: 2,
        permittedDeviceCount: 4,
      }),
    ).toMatchObject({ kind: "allocate" });
  });
});
