# G-05 Pharmacy CA and Terminal mTLS Evidence

Date: 26 August 2026

Issue: GitHub #36 (`05: Prove the pharmacy CA and terminal mTLS`)

Status: **pending Windows and physical-profile evidence**. This record does not close G-05.

## Implemented seams

- Secure initialization serializes CA creation with PostgreSQL advisory lock `165308857`. An existing database identity must match the persisted key, CA certificate, fingerprint, and installation identity; missing or mismatched state fails closed.
- Windows keys are machine-scoped CNG RSA keys with export policy `None`. The creation DACL contains only the identity running the Breev service. Creation never overwrites an existing named key.
- Provider selection performs a create/open/delete probe against Microsoft Platform Crypto Provider. Failure selects Microsoft Software Key Storage Provider and persists `software-cng-fallback`; that level is for non-certified installations only.
- Certificates use maintained ASN.1 schemas, random positive 128-bit serials, standard server/client EKUs, exact critical key profiles, and SAN URI identities (`urn:breev:installation:*` and `urn:breev:device:*`). Validation parses extensions and checks the CA, signature, role, installation, server IP, validity, and certificate fingerprint registered to the terminal.
- The optional production LAN listener is configured with `BREEV_LAN_API_HOST` and `BREEV_LAN_API_PORT`. It accepts TLS 1.3 only, requests a client certificate, runs the mTLS and revocation middleware before the local API, and shares the bounded privacy-safe denial recorder.
- The cross-platform fixture uses an exportable, process-local terminal key only to prove TLS and validation mechanics. It is not evidence of a non-exported Windows terminal key.

## Automated evidence available now

On Linux, `@breev/local-api` reports:

```text
test:unit        9 passed, 1 Windows-only test skipped
test:integration 46 passed, 1 Windows-only test skipped
typecheck        passed
```

The live integration fixture exercises the production LAN server and middleware. It proves a TLS 1.3 connection, missing-certificate denial, role denial, per-request revocation, replaced-certificate denial, and a successful audit insert referencing `terminal_devices` rather than `main_devices`.

The Windows CI job `windows-cng-proof` runs the CNG unit seam. It asserts machine scope, the service-only DACL, and failed PKCS#8 export. Its result must be attached here after the branch workflow completes; a hosted software provider result is not TPM evidence.

## Required evidence still open

- TPM-capable supported Windows profile: hardware details, successful Platform Crypto create/open/sign/restart, and failed export.
- Supported Windows fallback profile: successful software-CNG create/open/sign/restart, lower-assurance database row, and failed export.
- ACL check from a distinct non-service account showing open/sign denial on both profiles.
- A Windows terminal client whose own private key remains non-exported while completing mTLS to the Main API.
- Offline and service-restart transcript, plus repair/reinstall evidence showing that the CA is retained and never silently replaced.
- Plaintext, possession-less, TLS 1.0/1.1, and certificate-warning-bypass rejection transcripts on the supported Windows profile.

Until those items exist, this branch proves the certificate and server mechanics but does not satisfy the issue's Windows acceptance criteria or the G-05 release gate. If the non-exported terminal/TPM channel fails on the supported profile or has unacceptable recovery burden, the issue requires a documented pinned-server-TLS plus machine-protected per-device-credential alternative for stakeholder decision before changing the confirmed mTLS rule.
