# G-05 Main loopback proof

Date: 24 August 2026

Issue: GitHub #35

Base: `236ca36f38b8f29169c83d7fcfb9c37fd684e601` (`issue/02-harden-desktop-shell`)

This record covers only G-05's Main loopback device/session and browser-request proof. It does not close G-05. Terminal mTLS and the pharmacy CA remain #36, and pairing, revocation, installer, firewall, user authorization, and posting remain in their named later issues.

## Threat and design

A process that can address `127.0.0.1` is not trusted. An attacker may run a normal browser page on the Main computer, submit a simple cross-site form or fetch, resolve an attacker-controlled name to loopback, copy a session token, forge browser evidence with a raw client, or retry across an API restart.

The smallest complete boundary is one early global Main REST guard plus a persistent PostgreSQL binding:

1. The API binds only to `127.0.0.1` and compares the single raw `Host` header with `127.0.0.1:<configured-port>` before body parsing or routing.
2. Every unsafe REST method requires exact `Origin: breev://app`. CORS is emitted only for that exact origin, without credential support. The one preflight permits only `POST`, `Content-Type`, and `X-Breev-CSRF` on the proof path.
3. Unsafe requests require the exact wire value `Content-Type: application/json` and `X-Breev-CSRF: 1`. The typed client uses `credentials: "omit"`; cookies are never authority.
4. Electron main attaches a 256-bit device credential and a separate 256-bit session token only to the trusted packaged window's exact local API origin. Neither value is exposed through preload, renderer storage, a URL, or a request body.
5. PostgreSQL stores only SHA-256 hashes of the high-entropy secrets. The device credential is verified with constant-time comparison, then the session hash must resolve to that device. A copied session token or caller-selected device ID is insufficient.
6. The proof mutation is one atomic PostgreSQL update. A durable fixed-window limit defaults to five verified mutation attempts per 60 seconds. Device/session records, mutation state, rate windows, and denial evidence survive process restart.
7. Each denial returns a UUIDv7 correlation ID and increments one fixed reason counter. Recent evidence retains at most 256 rows under a PostgreSQL advisory lock; aggregate storage has one row per fixed denial enum. It records no body, raw header, URL, secret, tenant, patient data, IP address, or user agent.

No request body carries pharmacy, tenant, user, permission, entitlement, or other authority. This issue intentionally proves the device layer beneath later user authorization.

## Current standards and runtime behavior

The implementation was checked against current official material on 24 August 2026:

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): exact origin verification, rejection of simple content types, a custom-header API defense, narrow CORS, and fail-closed handling.
- [WHATWG Fetch Living Standard](https://fetch.spec.whatwg.org/): `Origin` and `Host` are forbidden request headers; simple requests can be sent without preflight; custom headers and JSON trigger CORS preflight; credential mode is explicit.
- [Electron 43.4.1 release](https://releases.electronjs.org/release/v43.4.1) and [Electron protocol guidance](https://www.electronjs.org/docs/latest/api/protocol#protocolregisterschemesasprivilegedcustomschemes): the packaged runtime uses Electron 43.4.1 with Chromium 150.0.7871.224 and the registered secure `breev` scheme.
- [Playwright 1.62.1 release](https://github.com/microsoft/playwright/releases/tag/v1.62.1): browser attacks use its bundled Chromium 151.0.7922.34.
- [Chrome Local Network Access restrictions](https://developer.chrome.com/release-notes/142#local-network-access-restrictions): current browser permission behavior is defense in depth, not Main authorization. Tests require a server audit row rather than accepting a browser-side network error as proof.

The packaged POST was observed with:

```text
Host: 127.0.0.1:<ephemeral-port>
Origin: breev://app
Sec-Fetch-Site: cross-site
Content-Type: application/json
X-Breev-CSRF: 1
User-Agent: ... Chrome/150.0.7871.224 Electron/43.4.1 ...
```

`Sec-Fetch-Site: cross-site` is legitimate for Breev's packaged custom-scheme renderer calling its HTTP loopback API, so it cannot be used as a blanket deny signal. Exact Origin, CORS, JSON, CSRF, and the persistent device/session binding remain authoritative.

## Attack matrix

Every denial below asserts a typed denial, one additional fixed audit count with a UUIDv7 correlation ID, and an unchanged PostgreSQL mutation count.

| Attack or failure                                                                               | Exercised seam                                              | Result                                                              |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Missing Origin; `null`; foreign, prefix, and suffix Origins                                     | Real HTTP API                                               | `origin-not-allowed`                                                |
| Raw forged `Origin: breev://app` without binding                                                | Real HTTP API                                               | `binding-missing`; Origin is not authority                          |
| Missing device/session; session without device credential                                       | Real HTTP API                                               | `binding-missing`                                                   |
| Stolen session under another device ID or wrong session under a valid device                    | Real HTTP API and PostgreSQL                                | `binding-invalid` or `session-binding-invalid`                      |
| URL-encoded, multipart, text, missing, parameterized, and case-changed content types            | Real HTTP API                                               | `content-type-not-allowed`                                          |
| Missing custom CSRF header                                                                      | Real HTTP API                                               | `csrf-header-missing`                                               |
| Invalid authority-bearing body, malformed JSON, declared oversized body, chunked oversized body | Real HTTP API and parser                                    | `body-invalid` or `request-too-large`                               |
| Foreign or widened preflight                                                                    | Real HTTP API                                               | no permissive CORS; audited denial                                  |
| Attacker DNS name mapped to `127.0.0.1`                                                         | Chromium page and real HTTP API                             | `host-not-allowed` before routing                                   |
| Cross-site HTML form                                                                            | Chromium page and real HTTP API                             | audited Origin denial; no mutation                                  |
| `no-cors` text fetch while script attempts forbidden Host/Origin headers                        | Chromium page and real HTTP API                             | browser controls the wire Origin/Host; audited denial               |
| JSON/custom-header fetch from a plain browser                                                   | Chromium page and real HTTP API                             | denied preflight; actual mutation absent                            |
| Public session token in a plain browser context                                                 | Chromium page and real HTTP API                             | denied before mutation; token alone is insufficient                 |
| Verified attempts above the durable limit                                                       | Real HTTP API and PostgreSQL                                | `rate-limit-exceeded`; rejected attempt does not mutate             |
| API restart inside the same rate window                                                         | Packaged Electron and real HTTP API                         | binding, state, audit, and rate denial persist                      |
| Internet DNS unavailable                                                                        | Packaged Electron with `MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` | first and post-restart mutations both succeed over literal loopback |

The global-boundary test also sends an authenticated-shape `POST` to an unknown future route without device binding and receives the binding denial before Nest routing. This proves new state-changing REST does not silently bypass the guard.

## Evidence and transcripts

- Server boundary and persistence: `apps/local-api/src/main-device/main-device-security.integration.test.ts`
- Typed schemas and parsers: `packages/contracts/src/local-rest/index.test.ts`
- Electron main binding isolation: `apps/desktop/src/main/security.unit.test.ts`
- Typed renderer client: `apps/desktop/src/renderer/src/local-api.unit.test.ts`
- Current-browser attacks: `apps/desktop/test/browser/shell.browser.test.ts`
- Packaged artifact, offline DNS, restart, and CDP wire observation: `apps/desktop/test/desktop.smoke.test.ts`
- UI before: [`../issue-33/after/en-light-ready.png`](../issue-33/after/en-light-ready.png)
- UI after: [`after/en-light-device-binding.png`](after/en-light-device-binding.png)

Full worktree validation:

```text
$ pnpm verify
lint + 41-file boundary check: passed
format check: passed
strict typecheck: 4 tasks passed
production build: 3 tasks passed
unit: contracts 32 passed; desktop 44 passed; deliberate boundary violations failed as expected
integration: 27 passed against PostgreSQL 18.6
browser: 7 passed in Chromium 151.0.7922.34
packaged Electron smoke: 2 passed in Electron 43.4.1 / Chromium 150.0.7871.224
```

The clean-checkout result is appended after validation from the committed tree. The repository's authoritative documents were intentionally not edited under the issue instruction; therefore `docs/open-decisions.md` correctly leaves G-05 open for #36 and the remaining named evidence.
