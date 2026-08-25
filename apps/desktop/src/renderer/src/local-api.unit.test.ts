import {
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
} from "@breev/contracts/local-rest";
import { describe, expect, it, vi } from "vitest";

import { requestLocalHealth } from "./local-api";

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
