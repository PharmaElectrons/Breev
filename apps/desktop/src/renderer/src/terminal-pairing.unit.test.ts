import {
  TERMINAL_PAIRING_FAILURE_REASONS,
  TERMINAL_PAIRING_STAGES,
  type TerminalPairingState,
} from "@breev/contracts/desktop-preload";
import { describe, expect, it } from "vitest";

import {
  acceptsPairingInvitation,
  isPairingInProgress,
  isPairingInvitation,
  isPairingRetryable,
  pairingFingerprintDigits,
  pairingProgressIndex,
  parseEndpointPort,
  TERMINAL_PAIRING_PROGRESS_STEPS,
  UNRECOVERABLE_PAIRING_FAILURES,
} from "./terminal-pairing";
import { terminalPairingMessages } from "./terminal-pairing-messages";

const endpoint = { host: "192.168.1.10", port: 8443 };
const digits = "012345678901";

const awaitingInvitation: TerminalPairingState = {
  candidates: [],
  stage: "awaiting-invitation",
};
const generatingKey: TerminalPairingState = {
  candidates: [],
  endpoint,
  stage: "generating-key",
};
const awaitingConfirmation: TerminalPairingState = {
  candidates: [],
  deviceName: "Counter 2",
  endpoint,
  fingerprintDigits: digits,
  stage: "awaiting-confirmation",
};
const fetchingCertificate: TerminalPairingState = {
  candidates: [],
  endpoint,
  fingerprintDigits: digits,
  stage: "fetching-certificate",
};
const paired: TerminalPairingState = {
  candidates: [],
  deviceId: "0199c0de-0000-7000-8000-000000000001",
  endpoint,
  installationId: "0199c0de-0000-7000-8000-000000000000",
  stage: "paired",
};
const failed: TerminalPairingState = {
  candidates: [],
  endpoint: null,
  reason: "server-identity-rejected",
  stage: "failed",
};
const unprotectedMachine: TerminalPairingState = {
  candidates: [],
  endpoint: null,
  reason: "key-protection-unavailable",
  stage: "failed",
};

describe("terminal pairing progress", () => {
  it("orders the ceremony steps the terminal shows", () => {
    expect([...TERMINAL_PAIRING_PROGRESS_STEPS]).toEqual([
      "validating-endpoint",
      "generating-key",
      "joining",
      "awaiting-confirmation",
      "fetching-certificate",
      "paired",
    ]);
  });

  it("covers every contract stage as either a step or a resting stage", () => {
    for (const stage of TERMINAL_PAIRING_STAGES) {
      const resting = stage === "awaiting-invitation" || stage === "failed";
      expect(pairingProgressIndex(stage) === -1).toBe(resting);
    }
  });

  it("places the ceremony stages in ceremony order", () => {
    expect(pairingProgressIndex("validating-endpoint")).toBe(0);
    expect(pairingProgressIndex("generating-key")).toBe(1);
    expect(pairingProgressIndex("joining")).toBe(2);
    expect(pairingProgressIndex("awaiting-confirmation")).toBe(3);
    expect(pairingProgressIndex("fetching-certificate")).toBe(4);
    expect(pairingProgressIndex("paired")).toBe(5);
  });

  it("reports progress only while the ceremony runs", () => {
    expect(isPairingInProgress(awaitingInvitation)).toBe(false);
    expect(isPairingInProgress(generatingKey)).toBe(true);
    expect(isPairingInProgress(awaitingConfirmation)).toBe(true);
    expect(isPairingInProgress(fetchingCertificate)).toBe(true);
    expect(isPairingInProgress(paired)).toBe(false);
    expect(isPairingInProgress(failed)).toBe(false);
  });

  it("offers the invitation form only when idle or stopped by a failure", () => {
    expect(acceptsPairingInvitation(awaitingInvitation)).toBe(true);
    expect(acceptsPairingInvitation(failed)).toBe(true);
    expect(acceptsPairingInvitation(generatingKey)).toBe(false);
    expect(acceptsPairingInvitation(awaitingConfirmation)).toBe(false);
    expect(acceptsPairingInvitation(paired)).toBe(false);
  });

  it("withholds the invitation form when another attempt cannot succeed", () => {
    expect(acceptsPairingInvitation(unprotectedMachine)).toBe(false);
  });

  it("treats every failure but an unprotectable key as retryable", () => {
    for (const reason of TERMINAL_PAIRING_FAILURE_REASONS) {
      expect(isPairingRetryable(reason)).toBe(
        reason !== "key-protection-unavailable",
      );
    }
    expect([...UNRECOVERABLE_PAIRING_FAILURES]).toEqual([
      "key-protection-unavailable",
    ]);
  });

  it("shows the comparison digits only once a key has been proposed", () => {
    expect(pairingFingerprintDigits(awaitingConfirmation)).toBe(digits);
    expect(pairingFingerprintDigits(fetchingCertificate)).toBe(digits);
    expect(pairingFingerprintDigits(awaitingInvitation)).toBeNull();
    expect(pairingFingerprintDigits(generatingKey)).toBeNull();
    expect(pairingFingerprintDigits(paired)).toBeNull();
    expect(pairingFingerprintDigits(failed)).toBeNull();
  });
});

describe("terminal pairing input validation", () => {
  it("accepts an invitation exactly as the scanner types it", () => {
    expect(isPairingInvitation("breev-pair://1/eyJ2IjoxfQ")).toBe(true);
    expect(isPairingInvitation("  breev-pair://1/eyJ2IjoxfQ  ")).toBe(true);
  });

  it("rejects anything that is not a version 1 pairing invitation", () => {
    expect(isPairingInvitation("")).toBe(false);
    expect(isPairingInvitation("breev-pair://2/eyJ2IjoxfQ")).toBe(false);
    expect(isPairingInvitation("https://breev.example/pair")).toBe(false);
    expect(isPairingInvitation("breev-pair://1/")).toBe(false);
    expect(isPairingInvitation("breev-pair://1/not base64")).toBe(false);
    expect(isPairingInvitation(`breev-pair://1/${"a".repeat(2_048)}`)).toBe(
      false,
    );
  });

  it("accepts only ports inside the TCP range", () => {
    expect(parseEndpointPort("8443")).toBe(8443);
    expect(parseEndpointPort("1")).toBe(1);
    expect(parseEndpointPort("65535")).toBe(65_535);
    expect(parseEndpointPort("0")).toBeNull();
    expect(parseEndpointPort("65536")).toBeNull();
    expect(parseEndpointPort("")).toBeNull();
    expect(parseEndpointPort("84a3")).toBeNull();
    expect(parseEndpointPort("-1")).toBeNull();
  });
});

describe("terminal pairing translations", () => {
  it("translates every failure reason in both locales", () => {
    for (const locale of ["ar", "en"] as const) {
      for (const reason of TERMINAL_PAIRING_FAILURE_REASONS) {
        expect(
          terminalPairingMessages[locale].failures[reason].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the two locales distinct so neither falls back to the other", () => {
    for (const reason of TERMINAL_PAIRING_FAILURE_REASONS) {
      expect(terminalPairingMessages.ar.failures[reason]).not.toBe(
        terminalPairingMessages.en.failures[reason],
      );
    }
  });

  it("names every ceremony step in both locales", () => {
    for (const locale of ["ar", "en"] as const) {
      for (const step of TERMINAL_PAIRING_PROGRESS_STEPS) {
        expect(
          terminalPairingMessages[locale].steps[step].length,
        ).toBeGreaterThan(0);
      }
    }
  });
});
