# Epic 08: Correct posted transactions through linked Returns and Reversals

Type: epic
Status: needs-triage
Engineering phase: P5 — Sales/cash
Blocked by: 07
GitHub issue: #10
Parent GitHub specification: #2

## User Story

As an authorized supervisor, I want returns and corrections to create linked offsetting evidence without changing the original invoice, so that stock, money, accounting, and audit remain historically trustworthy.

## Outcome

Deliver invoice-linked partial/full Return, controlled no-invoice Return, full Reversal for erroneous posting, approved replacement flow, refund/debt/Cash Box effects, batch disposition, printable evidence, and Step-Up/Dual Control enforcement.

## Expected workflow

1. User finds the original Posted Invoice and chooses Return for goods received back or Reversal for a wrongly posted transaction.
2. Breev restricts quantities/amounts to remaining eligible facts and shows stock, refund/debt, Cash Box, and journal preview.
3. User supplies reason/evidence; high-risk/no-invoice/backdated cases enter the configured approval workflow.
4. At execution, Breev revalidates newest invoice/returned quantity, period, stock/batch disposition, permission, Entitlement, approval, and refund method.
5. One transaction creates the new linked document and all offset effects, leaving the original visible and immutable.
6. An optional replacement begins as a new Draft Invoice and never overwrites either prior record.

## Invariants and failure behavior

- Return means goods returned; Reversal means accounting-safe cancellation of wrong posting. They are not synonyms.
- Returned quantity/value cannot exceed current remaining eligibility; concurrent/stale attempts conflict safely.
- No-invoice Return requires elevated evidence and does not invent an original sale.
- Provider Refund, if later integrated, is independently tracked and cannot rewrite local refund evidence.

## Acceptance scenarios

- Given a partially returnable original invoice, when an authorized Return posts, then only selected eligible quantities/effects are offset and both documents remain traceable.
- Given two users attempt the final return concurrently, when newest state is checked, then at most one succeeds and the other sees a recoverable conflict.
- Given a Dual Control request is self-approved, expired, or based on stale state, when execution is attempted, then no correction posts and the outcome is audited.

## Planned child slices

- Return eligibility/query; linked Return draft/posting; refund/debt/Cash Box integration; Reversal posting; replacement handoff; no-invoice control; Step-Up/Dual Control; concurrency/idempotency/print evidence suite.

## Gate and exclusions

- Exact legal numbering/correction series, thresholds, period rules, and accountant approval are required. Official authority correction and provider refunds remain separate integrations.

## Traceability

- US-056–058; correction/approval requirements; ADR-005, ADR-010, ADR-021, ADR-025.
