import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  projectReorder,
  proposeReorderQuantity,
  resolveReaddQuantity,
} from "./inventory-reorder.js";

describe("inventory reorder domain", () => {
  it("proposes zero with an explicit basis when no maximum exists", () => {
    expect(proposeReorderQuantity({ balance: 8n, maximumLevel: null })).toEqual(
      { basis: "no-maximum-level", quantity: 0n },
    );
  });

  it("proposes zero when the balance is at or above the maximum", () => {
    expect(proposeReorderQuantity({ balance: 60n, maximumLevel: 60n })).toEqual(
      { basis: "balance-at-or-above-maximum", quantity: 0n },
    );
    expect(proposeReorderQuantity({ balance: 61n, maximumLevel: 60n })).toEqual(
      { basis: "balance-at-or-above-maximum", quantity: 0n },
    );
  });

  it("proposes the maximum minus the balance below the maximum", () => {
    expect(proposeReorderQuantity({ balance: 8n, maximumLevel: 60n })).toEqual({
      basis: "maximum-minus-balance",
      quantity: 52n,
    });
  });

  it("defends the proposal against a negative balance without negative quantities", () => {
    expect(proposeReorderQuantity({ balance: -8n, maximumLevel: 60n })).toEqual(
      { basis: "maximum-minus-balance", quantity: 68n },
    );
  });

  it("keeps an edited quantity when an item is re-added", () => {
    const proposal = { basis: "maximum-minus-balance" as const, quantity: 52n };
    expect(
      resolveReaddQuantity({
        previousQuantity: 60n,
        quantityEditedAt: "2026-09-12T10:00:00.000Z",
        proposal,
      }),
    ).toBe(60n);
    expect(
      resolveReaddQuantity({
        previousQuantity: 60n,
        quantityEditedAt: null,
        proposal,
      }),
    ).toBe(52n);
  });

  it("keeps every proposal non-negative and within the maximum bound", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000n, max: 10_000n }),
        fc.bigInt({ min: 0n, max: 10_000n }),
        (balance, maximumLevel) => {
          const proposal = proposeReorderQuantity({ balance, maximumLevel });
          const expected = balance < maximumLevel ? maximumLevel - balance : 0n;
          return (
            proposal.quantity >= 0n &&
            proposal.quantity === expected &&
            proposal.basis ===
              (balance < maximumLevel
                ? "maximum-minus-balance"
                : "balance-at-or-above-maximum")
          );
        },
      ),
    );
  });

  it("warns exactly when a maximum exists and the projection exceeds it", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000n, max: 10_000n }),
        fc.bigInt({ min: 0n, max: 10_000n }),
        fc.option(fc.bigInt({ min: 0n, max: 10_000n }), { nil: null }),
        (balance, quantity, maximumLevel) => {
          const projection = projectReorder({
            balance,
            maximumLevel,
            quantity,
          });
          if (projection.projectedLevel !== balance + quantity) return false;
          if (maximumLevel === null) return projection.warning === null;
          return (
            (projection.warning === "surplus") ===
            balance + quantity > maximumLevel
          );
        },
      ),
    );
  });
});
