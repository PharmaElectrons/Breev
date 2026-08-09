# Task 27 / P1-11: Unify contracts, test fixtures, and CI quality gates

Type: task
Status: needs-triage
Blocked by: 18, 19, 20, 21, 22, 23, 25, 26
GitHub issue: #29
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Tasks 18–23, 25, and 26 → #20–#25, #27, #28

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a Breev engineer, I want one reliable contract/test harness and CI matrix, so that every later vertical slice proves its boundaries instead of passing because a gate never ran.

## Phase

Phase 1 — Foundation

## Module

`packages/contracts`, `packages/testing`, and CI

## Goal

The root verification path runs formatting, lint, typecheck, boundary, unit, contract/integration, Electron security, and accessibility smoke gates with deliberate failure proofs.

## Source requirements

- US-098–102; REQ-ARCH-011, REQ-UX-001–004, REQ-NFR-006; ADR-001–003, ADR-008, ADR-027; P1-11

## Preconditions

- Tasks 18–23, 25–26 resolved; supported CI environments and dependency cache policy documented.

## Scope

- Shared API validation/client seam and reusable isolated fixtures.
- CI jobs/cache/artifacts for every foundation gate; deliberate failing fixture or mutation proving each job detects failure.
- Test ownership, naming, flake/retry and evidence conventions.

## Out of scope

- Domain E2E scenarios, production deployment, hiding real failures with retries.

## Files likely affected

- Contracts/testing packages, CI config, root scripts, fixtures, contributor/testing docs.

## Data changes

- Disposable, isolated test data only.

## API or IPC changes

- Add the foundation contract-generation/validation seam; no domain API/IPC behavior.

## Security considerations

- CI artifacts/logs are redacted; secrets and sensitive fixtures are prohibited.

## Offline and sync considerations

- Local verification works without runtime cloud; no synchronization behavior.

## Accounting and inventory impact

- None.

## Test plan

- Run full matrix; activate each deliberate failure; validate isolation, deterministic order, artifact/evidence output and secret scanning.

## Acceptance criteria

- Given a valid clean checkout, when CI runs, then every named gate executes and publishes a clear pass/fail result.
- Given each deliberate failing fixture, when its gate runs, then CI fails for the intended reason rather than passing or failing elsewhere.
- Given tests run twice or concurrently, when fixtures isolate state, then results remain deterministic with no shared database/port pollution.

## Documentation updates

- Document the test pyramid, ownership, evidence rules, and local/CI commands.

## Risks

- CI may appear green because jobs are skipped by filters; retries may hide flakes; shared ports/databases may create nondeterminism.

## Completion evidence

- Record the complete matrix plus the intended result of each deliberately failing fixture/mutation.
