# Purchase adjustment Delta verification

## Pure Delta matrix

Command:

`pnpm --filter @breev/local-api exec vitest run --config vitest.unit.config.ts src/purchasing/purchase-adjustment-delta.unit.test.ts src/accounting/purchase-adjustment-posting-template.unit.test.ts`

Observed result: 2 test files passed; 8 tests passed.

| Case                  | Proven result                                                                 |
| --------------------- | ----------------------------------------------------------------------------- |
| Unchanged row         | Empty Delta: no movement, value effect, or journal line                       |
| Quantity 4 → 8        | One signed movement and value effect for exactly +4                           |
| Cost change           | Exact signed integer-fils value and supplier effects                          |
| Retail-price change   | Field Delta without inventing a stock movement                                |
| Supplier change       | Payable transfer through the versioned template, no stock movement            |
| Invoice-number change | Non-financial header correction with a balanced empty journal                 |
| Added/removed rows    | Signed row effects derived against original lineage                           |
| Accounting template   | Balanced entries for financial effects and no lines for non-financial effects |

## Real PostgreSQL invariant battery

Command:

`pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/purchasing/purchase-posting.integration.test.ts`

Observed result: 1 test file passed; 12 tests passed, including:

```text
✓ posts only Purchase Adjustment Deltas, preserves the original, numbers A01/A02,
  replays once, serializes, and blocks consumed stock

Test Files  1 passed (1)
Tests       12 passed (12)
```

That scenario captures the original header and rows as JSON, posts A01 and A02, and compares the original JSON byte-for-byte afterward. It also proves idempotent replay, concurrent serialization, immutable update/delete rejection, and per-original numbering.

## Blocked reducing Delta

The PostgreSQL scenario appends a later stock consumption movement, then attempts to remove the received row. Saving is rejected before posting because the batch no longer holds enough eligible units. The committed draft row and version remain unchanged after the rejection.

```text
HTTP 409
code: adjustment-batch-conflict
rule: purchase.adjustment.batch-insufficient
UI guidance: Resolve through stock count (#25), Purchase Return (#22), or another correction.
```

No stock movement, value effect, journal, posted adjustment, number issuance, audit success, or outbox event is committed for the blocked save.
