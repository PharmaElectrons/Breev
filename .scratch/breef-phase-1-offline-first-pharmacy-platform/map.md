# Breev Commercial Stage 1 — Delivery Map

This map separates product scope, gated epics, and executable tasks. Read `spec.md` first. An epic is never claimed as one change.

GitHub mapping: specification #2; delivery epics 01–16 map to #3–#18; Phase 1 tasks 17–28 map to #19–#30.

## Current state

- Phase 0 discovery: approved on 2026-08-06.
- Phase 1 Foundation: decomposed and ready for review/explicit initiation; no task is claimed or implemented.
- Phases 2–11: planned epics only. Create their small task documents only after the applicable entry gate passes.

## Delivery epics

| Epic | Outcome | Phase(s) | Status | Principal dependency/gate |
|---|---|---|---|---|
| 01 | Foundation runtime seam | P1 | Child task set ready; epic not claimable | Phase 0 approval; task-by-task prerequisites |
| 02 | Identity, Tenant, roles, permissions | P2 | Planned | Epic 01; P2 authorization decisions |
| 03 | Subscriptions, Entitlements, Free Core | P2/P9 | Planned | Epic 02; licence/expiry/cloud gates |
| 04 | Catalog, naming, units, Suppliers | P3 | Planned | Epic 02; money/unit/naming decisions |
| 05 | Purchasing, inventory, valuation | P4 | Planned | Epic 04; final posting requires Epic 06 ledger core |
| 06 | Accounting ledger and posting | P6 | Planned | Epic 04; reviewed fact contracts and signed posting matrix; may start before Epic 05 UI is complete |
| 07 | POS sales and Cash Box | P5 | Planned | Epics 03–06; action/performance rules |
| 08 | Returns, reversals, approvals | P5 | Planned | Epic 07; numbering/correction/approval rules |
| 09 | Patients, consent, clinical boundary | P7 | Planned | Epic 02/07; legal/pharmacist/licence gates |
| 10 | Additional POS Terminal trust | P2 | Planned | Epic 03; pairing/CA/LAN evidence |
| 11 | One-way cloud synchronization | P9 | Planned | Local posting sources; cloud operations gate |
| 12 | Human-reviewed OCR purchase drafts | P8 | Planned | Epic 05; provider/model/privacy benchmark gate |
| 13 | Pharmacy-owned WhatsApp messaging | P8 | Planned | Epic 09; provider/DPA/template/legal gates |
| 14 | Reports, exports, audit | P10 | Planned | Stable accounting/operational sources; export gates |
| 15 | Backup, restore, update, hardware | P11 | Planned | Runtime and transaction flows; certification evidence |
| 16 | Production release and support handoff | P11 | Planned | All included epics and release gates complete |

## Phase 1 executable tasks

| Task | User outcome | Blocked by | Status |
|---|---|---|---|
| 17 / P1-01 | Reproducible Breev toolchain and identifiers | Explicit initiation | Ready |
| 18 / P1-02 | Enforced workspace boundaries | 17 | Planned |
| 19 / P1-03 | Shared config, validation, and redaction baseline | 17 | Planned |
| 20 / P1-04 | Secure Electron shell and narrow bridge | 19 | Planned |
| 21 / P1-05 | Bilingual accessible desktop UI foundation | 19, 20 | Planned |
| 22 / P1-06 | Versioned local API health seam | 19 | Planned |
| 23 / P1-07 | Tenant-safe cloud API skeleton | 19 | Planned |
| 24 / P1-08 | Disposable Windows PostgreSQL lifecycle proof | 17, 19 | Planned |
| 25 / P1-09 | Empty forward-only Drizzle migration harness | 19, 24 | Planned |
| 26 / P1-10 | Redacted observability and audit envelopes | 19, 22, 23 | Planned |
| 27 / P1-11 | Shared contract/test harness and CI gates | 18–23, 25, 26 | Planned |
| 28 / P1-12 | Offline desktop-to-local-API integration proof | 20–22, 24–27 | Planned |

## Execution rule

1. Explicitly initiate one `Ready` task.
2. Set it to `claimed`; do not claim another task concurrently unless the user explicitly requests parallel agent work.
3. Implement only its stated scope and tests.
4. Record commands/results under Completion evidence, update related docs, set `resolved`, and stop.
5. Mark newly unblocked tasks `Ready` only after their dependencies and review boundary are satisfied.
