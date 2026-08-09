# Epic 13: Send durable policy-compliant WhatsApp messages from a Pharmacy-owned identity

Type: epic
Status: needs-triage
Engineering phase: P8 — Messaging/OCR/AI
Blocked by: 03, 09; WhatsApp provider/template/legal gate
GitHub issue: #15
Parent GitHub specification: #2

## User Story

As a pharmacy owner and patient, I want approved WhatsApp communication to use the Pharmacy's dedicated identity, current purpose/template/consent, and transparent usage, so that messages are attributable, revocable, privacy-minimized, and never silently sent after policy changes.

## Outcome

Deliver Pharmacy WhatsApp Identity onboarding, encrypted credential references, immutable Arabic/English Template Versions, purpose/destination/provider/jurisdiction gates, estimated/actual Tenant costs, durable queue, send-time revalidation, official provider adapter, authenticated idempotent callbacks, retry/cancel/dead-letter, communication history, and provider deletion/cancellation outcomes.

## Expected workflow

1. Owner connects a dedicated Pharmacy-owned business account/number through an approved provider; it is never shared with another Tenant.
2. Owner reviews a bilingual Template Version bound to purpose, Meta category, consent scope, provider policy, and approval state.
3. User selects Patient/verified destination and trigger. Enqueue checks permission, Entitlement, basis/Consent Event, template, category, provider/jurisdiction, privacy rules, and allowance/estimated overage.
4. Durable job stores only minimum approved content/context. At send time every gate is checked again.
5. Provider call uses idempotency. Callback authentication derives Tenant/job binding, rejects replay/mismatch, and records delivery plus actual charge.
6. Withdrawal/policy/Entitlement change cancels unsent work and requests/records provider cancellation/deletion where possible; failed work is visible and recoverable.

## Invariants and failure behavior

- Consent for one purpose, channel, destination, provider, or Patient never transfers to another.
- No in-memory timer is the source of truth; no hidden automatic overage.
- Medicine/health content remains disabled until each applicable provider, Iraqi legal, pharmacist, and consent gate passes.
- Telegram/SMS/shared sender and provider-specific authority in core domain are prohibited.

## Acceptance scenarios

- Given consent/template/Entitlement is valid at enqueue but withdrawn before send, when the worker revalidates, then it does not send and records the cancellation outcome.
- Given a replayed or cross-Tenant callback, when authenticated, then it is rejected without changing delivery state or usage.
- Given provider timeout/retry, when the same idempotency key is reconciled, then at most one provider message/charge is attributed and uncertainty remains visible.

## Planned child slices

- Pharmacy identity onboarding; Template Version lifecycle; enqueue policy; durable queue; send-time revalidation/provider adapter; callback security; retry/cancel/dead-letter; usage/cost; communication history/deletion; policy/isolation/failure suite.

## Gate and exclusions

- Specific provider contract/DPA/onboarding/migration plus per-template approval required. Unapproved health messaging, Telegram, and SMS are excluded.

## Traceability

- US-078–083; messaging/patient/subscription requirements; ADR-016–017, ADR-019, ADR-025.
