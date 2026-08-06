# 10 — Additional POS Terminal pairing and revocation

**What to build:** An owner can pair, use, replace, and revoke Additional POS Terminals over the Pharmacy LAN while the Main Pharmacy Computer remains the sole local transaction authority.

**Blocked by:** 03 — Subscriptions, entitlements, licences, and Free Core fallback.

**Status:** ready-for-agent

- [ ] Pairing requires owner/trusted-user re-authentication, one-use expiry, human fingerprint confirmation, seat entitlement, and complete audit evidence.
- [ ] Each terminal generates and retains its own non-exported keypair and receives a device-specific local certificate.
- [ ] Every request validates both device identity and signed-in user permissions; discovery never substitutes for trust.
- [ ] Local revocation immediately invalidates sessions and rejects requests while preserving main-computer records and transmitted drafts.
- [ ] LAN operation continues without internet when the Main Pharmacy Computer and network are available; no terminal directly accesses PostgreSQL.
