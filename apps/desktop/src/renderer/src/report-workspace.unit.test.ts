import { describe, expect, it } from "vitest";
import { reportCell, reportSourceLabel } from "./report-workspace";
import { reportMessages } from "../../shared/report-messages";

describe("inventory report display localization", () => {
  it.each([
    ["Strip", "شريط"],
    ["Bottle", "زجاجة"],
    ["  BOTTLE  ", "زجاجة"],
    ["Pack", "علبة"],
    ["Box", "علبة"],
    ["Tablet", "قرص"],
    ["Capsule", "كبسولة"],
    ["Ampoule", "أمبولة"],
    ["Vial", "قارورة"],
    ["Tube", "أنبوب"],
    ["Piece", "قطعة"],
    ["Sachet", "كيس"],
    ["Unit", "وحدة"],
    ["Bottles", "زجاجة"],
  ])("localizes %s only in unit display cells", (stored, arabic) => {
    expect(reportCell(stored, "unit", "ar", "Asia/Baghdad")).toBe(arabic);
    expect(reportCell(stored, "unit", "en", "Asia/Baghdad")).toBe(stored);
    expect(reportCell(stored, "item", "ar", "Asia/Baghdad")).toBe(stored);
  });

  it("preserves custom and Arabic snapshots and localizes missing descriptions", () => {
    for (const value of [
      "Custom measure",
      "زجاجة",
      "شريط",
      "constructor",
      "__proto__",
      "toString",
    ])
      for (const locale of ["ar", "en"] as const)
        expect(reportCell(value, "unit", locale, "Asia/Baghdad")).toBe(value);
    for (const locale of ["ar", "en"] as const)
      expect(reportCell(null, "unit", locale, "Asia/Baghdad")).toBe(
        reportMessages[locale].unitUnavailable,
      );
  });

  it("localizes generated actor and count source text without changing references", () => {
    expect(reportCell("system", "actor", "ar", "Asia/Baghdad")).toBe("النظام");
    expect(reportCell("system", "actor", "en", "Asia/Baghdad")).toBe("System");
    expect(reportCell("Employee name", "actor", "ar", "Asia/Baghdad")).toBe(
      "Employee name",
    );
    const reference = "0198bded-c200-7000-8000-000000000001";
    const label = `Count session ${reference} · 12`;
    expect(reportCell(label, "source", "ar", "Asia/Baghdad")).toBe(
      `جلسة جرد ${reference} · السطر ١٢`,
    );
    expect(reportSourceLabel(label, "en", "Asia/Baghdad")).toBe(label);
    expect(
      reportSourceLabel(`Count session ${reference} · line 12`, "ar", "UTC"),
    ).toBe(`جلسة جرد ${reference} · السطر ١٢`);
    expect(
      reportSourceLabel(`Count session ${reference} · line 12`, "en", "UTC"),
    ).toBe(`Count session ${reference} · line 12`);
    expect(reportSourceLabel("C123/2026 · line 2", "ar", "UTC")).toBe(
      "C123/2026 · السطر ٢",
    );
    expect(
      reportSourceLabel(
        "Count session started 2026-09-01T00:00:00Z · line 3",
        "ar",
        "Asia/Baghdad",
      ),
    ).toMatch(/^بدأت جلسة الجرد .* · السطر ٣$/u);
    expect(reportSourceLabel("P123/2026", "ar", "UTC")).toBe("P123/2026");
    for (const source of [
      "purchase-invoice",
      "purchase-receipt",
      "purchase-adjustment",
      "purchase-return",
      "count-session",
    ]) {
      expect(reportSourceLabel(source, "ar", "UTC")).not.toMatch(/[a-z]/iu);
      expect(reportSourceLabel(source, "en", "UTC")).toBe(source);
    }
  });

  it("maps every status, alert and availability label without translating stored names", () => {
    for (const [state, english] of Object.entries(reportMessages.en.states)) {
      for (const column of ["status", "alert", "availability"] as const) {
        expect(reportCell(state, column, "ar", "UTC")).toBe(
          reportMessages.ar.states[state],
        );
        expect(reportCell(state, column, "en", "UTC")).toBe(english);
      }
      expect(reportCell(state, "item", "ar", "UTC")).toBe(state);
    }
    expect(reportMessages.en.saved).toBe("Report saved.");
    expect(reportMessages.ar.saved).toBe("تم حفظ التقرير.");
  });

  it("keeps every report-owned Arabic caption free of English text", () => {
    function assertArabic(value: unknown): void {
      if (typeof value === "string") {
        expect(value).not.toMatch(/[a-z]/iu);
        expect(value).not.toBe("");
      } else if (value !== null && typeof value === "object") {
        for (const caption of Object.values(value)) assertArabic(caption);
      }
    }
    assertArabic(reportMessages.ar);
  });
});
