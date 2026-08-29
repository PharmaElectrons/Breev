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

## Held for the certification candidate

- The install to Ready, restart to Ready, repair, injected-failure rollback, and
  data-preserving uninstall cycle runs through
  `tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1` against a built,
  signed candidate. It rewrites the installation, so it runs only behind
  `--allow-destructive` and only after `capture-disposable-baseline.sh`. This
  guest uses pflash UEFI firmware, which libvirt internal snapshots cannot
  protect, so the disposable-baseline capture (disk, UEFI NVRAM, and swtpm
  state as one unit) is the supported safety step before the destructive run.
- The ASAR runtime tamper proof, `prove-asar-integrity.mjs`, needs an
  interactive desktop session in the guest to observe the shell reaching Ready
  and then failing after tamper.

The installer code that this lifecycle exercises is complete and tested on
Linux: `apps/local-api/test/windows-service-boot.integration.test.ts` proves the
LAN mutual-TLS listener binds and serves the pre-authentication pairing route
when the endpoint is configured, and binds nothing when it is absent.

## Running the harness

```
tooling/windows/m1/run-m1-lifecycle.sh --run-id <uuid> --source-commit <sha>
```

Add `--phase <name>` to run one phase, and `--allow-destructive` to permit the
clean-install phase after a disposable-baseline capture. `summarize` fails when
any requested phase has no passing record, so a skipped phase never reads as
covered.
