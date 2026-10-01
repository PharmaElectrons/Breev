# Phase 1 branch finalization — 1 October 2026

The stakeholder explicitly authorized committing the accepted Phase 1 slice,
opening a PR and merging it to provide a clean Phase 2 starting point. They
explicitly requested reuse of the recorded full gate and only necessary checks.

Accepted T06 is committed at `3ecde98`; T01–T05 were already committed. The
latest `dev` at `aac3f55` was integrated by merge commit `457d7ba`. These base
changes include existing Inventory/Patient work; this phase does not implement
or claim ownership of those features.

## Necessary integration repairs

- `dev` already owns migrations `0030_patient_profiles` and
  `0031_patient_permissions`. Append the offer migration as
  `0032_purchase_invoice_offer`, journal index 32, preserving its SQL byte
  content, original timestamp and zero role-grant statements. Git blob identity
  before/after is `5c01e356313c7dce8cc55adfe8ce60a37354ccfd`.
- The forward-offer fixture now starts from the complete pre-offer journal
  through index 31, so its unchanged-role-revisions assertion isolates the offer
  migration from the already-integrated Patient permission grants.
- Both branches had independently advanced the REST/schema version to 18.
  The combined schema is version 19; the explicit version assertion and two
  typed connection-display fixtures were updated consistently.

Retained Phase 1 manual databases remain untouched and pre-integration. Do not
reuse or migrate them for Phase 2; use a fresh disposable fixture with the merged
journal. No runtime compatibility adapter or old-migration alias was added.

## Checks on the integrated candidate

| Check | Result |
| --- | --- |
| Build | Exit 0 |
| Typecheck | Exit 0 |
| Contracts | 224 passed, 11 files |
| Purchase-posting, offer forward migration and custom-role migration | 37 passed, 3 files |
| Affected desktop panel/API/protected row and connection fixtures | 51 passed, 5 files |
| T06 real-API browser canary | 4 passed: English/Arabic × light/dark |

See `checks.json`, `logs/` and `browser/`. An initial contracts attempt caught
the remaining explicit version-18 assertion; its failed log is retained beside
the passing retry. The original [full gate](../t06/full-gate/report.md) remains
the complete repository baseline, with its accurately classified failures.
These narrower results overlap it and must not be added to its counts.

No full local test suite was rerun. Normal GitHub PR verification remains the
remote check. No application behavior changed during finalization beyond the
necessary merged-schema version; the offer SQL is unchanged.

## Preserved boundaries and open findings

PR [#205](https://github.com/PharmaElectrons/Breev/pull/205)'s first Linux CI
run passed source/unit checks but found two integration-fixture defects:
the newly integrated Patient snapshot fixture omitted required `invoiceOffer`,
and the T06 reconciliation fixture guessed a passwordless `postgres` URL in
Testcontainers. The latter now uses the fixture's existing schema-owner URL;
the Patient fixture explicitly supplies a zero offer. No runtime behavior,
security boundary or assertion was weakened. The two affected PostgreSQL tests
passed in a focused sequential retry (40 other tests were intentionally filtered
out), and scoped ESLint/format checks passed. See `logs/final-ci-fixture-repair.log`
and `ci-fixture-repair.json`. The first remote failure is retained in
`logs/github-ci-first-failure.log`; it is separate from the original local gate.

The two unrelated dirty files remain excluded and retain their recorded hashes:
`use-startup-connection.ts` and `tooling/dev.mjs`. Accepted historical browser
images were backed up and restored; the new integrated-candidate images are
stored here separately. The complete starting dirty diff/source backup is
retained in the directory named by `.scratch/runtime/phase-1-finalize-path.txt`.
Manual database processes/sessions were not stopped or reset.

Stakeholder [Phase 1 PASS](../phase-1-checkpoint.md) remains distinct from a fully
green repository gate or complete M2/release acceptance. Sales issue
[#204](https://github.com/PharmaElectrons/Breev/issues/204), Purchase preview
clipping for Phase 2, G-01/G-02/G-16, host/Narrator/physical-profile limits and
the older unconfirmed evidence-note follow-up remain open. No #63/#75, M3 UI,
OCR/cloud/final printing or release work was added by this phase.

The latest authorization permits the Phase 1 PR and merge only. Phase 2 has not
started; its first separate checkpoint remains T01.
