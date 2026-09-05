import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CrashFallback,
  DiagnosticSubmissionConfirmation,
  crashCopyForLocale,
  createAsyncIncidentCode,
  createIncidentCode,
} from "./error-boundary";

describe("renderer diagnostic error boundary", () => {
  it("creates a stable closed incident code without exposing the message", () => {
    const error = new Error("patient-name-canary");
    error.stack =
      "Error: patient-name-canary\n at Catalog (C:\\Users\\Name\\app.tsx:10:2)";

    const first = createIncidentCode(error, "workspace");
    const second = createIncidentCode(error, "workspace");

    expect(first).toBe(second);
    expect(first).toMatch(/^VIEW-[0-9A-F]{8}$/u);
    expect(first).not.toContain("patient");
    expect(first).not.toContain("Name");

    const equivalent = new Error("different patient");
    equivalent.stack =
      "Error: different patient\n at Catalog (D:\\Other\\private.tsx:99:7)";
    expect(createIncidentCode(equivalent, "workspace")).toBe(first);
  });

  it("uses distinct prefixes for each containment level", () => {
    expect(createIncidentCode(new Error("x"), "bootstrap")).toMatch(/^BOOT-/u);
    expect(createIncidentCode(new Error("x"), "application")).toMatch(/^APP-/u);
    expect(createIncidentCode(new Error("x"), "workspace")).toMatch(/^VIEW-/u);
    expect(createAsyncIncidentCode(new Error("x"))).toMatch(/^ASYNC-/u);
  });

  it("provides complete and distinct Arabic and English recovery copy", () => {
    const english = crashCopyForLocale("en");
    const arabic = crashCopyForLocale("ar");
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect(english[key].trim().length, "English " + key).toBeGreaterThan(0);
      expect(arabic[key].trim().length, "Arabic " + key).toBeGreaterThan(0);
      expect(arabic[key], key).not.toBe(english[key]);
    }
  });

  it.each(["en", "ar"] as const)(
    "renders a localized privacy-safe recovery surface in %s",
    (locale) => {
      const copy = crashCopyForLocale(locale);
      const markup = renderToStaticMarkup(
        createElement(CrashFallback, {
          copiedState: "idle",
          contactState: "unavailable",
          copy,
          exportState: "idle",
          incidentCode: "VIEW-0123ABCD",
          level: "workspace",
          onCancelSubmission: () => undefined,
          onConfirmSubmission: () => undefined,
          onConfirmationButton: () => undefined,
          onContactSupport: () => undefined,
          onCopy: () => undefined,
          onExportDiagnostics: () => undefined,
          onHeading: () => undefined,
          onReload: () => undefined,
          onRetry: () => undefined,
          onSubmitDiagnostics: () => undefined,
          secondaryCopy: undefined,
          submissionReportId: null,
          submissionState: "idle",
        }),
      );
      expect(markup).toContain('role="alert"');
      expect(markup).toContain(copy.privacyNotice);
      expect(markup).toContain(
        locale === "en"
          ? "Write down the incident code"
          : copy.manualSupportInstructions,
      );
      expect(markup).not.toContain("different patient");
      expect(markup).not.toContain("private.tsx");
    },
  );

  it("renders an explicit modal confirmation before central submission", () => {
    const copy = crashCopyForLocale("en");
    const markup = renderToStaticMarkup(
      createElement(DiagnosticSubmissionConfirmation, {
        copy,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain(copy.confirmSubmissionDescription);
    expect(markup).toContain(copy.confirmSubmission);
    expect(markup).toContain(copy.cancelSubmission);
  });
});
