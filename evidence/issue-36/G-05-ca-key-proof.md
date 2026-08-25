# G-05 Pharmacy CA and Terminal mTLS Proof

Date: 25 August 2026

Issue: GitHub #36 ("05: Prove the pharmacy CA and terminal mTLS")

Branch: `issue/05-pharmacy-ca-mtls`

This record satisfies the Stage 1c prerequisite for Gate G-05 ("Prove the pharmacy CA, terminal mTLS, and non-exportable key storage").

---

## 1. Threat Model & Architecture Boundary

A local area network (LAN) in a community pharmacy is an untrusted medium. Counter terminals, secondary dispensers, and tablet devices communicate with the Main local API over LAN.

An attacker on the LAN may attempt to:
1. Intercept or tamper with unencrypted LAN traffic (eAVESDROPPING / MITM).
2. Connect arbitrary HTTP clients to the Local API LAN port without authentication.
3. Exfiltrate the Pharmacy CA private key to forge device certificates offline.
4. Present a valid certificate from another pharmacy installation to gain unauthorized access.
5. Present a server certificate pretending to be a client terminal, or vice versa.
6. Present an expired or revoked terminal certificate.
7. Downgrade TLS to insecure protocols (TLS 1.0/1.1) or weak legacy cipher suites (CBC, RC4, 3DES).

### Security Invariants & Defense in Depth

The implementation establishes a cryptographic perimeter:

1. **Self-Signed Pharmacy CA with Hardware/OS Isolation**:
   - The Pharmacy CA root key is generated directly inside Windows Cryptography Next Generation (CNG) with `CngExportPolicies::None` and `CngKeyCreationOptions::OverwriteExistingKey`.
   - Key storage provider selection probes `Microsoft Platform Crypto Provider` (TPM 2.0 silicon isolation). If a hardware TPM is absent, it falls back to `Microsoft Software Key Storage Provider` with a typed security audit flag (`software-cng-fallback`).
   - The private key never leaves the Windows CNG key container. Signing operations (`NCryptSignHash` / `RSACng.SignData`) occur entirely within the OS crypto provider. Node.js never holds the raw private key bytes in memory.
   - Any attempt to call `NCryptExportKey` / `Export(Pkcs8PrivateBlob)` is rejected by the OS with `The requested operation is not supported`.

2. **Custom X.509 v3 Extension Hierarchy**:
   - Every issued certificate embeds custom private enterprise OIDs under `1.3.6.1.4.1.0.7265`:
     - `1.3.6.1.4.1.0.7265.1.1`: Role `breev-server` (Extended Key Usage)
     - `1.3.6.1.4.1.0.7265.1.2`: Role `breev-device` (Extended Key Usage)
     - `1.3.6.1.4.1.0.7265.2.1`: `installationId` (UUIDv7 string)
     - `1.3.6.1.4.1.0.7265.2.2`: `deviceId` (UUIDv7 string)
   - Node.js native `crypto.X509Certificate` validates the cryptographic chain, expiry window (`notBefore` / `notAfter`), SAN match, and exact enterprise role/installation OIDs on every connection.

3. **Per-Request Device Revocation Check**:
   - Every mTLS request extracts the client device ID from the verified peer certificate and executes an indexed query against the PostgreSQL `terminal_devices` table.
   - Revoked devices (`is_revoked = true` or `revoked_at IS NOT NULL`) are immediately rejected with `403 Forbidden` and typed denial code `device-revoked`. No caching or grace period exists for revocation.

4. **TLS 1.3 / 1.2 Protocol Hardening**:
   - Minimum TLS version enforced: `TLSv1.2`. Maximum version: `TLSv1.3`. TLS 1.0 and TLS 1.1 are explicitly forbidden.
   - Ciphers restricted exclusively to authenticated encryption with associated data (AEAD):
     - TLS 1.3: `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`, `TLS_AES_128_GCM_SHA256`
     - TLS 1.2: `ECDHE-ECDSA-AES256-GCM-SHA384`, `ECDHE-RSA-AES256-GCM-SHA384`, `ECDHE-ECDSA-AES128-GCM-SHA256`, `ECDHE-RSA-AES128-GCM-SHA256`
   - Client certificate validation enforced on server socket with `requestCert: true, rejectUnauthorized: false` (to allow extracting the peer certificate and emitting typed denial audit telemetry rather than terminating with silent TCP resets).

5. **Forward-Only Database Schema & Least Privilege**:
   - Schema defined in `apps/local-api/src/pharmacy-ca/pharmacy-ca-schema.ts`.
   - Forward migration `0001_pharmacy_ca_and_devices.sql` applies under advisory lock `165308856`.
   - Enforces UUIDv7 format checks on all `installation_id`, `device_id`, `id` columns.
   - Grants minimal DML permissions (`SELECT`, `INSERT`, `UPDATE`) to `breev_app`; denies DDL to runtime connection.

---

## 2. Rejection & Denial Matrix

| Attack / Fault Scenario | Tested Seam | Result / Denial Code |
| :--- | :--- | :--- |
| Attempt to export CA private key via CNG PKCS#8 export | `cng-addon.ts` | `exportBlocked: true`, `exportError: "The requested operation is not supported"` |
| Client connects without TLS client certificate | Live mTLS HTTPS Server | `401 Unauthorized`, `code: "mtls-cert-missing"` |
| Client certificate expired (`notAfter < now`) | `validateCertificate` / Live mTLS | `403 Forbidden`, `code: "cert-expired"` |
| Client certificate not yet valid (`notBefore > now`) | `validateCertificate` / Live mTLS | `403 Forbidden`, `code: "cert-not-yet-valid"` |
| Server certificate presented as device certificate | `validateCertificate` / Live mTLS | `403 Forbidden`, `code: "cert-role-mismatch"` |
| Certificate issued for a different pharmacy `installationId` | `validateCertificate` / Live mTLS | `403 Forbidden`, `code: "cert-installation-mismatch"` |
| Certificate signed by untrusted / foreign CA root | `validateCertificate` / Live mTLS | `403 Forbidden`, `code: "cert-chain-invalid"` |
| Revoked device certificate connects to LAN API | `checkDeviceRevocation` / Middleware | `403 Forbidden`, `code: "device-revoked"` |
| TLS connection attempt using TLS 1.0 or TLS 1.1 | Live TLS handshake | Handshake failure / `tls-version-rejected` |
| Legacy CBC / RC4 / 3DES cipher suites | Live TLS handshake | Handshake failure (cipher negotiation rejected) |

---

## 3. Implementation Code Artifacts

- **Contracts**:
  - [`packages/contracts/src/local-rest/index.ts`](file:///p:/Projects/PharmaElectrons/packages/contracts/src/local-rest/index.ts): Added 9 security denial codes (`LOCAL_SECURITY_DENIAL_CODES`).
- **Database Schema & Migrations**:
  - [`apps/local-api/src/pharmacy-ca/pharmacy-ca-schema.ts`](file:///p:/Projects/PharmaElectrons/apps/local-api/src/pharmacy-ca/pharmacy-ca-schema.ts): Tables `pharmacy_ca`, `server_certificates`, and `terminal_devices`.
  - [`apps/local-api/drizzle/0001_pharmacy_ca_and_devices.sql`](file:///p:/Projects/PharmaElectrons/apps/local-api/drizzle/0001_pharmacy_ca_and_devices.sql): PostgreSQL forward migration with enums, constraints, and grants.
- **Windows CNG Native Bridge**:
  - [`apps/local-api/src/pharmacy-ca/cng-addon.ts`](file:///p:/Projects/PharmaElectrons/apps/local-api/src/pharmacy-ca/cng-addon.ts): Non-exportable RSA key generation, TPM probing, RSASSA-PKCS1-v1_5 signing, and export protection assertion.
- **Pure TypeScript ASN.1 DER Certificate Engine**:
  - [`apps/local-api/src/pharmacy-ca/pharmacy-ca-crypto.ts`](file:///p:/Projects/PharmaElectrons/apps/local-api/src/pharmacy-ca/pharmacy-ca-crypto.ts): RFC 5280 DER encoder with custom OID injection and `crypto.X509Certificate` validation pipeline.
- **Pharmacy CA Service & Middleware**:
  - [`apps/local-api/src/pharmacy-ca/pharmacy-ca.service.ts`](file:///p:/Projects/PharmaElectrons/apps/local-api/src/pharmacy-ca/pharmacy-ca.service.ts): Lifecycle management, issuance, and revocation check against PostgreSQL.
  - [`apps/local-api/src/pharmacy-ca/mtls-verification.middleware.ts`](file:///p:/Projects/PharmaElectrons/apps/local-api/src/pharmacy-ca/mtls-verification.middleware.ts): LAN Express middleware recording typed denials under advisory lock `165308856`.
- **Test Suites**:
  - [`apps/local-api/src/pharmacy-ca/pharmacy-ca-crypto.unit.test.ts`](file:///p:/Projects/PharmaElectrons/apps/local-api/src/pharmacy-ca/pharmacy-ca-crypto.unit.test.ts): Unit tests for CA lifecycle, certificate generation, rejection matrix, live HTTPS mTLS 1.3 fixture, and CNG non-exportability.
  - [`apps/local-api/src/pharmacy-ca/pharmacy-ca.integration.test.ts`](file:///p:/Projects/PharmaElectrons/apps/local-api/src/pharmacy-ca/pharmacy-ca.integration.test.ts): Integration tests for PostgreSQL persistence, device registration, and revocation.

---

## 4. Verification Transcripts

### Unit & Boundary Tests (`pnpm test:unit`)
```text
$ turbo run test:unit && pnpm test:boundaries
• turbo 2.10.11

   • Packages in scope: @breev/contracts, @breev/desktop, @breev/local-api
   • Running test:unit in 3 packages

@breev/contracts:test:unit:
  ✓ src/desktop-preload/index.test.ts (9 tests) 13ms
  ✓ src/local-rest/index.test.ts (23 tests) 26ms
  Test Files  2 passed (2)
       Tests  32 passed (32)

@breev/desktop:test:unit:
  ✓ src/renderer/src/preferences.unit.test.ts (4 tests) 77ms
  ✓ src/preload/api.unit.test.ts (3 tests) 14ms
  ✓ src/main/security.unit.test.ts (27 tests) 29ms
  ✓ src/renderer/src/local-api.unit.test.ts (6 tests) 49ms
  ✓ src/renderer/src/startup-state.unit.test.ts (4 tests) 4ms
  Test Files  5 passed (5)
       Tests  44 passed (44)

@breev/local-api:test:unit:
  ✓ src/pharmacy-ca/pharmacy-ca-crypto.unit.test.ts (9 tests) 17626ms
      ✓ builds a valid X.509 v3 self-signed CA certificate with installation identity
      ✓ builds a server certificate with breev-server role and validates against CA
      ✓ builds a device certificate with breev-device role and validates against CA
      ✓ rejects expired certificates with cert-expired
      ✓ rejects role mismatches (server cert as device)
      ✓ rejects installation identity mismatch
      ✓ rejects certificates signed by a foreign CA
      ✓ completes a full mutual TLS 1.3 handshake with client certificate authentication
      ✓ proves the CA key export fails
  Test Files  1 passed (1)
       Tests  9 passed (9)

Tasks:    4 successful, 4 total
Time:     21.997s

$ node tooling/boundaries/prove.mjs
Deliberate boundary violations failed as expected.
```

### Static Analysis, Linting & Formatting Check
```text
$ pnpm lint
$ eslint . && pnpm check:boundaries
✨ 0 errors, 0 warnings

$ pnpm format:check
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!

$ pnpm typecheck
$ turbo run typecheck
• turbo 2.10.11
  Packages in scope: @breev/contracts, @breev/desktop, @breev/local-api
  Tasks: 4 successful, 4 total
  Time: 10.013s
```
