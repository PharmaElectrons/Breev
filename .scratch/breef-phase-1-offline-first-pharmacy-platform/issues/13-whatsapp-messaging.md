# 13 — WhatsApp identity, templates, and durable messaging

**What to build:** A Pharmacy can use its own approved WhatsApp Business identity for entitled, policy-compliant messages with durable delivery state, attributable usage, and safe cancellation/retry behavior.

**Blocked by:** 03 — Subscriptions, entitlements, licences, and Free Core fallback; 09 — Patient Profiles, consent, and bounded clinical boundary.

**Status:** ready-for-agent

- [ ] Each Pharmacy connects a dedicated Pharmacy WhatsApp Identity; no sender or credentials are shared across Tenants.
- [ ] Arabic/English WhatsApp Template Versions preserve purpose, consent scope, provider category, approval state, and policy version.
- [ ] Enqueue and send-time checks validate consent/basis, destination, template, provider, jurisdiction, privacy, and entitlement.
- [ ] Durable queues support retries, cancellation, dead-letter handling, authenticated tenant-bound idempotent callbacks, and delivery history.
- [ ] Usage allowances, actual provider charges, overage, and provider deletion/cancellation outcomes are visible and attributable.
- [ ] Telegram, SMS, and unapproved medicine/health messaging remain unavailable.
