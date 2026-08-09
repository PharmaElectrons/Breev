# Task 23 / P1-07: Create a tenant-safe cloud API skeleton

Type: task
Status: needs-triage
Blocked by: 19
GitHub issue: #25
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Task 19 → #21

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a Breev cloud operator, I want every future cloud request to require verified Tenant context, so that no endpoint or job starts from an unsafe tenant-optional default.

## Phase

Phase 1 — Foundation

## Module

`apps/cloud-api`, contracts, and validation

## Goal

A separate NestJS cloud composition root exposes health/readiness and a mandatory Tenant-context interface with negative tests, but no business endpoint or provider commitment.

## Source requirements

- US-003, US-093; REQ-ARCH-003, REQ-ARCH-006, REQ-NFR-003–006, REQ-SYN-003; ADR-008; P1-07

## Preconditions

- Task 19 resolved; no cloud vendor/region has been selected.

## Scope

- Separate cloud bootstrap and foundation health/readiness contracts.
- Verified-principal-to-Tenant-context interface that never trusts body/query Tenant IDs.
- Missing/mismatched Tenant negative fixtures for HTTP and background-context construction.

## Out of scope

- Real authentication, Tenant records, subscriptions, sync ingestion, production cloud deployment or vendor selection.

## Files likely affected

- `apps/cloud-api`; shared contracts/validation; cloud foundation tests.

## Data changes

- None.

## API or IPC changes

- Add health/readiness plus an internal verified Tenant-context interface only.

## Security considerations

- Deny absent/unverified Tenant context and redact principal data; never trust body/query Tenant fields.

## Offline and sync considerations

- Cloud remains optional to local operation; no sync ingestion or projection behavior.

## Accounting and inventory impact

- None.

## Test plan

- Missing, forged, mismatched and valid test-principal contexts; redacted error and health response.

## Acceptance criteria

- Given no verified principal/Tenant binding, when protected context is requested, then construction fails before application work runs.
- Given an untrusted body/query Tenant ID differs from verified context, when validated, then the request is rejected and safely correlated.
- Given cloud API is absent, when the local foundation runs, then no local health or desktop startup behavior fails.

## Documentation updates

- Update Tenant-isolation foundation notes and test-context rules.

## Risks

- A test-only principal/Tenant fallback could become a production bypass.

## Completion evidence

- Record valid, missing, forged, mismatched, redaction, and local-independence results.
