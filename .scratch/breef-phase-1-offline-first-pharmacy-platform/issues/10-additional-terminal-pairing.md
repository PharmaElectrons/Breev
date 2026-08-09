# Epic 10: Pair and revoke Additional POS Terminals without creating another authority

Type: epic
Status: needs-triage
Engineering phase: P2 — Identity/platform
Blocked by: 03
GitHub issue: #12
Parent GitHub specification: #2

## User Story

As a pharmacy owner, I want to pair, name, use, replace, and revoke an Additional POS Terminal through a human-confirmed one-use ceremony, so that trusted LAN devices can work offline without sharing keys or owning a conflicting database.

## Outcome

Deliver Pharmacy Local CA/Installation Identity foundation, discovery-as-location, terminal-generated non-exported keypair, one-use Pairing Session, fingerprint confirmation, device certificate, Terminal Seat allocation, mutual TLS requests, independent user authorization, renewal, replacement, and local-authoritative revocation.

## Expected workflow

1. Terminal discovers or receives a candidate main endpoint; discovery provides no trust.
2. Terminal generates its keypair and proposes its public key. An owner/trusted `devices.pair` user reauthenticates and opens a short one-use pharmacy/main-bound Pairing Session.
3. Both screens show human-comparable identity/fingerprint; approval rechecks Seat, Entitlement, trusted time, proposed key, and newest revocation state.
4. Main service signs a device-specific certificate and records terminal name/identity/seat/audit. Reusable secret material is not retained.
5. Each LAN request proves certificate/private-key possession and independently authenticates/authorizes the user.
6. Local revocation immediately closes sessions and blocks renewal/requests offline; replacement requires explicit revoke/release/reallocate/re-pair.

## Invariants and failure behavior

- Main Pharmacy Computer remains the sole local transaction/database authority.
- IP, Windows name, discovery result, QR possession, certificate, or Seat alone is insufficient authority.
- Repair preserves CA/device state; replacement/reinitialization creates a new trust domain and requires re-pairing.
- Main-computer outage is visible; terminal never creates a private fork.

## Acceptance scenarios

- Given a valid Seat and matching fingerprints, when an authorized different device completes the one-use session, then only its locally held key receives one pharmacy-bound certificate.
- Given a reused/expired/mismatched session or key, when approval is attempted, then pairing fails and no Seat/certificate authority is granted.
- Given a terminal is revoked while internet is down, when it calls or renews, then local validation rejects it immediately while main-computer records remain intact.

## Planned child slices

- Local CA/Installation Identity; discovery metadata; proposed key/session; owner confirmation; certificate issuance/storage; mTLS request context; seat allocation/replacement; renewal; revocation/session invalidation; offline/LAN/security test matrix.

## Gate and exclusions

- ADR-014/015 implementation evidence and exact client packaging path required. Multi-master operation and direct PostgreSQL access are excluded.

## Traceability

- US-086–090; REQ-NFR-005, REQ-NFR-008–012; ADR-003, ADR-013–015, ADR-025.
