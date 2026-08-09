# Epic 03: Enforce Subscriptions and Entitlements without holding pharmacy data hostage

Type: epic
Status: needs-triage
Engineering phase: P2 identity/platform and P9 cloud/subscriptions
Blocked by: 02
GitHub issue: #5
Parent GitHub specification: #2

## User Story

As a pharmacy owner, I want explicit plan capabilities and a tamper-resistant offline licence that falls back to Free Core POS safely, so that paid features are controlled while core sales and pharmacy-owned data remain permanently accessible.

## Outcome

Represent Subscription Plans, Entitlements, Terminal Seats, Signed Offline Licences, Trusted Breev Time, active/grace/fallback/tamper/reconciliation states, and server-side enforcement at every execution boundary.

## Expected workflow

1. Cloud administration issues a signed Tenant/device/plan licence with features, seats, issue/expiry/grace times, and version.
2. Local validation verifies signature, binding, version, revocation, and Trusted Breev Time without trusting the editable Windows clock.
3. Active and seven-inclusive-day Grace Period states preserve existing paid capabilities and show owner/admin warnings.
4. At day 8 00:00 trusted time, or on suspected tamper, new paid-only work stops while Free Core POS, history, reports, print, backup, export, and renewal remain available.
5. Drafts and jobs are preserved with explicit status; they are never deleted silently.
6. After verified renewal/reconciliation, entitled capabilities return without reinstall or data recovery.

## Invariants and failure behavior

- Permission and Entitlement are independent and both must pass.
- Navigation hiding is not enforcement; APIs, jobs, exports, sync, providers, and device seats recheck.
- Clock/time-zone rollback, restart, offline duration, forged local state, or stale cloud state cannot extend authority.
- Expiry never encrypts, hides, deletes, or blocks supported access to pharmacy-owned data.

## Acceptance scenarios

- Given expiry on August 31, when trusted time reaches September 8 00:00, then paid-only work stops and all Free Core capabilities remain usable.
- Given a forged licence or clock rollback, when evaluated, then paid authority is denied/audited without disabling Free Core.
- Given a preserved paid-only draft and a later valid renewal, when reconciliation completes, then the draft resumes under current validation without duplication.

## Planned child slices

- Feature/plan vocabulary; signed licence verification; Trusted Breev Time; grace/fallback state machine; boundary enforcement adapters; cloud issuance/reconciliation; expiry job/draft behavior; negative/tamper suite.

## Gate and exclusions

- Exact signing/rotation/offline-expiry evidence and Phase 9 cloud choice remain gates. Payment collection and commercial billing contracts are outside this product epic.

## Traceability

- US-084–086, US-091–092; entitlement/licensing requirements; ADR-013, ADR-022, ADR-025.
