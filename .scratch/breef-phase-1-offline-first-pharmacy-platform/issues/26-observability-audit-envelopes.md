# Task 26 / P1-10: Standardize redacted observability and append-only audit envelopes

Type: task
Status: needs-triage
Blocked by: 19, 22, 23
GitHub issue: #28
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Tasks 19, 22, and 23 → #21, #24, #25

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a support operator, I want correlated health/error logs and attributable audit contracts without raw secrets or unnecessary patient data, so that failures can be diagnosed safely across desktop, local, and cloud boundaries.

## Phase

Phase 1 — Foundation

## Module

`packages/audit` and shared observability

## Goal

All foundation apps emit a shared redacted structured-log shape and can construct append-only audit envelopes with actor, Tenant, device, correlation, action, time, outcome, and reason fields.

## Source requirements

- US-098, US-101; REQ-NFR-003–004, REQ-NFR-006, REQ-NFR-013, REQ-NFR-024; ADR-008, ADR-017; P1-10

## Preconditions

- Tasks 19, 22 and 23 resolved; no production retention backend is selected.

## Scope

- Structured logger adapter, correlation propagation, field classification/redaction, normalized error logging.
- Versioned audit-envelope interface and validation; append-only test sink only.
- Tests proving secrets/health-like sample data are excluded and identifiers propagate.

## Out of scope

- Domain audit events, production log vendor/storage, support access UI, indefinite retention.

## Files likely affected

- `packages/audit`, validation/contracts, app middleware/adapters, tests and observability docs.

## Data changes

- Append-only test-sink records only; no domain or production retention table.

## API or IPC changes

- Add versioned internal audit/log contracts; no public business endpoint or IPC.

## Security considerations

- Default-deny metadata and mandatory redaction; free-form payloads must not bypass classification.

## Offline and sync considerations

- The local test sink works offline; no synchronization behavior.

## Accounting and inventory impact

- None.

## Test plan

- Correlation across HTTP error; actor/Tenant/device absence rules; secret and health-data fixtures; malformed envelope rejection; append-only sink behavior.

## Acceptance criteria

- Given one correlated request, when it crosses middleware and fails, then logs and error response share its correlation ID without leaking sensitive payload.
- Given a secret or health-data fixture, when structured logging runs, then prohibited values are removed/redacted and the test fails if raw values remain.
- Given an invalid or mutation attempt against an accepted audit envelope, when validated, then it is rejected rather than silently corrected or overwritten.

## Documentation updates

- Document field classifications, envelope versioning, and the production-retention caveat.

## Risks

- Free-form metadata may bypass redaction; a generic audit envelope may become a sensitive payload store.

## Completion evidence

- Record correlation, validation, append-only, missing-context, and secret/health-data redaction results.
