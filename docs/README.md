# Breev engineering baseline

**Status:** authoritative product and architecture baseline as of **1 September 2026**.

This baseline replaces every earlier document under `docs/` and every pre-baseline local issue under `.scratch/` and authorizes planning against the current requirements. Each release gate in [`open-decisions.md`](open-decisions.md) still requires its named evidence before that capability ships.

## Read in this order

1. Read [`product.md`](product.md) for users, scope, plans, exclusions, and success.
2. Read root [`CONTEXT.md`](../CONTEXT.md) for canonical language.
3. Read [`domain.md`](domain.md) for rules that no implementation may weaken.
4. Read [`workflows.md`](workflows.md) for critical user and failure flows.
5. Read [`architecture.md`](architecture.md) for runtime, repository, security, and data boundaries.
6. Read [`delivery.md`](delivery.md) for the small end-to-end implementation order.
7. Read [`quality.md`](quality.md) for tests, evidence, and the definition of done.
8. Read [`open-decisions.md`](open-decisions.md) for decisions that remain genuinely open.
9. Read [`traceability.md`](traceability.md) for source authority, reconciliation, and coverage.

ADRs under [`adr/`](adr/) record only consequential structural choices and explain their reasons. The files above define current behavior.

## Requirement language

- **Required** means confirmed by the governing baseline or a later explicit stakeholder decision.
- **Provisional target** is an approved engineering/release target that must be validated on the selected platform or by the named professional before release.
- **Release-gated** means the safety boundary is required but enabling policy, provider, or proof is still open. Keep the capability disabled until its gate closes.
- **Deferred** means do not design or build it in the current sequence. Preserve only the explicitly stated data-integrity boundary and any stakeholder-confirmed semantics recorded in [`domain.md`](domain.md), such as the Cloud Command and payment-safety rules.
- **Excluded** means remove it from product navigation, architecture, and plans.

No document may turn a release gate into a guessed default. Stale documents do not reopen decisions that later evidence settled.

## Source authority

The client's business requirements live in [`docs/requirements/`](requirements/). When sources disagree, apply this order:

1. [`requirements/breev-phase1-mvp-scope.md`](requirements/breev-phase1-mvp-scope.md) — the Phase One scope, version 1.2 of 9 August 2026. It is the latest and most specific requirement statement and carries its own conflict rule: the latest approved, specific written clarification wins.
2. Later dated client clarifications recorded in [`requirements/client-chat.md`](requirements/client-chat.md). The record is chronological; a later entry supersedes an earlier one on the same point.
3. [`requirements/project-breif/`](requirements/project-breif/) — the client's detailed draft and its interface images. Per the scope's own document control, its details are commitments only where the scope incorporates them; elsewhere they are supporting evidence of intent.
4. Prototype and interface images — visual and interaction evidence only. Written requirements override conflicting visuals; images add no scope by themselves.
5. This engineering baseline — for the implementation choices the business requirements do not constrain (stack, module boundaries, security engineering, delivery mechanics).

The scope's formal Mostaql approval fields are blank in this copy; the client record confirms it was sent for approval. Treat it as governing unless a later approved revision replaces it.

Use external standards and product precedents to validate approaches. They do not overrule confirmed Breev policy or decide Iraqi legal, accounting, pharmacist, privacy, or security questions.

The pre-consolidation repository documentation (the earlier requirement register and its sources) is fixed at local Git commit `6ddc0431b58a43efdbc3bf2899e3f6251cd69c82` for archaeology only. It cannot reopen decisions the current requirement set settles.

## Current implementation state

Production implementation exists in the three earned workspaces: `apps/desktop`, `apps/local-api`, and `packages/contracts`. The marker scaffold of five apps and twenty-five packages is gone. Milestone 1 delivers the packaged Electron desktop, the NestJS local authority over PostgreSQL, runtime-validated contracts, the startup and recovery states, device trust, and the identity and licensing boundaries, each with its automated evidence. Catalog product definition is the first milestone-2 vertical slice, implemented end to end through its contract, permission enforcement, PostgreSQL persistence, renderer, and browser tests. Add further modules and workspaces only as the sequencing in [`delivery.md`](delivery.md) and the extraction test in [`architecture.md`](architecture.md) allow. No compatibility layer for the obsolete scaffold is required.

## Keeping this baseline authoritative

Put each fact in one place and link to it. When a requirement changes, update `traceability.md`. When evidence closes a gate, update `open-decisions.md`. Update an ADR only when a hard-to-reverse structural decision changes. Delete superseded prose instead of keeping it beside its replacement. Production data still uses reviewed forward schema migrations and coordinated sync-version handling. These mechanisms protect live-data integrity. They do not provide backward compatibility with obsolete designs.
