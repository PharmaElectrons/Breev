# Task 25 / P1-09: Establish empty forward-only Drizzle migration journals

Type: task
Status: needs-triage
Blocked by: 19, 24
GitHub issue: #27
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Tasks 19 and 24 → #21, #26

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a Breev engineer, I want repeatable local and cloud migration journals with explicit ownership, so that later schema changes cannot run out of order, cross module boundaries, or silently downgrade data.

## Phase

Phase 1 — Foundation

## Module

`packages/database-local` and `packages/database-cloud`

## Goal

Empty local/cloud Drizzle migration harnesses apply, resume, and report version state against disposable databases without creating domain tables.

## Source requirements

- US-099; REQ-ARCH-006, REQ-ARCH-010–011, REQ-NFR-041–043; ADR-001, ADR-004, ADR-024; P1-09

## Preconditions

- Tasks 19 and 24 resolved; lifecycle proof supplies safe disposable connection conventions.

## Scope

- Separate local/cloud journals, module ownership/naming policy, forward-only application command, compatibility/version reporting.
- Tests for clean apply, repeat apply, interrupted/resumed fixture, checksum/order mismatch and downgrade refusal.

## Out of scope

- Domain tables, production credentials, destructive repair automation, backward database migration.

## Files likely affected

- Database packages, Drizzle config, migration test fixtures, scripts and migration docs.

## Data changes

- Migration journal metadata in disposable databases only; no domain tables.

## API or IPC changes

- None.

## Security considerations

- Database credentials stay server-side and redacted; local/cloud ownership is separated.

## Offline and sync considerations

- The local harness works without cloud; no synchronization behavior.

## Accounting and inventory impact

- None; no accounting or inventory data/schema.

## Test plan

- Empty apply, idempotent rerun, interrupted resume, changed checksum, wrong order, incompatible/downgrade attempt.

## Acceptance criteria

- Given clean disposable local and cloud databases, when their harnesses run, then each records only its own journal state and no domain table.
- Given the same version is rerun, when checksums/order match, then no duplicate effect occurs.
- Given an altered, out-of-order, or downgrade request, when evaluated, then it stops with recovery guidance and does not mutate schema state.

## Documentation updates

- Document journal ownership, compatibility, and forward-only policy.

## Risks

- Local/cloud journals or later module schemas may become coupled; migration mutation could invalidate checksums.

## Completion evidence

- Record database/Drizzle versions and clean, rerun, resume, mismatch, order, and downgrade test output.
