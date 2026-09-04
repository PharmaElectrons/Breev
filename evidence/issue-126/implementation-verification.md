# Issue 126 candidate verification

Date: 4 September 2026. Product-code commit: `0ba6bb435b5c0061851101cb99ed25a343f015c7`.

This is implementation evidence for review, **not a passing installed-release certificate**. The original issue's impossible numerical criteria are explicitly reconciled in [README.md](README.md). No schema, business logic, service account, role selection, installer compression, synchronization, repair/update preservation or genuine-uninstall deletion policy changed.

## Rebuilt artifact

`pnpm package:windows` completed with exit code 0. Its build performed fresh local-API and desktop compilation (contracts cache hit), verified the pinned vendor archive hashes, selectively extracted reviewed members, built the CJS API from TypeScript-emitted JS, generated the full inventory and built the existing NSIS target.

| Scope                              |       Bytes |    MiB | Files |
| ---------------------------------- | ----------: | -----: | ----: |
| Complete application               | 505,178,531 | 481.78 | 1,069 |
| Service payload including manifest | 176,291,010 | 168.12 | 1,047 |
| Local API                          |   7,254,491 |   6.92 |    18 |
| PostgreSQL                         |  72,548,645 |  69.19 | 1,022 |
| Chromium locales                   |   1,662,238 |   1.59 |     2 |
| NSIS installer                     | 151,011,475 | 144.02 |     1 |

Installer SHA-256: `5ff3c3e773878cf960348f01868be829d697ed7fa0b9488926346447fdc67dba`.

The installer and `Breev.exe` report **NotSigned** locally: no release-signing credentials were configured. Builder's “signing with signtool.exe” progress messages are not evidence that an Authenticode signature exists. Do not deploy this diagnostic artifact as a signed release. Default-icon and dependency-collection notices were emitted; no new compiler warning was observed. Branding was not changed by this issue.

The Windows comparison CI job also emitted optional Forge icon-extractor `node-gyp`/Visual Studio discovery diagnostics while installing its existing comparison-tool dependencies. Both candidate versions subsequently built successfully. This is not a claim that every tool emitted warning-free output; unrelated comparison-toolchain diagnostics were not hidden or fixed by changing the production installer.

Compared with the previously inspected 673.50 MiB / 13,395-file artifact, this candidate is approximately 28% smaller and has 92% fewer files; its installer is approximately 22% smaller than the earlier 184.01 MiB setup. The earlier artifact predates this checkout, so these are indicative deltas rather than a controlled same-source rebuild comparison.

Total local `package:windows` wall time was 296.03 seconds, with other verification work running. The measured selective-extraction portions were Node 579 ms, PostgreSQL 3,780 ms and Shawl 83 ms. There is no matched before/after packaging-time or installation-time claim. [Machine-readable metrics](candidate-metrics.json) preserve the raw counters and limitations.

## Local checks

| Check                                           | Result                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Frozen dependency installation                  | Passed                                                                                                               |
| Lint and boundaries                             | Passed; 241 source files                                                                                             |
| Formatting                                      | Passed                                                                                                               |
| Strict typecheck                                | Passed, all workspaces                                                                                               |
| Build                                           | Passed; fresh API/desktop build in the packaging run                                                                 |
| Licence artifact scan                           | Passed; 76 first-party build files                                                                                   |
| Contracts unit suite                            | 125 passed                                                                                                           |
| Desktop unit suite                              | 373 passed, 27 files                                                                                                 |
| API unit suite                                  | 443 passed; one symlink test failed and a 12-test CNG suite could not initialize due to local Windows permissions    |
| Inventory and lifecycle unit subset             | 14 passed, including actual PowerShell clean/tamper checks                                                           |
| Isolated bundled API / pruned native PostgreSQL | 7 passed                                                                                                             |
| Deliberate boundary violations                  | Rejected as expected                                                                                                 |
| Development launcher test                       | Passed                                                                                                               |
| Complete `pnpm verify`                          | Not claimed: this host cannot pass the required machine-key/symlink prerequisites or run the container-backed suites |

The failing local CNG test received Access denied creating a machine key. The recovery test received EPERM while creating its test directory symlink, before reaching the restore-isolation assertion. Neither test was deleted, loosened or skipped to manufacture a green run. The separately dispatched Windows CNG CI job passed on its suitable runner.

All eight changed PowerShell scripts passed the Windows PowerShell parser. The final lifecycle diff changes only payload verification and deployed CJS entrypoint references; service recovery settings, ACL/firewall policy, database initialization and lifecycle control flow are untouched. This diff review does not substitute for installed behavior tests.

### Bundled/runtime evidence

Run:

```powershell
pnpm build
$env:BREEV_TEST_POSTGRES_BIN = '<absolute path to prepared pruned postgresql/bin>'
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts windows/api-runtime.integration.test.mjs
```

The test builds the runtime into a new OS temporary directory outside the repository, uses a working directory different from the bundle directory, and ships no `node_modules`. On Windows it starts only a fresh disposable cluster using the selected pruned binaries, UTF8/C locale, SCRAM and data checksums; it never uses an installed Breev service. On Linux it uses the pinned PostgreSQL Testcontainer and the same JS bundle with the test host's Argon2 prebuild.

The passing assertions include:

- Exact journal-referenced SQL bytes, retained reflection metadata, native addon and legal notices.
- Missing migration credential rejection, forced `pg-native` rejection, and the full Nest graph surviving a no-database degraded start.
- Concurrent and repeated standalone migrations, migration-journal count, pg-boss initialization and application-role DDL denial.
- Exact UTF-8 Arabic round-trip, explicit `ar-IQ` ICU collation, PL/pgSQL and transaction rollback.
- Bundled API health with no migration credential, unauthenticated request denial, owner bootstrap, Argon2 password hashing and wrong-password denial, restart and successful login with the persisted hash.
- Native `pg_dump`/`pg_restore` round-trip and `pg_basebackup`/`pg_verifybackup`, including WAL verification via retained `pg_waldump`.

The fixture stops its own processes and removes its synthetic data. It is not a full encrypted Breev recovery/Restore Quarantine drill, a Shawl service-account proof or an installed LAN mTLS proof.

### Integrity evidence

The complete prepared and packaged payloads passed both the JavaScript verifier and the actual `Test-PayloadFiles` PowerShell function. The harness imports only that AST-extracted function: no lifecycle actions, service changes or ProgramData writes occur. Tests reject altered bundle/SQL/DLL bytes, missing and extra files, malformed paths and duplicate inventory entries. The packaging hook allows signature changes only in signable files and refuses changes to non-signable JS/SQL before recording final hashes.

The existing executable's fuse wire remained: RunAsNode off, cookie encryption on, NODE_OPTIONS off, Node inspect off, embedded ASAR validation on, ASAR-only loading on, browser-specific snapshot off, extra file privileges off, Wasm handlers on. The packaged payload uses CJS entrypoints; the source development/test module build intentionally remains ESM. Proof scripts that address installed files were updated to CJS, including the synthetic-issuer mTLS loader's test-only in-memory registry substitution. That loader is not shipped in the payload.

A supplementary isolated launch used the packaged `node.exe`, actual `main.cjs` and that test-only `--import` loader with a one-entry synthetic public-key registry. It reached the expected no-database 503 health response and left the bundle SHA-256 unchanged. This checks loader execution and bundle-shape compatibility, not signature acceptance or an installed mTLS handshake.

## CI and remaining release gates

Full explicit workflow: [Verify run 33878650144](https://github.com/PharmaElectrons/Breev/actions/runs/33878650144), code commit `0ba6bb4`. All executable suites and candidate builds passed; its evidence-recording step rejected the repository's renamed identity. The strict producer and verifier now agree on `PharmaElectrons/Breev` in commit `36161d0`, with a regression test. The [complete rerun](https://github.com/PharmaElectrons/Breev/actions/runs/33879877079) and its final result are recorded in [README.md](README.md). The workflow includes normal source/unit, real PostgreSQL, renderer and Electron seams plus Windows CNG and Windows packaging. Windows packaging now also runs the isolated bundled/native PostgreSQL test.

The rerun **completed successfully** at source commit `36161d0ba4af94ca18ca334c6bc720035a1f4651`: `verify`, `windows-candidates` and `windows-cng-proof` all passed, including Windows evidence recording and export. The measured runtime remains the one built at `0ba6bb4`; the intervening change affects only CI evidence identity and its test. The following evidence commit is documentation-only, not another runtime build or installed certificate.

Do not merge as a certified Windows release until the applicable [quality requirements](../../docs/quality.md) have their real evidence:

- Two signed candidates on disposable Main and Terminal snapshots: install, repair, update, injected failure, reboot without login, genuine uninstall and reinstall; data/CA/pairing witnesses preserved or deleted exactly as required.
- Shawl supervision and child/wrapper crash recovery under the restricted service identities; real SCM, filesystem ACL, listener and firewall assertions.
- Installed offline TLS 1.3 mTLS success and missing/foreign certificate denial across restart; remaining G-05 production key/TPM proof stays open.
- Clean offline Windows runtime prerequisite check, especially the imported VC++ runtime DLLs. A hosted developer runner is not proof of a clean pharmacy machine.
- Hardened-artifact ASAR tamper rejection, Arabic/English Windows layout/fonts/Narrator/peripherals and the certified physical profile.
- Approved encrypted recovery, Restore Quarantine, base+WAL clean-machine restore and RPO/RTO evidence required by G-06.
- Defender-on, controlled installation and cold/warm startup distributions on the supported profile; no security exclusion or durability relaxation.

The working host already has Breev installed and is not an authorized disposable lifecycle target. Those destructive/update/repair proofs were not run against its existing installation. A disposable Windows VM was requested from the stakeholder. This PR must remain explicitly review/release-gated until the unavailable evidence is supplied.

The repository's named candidate is managed by CachyOS/libvirt through `qemu:///system`. That host is not exposed by this Windows environment; no Hyper-V, libvirt, QEMU, VMware or VirtualBox command was available, and the standard VMware/VirtualBox control-tool paths were absent. No VM was started, reset or modified while checking availability.
