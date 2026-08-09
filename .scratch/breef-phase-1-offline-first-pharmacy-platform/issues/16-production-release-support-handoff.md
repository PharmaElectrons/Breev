# Epic 16: Certify, document, and hand off an operable Stage 1 release

Type: epic
Status: needs-triage
Engineering phase: P11 — Production release
Blocked by: 03, 08, 11, 12, 13, 14, 15 and every included release gate
GitHub issue: #18
Parent GitHub specification: #2

## User Story

As the Breev product and support team, I want an installable release with reproducible acceptance evidence, operating runbooks, and explicit support/change boundaries, so that the company can deploy and support Stage 1 without undocumented developer knowledge.

## Outcome

Produce signed release artifacts, source/configuration handoff, migration/installation/activation/backup/restore/update documentation, operational dashboards/runbooks, support training, data/provider/credential ownership matrix, acceptance matrix, known limitations, warranty/maintenance boundary, and final sign-off evidence.

## Expected workflow

1. Release candidate is built reproducibly from the tagged source and signed through the approved protected process.
2. Automated and manual evidence runs on named minimum/recommended Certified Hardware Profiles across clean install, upgrade, restore, offline, restart, failure, AR/EN, RTL/LTR, themes, keyboard, accessibility, performance, security, Tenant isolation, provider gates, and Free Core fallback.
3. Each failed/conditional capability is fixed or explicitly blocked from release; a provisional ADR is not treated as production authorization.
4. Company/support receive source, configuration ownership, deployment/recovery/provider procedures, monitoring/escalation, security/credential rotation, backup drills, known limitations, and training exercises.
5. Acceptance demonstrates core purchase-to-stock-to-sale-to-accounting-to-report plus correction/recovery and paid-provider boundaries.
6. Final sign-off records included scope, exclusions, external costs/owners, defects/waivers, maintenance/warranty/SLA contract references, and separately priced change control.

## Invariants and failure behavior

- A green UI demo is not release evidence; every included business invariant and failure path needs recorded results.
- Missing provider/legal/pharmacist/accountant/hardware evidence keeps that capability disabled or the release blocked as specified.
- Company ownership/access to pharmacy data, source, configuration, backups, and recovery is never dependent on an undocumented developer account.
- Future custom features, plan variations, and major upgrades are separate approved work and cannot weaken the released core.

## Acceptance scenarios

- Given cloud, internet, subscription, OCR, WhatsApp, printer, or update service failure, when the final continuity checklist runs, then applicable Free Core POS and pharmacy-owned data paths remain usable/recoverable.
- Given a clean supported Windows profile, when a trained support operator follows delivered docs, then they can install/activate, diagnose local health/sync/provider status, pair/revoke a terminal, back up, restore, and recover without developer-only knowledge.
- Given the release evidence index, when each Stage 1 User Story is traced, then it maps to a resolved task/test/result or an explicit gated exclusion—never an assumed implementation.

## Planned child slices

- Release candidate/reproducibility; security review; end-to-end business acceptance; offline/Free Core continuity; accessibility/performance/hardware certification; install/update/restore drills; operations/incident runbooks; support/admin training; source/config/credential handoff; limitations/change-control/acceptance sign-off.

## Gate and exclusions

- Every included epic, ADR release condition, external approval, and production evidence must pass. Contract prices, legal ownership wording, SLA negotiation, and unapproved future modules are separate commercial/legal deliverables.

## Traceability

- US-100–102 plus all Stage 1 stories; REQ-ARCH-011 and cross-phase definition of done; Master Delivery Plan P11; ADR-017, ADR-022–027.
