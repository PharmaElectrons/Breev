# Epic 02: Establish attributable identity, Tenant context, roles, and permissions

Type: epic
Status: needs-triage
Engineering phase: P2 — Identity/platform
Blocked by: 01
GitHub issue: #4
Parent GitHub specification: #2

## User Story

As a pharmacy owner, I want every staff action attributed to a verified user, Pharmacy Tenant, and device with named permissions, so that shared accounts and UI-only authorization cannot compromise pharmacy data.

## Outcome

Support secure first-owner initialization, local sign-in/session lifecycle, staff accounts, roles, named permissions, and consistent actor/Tenant/device context across UI, APIs, application services, jobs, exports, and audit.

## Expected workflow

1. A new initialized Pharmacy creates exactly one attributable first owner through a one-time protected ceremony.
2. The owner creates individual staff users and assigns reviewed roles/permissions; no shared default account exists.
3. A user signs in locally while offline and receives a bounded revocable session tied to Pharmacy and device context.
4. Every command derives Tenant and actor from verified context, then checks named permission at the execution boundary.
5. Sensitive grants or actions enter Step-Up Authorization or Dual Control; ordinary sales remain fast.
6. Logout, disablement, role change, password reset, session expiry, and revocation take effect under newest-state rules and are audited.

## Invariants and failure behavior

- Consent and Entitlement never grant staff permission; device trust never replaces user authorization.
- Tenant IDs supplied in bodies/queries are never authoritative.
- Permission denial changes no business state and returns a localized, non-sensitive reason/correlation ID.
- Shared accounts, self-approval under Dual Control, generic bypasses, and standing support access are prohibited.

## Acceptance scenarios

- Given an authenticated user without a named permission, when the action is called from UI or directly through an API/job/export seam, then every path rejects it and records safe evidence.
- Given a forged or mismatched Tenant field, when a request executes, then verified context wins and cross-Tenant access is rejected.
- Given a user's authority is removed, when an older session attempts a sensitive command, then newest-state validation rejects it.

## Planned child slices

- First-owner initialization; local credentials and session lifecycle; staff/role administration; permission evaluator and enforcement adapters; Step-Up Authorization; Dual Control and approval inbox; negative authorization/audit suite.

## Gate and exclusions

- Decompose only after Epic 01 and P2 authorization/offline-account decisions pass. No subscriptions, Patient consent, or terminal certificate implementation in this epic.

## Traceability

- US-003–005, US-075, US-085; REQ-UX-005 and identity/permission requirements; ADR-008, ADR-016, ADR-025.
