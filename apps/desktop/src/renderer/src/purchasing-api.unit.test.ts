import { afterEach, describe, expect, it, vi } from "vitest";
import { LicensingApiDenied } from "./identity-api";
import {
  clearPendingPurchasePost,
  postPurchase,
  purchasingCommandAttempt,
  readPendingPurchasePost,
  rememberPurchasePost,
  requestSuppliers,
} from "./purchasing-api";

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

  it("posts through the published route and validates the immutable result", async () => {
    const draftId = "018fa000-0000-7000-8000-000000000001";
    const result = {
      posted: {
        allowanceFils: "0",
        allowanceSnapshot: { basisFils: "1000", percentage: "0" },
        costAfterDiscountFils: "1000",
        draftId,
        id: "018fa000-0000-7000-8000-000000000002",
        invoiceDate: "2026-09-08",
        journal: {
          entryId: "018fa000-0000-7000-8000-000000000003",
          lines: [
            {
              accountCode: "inventory",
              creditFils: "0",
              debitFils: "1000",
              ordinal: 1,
              supplierId: null,
            },
            {
              accountCode: "supplier-payable",
              creditFils: "1000",
              debitFils: "0",
              ordinal: 2,
              supplierId: "018fa000-0000-7000-8000-000000000004",
            },
          ],
          templateId: "purchase.invoice",
          templateVersion: 1,
        },
        number: { series: "P", value: "1", year: 2026 },
        postedAt: "2026-09-08T10:00:00.000Z",
        postedBy: "018fa000-0000-7000-8000-000000000005",
        primarySupplierCostFils: "1000",
        rows: [
          {
            baseUnitsPerEnteredUnit: "1",
            batchId: "018fa000-0000-7000-8000-000000000006",
            costAfterDiscountFils: "1000",
            enteredQuantity: "1",
            expiryDate: "2028-10-31",
            id: "018fa000-0000-7000-8000-000000000007",
            inventoryUnitName: "Strip",
            inventoryUnitQuantity: "1",
            itemDisplayName: "Panadol",
            itemId: "018fa000-0000-7000-8000-000000000008",
            linePrimarySupplierCostFils: "1000",
            lotNumber: null,
            marginPercentage: null,
            movementId: "018fa000-0000-7000-8000-000000000009",
            notes: null,
            ordinal: 1,
            priceCapture: "by-price-propagated",
            pricingMethod: "by-price",
            primarySupplierCostFils: "1000",
            retailPriceFils: "1500",
            unit: { kind: "inventory-unit" },
          },
        ],
        settlementContext: "debt",
        settlementEffect: { context: "debt", payableFils: "1000" },
        supplierId: "018fa000-0000-7000-8000-000000000004",
        supplierInvoiceNumber: "SUP-1",
        supplierNameSnapshot: "Supplier",
      },
      warnings: [],
    } as const;
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      postPurchase("http://127.0.0.1:3000", draftId, {
        expectedVersion: "2",
        idempotencyKey: "018fa000-0000-4000-8000-00000000000a",
      }),
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      new URL(`/purchases/drafts/${draftId}/postings`, "http://127.0.0.1:3000"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("addresses one post attempt across reloads until the outcome is definitive", () => {
    const storage = {
      hash: "#/purchases",
      replace(hash: string) {
        this.hash = hash;
      },
    };
    const draftId = "018fa000-0000-7000-8000-000000000001";
    const first = rememberPurchasePost(storage, draftId, "2");
    const afterReload = readPendingPurchasePost(storage);
    const reused = rememberPurchasePost(storage, draftId, "3");
    expect(first.idempotencyKey).toBe(draftId);
    expect(afterReload).toEqual(first);
    expect(reused).toEqual(first);

    clearPendingPurchasePost(storage);
    expect(readPendingPurchasePost(storage)).toBeNull();
    expect(storage.hash).toBe("#/purchases");
  });

  it("drops a malformed addressed post attempt", () => {
    const address = {
      hash: "#/purchases/posting/not-a-draft/2",
      replace(hash: string) {
        this.hash = hash;
      },
    };
    expect(readPendingPurchasePost(address)).toBeNull();
    expect(address.hash).toBe("#/purchases");
  });
});
