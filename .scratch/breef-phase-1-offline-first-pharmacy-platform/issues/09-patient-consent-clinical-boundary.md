# 09 — Patient Profiles, consent, and bounded clinical boundary

**What to build:** Pharmacy staff can use optional Patient Profiles and approved health/contact context without forcing identity into ordinary sales, while consent, access, retention, and clinical safety boundaries remain explicit.

**Blocked by:** 02 — Identity, Tenant, roles, and permissions; 07 — POS sales and continuous Cash Box.

**Status:** ready-for-agent

- [ ] Ordinary sales can remain anonymous and optional Patient Profiles are separate from immutable transaction snapshots.
- [ ] Patient contact and health facts require a documented necessary basis or separate bilingual purpose and Consent Event.
- [ ] Consent grants, denials, and withdrawals are append-only, purpose/provider/destination scoped, and do not grant staff access.
- [ ] Future use and queued work stop after withdrawal, while required historical evidence remains protected under retention policy.
- [ ] Clinical evaluation is advisory and deterministic only; missing, stale, invalid, or disabled content returns `Not Evaluated` and never becomes an implicit safety claim.
- [ ] Patient export, support access, and sensitive changes use the approved verification, step-up, dual-control, and audit boundaries.
