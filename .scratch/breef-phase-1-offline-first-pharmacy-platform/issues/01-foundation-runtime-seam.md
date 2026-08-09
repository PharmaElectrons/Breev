# Epic 01: Establish the secure offline foundation runtime

Type: epic
Status: needs-triage
Engineering phase: P1 — Foundation
GitHub issue: #3
Parent GitHub specification: #2

## User Story

As a pharmacy owner, I want Breev to start as a secure local Windows application without internet, so that later pharmacy workflows have a dependable and recoverable execution boundary.

## Outcome

Deliver a reproducible monorepo, secure Electron shell, separate local/cloud API skeletons, managed-PostgreSQL lifecycle proof, empty migrations, redacted observability, shared test gates, and an offline desktop-to-local-API integration proof. This epic creates no pharmacy domain schema or behavior.

## Expected workflow

1. An engineer installs the pinned toolchain and runs one root verification command.
2. Electron starts with a sandboxed renderer and a narrow typed desktop bridge.
3. The renderer calls the versioned Local API health/readiness contract over HTTP; it never reads PostgreSQL or Node/Windows APIs directly.
4. Starting, ready, dependency-not-ready, unavailable, and recovered states are shown accessibly in AR/RTL and EN/LTR.
5. The cloud API remains a separate optional process and cannot affect local foundation startup.
6. CI proves architecture, security, config, contract, redaction, accessibility-smoke, migration, and offline-integration gates.

## Invariants and failure behavior

- No domain tables, users, products, invoices, stock, journals, sync records, OCR, or messages.
- Missing/invalid config fails before listening and never reveals secrets.
- Local dependency failure is visible and recoverable; cloud/internet failure is irrelevant to local readiness.
- Windows/PostgreSQL destructive proof steps target only a verified disposable instance and preserve its last recoverable state.

## Acceptance scenarios

- Given a clean supported environment with internet blocked, when the foundation starts, then the desktop reaches the Local API through the typed HTTP contract and shows accurate readiness.
- Given malicious renderer navigation or IPC input, when it reaches the boundary, then it is denied without Node, filesystem, shell, database, secret, or broad device access.
- Given the Local API or disposable database becomes unavailable and then recovers, when the desktop observes it, then state changes are announced and no fabricated domain data appears.

## Executable child tasks

- 17/P1-01 through 28/P1-12, sequenced in `../map.md`.

## Gate and exclusions

- Phase 0 is approved; each child task still requires explicit initiation and dependency completion.
- Production installer selection, authentication, Tenant data, pairing, and all pharmacy behavior are later work.

## Traceability

- US-001–009, US-098–099; REQ-ARCH-001–007, REQ-ARCH-010–011, REQ-UX-000–004, REQ-NFR-002–006; ADR-001–004, ADR-008, ADR-023–024, ADR-027.
