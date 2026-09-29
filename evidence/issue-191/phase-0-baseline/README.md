# Milestone 2 Phase 0 before-state baseline

This bundle is the reproducible technical and visual baseline for issue #191,
task M2-P0-T03. It records the current Milestone 2 behavior before remediation.
It is not evidence that the current Purchasing, Adjustment, or Return UI matches
the prototype.

## Provenance and safety

- Source commit at capture: `7164fbff6ab56ee99d46463b7d148e874a5b12cc`.
- Runtime: packaged Windows `Breev.exe`, the built local API, and a disposable
  PostgreSQL 18 cluster bound only to `127.0.0.1:5549`.
- Fixture creation uses public REST contracts; it does not seed application
  tables with SQL.
- All pharmacy, Supplier, Product, user, invoice, lot, and barcode values are
  synthetic. No database passwords, host names, account names, device IDs,
  pharmacy IDs, or machine identifiers are stored in this bundle.

## Artifacts

- [Deterministic fixture manifest](fixture-manifest.md)
- [Automated result and failure classification](automated-results.md)
- [Packaged end-to-end performance samples](performance.json)
- [English/light Purchase workspace, 1366×768](screenshots/clause-2-supplier-invoice-en-light-1366x768.png)
- [Arabic/dark Adjustment summary, 1280×800](screenshots/clause-3-adjustment-difference-ar-dark-1280x800.png)
- [English/light Purchase Return confirmation, 1366×768](screenshots/clause-3-purchase-return-en-light-1366x768.png)
- [Arabic/light linked Adjustment/Return register, 1280×800](screenshots/clause-3-linked-return-ar-light-1280x800.png)
- [English/dark Inventory review, 1280×800](screenshots/clause-4-inventory-en-dark-1280x800.png)

The `screenshots/` directory contains 128 PNGs: 16 named surfaces × English
and Arabic × light and dark × 1366×768 and 1280×800. Captured surfaces are:

- Product definition/search and the exact search scenario;
- Purchase invoice, margin/pricing, selected-item panel, Adjustment summary,
  Purchase Return confirmation, and linked corrections;
- Inventory review, FEFO batches, Count/units, reorder basket, Ordered Items,
  and the Sales-to-basket preservation flow.

## Current before-state findings

The reference images intentionally preserve known defects. Most importantly,
the current Adjustment and Return workflows are materially different from the
checked-in prototype and are not accepted as final UI. The automated baseline
also proves two current product defects: the Adjustment screen omits its
required unchanged-line explanation, and the Sales reorder surface violates
axe's `scrollable-region-focusable` rule. These remain remediation inputs.

## Reproduction

With a disposable PostgreSQL administrator URL in the environment and the
current desktop package built, run:

```powershell
$env:BREEV_M2_PHASE0_BASELINE_EVIDENCE = '1'
pnpm --filter @breev/desktop exec playwright test --config playwright.acceptance.config.ts -g 'clause 1 —|clause 2 —|scope —'
pnpm --filter @breev/desktop exec playwright test --config playwright.acceptance.config.ts -g 'scope —|units scenario'
pnpm --filter @breev/desktop exec playwright test --config playwright.acceptance.config.ts -g 'clause 3 —'
```

The Clause 3 command is expected to fail at the retained assertion for the
missing unchanged-line statement after it captures the Adjustment, Return, and
linked-correction screens. The database URL is deliberately not recorded here.
