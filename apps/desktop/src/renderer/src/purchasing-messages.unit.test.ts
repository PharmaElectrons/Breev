import { describe, expect, it } from "vitest";
import {
  PURCHASE_ADJUSTMENT_REASONS,
  PURCHASING_DENIAL_CODES,
} from "@breev/contracts/local-rest";

import {
  getAdjustmentReasonLabel,
  getPurchasingDenialMessage,
  purchasingMessages,
  purchaseAdjustmentMessages,
  purchasingSupportMessages,
} from "./purchasing-messages";

describe("purchasing translations", () => {
  it("fills every key in Arabic and English", () => {
    for (const locale of ["ar", "en"] as const) {
      const copy = purchasingMessages[locale];
      for (const [key, value] of Object.entries(copy)) {
        if (typeof value === "string") {
          expect(value, `${locale}/${key}`).not.toBe("");
        }
      }
    }
  });

  it("keeps both locales on the same key set", () => {
    expect(Object.keys(purchasingMessages.ar).sort()).toEqual(
      Object.keys(purchasingMessages.en).sort(),
    );
    for (const catalogue of [
      purchaseAdjustmentMessages,
      purchasingSupportMessages,
    ]) {
      expect(Object.keys(catalogue.ar).sort()).toEqual(
        Object.keys(catalogue.en).sort(),
      );
      for (const locale of ["ar", "en"] as const)
        for (const value of Object.values(catalogue[locale]))
          expect(value).not.toBe("");
    }
  });

  it("translates every adjustment reason in Arabic and English", () => {
    for (const reason of PURCHASE_ADJUSTMENT_REASONS) {
      const arLabel = getAdjustmentReasonLabel(reason, "ar");
      const enLabel = getAdjustmentReasonLabel(reason, "en");
      expect(arLabel).not.toBe("");
      expect(enLabel).not.toBe("");
      // Arabic should differ from the raw English enum
      expect(arLabel).not.toBe(reason);
    }

    expect(getAdjustmentReasonLabel("quantity error", "ar")).toBe(
      "خطأ في الكمية",
    );
    expect(getAdjustmentReasonLabel("price error", "ar")).toBe("خطأ في السعر");
    expect(getAdjustmentReasonLabel("invoice-number error", "ar")).toBe(
      "خطأ في رقم الفاتورة",
    );
    expect(getAdjustmentReasonLabel("supplier error", "ar")).toBe(
      "خطأ في المورد",
    );
    expect(getAdjustmentReasonLabel("other", "ar")).toBe("أخرى");
  });

  it("maps purchasing denial codes to friendly localized messages", () => {
    expect(getPurchasingDenialMessage("adjustment-empty", "ar")).toBe(
      "لم يتم إجراء أي تعديل على الفاتورة",
    );
    expect(getPurchasingDenialMessage("adjustment-batch-conflict", "ar")).toBe(
      "تعارض في بيانات الوجبة أو تاريخ الصلاحية",
    );
    expect(getPurchasingDenialMessage("return-empty", "ar")).toBe(
      "يجب تحديد كمية راجعة واحدة على الأقل",
    );
    expect(getPurchasingDenialMessage("return-quantity-exceeded", "ar")).toBe(
      "الكمية المرتجعة تتجاوز الكمية المتاحة في الفاتورة",
    );
    expect(getPurchasingDenialMessage("return-over-eligible", "ar")).toBe(
      "الكمية المرتجعة تتجاوز الكمية المتاحة في الفاتورة",
    );

    for (const locale of ["ar", "en"] as const) {
      for (const code of [...PURCHASING_DENIAL_CODES, "unknown-denial-code"]) {
        expect(getPurchasingDenialMessage(code, locale)).not.toContain(code);
      }
    }
  });
});
