import { afterEach, describe, expect, it, vi } from "vitest";
import { LicensingApiDenied } from "./identity-api";
import { purchasingCommandAttempt, requestSuppliers } from "./purchasing-api";

const REQUEST_ID = "018f9999-9999-7999-8999-999999999999";

describe("Purchasing REST client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses one idempotency key for the same uncertain command intent", () => {
    const createKey = vi
      .fn<() => string>()
      .mockReturnValueOnce("first-key")
      .mockReturnValueOnce("second-key");
    const first = purchasingCommandAttempt(null, "same-intent", createKey);
    const retry = purchasingCommandAttempt(first, "same-intent", createKey);
    const changed = purchasingCommandAttempt(
      first,
      "changed-intent",
      createKey,
    );

    expect(retry).toBe(first);
    expect(changed).toEqual({
      fingerprint: "changed-intent",
      idempotencyKey: "second-key",
    });
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("keeps the Additional POS entitlement denial typed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: "entitlement-denied",
              requestId: REQUEST_ID,
              requiredCapability: "additional-device-pos",
              status: "denied",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 403,
            },
          ),
        ),
      ),
    );

    await expect(requestSuppliers("http://127.0.0.1:3000")).rejects.toEqual(
      expect.objectContaining({
        denial: expect.objectContaining({ code: "entitlement-denied" }),
      }),
    );
    await expect(
      requestSuppliers("http://127.0.0.1:3000"),
    ).rejects.toBeInstanceOf(LicensingApiDenied);
  });
});
