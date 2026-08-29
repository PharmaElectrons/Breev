# Issue #43 milestone-1 lifecycle evidence

This directory holds the milestone-1 Windows lifecycle evidence for the packaged
install, repair, and uninstall work. The harness that produces it is
`tooling/windows/m1/run-m1-lifecycle.sh`, driven from the CachyOS host against
the disposable guest `breev-issue-34-win11` over the QEMU Guest Agent.

The milestone-1 acceptance for the Windows release seam is the practical
lifecycle and the hardened artifact, recorded in
[`docs/quality.md`](../../docs/quality.md) and
[`docs/open-decisions.md`](../../docs/open-decisions.md) G-07 under the
stakeholder decision of 29 August 2026. The full certification sequence in
[`../issue-34/README.md`](../issue-34/README.md) is the release path.

## What ran, and what it proved

Run `ba18d330-79ec-42bf-9c77-3727ff41effa`, source commit
`8254954134b76316c61139d429de1442ca66c7d9`, against the installed product in the
guest. Every record carries the run id and source commit and passes through
`sanitize-evidence.mjs`, which fails closed on secret-shaped content.

- `preflight.json` (passed). The `BreevLocalApi` and `BreevPostgreSQL` services
  are present, and the Program Files install and ProgramData data roots exist.
- `hardened-artifact.json` and `fuses.json` (passed). The installed `Breev.exe`
  was read with `@electron/fuses`: all nine fuses match the hardened profile,
  including `RunAsNode` disabled, `OnlyLoadAppFromAsar` enabled, and
  `EnableEmbeddedAsarIntegrityValidation` enabled. The binary sha256 is recorded
  in both records. The installed `app.asar` version was read with
  `@electron/asar`. The fuse and ASAR configuration is also proven, and green,
  in `apps/desktop/electron-builder.config.unit.test.ts` under `pnpm test:unit`.
- `signature-tamper.json` (passed). A copy of an installer was signed with the
  development and test comparison certificate already present in the guest,
  which verified `Valid`. Flipping one byte moved the verdict to `HashMismatch`,
  so a tampered signed artifact fails closed.
- `summarize.json` lists the three proven phases and the two phases held for the
  certification candidate.

## Full lifecycle and Alpine-peer mTLS, proven on the live guest

Run `8c44f773-e4ce-4b85-836c-ab79782092ef`, source commit
`0b3f5a4e5e478abe3d3fcd20c7a1108eafe079f5`, executed the whole lifecycle of the
current installer against the disposable guest `breev-issue-34-win11` and the
disposable peer `breev-issue-34-peer` on the isolated LAN. The payload was built
from this branch, transferred to the guest, and installed with the same
`lifecycle.ps1` that ships in the payload. Every record carries the run id and
source commit and passes through `sanitize-evidence.mjs`.

- `install.json` (passed). A clean install reached `status: healthy`,
  `database: available`, HTTP 200. The captured listeners show the LAN mutual-TLS
  listener bound on `192.168.134.154:31312` and the loopback API on
  `127.0.0.1:31310`; PostgreSQL is loopback-only on `31311` (`127.0.0.1` and
  `::1`), never on the LAN address. The `BreevLanApi` firewall rule allows only
  TCP 31312 on the LAN address. Both services run with automatic start.
- `restart.json` (passed). After `Restart-Computer -Force` both services started
  automatically and `/health` was healthy again before any interactive login.
- `repair.json` (passed). A damaged install made `/health` unreachable; after
  `-Action Repair` it returned to healthy, the data marker survived, `PG_VERSION`
  stayed 18, and the pharmacy CA fingerprint was identical before and after, so
  repair never replaced the CA.
- `rollback.json` (passed). `-Action Install -InjectFailure BeforeReadiness` threw,
  removed the registered services and firewall rule, and left the data directory
  and its marker intact (`status: failed-data-preserved`).
- `peer-mtls/accepted.json`, `foreign.json`, `missing.json`, `aggregate.json`
  (passed). From the Alpine peer over the isolated LAN: a paired pharmacy-CA
  terminal certificate was accepted (HTTP 200, TLS 1.3, reaching
  `/identity/state`); a foreign-CA certificate was refused (HTTP 403,
  `cert-chain-invalid`); a missing certificate was refused (HTTP 401,
  `mtls-cert-missing`).
- `uninstall.json` (passed). Default uninstall removed the services and firewall
  rule and preserved the data directory (`status: data-preserved`).
- `destructive.json` (passed). An unauthorized `DestructiveUninstall` removed
  nothing; the authorized run purged the services, firewall rule, PostgreSQL
  cluster, and data (`status: data-destroyed`).
- `GATES.md` and `summary.json` record the per-phase verdicts (10/10).

Two installer fixes came out of this real run: the API service account needs a
grant on the machine software-key directory so the software-fallback pharmacy CA
key can persist without a TPM, and it needs traversal rights on the data root so
Node's `fs.realpathSync` can `lstat` the parent directories of its log path.
Both are in `apps/local-api/windows/lifecycle.ps1`.

## The hardened-artifact harness

`tooling/windows/m1/run-m1-lifecycle.sh` produced the `ba18d330` hardened-artifact
records above and gates its destructive clean-install phase behind
`--allow-destructive`. The `8c44f773` full-lifecycle run was driven directly with
the built payload and `lifecycle.ps1` on the guest, which is why its evidence
covers the install, repair, rollback, and uninstall actions end to end.

The installer code is also tested on Linux:
`apps/local-api/test/windows-service-boot.integration.test.ts` proves the LAN
mutual-TLS listener binds and serves the pre-authentication pairing route when
the endpoint is configured, and binds nothing when it is absent.

The one item that still needs an interactive guest desktop session is the ASAR
runtime tamper proof, `prove-asar-integrity.mjs`, which watches the shell reach
Ready and then fail after tamper; the ASAR integrity fuse itself is proven in the
`ba18d330` fuse record.
