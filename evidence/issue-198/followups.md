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

Status: Adjustment, Return and Posted Purchase review denial presentation is
implemented and accepted in T03, with localized explanation and closed support
details. Other module occurrences remain pending in their owning tasks; this is
not a global-module completion claim.

## 30 September 2026 — optional Adjustment evidence note

The stakeholder reported that the note shared by the Reason header and Delta
dialog was absent after restart/Continue draft, while quantity survived. Both
manual save histories had null evidence throughout; four strengthened real
API/browser restart cases passed. The cause remains unconfirmed, with no
production persistence fix claimed. See the [investigation](t02/evidence-restart-investigation.md).

The stakeholder later accepted T02 and confirmed the manual tests were finished.
Carry this report into subsequent Purchasing work without treating acceptance
as proof of a fix. The new manual-fixture guard verifies saved case A evidence
before allowing the restart. Do not mutate immutable posted notes/reasons or
introduce speculative autosave/business-persistence workarounds.

## 1 October 2026 — consolidated automated gate findings

The later-initiated [T06 / Phase 1 full automated gate](t06/full-gate/report.md)
retains two visible findings rather than declaring the repository fully green:

- Packaged Sales draft preservation passed, then Axe reported
  `scrollable-region-focusable`. The Sales surface was not changed in Phase 1;
  this run alone does not prove whether the issue predates the phase. Remediation
  belongs to the Sales owner. See
  [the original result](t06/full-gate/logs/packaged-en-light-ready-supplier.log).
  Subsequently filed as [GitHub issue #204](https://github.com/PharmaElectrons/Breev/issues/204)
  under explicit stakeholder authorization; serious accessibility impact, not
  an observed draft data-loss/posting failure.
- The packaged Purchase units scenario shows the correct `4 Strip` / `4 أشرطة`
  conversion, but only approximately 79.8% of its base-unit preview cell is in
  the default viewport in all four language/theme cases. The protected Purchase
  entry layout and strict visibility assertion remain unchanged. The later
  stocktake portion is not reached by that packaged scenario. See
  [the affected result](t06/full-gate/logs/packaged-units-visibility-final.log).

Status: open; no layout fix, waived accessibility rule or release approval is
inferred. The stakeholder subsequently gave separate explicit
[Phase 1 PASS](phase-1-checkpoint.md), carrying preview clipping into Phase 2.
Earlier diagnostic-reference and unconfirmed optional
evidence-note follow-ups remain in force. Existing CNG, Docker, Windows crash
harness and G-16/physical-profile limits remain separately recorded.
