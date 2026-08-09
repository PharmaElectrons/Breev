# Task 18 / P1-02: Enforce workspace dependency boundaries

Type: task
Status: needs-triage
Blocked by: 17
GitHub issue: #20
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Task 17 → #19

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a Breev engineer, I want automated workspace boundary and cycle checks, so that later pharmacy modules cannot silently depend on deployable apps or one another's internals.

## Phase

Phase 1 — Foundation

## Module

Repository architecture

## Goal

CI and the root verification command reject forbidden imports, circular dependencies, and invalid package manifests.

## Source requirements

- US-102; REQ-ARCH-004, REQ-ARCH-008, REQ-ARCH-011, REQ-NFR-006
- ADR-001; `docs/architecture/MODULE_MAP.md`; P1-02

## Preconditions

- Task 17 resolved; ADR-001 boundary direction remains the reviewed basis.

## Scope

- Validate package manifests and dependency direction: apps → modules → focused packages → shared-kernel.
- Add deterministic forbidden-import and cycle checks with one intentionally failing fixture.
- Document module ownership and the exception/change process.

## Out of scope

- Adding domain behavior, redesigning modules, or allowing cross-module table access.

## Files likely affected

- Workspace manifests, lint/boundary config, root scripts, architecture docs, test fixtures.

## Data changes

- None.

## API or IPC changes

- None.

## Security considerations

- Boundaries must prevent renderer/server and cross-domain authorization/data-access bypasses.

## Offline and sync considerations

- No runtime or synchronization behavior changes.

## Accounting and inventory impact

- None.

## Test plan

- Positive scan of current graph; negative fixtures for app import, cross-module internal import, cycle, and shared-kernel misuse.

## Acceptance criteria

- Given a valid package graph, when boundary checks run, then they pass with a readable graph summary.
- Given each prohibited dependency fixture, when checks run, then they fail and identify importer, target, and violated rule.
- Given two packages forming a cycle, when checks run, then CI fails before domain implementation can merge.

## Documentation updates

- Update the module map and contributor instructions.

## Risks

- Rules may be too strict, or path aliases/built output may bypass checks; test both source and resolved imports.

## Completion evidence

- Record graph/check commands, the valid graph result, and every deliberate failure result.
