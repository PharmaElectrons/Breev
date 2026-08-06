# 03 — Subscriptions, entitlements, licences, and Free Core fallback

**What to build:** A Pharmacy owner can manage Subscription Plans and see the active capabilities and device seats, while offline licence expiry preserves Free Core POS and pharmacy-owned data instead of creating a data hostage condition.

**Blocked by:** 02 — Identity, Tenant, roles, and permissions.

**Status:** ready-for-agent

- [ ] Plans grant explicit feature and Additional POS Terminal entitlements.
- [ ] Local signed licence state, Trusted Breev Time, expiry, seven-day grace, tamper state, renewal, and restoration are represented and audited.
- [ ] Paid features are hidden and blocked consistently when unavailable, while Free Core POS, history, reports, print, backup, export, and renewal remain available.
- [ ] Provider jobs and paid cloud work stop or preserve visible status after expiry without silently discarding drafts or data.
- [ ] Negative tests prove that expired or forged entitlement state cannot extend paid authority or remove access to pharmacy-owned records.
