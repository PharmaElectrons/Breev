# G-05 Terminal Pairing, Seats, and Revocation Evidence

Date: 29 August 2026

Issue: [#42](https://github.com/PharmaElectrons/PharmaElectrons/issues/42), `11: Pair and operate four licensed devices`

Base: `451846a` (`dev`)

Status: **pending Windows and physical-profile evidence**. This record proves the
pairing ceremony, seat allocation, revocation, and terminal runtime at every
automated seam. It does not close G-05, and it does not claim the physical
four-device Windows/LAN acceptance run.

## What this record does not close

The physical seam — four Windows devices over a real pharmacy LAN (Wi-Fi or
Ethernet), pulling a cable, internet disconnected throughout — cannot be
executed in this environment and remains an explicit environmental handoff for
the milestone acceptance (#44). The Windows-only terminal-key hardening (a
CNG/TPM-held, non-exportable terminal private key completing mTLS) was already
an open G-05 item from #36 and stays deferred to the milestone 4 hardening
stage; this branch fails pairing closed on any machine whose OS key store is
unavailable and records the `safe-storage` protection level it uses. Licence
downgrade against already-paired seats (a licence later permitting fewer
devices than are paired) has no governing requirement in #42; the entitlement
gate below still blocks every terminal the moment the licence loses the
`additional-device-pos` capability, and the open product decision is recorded
in the pull request.

## The ceremony, as implemented

1. A user holding `devices.pair` reauthenticates (Step-Up action
   `devices.pairing.start`) and starts the one-per-installation pairing
   session: five-minute server-side expiry, five join attempts, a 32-byte
   single-use join secret stored only as a SHA-256 hash.
2. The Main displays the version-1 invitation QR
   (`breev-pair://1/…`: installation identity, endpoint, CA fingerprint,
   session, join secret). The terminal operator scans it with the terminal's
   keyboard-wedge 2D scanner or types it. mDNS discovery and manual endpoint
   entry supply the address only and cannot bypass validation.
3. The terminal validates the presented TLS chain against the QR-pinned CA
   fingerprint, installation identity, server role, and validity before
   sending a byte; generates its keypair; and joins with a PKCS#10 CSR plus a
   signature over the domain-separated join transcript — proof of possession
   before any binding.
4. Both screens derive the same twelve digits from the session, installation,
   CA fingerprint, and the bound public key; the Main also renders the
   version-2 QR over that complete binding. The digits are the check the user
   confirms.
5. Confirmation is one serialized transaction under an installation-scoped
   advisory lock: fresh authority, licence re-read, seat count from
   `permittedDeviceCount` (1 Main + unreleased terminal seats), conditional
   one-use consume with expiry predicate, certificate signed by the pharmacy
   CA binding pharmacy, device, type, licence, and serial, device row and
   audit committed together. The terminal collects the durably stored
   certificate with a possession signature and completes real mTLS.
6. Revocation (Step-Up `devices.revoke`) commits the device-record change,
   revokes the device's user sessions, then destroys its open TLS sockets; a
   revoked-device tombstone destroys late socket registrations. Every request
   still consults the current device record. The seat stays consumed until a
   different authorized user approves the release (Step-Up
   `devices.seat.release.request` plus the approver's own password).

## Adversarial review

Two independent reviewers — a fresh Claude Opus reviewer and a GPT-5.6 Sol
xHigh reviewer — inspected the complete diff against #42 before this record.
Every accepted finding was fixed and re-verified, including: a recoverable
invitation persisted in idempotency results (removed — replays return a
redacted response), the approver password reaching an unsalted idempotency
fingerprint (credential fields excluded), terminal-context commands violating
the device-kind constraints (terminal-aware inserts), terminals surviving
licence loss (entitlement gate at login and every request), the
verify/register/destroy socket race (tombstones plus an in-transaction
device-row share lock at login), the confirmation poll exhausting the pairing
channel budget (split budgets, retryable 429), a silent plaintext terminal-key
fallback (pairing now fails closed), and an unauthenticated read of
`/recovery/status` through a certificate-only terminal (identity now
required). Findings judged out of scope or incorrect are recorded with
reasons in the pull request.

## Attack and failure matrix

| Attack or failure                                          | Exercised seam        | Result                                                                                                                       |
| ---------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Replayed invitation after a terminal bound its key         | integration           | refused and audited; bound key unchanged                                                                                     |
| Second use of a confirmed one-use session                  | integration           | conditional consume updates no row; replay denial audited                                                                    |
| Excess join attempts (wrong secret or malformed CSR/proof) | integration           | session fails closed as `excess-attempts` on the spending attempt, audited                                                   |
| Fingerprint mismatch (user rejects digits)                 | integration + browser | cancellation with reason, audited, session terminal                                                                          |
| Expired session (server clock)                             | integration + browser | denied and audited; UI shows the expired state                                                                               |
| Missing seat entitlement (licence count reached)           | integration + browser | denied `pairing-seat-unavailable`; the session survives for a later confirm                                                  |
| Higher-count signed licence installed                      | integration + browser | the same session confirms with no code change                                                                                |
| Licence deactivated with terminals operating               | integration           | next terminal request and fresh login denied `entitlement-denied`; Main unaffected; reinstalling restores without re-pairing |
| Revoked device presenting a still-valid certificate        | integration           | denied via the current device record; sessions revoked; open sockets destroyed                                               |
| Login racing its own revocation                            | integration           | device-row share lock refuses the session                                                                                    |
| Certificate-only terminal, no user login                   | integration           | `/identity/state`, `/health`, login reachable; everything else denied, including `/recovery/status`                          |
| Terminal reaching Main-only device administration          | integration           | refused regardless of the certificate it holds                                                                               |
| Non-pairing route without a client certificate             | integration           | falls through to the mTLS boundary and is refused                                                                            |
| Pairing-channel flood                                      | integration           | in-memory budgets refuse without writing rows; no unauthenticated audit append                                               |
| Audit privacy                                              | integration           | no join secret, private key, or `breev-pair://` URI in any audit or command-result row                                       |
| LAN loss on a terminal                                     | browser               | `Main unavailable` blocking state; automatic recovery; no fallback datastore                                                 |
| Machine without OS key protection                          | unit + browser        | pairing refuses before spending a join attempt; distinct unrecoverable failure state                                         |

## Evidence and transcripts

- Server seams: `apps/local-api/src/devices/pairing-domain.unit.test.ts`,
  `pairing-csr.unit.test.ts`, `devices.integration.test.ts` (live LAN TLS
  fixture: full ceremony, four simultaneous devices, revocation with open
  connections, seat and licence proofs, audit privacy),
  `apps/local-api/src/pharmacy-ca/*` suites (certificate profiles, CNG),
  `apps/local-api/src/identity-access/identity-access.integration.test.ts`
  (terminal sessions, step-up, terminal-aware command results).
- Desktop seams: `apps/desktop/src/main/*.unit.test.ts` (transcripts with
  cross-pinned vectors equal to the server's, invitation parsing, chain
  pinning, bridge authentication, key-protection refusal),
  `apps/desktop/test/browser/devices-pairing.browser.test.ts` (Main pairing
  UI against the real API driven by a real terminal client),
  `apps/desktop/test/browser/terminal-pairing.browser.test.ts` (terminal UI,
  all stages and failures, LAN loss), `apps/desktop/test/desktop.smoke.test.ts`
  (packaged shell).
- The verbatim devices acceptance scenario — four devices operate
  simultaneously over LAN; an authorized user signs in from any licensed
  device; raising the permitted count requires no code change — is exercised
  by `serves one Main and three terminals at the same time over the LAN`,
  `pairs a terminal end to end over the LAN channel and signs a user in`, and
  `refuses a terminal beyond the licence's permitted device count` (which
  installs a higher-count signed licence and confirms the same session), all
  against real PostgreSQL and real TLS sockets in one process on Linux — the
  logical seam of the scenario, with the physical Windows seam handed off as
  above.
- UI before: [`before/`](before/) — the workspace and blocking state from
  `dev` prior to this change. UI after: [`after/`](after/) — bilingual,
  both-theme, Axe-clean captures of every pairing, device-list, revocation,
  seat-release, failure, and terminal state.

Worktree verification:

```text
$ pnpm verify
lint + boundaries        passed (181 source files)
format:check             all matched files clean
typecheck + build        4 workspaces clean
licence artifact check   passed
@breev/contracts         test:unit          71 passed (2 files)
@breev/desktop           test:unit         301 passed (18 files)
@breev/local-api         test:unit         425 passed, 1 skipped (19 files)
@breev/local-api         test:integration  165 passed, 1 skipped (13 files)
@breev/desktop           test:browser       27 passed
@breev/desktop           test:smoke          2 passed
```

Clean checkout verification:

```text
$ git clone … && pnpm install --frozen-lockfile && pnpm verify
$ git clone --branch issue/11-pair-four-devices … && pnpm install --frozen-lockfile
$ pnpm verify
lint + boundaries        passed (181 source files)
format:check             all matched files clean
typecheck + build        4 workspaces clean
licence artifact check   passed
@breev/contracts         test:unit          71 passed (2 files)
@breev/desktop           test:unit         301 passed (18 files)
@breev/local-api         test:unit         425 passed, 1 skipped (19 files)
@breev/local-api         test:integration  165 passed, 1 skipped (13 files)
@breev/desktop           test:browser       27 passed
@breev/desktop           test:smoke          2 passed
```

## Open before G-05 closes

- The physical Windows four-device LAN run with internet disconnected
  (milestone acceptance seam, #44).
- TPM-profile and Windows-terminal key-custody evidence listed in
  [`../issue-36/G-05-ca-key-proof.md`](../issue-36/G-05-ca-key-proof.md),
  deferred to milestone 4 hardening.
- Pairing UX polish, certificate renewal/rotation, compromise retirement,
  CA-recovery tooling, and revocation drills (deferred per the issue's
  exclusions).
