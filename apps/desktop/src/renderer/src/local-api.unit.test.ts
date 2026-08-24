import {
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
} from "@breev/contracts/local-rest";
import { describe, expect, it, vi } from "vitest";

import {
  requestLocalHealth,
  requestMainDeviceProofMutation,
} from "./local-api";

describe("desktop local REST client", () => {
  it("returns the contract-derived healthy response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "healthy",
        database: "available",
      }),
    );

    await expect(
      requestLocalHealth("http://127.0.0.1:31310", fetcher),
    ).resolves.toMatchObject({ database: "available" });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:31310/health"),
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns database unavailability from the reachable API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          apiVersion: LOCAL_API_VERSION,
          schemaVersion: LOCAL_SCHEMA_VERSION,
          status: "degraded",
          database: "unavailable",
        },
        { status: 503 },
      ),
    );

    await expect(
      requestLocalHealth("http://127.0.0.1:31310", fetcher),
    ).resolves.toMatchObject({ database: "unavailable" });
  });

  it("rejects when the API cannot be reached", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      requestLocalHealth("http://127.0.0.1:31310", fetcher),
    ).rejects.toThrow("fetch failed");
  });

  it("passes an abort signal so a stalled API becomes unavailable", async () => {
    const signal = AbortSignal.abort(new Error("health check timed out"));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation((_, init) => Promise.reject(init?.signal?.reason));

    await expect(
      requestLocalHealth("http://127.0.0.1:31310", fetcher, signal),
    ).rejects.toThrow("health check timed out");
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ signal }),
    );
  });
});

describe("desktop Main device proof client", () => {
  it("uses the typed JSON mutation without ambient credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { status: "committed", mutationCount: "7" },
          { status: 201 },
        ),
      );

    await expect(
      requestMainDeviceProofMutation("http://127.0.0.1:31310", fetcher),
    ).resolves.toEqual({ status: "committed", mutationCount: "7" });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:31310/security/device-session-proof"),
      expect.objectContaining({
        body: '{"increment":1}',
        credentials: "omit",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Breev-CSRF": "1",
        },
        method: "POST",
      }),
    );
  });

  it("returns a typed denial without hiding the server reason", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          status: "denied",
          code: "binding-missing",
          requestId: "0198dcbb-d7e3-7000-8000-000000000001",
        },
        { status: 401 },
      ),
    );

    await expect(
      requestMainDeviceProofMutation("http://127.0.0.1:31310", fetcher),
    ).resolves.toMatchObject({
      status: "denied",
      code: "binding-missing",
    });
  });
});
