# Phase 1 stakeholder follow-ups

## 30 September 2026 — diagnostic references in ordinary messages

After T01 manual PASS, the stakeholder reported raw UUIDs beneath errors and
asked that end users not see them in ordinary operation. They then explicitly
authorized continuing and asked that this concern be retained for later tasks.

Keep the request/audit reference internally. Show a clear localized explanation
and recovery action. Hide diagnostic IDs by default; optional Support details
may expose a copyable reference. Do not remove server audit or correlation.

T03 owns the Adjustment denial presentation. Apply the same rule to other
Purchasing denial surfaces within the authorized phase scope. Track remaining
module occurrences for their owning M2 tasks rather than changing unrelated
module visuals during an Adjustment slice.

Inspected occurrences: `purchase-adjustment-workflow.tsx`,
`purchase-return-workflow.tsx`, `posted-purchase-review.tsx`, `basket-screen.tsx`,
`inventory-screen.tsx`, `batch-safety-panel.tsx`, `batch-safety-review.tsx`,
`devices-panel.tsx`, and `step-up.tsx` under
`apps/desktop/src/renderer/src/`. Confirm the complete occurrence inventory at
the owning task. Protected Quick Product and Purchase row keyboard behavior
remain unchanged.

Status: pending implementation and verification in the owning tasks.
