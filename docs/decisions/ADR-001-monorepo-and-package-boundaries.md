# ADR-001: Monorepo and Package Boundaries

- Status: **Proposed — Phase 0 review**
- Date: 2026-08-05
- Decision owners: Architecture / engineering
- Related: `docs/architecture/MODULE_MAP.md`, REQ-ARCH-004

## Context

The product has separate desktop, pharmacy-local server, cloud server, operations UI, migration tools, domain modules, and cross-cutting contracts. The existing `breef/` scaffold names these areas but contains marker files only. Without enforced dependency direction, a workspace can still become a distributed tangle or a shared-package dumping ground.

## Proposed decision

Use one pnpm/Turborepo modular-monolith repository with:

- Breev-normalized new package scopes (`@breev/*`) and application metadata from the first Phase 1 foundation task; historical governing sources/prototype remain unchanged;
- deployable apps as composition/adaptation boundaries;
- domain modules owning behavior and persistence schema;
- focused shared packages for contracts, money, units, permission/entitlement vocabulary, audit, sync envelope, validation, i18n, UI, and testing;
- a deliberately small `shared-kernel` limited to stable primitives;
- enforced direction: apps → modules → focused packages → shared-kernel;
- no app imports from modules, no circular dependencies, and no cross-module table access.

Domain collaboration uses explicit application contracts and synchronous orchestration where one local transaction is required; integration events are for decoupled projections/sync, not a substitute for local consistency.

## Alternatives considered

- Separate repositories: clearer release ownership, but adds contract/version/CI overhead too early.
- Microservices: independent scaling, but operationally incompatible with an offline pharmacy main-PC deployment and premature for the team/product.
- Single unstructured application: fast initially, but unsafe for accounting, sync, and entitlement boundaries.

## Consequences

- Positive: atomic local workflows remain possible; types/contracts and UI can be shared intentionally; one reproducible toolchain.
- Negative: boundary linting and ownership discipline are mandatory; build graph and package publication conventions must be maintained.
- Follow-up: Phase 1 adds clean-install CI and automated forbidden-import/cycle checks before domain code.

## Approval note

Directory existence is not evidence of acceptance. This ADR becomes Accepted only with Phase 0 approval.
