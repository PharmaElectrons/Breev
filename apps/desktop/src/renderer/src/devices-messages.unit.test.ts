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

  it("clarifies seat usage breakdown in English", () => {
    expect(devicesMessages.en.seatUsageBreakdown("1", "0", 0)).toBe(
      "1 Main + 0 terminals",
    );
    expect(devicesMessages.en.seatUsageBreakdown("1", "1", 1)).toBe(
      "1 Main + 1 terminal",
    );
    expect(devicesMessages.en.seatUsageBreakdown("1", "2", 2)).toBe(
      "1 Main + 2 terminals",
    );
    expect(devicesMessages.en.seatUsageBreakdown("1", "5", 5)).toBe(
      "1 Main + 5 terminals",
    );
  });

  it("clarifies seat usage breakdown in Arabic with proper pluralization", () => {
    expect(devicesMessages.ar.seatUsageBreakdown("١", "٠", 0)).toBe(
      "١ رئيسية + ٠ نقطة بيع",
    );
    expect(devicesMessages.ar.seatUsageBreakdown("١", "١", 1)).toBe(
      "١ رئيسية + ١ نقطة بيع",
    );
    expect(devicesMessages.ar.seatUsageBreakdown("١", "٢", 2)).toBe(
      "١ رئيسية + ٢ نقطة بيع",
    );
    expect(devicesMessages.ar.seatUsageBreakdown("١", "٣", 3)).toBe(
      "١ رئيسية + ٣ نقاط بيع",
    );
    expect(devicesMessages.ar.seatUsageBreakdown("١", "١٠", 10)).toBe(
      "١ رئيسية + ١٠ نقاط بيع",
    );
    expect(devicesMessages.ar.seatUsageBreakdown("١", "١١", 11)).toBe(
      "١ رئيسية + ١١ نقطة بيع",
    );
  });

  it("clarifies that total seats include the Main computer in both locales", () => {
    expect(devicesMessages.en.description).toContain(
      "Total licensed seats include this Main computer.",
    );
    expect(devicesMessages.ar.description).toContain(
      "يشمل إجمالي المقاعد المرخصة هذه الحاسبة الرئيسية.",
    );
  });
});
