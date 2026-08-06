# Master Delivery Plan

This plan follows the governing master prompt. These are engineering phases, not the client's commercial milestones: the first commercial delivery spans the foundation, domain, accounting, sync, messaging, OCR, and release work listed below. Every phase requires reviewed ADRs, small task documents, verification evidence, documentation updates, and explicit approval at its gate.

## Phase status

| Phase | Outcome | Entry gate | Exit evidence | Status |
|---|---|---|---|---|
| 0 — Discovery | Reconciled source baseline, recovered UI/workflows, module map, risks/questions, draft ADRs, delivery plan | Repository and all four named sources available | Required docs complete; decisions grilled; stakeholder says `PHASE 0 APPROVED` | **Approved — 2026-08-06** |
| 1 — Foundation | Reproducible monorepo, secure Electron shell, local/cloud NestJS skeletons, health/config/log/test foundations, and update-contract proof | Phase 0 approved; blocking P1 ADRs accepted | Clean install/build/typecheck/lint/test; shell/API health; security checks; signed-manifest/compatibility interfaces; no domain schema | Not started |
| 2 — Identity/platform | Tenant/user/role/permission, step-up/dual-control authorization, feature/plan/license, device pairing/revocation, and ADR-022 cloud vendor/region/support evidence review (decision only; no production deployment) | P1 stable; expiry/pairing decisions approved | Negative authorization/approval/entitlement tests across UI/API/jobs; offline two-user tests; approved provider/region/location/support comparison or explicitly documented defer decision | Not started |
| 3 — Domain kernels/catalog | Money/unit/ID foundations, catalog, product naming, barcodes, suppliers | Money, unit, naming ADR/decisions approved | Domain tests, multilingual search and conversion fixtures, no stock mutation in catalog | Not started |
| 4 — Purchasing/inventory | Purchase lifecycle, reviewed OCR boundary, batches, movements, counts, valuation | Accountant approves valuation/discount examples | Transaction/failure tests; keyboard flow; snapshot/history; inventory reconciliation | Not started |
| 5 — Sales/cash | POS drafts/posting, payments/receivable, returns/corrections, continuous cash boxes, sensitive price/return approvals, and POS performance/accessibility verification | Invoice correction/numbering, money, ADR-025 action rules, and ADR-027 targets approved | Fast-path p95/p99 tests on certified hardware; Accessible Core Flow tests; atomic posting; step-up/dual-control; outage/restart; cash reconciliation; immutable history | Not started |
| 6 — Accounting | Double-entry engine, posting templates, journals, AP/AR, trial balance/P&L, journal approval | Signed posting matrix and ADR-025 manual-journal/ backdating controls from accountant/product owner | Balanced ledgers for golden scenarios, dual-control journals, reversal/backdating controls, close/rebuild tests | Not started |
| 7 — Patients | Consent-aware CRM, history, reminders, deterministic bounded clinical alerts if licensed | ADR-016/017 legal-pharmacist gates and ADR-018 commercial-licence/mapping/bilingual/pharmacist gates satisfied | Consent/retention/access tests; anonymous core; mapped/freshness/Not-Evaluated/advisory-vs-hard-block fixtures; no unlicensed advice | Not started |
| 8 — Messaging/OCR/AI | WhatsApp queue/provider, OCR jobs/review, and bounded optional AI/integration boundaries | ADR-016/019 messaging gates plus ADR-020 OCR and ADR-026 connector contract/provider gates satisfied | Dedicated-tenant identity, secure callbacks, policy revalidation, itemized usage, OCR 99%/95% evidence, connector field/consent/deletion/callback tests, idempotency/deletion/quota/privacy tests, no automatic business posting | Not started |
| 9 — Cloud/subscriptions/sync | SaaS plans/licenses, one-way sync, cloud views, minimal Super Admin | ADR-022 Phase 2 decision revalidated against current provider/region/legal/service/cost evidence; cloud ops and sync contracts approved | Tenant isolation, replay/outage/resume, billing/expiry, RPO/RTO/restore, monitoring/incident, and support audit tests | Not started |
| 10 — Reports | Permissioned reports, filters, exports, audit experience, high-risk export approvals, and approved outbound evidence | Accounting/projection sources stable; ADR-017/ADR-025/ADR-026 export and connector controls accepted | Reconciles to ledgers; step-up/dual-control export/privacy tests; connector allow-list/callback/deletion tests; AR/EN/print | Not started |
| 11 — Production release | Windows installer, PostgreSQL lifecycle, backup/restore, signing, updates, observability, Certified Hardware Profiles, accessibility/performance evidence, and runbooks | ADR-023/024/027 exact OS, hardware, signing/update, accessibility, performance, and support evidence revalidated; certified OS/hardware/update/backup policies | Fresh install/upgrade/rollback/restore/power/peripheral/migration drills, security review, compatibility/accessibility matrix, p95/p99 evidence, operational acceptance | Not started |

## Phase 0 exit checklist

- [x] Master prompt, product brief, Arabic PDF, conversation, `frontend/`, and `breef/` inspected.
- [x] Source authority and contradictions recorded.
- [x] Existing routes, state, data access, mocks, future modules, and unsafe behavior inventoried.
- [x] Required sales, purchase, stock, cash, invoice, messaging, and sync workflows recovered.
- [x] Requirements, screen, keyboard, question, risk, glossary, module, and delivery artifacts drafted.
- [x] ADR-001 through ADR-011 are review-ready proposals; ADR-012 through ADR-027 record approved, conditionally approved, or provisionally approved Phase 0 boundaries.
- [x] High-impact questions grilled one at a time and answers incorporated.
- [x] Stakeholder sends the exact phrase `PHASE 0 APPROVED`.

## Cross-phase quality gate

No task is complete until relevant evidence shows:

- clean reproducible install/build/typecheck/lint/test;
- server-side permission, entitlement, tenant, validation, idempotency, and audit enforcement;
- atomicity and rollback on injected failures;
- offline/restart/replay behavior;
- Arabic/English, RTL/LTR, light/dark, keyboard, accessibility, print/export checks;
- loading/empty/error/disabled/offline/conflict states;
- no destructive financial/inventory history edits;
- updated requirements, glossary, ADR, risk, workflow, and task documentation.

## Scope control

Clinic is excluded. Multi-branch, multi-currency, delivery, e-commerce, broad marketing, supplier comparison/auto-order, inter-pharmacy exchange, biometric payroll, external payments/e-invoicing, Telegram/SMS/Zapier, and two-way cloud editing remain outside the core path unless promoted after their approved provider/jurisdiction gates and entitlement plan.

## Immediate next step

Phase 0 was approved on 2026-08-06. Phase 1 may now be scheduled from `PHASE_1_TASK_PROPOSAL.md`; its tasks remain unstarted until explicitly initiated. Q-025's benchmark and final accessibility evidence remain release gates.
