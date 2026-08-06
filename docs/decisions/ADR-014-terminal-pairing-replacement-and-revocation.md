# ADR-014: Terminal Pairing, Replacement, and Revocation

- Status: **Accepted**
- Date: 2026-08-06
- Decision owners: Identity / security / desktop platform
- Related: REQ-IAM-010–013, Q-012, Q-013, R-003, R-003A

## Context

Paid additional terminals must authenticate to the Main Pharmacy Computer while the internet is unavailable. Treating LAN presence, a reusable code, shared credential, or copied certificate as trust would let an unintended or stolen device reach pharmacy data. At the same time, a lost terminal must be revocable locally without destroying authoritative records or depending on the cloud.

## Decision

- Pairing begins only on the Main Pharmacy Computer after re-authentication by the owner or a trusted user with `devices.pair`.
- A pairing session is one-use, bound to the pharmacy, Main Pharmacy Computer, and session, limited to the local pairing service, expires within five minutes, locks after limited failed attempts, and becomes invalid immediately on success. LAN presence alone grants no trust; the reusable secret value is not retained after completion/expiry.
- The terminal generates its own cryptographic keypair and never exports its private key. Breev never transfers database/admin credentials, shared private keys, or reusable pairing secrets to it.
- Before approval, the Main Pharmacy Computer shows the proposed name and fingerprint, and both devices show a matching short verification phrase/code for human confirmation.
- Pairing validates a pharmacy-matching signed offline licence, additional-terminal entitlement, available seat, expiry, and grace rules. New pairing during grace is prohibited unless the signed licence explicitly allows it; existing devices follow ADR-013.
- After approval, the local certificate authority issues a new device-specific certificate bound to the terminal public key, pharmacy/device identity and type, licence, and certificate serial. Every request still requires valid device identity plus the signed-in user's permissions.
- Audit preserves pairing session, authorizer and re-authentication time, main/terminal identifiers, terminal name/fingerprint, certificate serial, allocated seat, licence/grace state, creation/approval/completion times, result, and failure reason without retaining a reusable secret.
- A trusted administrator can revoke locally while offline. Revocation marks device/certificate revoked, invalidates server-side sessions/tokens, rejects current and future requests, and audits actor, reason, time, device, and certificate IDs. A disconnected device's screen cannot be remotely closed, but its next request is rejected.
- Revocation preserves posted records, audit history, and drafts already stored on the Main Pharmacy Computer. Breev cannot promise recovery of a draft never transmitted from a lost terminal, so drafts are main-computer-backed whenever LAN is available.
- Replacement revokes the old device, releases/reallocates its seat under policy, generates a new terminal keypair, and issues a new certificate. Old private keys/certificates are never copied.
- Reconnection reconciles device and revocation records with cloud. Older cloud state cannot silently reactivate a locally revoked device; reactivation is explicit and normally requires new pairing/certificate.

## Alternatives considered

- Trust any LAN client: easy deployment, unacceptable impersonation and data exposure.
- Reusable shared pairing password or certificate: difficult to attribute/revoke and easy to copy.
- Internet-required pairing/revocation: prevents safe operation during an outage.
- Copy the old certificate during replacement: preserves compromised identity and defeats revocation.

## Consequences

- Positive: offline-capable device trust with per-device attribution, seat enforcement, immediate local revocation, and no database credential exposure.
- Negative: Breev must operate a protected local certificate authority, secure terminal key storage, revocation checking, session invalidation, and a clear human fingerprint-verification flow.
- LAN discovery, local CA provisioning/protection, mutual TLS, rotation, compromise, and clock-safe renewal are approved in ADR-015.
