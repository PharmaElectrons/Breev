import {
  DEVICES_DENIAL_CODES,
  pairingCancellationReasonSchema,
  pairingFailureReasonSchema,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { devicesMessages } from "./devices-messages";

const locales = ["ar", "en"] as const;

describe("devices translations", () => {
  it("translates every devices denial code in both locales", () => {
    for (const locale of locales) {
      for (const code of DEVICES_DENIAL_CODES) {
        expect(devicesMessages[locale].denials[code].length).toBeGreaterThan(0);
      }
    }
  });

  it("explains every pairing cancellation reason in both locales", () => {
    for (const locale of locales) {
      for (const reason of pairingCancellationReasonSchema.options) {
        expect(
          devicesMessages[locale].sessionCancelled[reason].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("explains every pairing failure reason in both locales", () => {
    for (const locale of locales) {
      for (const reason of pairingFailureReasonSchema.options) {
        expect(
          devicesMessages[locale].sessionFailed[reason].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the two locales distinct so neither falls back to the other", () => {
    for (const code of DEVICES_DENIAL_CODES) {
      expect(devicesMessages.ar.denials[code]).not.toBe(
        devicesMessages.en.denials[code],
      );
    }
  });
});
