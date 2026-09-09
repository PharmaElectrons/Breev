# Breev Project Rules & Non-Negotiable Invariants

Every PR review and remediation performed in Breev must adhere strictly to these project rules, derived from `AGENTS.md`, `docs/quality.md`, `docs/architecture.md`, and `docs/domain.md`.

---

## 1. Core Engineering Rules (AGENTS.md)

1. **Zero Dead Code & No Compatibility Adapters**:
   - Do **NOT** preserve backward compatibility with prototypes, empty scaffolds, obsolete documentation, or superseded identifiers.
   - Remove obsolete paths instead of adding aliases, fallbacks, adapters, or one-off migration layers.
   - The current public name is **Breev**. Use `breev` and `@breev/*` for implementation identifiers. Do not create compatibility exports for legacy names.
2. **Simplest Implementation First**:
   - Choose the simplest implementation that satisfies current requirements. Avoid speculative abstractions, indirection, or over-engineered extension points.
3. **Tests Beside Code**:
   - Place unit and integration tests directly beside the code they own (e.g. `src/foo/bar.ts` -> `src/foo/bar.unit.test.ts`).
   - Test through narrow public module or transport seams.
4. **Real PostgreSQL Persistence**:
   - Never mock database repositories to claim test compliance.
   - Run integration tests against real PostgreSQL. On Windows workstations, use the local PostgreSQL Windows service (`BREEV_TEST_POSTGRES_ADMIN_URL`).
5. **Windows Execution Discipline**:
   - Follow `.agents/skills/breev-windows-execution/SKILL.md`.
   - Never assign to protected PowerShell variables (`$PID`, `$HOME`, `$PWD`, `$Host`, `$Error`, `$Args`, `$Matches`, `$Input`).
   - Distinguish sandbox `CryptUnprotectData` (DPAPI) failures from product CNG defects. Never weaken encryption or certificate checks to bypass sandbox limitations.
   - Electron debugging must strictly remain loopback-only (`127.0.0.1`, never `0.0.0.0`).

---

## 2. Architectural Invariants (docs/architecture.md & docs/domain.md)

1. **Renderer Isolation & Secure IPC**:
   - The Electron renderer process must have **zero** direct Node.js or raw filesystem access.
   - All renderer-to-main IPC communication must go through narrow preload bridges guarded by `createIpcGuard`.
   - IPC channels must enforce runtime schema validation (Zod) on both requests and responses.
2. **Server-Authoritative Operations**:
   - The desktop client is never authoritative for accounting, stock depletion, or pricing calculations.
   - All business logic lives in `@breev/local-api` and runs server-authoritative operations.
3. **Atomic Posting & Conservation**:
   - Debits must equal credits. Quantity and carrying amount must conserve.
   - Stock adjustments, settlements, Cash Box entries, and audit logs must commit atomically in a single database transaction. A failure at any point must roll back the entire operation.
4. **Immutable Snapshots**:
   - Posted documents (sales invoices, purchases, settlements) are immutable.
   - Corrections require explicit reverse-and-repost documents, never in-place SQL `UPDATE` or `DELETE` on posted rows.
5. **Offline Free Core**:
   - Core pharmacy operations (sales checkout, stock scanning, local receipt printing, offline authentication) must function 100% offline without cloud connectivity or external services.

---

## 3. Usability, Accessibility & Localization (docs/quality.md)

1. **Arabic RTL and English LTR Parity**:
   - Every UI change must be fully functional and visually aligned in both Arabic (RTL) and English (LTR).
   - Layouts must support dynamic switching without text truncation or broken flow.
2. **WCAG 2.2 AA Compliance**:
   - Normal text contrast $\ge 4.5:1$, large text $\ge 3:1$.
   - Full keyboard accessibility (no keyboard traps, logical Tab order independent of visual RTL).
   - Interactive pointer targets $\ge 24\times24$ CSS pixels (primary cashier controls target $44\times44$).
   - Proper screen-reader (Windows Narrator) semantics.

---

## 4. Local Issue Tracking (.scratch/<feature-slug>/)

Breev tracks features and issues in `.scratch/<feature-slug>/spec.md`:
- Must have: `Type: task|epic|research|prototype|grilling`
- Status transitions: `needs-triage` $\rightarrow$ `ready-for-agent` $\rightarrow$ `claimed` $\rightarrow$ `resolved`.
- Required sections:
  - `## User story`
  - `## Source requirements`
  - `## Scope` & `## Exclusions`
  - `## Acceptance scenarios` (numbered acceptance tests)
  - `## Completion evidence` (checked items with test run IDs, hashes, and measurements)
  - `## Answer` (summarizes resolution and explicitly records any accepted deviations directed by stakeholders).
