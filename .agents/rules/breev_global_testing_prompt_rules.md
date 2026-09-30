# Breev Global Testing & Forensic Audit Rules

These rules govern all AI testing agents, subagents, and automated verification workflows within the Breev repository.

## Rule 1: Immutability of Production Assets

1. You have a **Strict Read-Only Posture** toward the codebase.
2. Never modify, rename, delete, or create any file inside `apps/`, `packages/`, `docs/`, or `.github/` unless explicitly instructed to write the final audit report under `docs/audit/`.
3. Never stage, commit, push, or execute Git commands that mutate remote branch states.
4. All test scaffolding, reproduction code, synthetic seed scripts, and temporary traces must be confined to the git-ignored directory `scratch/`.

## Rule 2: Execution Over Speculation

1. Do not declare that an implementation is compliant simply by inspecting the code.
2. Every validation claim must be substantiated by running unit, integration, browser, or contract tests against real execution runtimes.
3. Integration tests must run against real PostgreSQL instances (`Testcontainers` or Docker) with explicit database role separation:
   - Migrations executed strictly under `breev_schema_owner`.
   - Application queries executed under `breev_app` with no schema alteration permissions.
   - Mocking database drivers or Drizzle repositories is strictly forbidden when asserting ACID guarantees or ledger balances.

## Rule 3: Enforce Core Invariants Without Compromise

1. **Integer Fils Only:** Flag any floating-point arithmetic in monetary or pricing calculations as a critical defect. All Iraqi Dinar amounts must be signed 64-bit integer fils (`bigint`).
2. **Primary Cost Valuation:** Verify that Perpetual Weighted Average Cost (WAC) and Cost of Goods Sold (COGS) are calculated on Primary Supplier Cost before discounts.
3. **Double-Entry Balance:** Ensure that debits equal credits for every posted financial transaction ($\sum \text{Debits} - \sum \text{Credits} = 0$).
4. **Append-Only Immutability:** Verify that posted rows cannot be edited or deleted (enforced by `SQLSTATE 55000`).
5. **FEFO Allocation & Regulatory Blocks:** Ensure that expired, recalled, or quarantined batches cannot be sold under any circumstances across all user roles.
6. **Integer Quantities:** Verify that inventory quantities are tracked as integer counts of base units without fractions.

## Rule 4: Bilingual and Accessibility Standards

1. Test all user-facing workflows in both Arabic (`ar-IQ`, RTL) and English (`en-US`, LTR).
2. Test across both Light and Dark themes.
3. Test at both required display resolutions: $1366\times768$ and $1280\times800$.
4. Ensure compliance with WCAG 2.2 AA (contrast $\ge 4.5:1$ normal, $\ge 3:1$ large, keyboard focus, screen reader accessibility).
5. Verify that Eastern Arabic-Indic numerals (`٠١٢٣٤٥٦٧٨٩`) are normalized to standard ASCII digits.

## Rule 5: Local Prototype Parity & Security Isolation

1. Compare UI workflows and visual presentation against the local prototype files in `design/prototype/`.
2. Do not navigate to external URLs (e.g., `lovable.app`, `lovable.dev`). All visual and interaction verifications must use local repository assets.

## Rule 6: Anti-Premature Finalization & Scale Rigor

1. Complete the entire test matrix before concluding an audit.
2. Do not stop execution after encountering a single bug or verifying a single happy path.
3. Execute all scheduled boundary, performance, and failure injection scenarios.
4. Scale verification must assert automated `EXPLAIN (ANALYZE)` execution plans on key queries:
   - Smart search $\text{p95} \le 200\text{ ms}$.
   - Inventory movement projections $\text{p95} \le 300\text{ ms}$.
   - Running ledger calculations $\text{p95} \le 250\text{ ms}$.
   - Ensure query plans use appropriate B-Tree, GIN, or GiST indexes without sequential table scans.

## Rule 7: Actionable Reporting

1. Document all findings in an evidence-based report in `docs/audit/audit-<target>-<YYYYMMDD-HHmmss>.md`.
2. For minor fixes or UI glitches, include ready-to-copy PR review comments with unified diffs and exact `file:line` locations.
3. For major architectural or domain defects, provide ready-to-submit GitHub Issue templates with reproduction steps, root cause analysis, and blast radius assessments.