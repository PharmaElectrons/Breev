# 02 — Identity, Tenant, roles, and permissions

**What to build:** Staff can sign in to an attributable Pharmacy Tenant, receive a role and named permissions, and use the same authorization context through the UI, local API, application services, jobs, exports, and audit records.

**Blocked by:** 01 — Foundation runtime seam.

**Status:** ready-for-agent

- [ ] The first owner and subsequent pharmacy users can authenticate locally without a shared account.
- [ ] Every request has verified Tenant, actor, device, and correlation context; untrusted Tenant fields are rejected.
- [ ] Roles and named permissions govern ordinary and sensitive actions consistently beyond navigation hiding.
- [ ] Permission failures are safe, localized, attributable, and auditable.
- [ ] Negative tests prove that direct application requests, jobs, and exports cannot bypass UI authorization.
