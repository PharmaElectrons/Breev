# ADR-003: Local API and LAN Topology

- Status: **Accepted**
- Date: 2026-08-05
- Decision owners: Architecture / security / operations
- Related: REQ-ARCH-001–003, Q-012, Q-013

## Context

The free deployment must operate on one Windows PC without internet. Paid additional POS terminals must continue over the local network when internet is down. Multiple independent terminal databases would create immediate conflicts in stock, invoices, cash, and accounting.

## Proposed decision

- One **Main Pharmacy Computer** runs the local NestJS API and authoritative local PostgreSQL.
- The desktop renderer and additional terminals use the same versioned REST application contract.
- Additional terminals connect only over the pharmacy LAN to the main computer; they do not own independent authoritative databases or directly access PostgreSQL.
- Each terminal is named, paired under ADR-014, authenticated with its own key/certificate plus the signed-in user, locally revocable, and entitlement/seat checked.
- The local API binds to configured private interfaces only, applies device/user authorization, request limits and audit, and uses ADR-015 mutual TLS and pharmacy-local trust.
- Loss of internet does not affect local operation. Loss of the main computer is a visible outage for terminals and enters a recovery workflow rather than silently creating local forks.

## Alternatives considered

- Independent offline DB per terminal: improves main-PC outage tolerance but introduces multi-master inventory/accounting conflict far beyond initial scope.
- Cloud-only API: cannot satisfy offline operation.
- Direct LAN PostgreSQL clients: exposes database credentials/schema and bypasses application invariants.

## Consequences

- Positive: one local transaction authority and simple offline correctness.
- Negative: the main computer is a local availability dependency, requiring health, backup, repair, UPS/recovery guidance.
- Future: true multi-master terminal operation would require a new ADR and is not implied by two-way cloud sync.

## Open details

Client packaging and the broader Main Pharmacy Computer replacement workflow remain unresolved. Terminal replacement/revocation is approved in ADR-014; LAN discovery and local-CA/TLS lifecycle is approved in ADR-015.
