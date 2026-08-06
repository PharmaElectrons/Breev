# ADR-013: Offline Licensing, Grace, and Free Core Fallback

- Status: **Accepted — Phase 0**
- Date: 2026-08-05
- Decision owners: Product / subscriptions / security / operations
- Related: REQ-IAM-004–009, Q-010, R-012

## Context

Breev is offline-first, has a free main-computer plan, and sells paid terminals/features. A pharmacy may lack internet when its paid term expires. Trusting Windows time permits bypass; hard-locking or withholding data endangers business continuity and turns customer data into leverage. Provider jobs also cost Breev money and cannot continue indefinitely after expiry.

## Decision

- Server issues a digitally signed offline licence containing tenant/pharmacy ID, licensed device ID, plan and features, subscription expiry, grace end, issue time, licence version, and signature.
- Paid expiry receives seven inclusive grace days. Example: expiry August 31; paid features operate through September 7; fallback begins September 8 at 00:00 under Trusted Breev Time.
- Trusted time uses signed/server observations and monotonic last-known state. Restart, time-zone/clock rollback, or remaining offline cannot extend entitlement.
- During grace, existing paid features continue. Owner/authorized administrator receives warnings with expiry, grace end, and renewal action; ordinary cashiers are not repeatedly interrupted.
- Significant tamper may prevent paid use/extension but never blocks Free Core, pharmacy-owned data/history/reports/print, local backup, complete export, supported restore/inspection, or renewal.
- After grace, main computer automatically uses Free Core. Paid history/config remains viewable where safe; no data is deleted, hidden, encrypted, or held for payment.
- Additional paid terminals cannot create new transactions. Paid sync/OCR/WhatsApp/AI/cloud/provider jobs stop. Queued jobs remain visible with explicit subscription-expired state.
- Drafts remain durable. Core-compatible drafts complete on the main computer; paid-only drafts remain read-only or are explicitly/safely converted where possible.
- Reconnection reconciles with the authoritative server without interrupting Free Core/data access. Renewal restores entitlements without reinstalling, recreating the pharmacy/catalog, or recovering history.
- Issue, expiry, grace entry/end, tamper detection, fallback, reconciliation, renewal, and restoration are audited.

The stakeholder approved these controls on 2026-08-05.

## Alternatives considered

- Trust local wall clock: easily bypassed.
- Require frequent online checks: breaks offline-first.
- Hard-lock after expiry: unsafe for patient/business continuity and customer data ownership.
- Continue paid provider work indefinitely: creates uncontrolled Breev/provider costs.
- Delete or obscure paid data: unacceptable data-hostage behavior.

## Consequences

- Positive: enforceable paid capabilities with bounded offline tolerance and permanent pharmacy continuity.
- Negative: trusted-time persistence, signed licence rotation/versioning, cross-device reconciliation, draft/job state, and clock-tamper testing add complexity.
- Verification: exact inclusive boundaries/time zones, long offline/reboot/rollback, damaged/old licence, device mismatch, cashiers versus owner warnings, drafts/jobs, fallback, export/restore, reconnect/renewal, and audit tests.
