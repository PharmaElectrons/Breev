# Phase 1 Foundation Task Proposal

Status: **proposal only; Phase 0 approved on 2026-08-06; execution not started**.

The proposal may now be initiated explicitly. Phase 1 remains limited to foundation work and does not authorize production domain behavior or bypass the later phase and release gates.

These are intentionally small review units. They create foundation seams and verification, not domain implementation, tables, or migrations.

| Task | Deliverable | Verification / review boundary | Depends on |
|---|---|---|---|
| P1-01 Toolchain and identifier baseline | Apply the approved Breev technical-identifier policy, then pin Node/pnpm/Turbo/TypeScript versions, workspace scripts, lockfile policy, and clean-install instructions | No accidental public `Breef` branding outside preserved source/history; clean checkout installs and runs one root verification command | Q-001A/ADR-001 |
| P1-02 Workspace conformance | Validate/adjust app, module, and shared-package manifests and dependency rules; add cycle/boundary check | CI rejects forbidden/circular imports; no domain code | ADR-001/module map |
| P1-03 Shared configuration | Strict TS, lint, formatting, test runner, environment schema and redacted config conventions | Negative config tests; no secrets in client bundles/logs | P1-01 |
| P1-04 Secure Electron shell | Main/preload/renderer skeleton with sandbox, context isolation, CSP, navigation/window controls, narrow typed API | Automated Electron security assertions and manual smoke | ADR-002/011 |
| P1-05 Desktop UI foundation | React/Vite shell, AR/EN direction, light/dark design tokens, error boundary and offline/disabled state components | Visual/keyboard smoke in four locale/theme combinations | P1-03/P1-04 |
| P1-06 Local API skeleton | NestJS composition root, versioned health/readiness endpoints, validation/error/correlation middleware | Contract tests; renderer uses HTTP client, not DB/Node | ADR-003 |
| P1-07 Cloud API skeleton | Separate NestJS composition root with health/readiness and mandatory tenant-context interface (no business endpoints) | Missing tenant context is rejected in tests | ADR-008 |
| P1-08 Database lifecycle proof | Time-boxed Windows proof of the approved managed PostgreSQL service/start/stop/health/repair/backup approach; no domain schema | Written validation evidence and updated ADR-004; destructive cases on disposable DB only | ADR-004/Q-003 |
| P1-09 Drizzle migration harness | Empty local/cloud migration journals, ownership conventions, forward-only test harness | Applies against disposable databases; no production/domain tables | ADR-004/module map |
| P1-10 Observability/audit envelopes | Structured redacted logging, actor/tenant/device/correlation contracts, append-only audit interface | Secret/health-data redaction and correlation tests | P1-03 |
| P1-11 Contract and test harness | API client generation/validation boundary, unit/integration/Electron fixtures, CI matrix | Deliberately failing fixture proves each gate runs | P1-01–P1-07 |
| P1-12 Foundation integration | Desktop connects to local health API; LAN-mode proof; cloud remains optional; architecture/runbook updated | Internet-disconnected smoke; main-service unavailable UX; no domain data | ADR-003/P1-04–P1-11 |

## Explicit non-goals

- No users/roles/tenants/plans/licenses/devices implementation beyond interfaces needed to prevent insecure defaults.
- No product, supplier, sale, purchase, stock, batch, patient, accounting, sync, OCR, or messaging schema/behavior.
- No port of Supabase migrations or direct browser data access.
- No production installer/update rollout until the ADR-004/011 proofs and later release phase.
- No visual rewrite of all prototype screens; only the shared shell/design-system proof needed for foundation acceptance.

## Task-document rule after approval

Each row becomes one local Markdown task/spec with scope, acceptance criteria, files allowed, test plan, risks, and doc updates. Do not combine the whole phase into one implementation change.
