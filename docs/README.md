# Breev engineering baseline

**Status:** authoritative product and architecture baseline as of **23 August 2026**.

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

When sources disagree, apply this order:

1. later explicit client/stakeholder clarification;
2. confirmed meeting conclusion;
3. consolidated product brief;
4. master architecture/build prompt for delivery and engineering constraints;
5. original Arabic brief for intent where later sources are silent;
6. prototype for visual and interaction evidence only;
7. scaffold or developer proposal.

Use external standards and product precedents to validate approaches. They do not overrule confirmed Breev policy or decide Iraqi legal, accounting, pharmacist, privacy, or security questions.

The complete prior repository-documentation baseline is fixed at local Git commit `6ddc0431b58a43efdbc3bf2899e3f6251cd69c82`. The two governing Markdown sources had SHA-256 hashes `e01353f9…4923c` for the master prompt and `0ddf4f1f…99c` for the product brief. The earlier evidence pass inspected the original Arabic PDF and conversation, but this checkout does not contain them. [`traceability.md`](traceability.md) retains their recorded hashes and derived decisions. The old prototype path is also unavailable, so it cannot supply new business logic.

## Current implementation state

There is no production implementation. The current five `apps/` and twenty-five `packages/` workspaces contain only name constants, old `breef` identifiers, and obsolete tool versions. They contain no Electron window, React UI, Nest application, schema, migration, transaction, or test. The first delivery slice deletes that scaffold and creates only the runtimes that meet the conditions in [`architecture.md`](architecture.md). It requires no compatibility layer or scaffold migration.

## Keeping this baseline authoritative

Put each fact in one place and link to it. When a requirement changes, update `traceability.md`. When evidence closes a gate, update `open-decisions.md`. Update an ADR only when a hard-to-reverse structural decision changes. Delete superseded prose instead of keeping it beside its replacement. Production data still uses reviewed forward schema migrations and coordinated sync-version handling. These mechanisms protect live-data integrity. They do not provide backward compatibility with obsolete designs.
