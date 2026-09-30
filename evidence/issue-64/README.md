# Issue #64 inventory reports — implementation evidence

The Reports workspace exposes seven read-only M2-backed categories: quantity, value, average cost, batches/expiry, consumption, alerts, and applied stocktake movements. Inventory owns historical quantity and frozen carrying-amount reads and the consumption calculation; Reporting composes presentation. From/To use a half-open immutable posting-time interval. Actor and separately labeled business-date filters select attributed activity while opening and closing positions remain pharmacy-wide. Historical threshold alerts say unavailable when rule versions are not recorded. Current M2 movements contain no qualifying demand, so historical consumption is zero rather than a forecast.

Permissions are separate for report view, ordinary export, and valuation. Ordinary CSV covers the whole filtered result with sensitive fields removed. The protected filtered export remains owner-only, password Step-Up-bound, audited, and idempotent. Source-document review uses the source owner's existing permission checks. No report route posts stock or changes a Count Session.

## Verification record

Targeted PostgreSQL integration suites passed for seven-category position/value reconciliation, corrections, protected export, count applications in an active session, multi-batch deduplication, and report authorization. The complete repository pre-flight passed on Linux x64 on 30 September 2026. Existing Windows-only tests retain their skips; these results do not establish Windows behavior.

The final targeted additions also passed: exact historical cutoff reconciliation, inactive attributed periods retaining pharmacy balances, future-cutoff denial, rejected mutation verbs on all seven report routes, renderer filter/group/sort and ordinary/protected export, and automated accessibility checks and captures for every category in all four locale/theme combinations. Purchase-return journal reconciliation explicitly accounts for the existing G-01 Inventory-account offset between frozen WAC carrying amount and supplier-cost reduction; a journal net is not silently substituted for carrying value.

| Gate | Result |
|---|---|
| Format, lint, typecheck, build, unit | Passed `pnpm format:write`, `format:check`, `lint`, `typecheck`, `build`, and `test:unit`: 218 contract, 652 desktop, and 640 Local API tests passed; 2 Local API tests skipped |
| PostgreSQL integration | Passed `pnpm test:integration`: 38 suites, 318 tests passed, 2 platform-specific skips |
| Browser and accessibility | Passed `pnpm test:browser`: 132 tests, including all seven categories in Arabic/RTL and English/LTR, both themes, source drill-down and focus return, and automated accessibility checks |
| Linux desktop package / Electron smoke | Passed `pnpm package:desktop` and packaged Playwright smoke: 3 tests |
| Clean source checkout | Verification in progress |
| Windows packaged and physical-profile evidence | Open; Linux does not establish Windows behavior |
| Client visual columns/grouping approval | Open under `docs/open-decisions.md` Visual reports |
| G-01/G-02 professional defaults | Open; issue #59 closure does not approve them |

The reviewed implementation captures are [English light](after/quantity-en-light.png), [English dark](after/quantity-en-dark.png), [Arabic light](after/quantity-ar-light.png), and [Arabic dark](after/quantity-ar-dark.png). They are engineering evidence, not client visual approval. Working column and grouping defaults remain proposals, and COGS plus expiry/damage write-off reporting awaits the corresponding posting milestones.

The [baseline operational Inventory screen](before/operational-inventory-en-light.png) comes from the tracked issue #54 evidence at the starting `dev` commit. It shows the existing current-stock interface before the separate historical report workspace. Each additional category has equivalent `after/<category>-<locale>-<theme>.png` captures.
