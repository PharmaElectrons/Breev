# Task 17 / P1-01: Establish the reproducible Breev toolchain and identifier baseline

Type: task
Status: ready-for-agent
Blocked by: explicit user initiation
GitHub issue: #19
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Explicit initiation

## Status

Ready for explicit initiation; implementation not started.

## User Story

As a Breev engineer, I want one pinned workspace toolchain and consistent new Breev identifiers, so that every contributor and CI runner builds the same foundation without leaking obsolete public naming.

## Phase

Phase 1 — Foundation

## Module

Repository/tooling foundation

## Goal

A clean checkout installs with the pinned Node/pnpm/Turbo/TypeScript versions and runs one documented root verification command.

## Source requirements

- US-001–002; REQ-ARCH-004, REQ-ARCH-011, REQ-UX-000, REQ-NFR-006
- ADR-001; ADR-012; `docs/plans/PHASE_1_TASK_PROPOSAL.md` P1-01

## Preconditions

- Phase 0 approved; user explicitly starts P1-01.
- Preserve historical source/prototype names for traceability.

## Scope

- Pin supported runtime/package-manager versions and root scripts.
- Normalize new package/app metadata and scopes to `breev`/`@breev/*`.
- Define lockfile and clean-install policy; document the canonical verification command.

## Out of scope

- Domain behavior, dependency upgrades unrelated to the pin, mass renaming historical artifacts, CI matrix design.

## Files likely affected

- Root/package manifests, workspace/Turbo/TypeScript config, lockfile, README and setup docs.

## Data changes

- None; no database or migration files.

## API or IPC changes

- None.

## Security considerations

- No secrets may be committed in configuration, generated files, or logs.

## Offline and sync considerations

- Dependency installation may require internet; the built foundation must introduce no runtime internet or sync dependency.

## Accounting and inventory impact

- None; this task creates no domain behavior or schema.

## Test plan

- Clean install with pinned versions; root format/lint/typecheck/test/build scripts.
- Negative scan for accidental new public `Breef` identifiers outside allow-listed historical paths.
- Failure: unsupported runtime produces a clear actionable error.

## Acceptance criteria

- Given a clean checkout and documented supported tools, when dependencies install and the root verification command runs, then every workspace package is discovered and all configured gates execute.
- Given a deliberately unsupported Node or pnpm version, when installation starts, then it fails early with the required version.
- Given preserved historical sources, when identifier validation runs, then those paths remain unchanged while all new package/app metadata uses Breev naming.

## Documentation updates

- Root README/setup instructions; task Completion evidence; source allow-list if needed.

## Risks

- A broad rename could destroy traceability; version pins could conflict with existing lockfile metadata.

## Completion evidence

- Record exact tool versions, clean-install command, verification command/results, and changed identifier paths.
