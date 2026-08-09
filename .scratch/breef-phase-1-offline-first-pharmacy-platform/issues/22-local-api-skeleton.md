# Task 22 / P1-06: Expose the versioned local API health and readiness seam

Type: task
Status: needs-triage
Blocked by: 19
GitHub issue: #24
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Task 19 → #21

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a pharmacy operator, I want the desktop to distinguish a healthy local service from a starting or failed service, so that offline operation and recovery are understandable.

## Phase

Phase 1 — Foundation

## Module

`apps/local-api`, contracts, and validation

## Goal

A NestJS local composition root provides versioned health/readiness, validation, normalized errors, and correlation behavior; the renderer uses a typed HTTP client.

## Source requirements

- US-002, US-009, US-098; REQ-ARCH-001–003, REQ-ARCH-006–007, REQ-NFR-003–006; ADR-003; P1-06

## Preconditions

- Task 19 resolved; binding remains local/private and no domain endpoints are added.

## Scope

- Local API bootstrap; `/health` liveness and `/ready` dependency readiness under a versioned contract.
- Boundary validation, correlation ID propagation, normalized errors and typed desktop client.
- Contract tests for starting/ready/unavailable/malformed request.

## Out of scope

- Authentication, Tenant domain, LAN pairing/mTLS, domain schema/endpoints, direct renderer DB/Node access.

## Files likely affected

- `apps/local-api`; `packages/contracts`; `packages/validation`; desktop HTTP client; tests.

## Data changes

- None.

## API or IPC changes

- Add versioned foundation health, readiness, and normalized-error HTTP contracts only.

## Security considerations

- Responses expose minimum safe metadata; private binding and validation must fail safely.

## Offline and sync considerations

- No cloud dependency and no synchronization behavior.

## Accounting and inventory impact

- None.

## Test plan

- Contract tests, correlation, malformed inputs, dependency not ready, renderer client, redaction, offline startup.

## Acceptance criteria

- Given the process is alive but a dependency is not ready, when health and readiness are queried, then liveness succeeds and readiness returns a safe non-ready result.
- Given a request with or without a valid correlation ID, when processed, then one normalized ID appears consistently in response and redacted logs.
- Given internet is absent, when the local API starts, then its foundation health contract remains usable.

## Documentation updates

- Document endpoint contracts, binding, and startup/readiness states.

## Risks

- Health may leak environment details or readiness may incorrectly report healthy.

## Completion evidence

- Record contract, negative-input, correlation, redaction, and offline startup results.
