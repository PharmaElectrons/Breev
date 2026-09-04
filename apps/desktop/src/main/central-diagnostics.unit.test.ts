import { describe, expect, it, vi } from "vitest";

import {
  readCentralDiagnosticConfiguration,
  submitCentralDiagnostic,
} from "./central-diagnostics.js";

describe("manual central diagnostics", () => {
  it("is disabled unless both the manual gate and a valid HTTPS DSN exist", () => {
    expect(readCentralDiagnosticConfiguration({})).toBeUndefined();
    expect(
      readCentralDiagnosticConfiguration({
        BREEV_DIAGNOSTIC_REPORTING: "automatic",
        BREEV_SENTRY_DSN: "https://public@example.test/123",
      }),
    ).toBeUndefined();
    for (const dsn of [
      "http://public@example.test/123",
      "https://public:secret@example.test/123",
      "https://public@example.test/project",
      "javascript:alert(1)",
    ]) {
      expect(
        readCentralDiagnosticConfiguration({
          BREEV_DIAGNOSTIC_REPORTING: "manual",
          BREEV_SENTRY_DSN: dsn,
        }),
      ).toBeUndefined();
    }
  });

  it("builds the fixed Sentry envelope endpoint from a public DSN", () => {
    expect(
      readCentralDiagnosticConfiguration({
        BREEV_DIAGNOSTIC_REPORTING: "manual",
        BREEV_SENTRY_DSN: "https://public123@o1.ingest.example.test/prefix/456",
      }),
    ).toEqual({
      dsn: "https://public123@o1.ingest.example.test/prefix/456",
      endpoint: "https://o1.ingest.example.test/prefix/api/456/envelope/",
    });
  });

  it("submits only a redacted bounded manual event", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const result = await submitCentralDiagnostic(
      {
        dsn: "https://public@example.test/123",
        endpoint: "https://example.test/api/123/envelope/",
      },
      {
        appVersion: "1.2.3",
        bundle: {
          application: { version: "1.2.3" },
          logs: [
            { event: "renderer-incident", patientName: "patient-name-canary" },
          ],
          token: "token-canary",
        },
        incidentCode: "VIEW-0123ABCD",
      },
      fetcher,
    );
    expect(result).toEqual({
      reportId: expect.stringMatching(/^[0-9a-f]{32}$/u),
      status: "submitted",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [endpoint, options] = fetcher.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(endpoint).toBe("https://example.test/api/123/envelope/");
    expect(options.body).toContain("VIEW-0123ABCD");
    expect(options.body).not.toContain("patient-name-canary");
    expect(options.body).not.toContain("token-canary");
  });

  it("fails closed when offline", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      submitCentralDiagnostic(
        {
          dsn: "https://public@example.test/123",
          endpoint: "https://example.test/api/123/envelope/",
        },
        { appVersion: "1.2.3", bundle: {} },
        fetcher,
      ),
    ).resolves.toEqual({ status: "failed" });
  });
});
