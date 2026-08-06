# ADR-015: LAN Discovery, Mutual TLS, and Local CA Lifecycle

- Status: **Accepted**
- Date: 2026-08-06
- Decision owners: Security / identity / desktop platform
- Related: REQ-IAM-011, REQ-NFR-005, REQ-NFR-008–012, Q-013, R-003, R-003A, R-003B

## Context

Additional terminals must find a Main Pharmacy Computer whose LAN address may change, then communicate securely while offline. Discovery protocols and manually entered addresses identify only candidates: neither proves that the endpoint is the pharmacy's Breev service. Trust therefore requires a pharmacy-specific certificate chain and bidirectional proof of private-key possession whose lifecycle survives normal repair but responds safely to revocation, expiry, clock rollback, and CA compromise.

## Decision

### Local CA and key protection

- Secure first initialization of the Breev main service creates exactly one pharmacy-specific local CA. Installer repair/re-run reuses it and never silently replaces it.
- Its private key is non-exportable in the Windows machine key store, accessible only to the dedicated Breev service identity. Microsoft Platform Crypto Provider with TPM-backed protection is preferred when available. Otherwise, Breev may use the Windows software key-storage provider with restrictive machine ACLs and must record the lower assurance level.
- The CA private key is excluded from ordinary backup, export, and migration. Secure main-computer reinitialization or replacement creates a new CA and requires terminal re-pairing. Public certificates, device records, revocation history, and audit remain exportable.

### Discovery is not trust

- Breev uses link-local mDNS/DNS-SD discovery with the pairing QR and manual endpoint entry as fallbacks. Manual entry changes only location and cannot bypass validation.
- Advertisements expose only a minimal Breev service type, opaque random installation identifier, required address/port, and minimal non-sensitive protocol metadata. They never expose pharmacy, owner, user, patient, licence, subscription, device-count, or detailed-version data; use a generic/random local hostname where practical.
- A candidate is accepted only after validating the pharmacy CA chain, Breev server identity/certificate role, certificate validity/revocation, pairing-established installation identity, and proof of the matching private key. A discovered IP may bind the active pairing session but never becomes the permanent trust anchor.
- The pairing QR binds the session ID, expected main-computer and server-certificate identities, pharmacy CA fingerprint, and proposed terminal public key.

### Encrypted channel and renewal

- Mutual TLS is mandatory for every terminal-to-main API request: terminal validates server; server validates terminal; user permission is still checked separately. Breev provides no plaintext LAN API, anonymous TLS, warning bypass, or accept-any-certificate mode.
- Prefer TLS 1.3. TLS 1.2 is the minimum compatibility fallback under an approved secure configuration. TLS 1.0/1.1 and lower-version fallback are disabled. TLS 1.3 0-RTT is disabled so state-changing Breev operations are never accepted as replayable early data.
- Automatic certificate renewal occurs only through an already authenticated connection, before expiry, after checking active device, certificate/key possession, revocation, licensed seat, subscription/grace entitlement, Trusted Breev Time, and current certificate-policy version.
- Revoked certificates/devices or identities outside the renewal window never silently renew; they require explicit authorized recovery or new pairing.

### Rotation, compromise, authority, and audit

- Planned CA rotation has a defined short overlap: introduce the new CA, temporarily trust both, reissue server/terminal certificates, confirm installation of the new chain, then remove old trust by deadline. Old trust never continues indefinitely.
- Suspected CA compromise bypasses overlap: immediately retire the compromised chain, create a new CA, and require owner-confirmed terminal re-pairing. Certificates under the compromised chain are not automatically transferred or renewed.
- Certificate/device validity, renewal windows, and CA overlap use Trusted Breev Time, not the editable Windows clock alone. Rollback cannot extend certificate/device trust, CA overlap, subscription, or grace.
- Local certificate/device revocation remains authoritative; cloud reconciliation cannot silently restore locally revoked certificate, device, or CA trust.
- Audit records CA creation, issuance, renewal/rejection/expiry/revocation, rotation, trust-store change, pairing identity, authorizer, validation result, and trusted-time state. It never records private keys, reusable pairing secrets, or recoverable QR values.

## Alternatives considered

- Trust discovery result or manual IP: vulnerable to spoofed LAN services.
- Plain HTTP or optional certificate warnings: trains operators to bypass identity and exposes pharmacy traffic.
- Public internet CA dependency: can break offline local operation and does not establish terminal identity.
- Back up/export the local CA key: improves transparent migration but expands the impersonation and backup-theft blast radius.
- Preserve a compromised chain during overlap: prioritizes convenience over trustworthy recovery.

## Consequences

- Positive: address changes remain usable without turning discovery into authority; both endpoints are authenticated and revoked devices stay revoked offline.
- Negative: full main-computer replacement requires new CA creation and terminal re-pairing; TPM absence is a visible lower-assurance state.
- Verification: test fake advertisements, manual-address spoofing, chain/role/fingerprint mismatch, key-possession failure, prohibited protocol versions/0-RTT/plaintext, renewal denials, rollback, planned/emergency rotation, revocation precedence, repair preservation, and audit redaction.
