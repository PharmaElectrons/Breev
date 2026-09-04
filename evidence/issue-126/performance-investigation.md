# Breev Windows payload and performance investigation

Research date: 4 September 2026. Repository HEAD: `961ef11a6164ee728ea30fe4b11a252475e2d2c3`.

Status: investigation and proposed implementation plan, **not release certification or completion of #126**. No production packaging, application, service, firewall, or security configuration was changed. Existing unrelated working-tree changes were preserved. Measurements below distinguish existing artifacts, disposable component experiments, and untested projections.

## 1. Executive summary and opportunity sizing

The recommended first change is a conservative PostgreSQL runtime allowlist, a TypeScript-first API bundle with its native Argon2 addon and migrations preserved, and two Electron locales. Keep the selected unified offline NSIS installer, independent Windows services, existing durability settings, and all security boundaries.

An approximately **480–495 MiB installed application with roughly 1,100 payload files** is a defensible planning range for the present pinned runtimes, before any newly required VC++ redistributable allowance. That is about **27–29% fewer bytes and 92% fewer packaged files** than the artifact inspected here. It is not a measured rebuilt installer. Installer size and end-to-end installation time remain to be measured after implementation.

The issue's 285 MB / 350-file target cannot be achieved by its listed changes: `Breev.exe` and `node.exe` alone total approximately 313.30 MiB; retained PostgreSQL timezone and abbreviation data alone contains 611 files. Similarly, a complete API runtime cannot be fewer than five files while retaining its two process entrypoints, native authentication addon, SQL migration journal and SQL files. These acceptance criteria need explicit reconciliation, not removal of necessary runtime data to make a counter pass.

### Measured inventory

All new sizes use MiB = 1,048,576 bytes; do not mix them with decimal MB. Existing artifacts are dated 2 September and are not a fresh build of the current source.

| Component / scope                | Existing size |        Files | Candidate / opportunity                                                            |
| -------------------------------- | ------------: | -----------: | ---------------------------------------------------------------------------------- |
| Full `win-unpacked` application  |    673.50 MiB |       13,395 | Approximately 480–495 MiB / ~1,100 files, projected                                |
| Embedded Windows service payload |    315.18 MiB |       13,320 | Approximately 169–175 MiB, projected                                               |
| PostgreSQL                       |    186.83 MiB |        4,417 | 69.19 MiB / 1,022 paths in conservative runtime candidate, including legal notices |
| Node runtime + license           |     88.68 MiB |            2 | Retain unchanged                                                                   |
| Local API                        |     36.50 MiB |        8,896 | Approximately 8–10 MiB / ~20–30 files, projected                                   |
| API `node_modules` subset        |     35.30 MiB |        8,637 | Remove deployment tree only after bundled-runtime tests pass                       |
| Shawl                            |      3.10 MiB |            1 | Retain unchanged                                                                   |
| Chromium locales                 |     46.65 MiB |           55 | `en-US.pak` + `ar.pak`: 1,662,238 bytes, 1.59 MiB / 2 files                        |
| Desktop `app.asar`               |      1.78 MiB | 1 outer file | Already bundles main, preload and renderer                                         |
| Existing `BreevSetup.exe`        |    184.01 MiB |            1 | New compressed size unknown; 105–115 MB is not yet supported by evidence           |

The full application and the service payload are different scopes. Newly initialized database files are additional ProgramData state: the disposable clean cluster alone created about 970 files / 39.71 MiB. A packaged-file reduction is not an equivalent reduction in every installation write.

### Evidence conditions and limits

The diagnostic host is an i5-9300H, 4 cores / 8 threads, approximately 7.9 GiB RAM, Windows 11 Home Single Language build 26200, with an NVMe SSD and SATA HDD present. Compression read from `P:` and extracted to a temporary `C:` directory; these results do not establish behavior on a particular low-end storage profile.

Defender reported `AntivirusEnabled=false` and `RealTimeProtectionEnabled=false` before these tests; this investigation did not change either setting. Consequently, **none of these timings measures Defender-on installation cost**. Cache state, background load and test order were not controlled. Single-run results are exploratory, not p95 or p99 evidence.

The governing [quality baseline](P:/Projects/PharmaElectrons/docs/quality.md) currently targets Windows 11 Pro 25H2 and a supported four-core/8 GB/SSD Main profile. Dual-core Celeron/i3 and HDD machines are useful stress profiles, but this report cannot silently certify them. The provisional cold/warm desktop targets are p95 ≤5 s / ≤3 s. “Guaranteed <2 s” would be a new, unproven target.

### Authority and established precedent

This analysis follows [AGENTS.md](P:/Projects/PharmaElectrons/AGENTS.md), [source authority](P:/Projects/PharmaElectrons/docs/README.md), [CONTEXT.md](P:/Projects/PharmaElectrons/CONTEXT.md), the domain/workflow/architecture boundaries, [ADR 0002](P:/Projects/PharmaElectrons/docs/adr/0002-main-computer-is-the-local-authority.md), and [ADR 0004](P:/Projects/PharmaElectrons/docs/adr/0004-secure-coordinated-windows-delivery.md). Later [G-05/G-06/G-07 decisions](P:/Projects/PharmaElectrons/docs/open-decisions.md) and their [traceability reconciliations](P:/Projects/PharmaElectrons/docs/traceability.md) govern where the older ADR is superseded.

In particular, production tooling is already electron-vite + electron-builder + NSIS, with one offline `BreevSetup.exe`. Genuine uninstall deletes Breev machine data and role state; update removal using `--updated` preserves them. Do not reinstate the older ADR's uninstall-preservation wording during optimization. Separate installers remain deferred in the [local issue](P:/Projects/PharmaElectrons/.scratch/issue-126/spec.md); the [GitHub issue](https://github.com/PharmaElectrons/Breev/issues/126) is not authority to weaken later release requirements.

Established patterns were compared with Breev's constraints:

| Precedent                                                              | Fit for Breev                                                                 | Boundary                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron's production performance guidance, including VS Code examples | Bundle application code and defer genuinely nonessential work                 | Do not defer authorization, quarantine or database readiness merely to display Ready sooner. [Electron guidance](https://www.electronjs.org/docs/latest/tutorial/performance)    |
| electron-builder's supported offline NSIS pipeline                     | Retain the selected signed, coordinated artifact and standard extraction path | A custom codec or split artifact multiplies installer/update proof obligations. [NSIS options](https://www.electron.build/docs/api/app-builder-lib.interface.commonnsisoptions/) |
| PostgreSQL's standard bootstrap and backup tools                       | Keep upstream catalog layout and version-matched backup verification          | Static binary tracing alone misses subprocesses and dynamically loaded modules. [Backup verifier](https://www.postgresql.org/docs/18/app-pgverifybackup.html)                    |

## 2. Component-by-component blueprint

### 2.1 Local API: bundle compiled JavaScript, not raw decorator-heavy TypeScript

[prepare-payload.mjs](P:/Projects/PharmaElectrons/apps/local-api/windows/prepare-payload.mjs) currently performs a production pnpm deployment with hoisted dependencies. Its cleanup does not turn that tree into a compact runtime; nested declarations, maps or tests can survive broad directory cleanup. Prefer an explicit output inventory.

[tsconfig.json](P:/Projects/PharmaElectrons/apps/local-api/tsconfig.json) enables `experimentalDecorators` and `emitDecoratorMetadata`; the main entry imports `reflect-metadata`. **`--keep-names` preserves function/class names, not TypeScript reflection metadata.** esbuild does not implement `emitDecoratorMetadata`. First compile with TypeScript, then bundle the emitted JavaScript containing `__metadata("design:paramtypes", ...)`. [TypeScript caveats](https://esbuild.github.io/content-types/#typescript-caveats), [keep-names semantics](https://esbuild.github.io/api/#keep-names).

Proposed build-script core, executed with the local-API directory as its working directory:

```js
// Run tsc -p tsconfig.build.json first into .build/.
// Keep emitDecoratorMetadata + experimentalDecorators enabled there.
await build({
  entryPoints: { main: ".build/main.js", migrate: ".build/migrate.js" },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  keepNames: true,
  minify: false,
  sourcemap: false,
  metafile: true,
  define: { "import.meta.dirname": "__dirname" },
  external: [
    "pg-native",
    "class-transformer",
    "class-validator",
    "@nestjs/websockets/socket-module",
    "@nestjs/microservices/microservices-module",
    "@nestjs/microservices",
    "@nestjs/platform-socket.io",
  ],
});
```

This is a **candidate**, not a proven drop-in production configuration. Pin esbuild as a direct build dependency. Emit its metafile to build evidence, not the installed runtime. Audit every retained `require`, `import.meta`, dynamic import and filesystem lookup. Fail the build on warnings or unexplained unresolved imports. The listed optional Nest modules must remain unexercised by Breev; if a real feature uses one, bundle the needed dependency instead of leaving a latent runtime failure. Do not externalize all packages.

Diagnostic results: a first bundle failed on seven optional Nest imports. After explicitly excluding the optional packages, compiled-JS bundling produced approximately 6.7 MiB `main.cjs` and 1.1 MiB `migrate.cjs` in 1.581 s of esbuild-reported build time. **The diagnostic CJS output also replaced `import.meta` with an empty object**, breaking migration path resolution. The `define` above addresses the observed expression, but the corrected full runtime still needs execution tests. This result is a feasibility measurement, not DI or migration certification.

#### Migrations and native dependencies

[database-migrations.ts](P:/Projects/PharmaElectrons/apps/local-api/src/database-migrations.ts) calls Drizzle's filesystem migrator using `path.resolve(import.meta.dirname, "../drizzle")`. Drizzle reads `meta/_journal.json`, opens the SQL file for each journal tag, splits statement breakpoints and hashes the original SQL. Preserve the bytes and layout:

```text
local-api/
  dist/main.cjs
  dist/migrate.cjs
  dist/prebuilds/win32-x64/argon2.glibc.node
  drizzle/meta/_journal.json
  drizzle/<every journal-referenced migration>.sql
  <applicable dependency license notices>
```

There are 13 SQL files plus the journal in current source, versus eight SQL files plus the journal in the existing artifact: another reason not to equate its inventory with a current release. Do not package only the files found in the old artifact. Preserve the migration advisory lock, journal, pg-boss schema migration and owner/runtime role separation. Keep migration execution as a separate privileged `migrate.cjs` process; the long-running service must not acquire migration credentials.

The application uses JavaScript `pg`, but its authentication stack uses **native Argon2**. Bundling all JavaScript does not eliminate every native binary. The observed Windows x64 N-API addon is about 206 KiB and loads through `node-gyp-build` relative to its supplied directory. Copy only the pinned Windows x64 addon to the audited lookup path and prove password hash/verify, including existing hashes, through the bundled API. Do not change password parameters to win a startup benchmark.

`pg-native` is optional and lazily loaded, and `NODE_PG_FORCE_NATIVE` can select it. Marking it external does not prove it is unused. Reject that environment setting in the controlled service environment, exercise real `pg` connections with no `node_modules`, and assert the native PostgreSQL binding is absent. [node-postgres native driver documentation](https://node-postgres.com/features/native).

Run both entrypoints from a directory outside the repository, with no ancestor `node_modules`, no development `NODE_PATH`, only the shipped files, and the pinned Node executable. Test the exact service working directory and a path containing spaces/non-ASCII characters. A developer checkout can otherwise conceal missing assets and dependencies.

### 2.2 PostgreSQL 18.6-1: a verified component candidate, not a guessed minimal engine

The exact reviewed path list is [postgresql-candidate-allowlist.txt](P:/Projects/PharmaElectrons/evidence/issue-126/postgresql-candidate-allowlist.txt): **1,022 explicit paths / 72,548,645 bytes (69.19 MiB)**. It represents the component-tested 1,020-file tree plus two retained legal notices. It is not a production hash manifest and does not claim every extension was exercised.

Executable roots:

```text
bin/postgres.exe       bin/initdb.exe       bin/pg_ctl.exe
bin/psql.exe           bin/pg_isready.exe
bin/pg_dump.exe        bin/pg_restore.exe
bin/pg_basebackup.exe  bin/pg_verifybackup.exe
bin/pg_waldump.exe
```

**`pg_waldump.exe` is mandatory for normal WAL verification.** The initial pruned candidate passed base-backup creation but failed `pg_verifybackup` because it was missing. Adding it made verification pass. Do not use `--no-parse-wal` to conceal the missing dependency. Upstream explicitly documents this subprocess relationship. [PostgreSQL verification](https://www.postgresql.org/docs/18/app-pgverifybackup.html).

The conservative candidate retains these 21 non-wxWidgets `bin` DLLs:

```text
icudt77.dll       icuin77.dll         icuio77.dll       icutu77.dll
icuuc77.dll       libcrypto-3-x64.dll libcurl.dll       libecpg_compat.dll
libecpg.dll       libiconv-2.dll      libintl-9.dll     liblz4.dll
libpgtypes.dll    libpq.dll           libssl-3-x64.dll libwinpthread-1.dll
libxml2.dll       libxslt.dll         libzstd.dll       testplug.dll
zlib1.dll
```

Recursive PE import and delay-import inspection of the ten executable roots found this smaller **static vendor-DLL closure**:

```text
icudt77.dll icuin77.dll icuuc77.dll libcrypto-3-x64.dll
libiconv-2.dll libintl-9.dll liblz4.dll libpq.dll
libssl-3-x64.dll libwinpthread-1.dll libxml2.dll libzstd.dll zlib1.dll
```

The roots plus these DLLs total 62,715,758 bytes. This is not permission to delete the other DLLs: runtime-loaded extension modules and plugin paths are outside that static graph. Retaining all 91 `lib/*.dll` costs only about 5.37 MiB and preserves PL/pgSQL, text conversion, text search and the existing extension inventory. The exact names are in the companion allowlist. No current migration was found creating an extension, but many use PL/pgSQL triggers; removing `plpgsql.dll` is unsafe.

The import graph also contains **`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll` and UCRT/API-set imports**. No VC++ redistributable handling was found in the inspected installer/lifecycle paths. A developer machine may supply these accidentally. Prove the pinned distribution on a clean offline Windows image, and include a supported, appropriately licensed offline VC++ redistributable or approved app-local runtime if needed. Its version must satisfy the binaries' toolset requirement; include its bytes in the final budget. [Microsoft runtime requirements](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170).

Retain these `share` root files without trying to save kilobytes:

```text
errcodes.txt                 information_schema.sql
pg_hba.conf.sample          pg_ident.conf.sample
pg_service.conf.sample      postgres.bki
postgresql.conf.sample      psqlrc.sample
snowball_create.sql         sql_features.txt
system_constraints.sql      system_functions.sql
system_views.sql
```

Also retain `share/timezone/**`, `share/timezonesets/**`, `share/tsearch_data/**`, and `share/extension/**`. `initdb` consumes the bootstrap catalog, system SQL and configuration templates; missing required inputs can fail initialization. Do not replace the pinned share tree with another PostgreSQL version. [Upstream initdb implementation](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/bin/initdb/initdb.c). Timezone abbreviation data has its own runtime requirements. [Datetime configuration](https://www.postgresql.org/docs/18/datetime-config-files.html).

Retain `server_license.txt` and `commandlinetools_3rd_party_licenses.txt`; audit notice coverage for every redistributed dependency. The removed `share/doc/extension` files here are four examples, not those legal notices.

Safe first-stage removals from this pinned distribution are `doc/`, `include/`, `share/locale/`, static `.lib`/`.a` development libraries, pgAdmin/StackBuilder assets, wxWidgets GUI DLLs and non-allowlisted utilities. The extra static `bin/libcurl.lib` is not a runtime DLL. Removing `pg_upgrade` deliberately removes that major-version upgrade tool: a future major upgrade requires its own coordinated plan, not an assumption that the utility still ships. Revisit `pg_checksums`, `pg_controldata`, `pg_receivewal`, and, only if incremental backup is adopted, `pg_combinebackup` against the approved support/recovery workflow before freezing a release list. G-06 remains open; this experiment does not choose its WAL architecture.

#### Arabic, UTF-8 and collation proof

`share/locale` contains translated PostgreSQL messages, not UTF-8 storage tables or ICU data. Removing it changes available diagnostic translations; it does not inherently remove Arabic storage or ICU collations. Keep the ICU DLL/data files. The current lifecycle initializes `--encoding=UTF8 --locale=C`, whose default provider is libc; this is **not an Arabic ICU default database collation**. Do not change existing collation semantics as a packaging optimization. [Locale behavior](https://www.postgresql.org/docs/18/locale.html), [character encodings](https://www.postgresql.org/docs/18/multibyte.html).

On the stripped disposable server, a pure-JS `pg` parameterized insert/query round-tripped `صيدلية بريف` with exact UTF-8 hex `d8b5d98ad8afd984d98ad8a920d8a8d8b1d98ad981`; a query using an explicitly created ICU `ar-IQ` collation succeeded; 884 ICU collations were present; `Asia/Baghdad` timezone lookup and a PL/pgSQL function executed. An initial PowerShell-argument probe produced question marks; byte-level validation caught it and the corrected Node parameter probe passed. This demonstrates why visual console output is insufficient Unicode evidence. Business-specific sort/search equivalence still requires its own golden tests.

### 2.3 Electron: preserve ASAR, integrity, native rendering and fallbacks

The actual configuration is [electron-builder.config.mjs](P:/Projects/PharmaElectrons/apps/desktop/electron-builder.config.mjs), not `electron-builder.json`. It already specifies `asar: true`, `disableAsarIntegrity: false`, and packages `out/**/*` plus `package.json`. Inspection of the existing archive found main JS, CJS preload, renderer HTML/JS/CSS and package metadata inside `app.asar`; there was no loose desktop dependency tree to eliminate.

Reading the actual `Breev.exe` fuse wire confirmed: embedded ASAR validation, ASAR-only loading and cookie encryption enabled; RunAsNode, NODE_OPTIONS, Node inspect arguments, extra file-protocol privileges and browser-specific custom snapshot loading disabled; Wasm trap handlers enabled. Preserve the full current fuse configuration and its before-signing order. Tamper rejection and signatures still need the release harness; reading fuse bits is not that proof. [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).

Add `electronLanguages: ['en-US', 'ar']` using builder's supported configuration. Chromium locale packs are not Breev's translation strings or font files. Keep app Arabic/English resources, Chromium ICU data, native Windows font fallback, accessibility resources and required graphics/media DLLs. Do not delete `LICENSES.chromium.html`, `icudtl.dat`, SwiftShader or Direct3D components to hit a size target on hardware that may depend on software rendering. [Builder configuration](https://www.electron.build/docs/api/app-builder-lib.interface.configuration/).

The generic [smoke packaging script](P:/Projects/PharmaElectrons/apps/desktop/scripts/package.mjs) produces an automation-oriented artifact with different ASAR fuse settings. Therefore `pnpm test:smoke` alone cannot certify the hardened production NSIS artifact. Retain that small test layer and run the installed-artifact proof separately.

### 2.4 Payload integrity and build-time I/O

[payload-lock.json](P:/Projects/PharmaElectrons/apps/local-api/windows/payload-lock.json) pins Node 24.19.0, PostgreSQL 18.6-1 and Shawl 1.9. The assembler verifies archive hashes before extraction, but the current runtime manifest covers selected executable hashes, not every installed JS, SQL, DLL or addon. The desktop after-sign hook refreshes those selected executable hashes while preserving source provenance.

Preserve that source-versus-signed-byte distinction and expand integrity coverage to every retained runtime file. Produce a sorted path/size/SHA-256 inventory, reject unexpected or absent files, and record the build commit, lockfile, tool versions and signatures. Hash final signed bytes at the correct phase. A mutable manifest beside mutable files is not an independent trust anchor: bind it to the trusted signed release/update verification chain and protect the installed directory through ACLs. Test modified DLL, addon, bundle and SQL rejection before service or database mutation.

Currently full vendor archives are extracted and then pruned. On the build machine, selecting reviewed members during extraction can avoid writing thousands of files that are immediately discarded. Continue verifying the complete upstream archive first; reject path traversal, duplicates and unexpected inventory. This improves payload preparation time, not necessarily the end-user installer, which already receives the assembled tree. Do not double-wrap the service payload and extract it a second time during installation merely to reduce a build-time file count.

## 3. Beyond the issue: installation and startup speed

### 3.1 Compression: two layers, not one interchangeable codec switch

The installed electron-builder 26.15.7 `NsisTarget.js` builds an embedded application archive separately from the outer NSIS installer. Its normal outer compressor is zlib; the application archive is normally 7z, with installer-decodable LZMA2 settings. Consequently, changing outer NSIS `SetCompressor` does not necessarily change compression of the large payload. Native NSIS documents zlib, bzip2 and lzma, **not zstd**. [NSIS SetCompressor](https://nsis.sourceforge.io/Reference/SetCompressor).

The local builder selects ZIP only when `useZip` is true and the package is not differential-aware; current configuration enables `differentialPackage`. A supported ZIP experiment therefore needs `useZip: true` with `differentialPackage: false` and an explicit update-behavior review. Do not inject an unsupported `compression: 'zstd'` or casually change differential settings in production. [Builder NSIS options](https://www.electron.build/docs/api/app-builder-lib.interface.commonnsisoptions/).

Exploratory archive benchmark using cached 7-Zip 24.09, the same unmodified 673.50 MiB / 13,395-file input, separate output directories, and level 5:

| Container / method    |      Archive |                              Compression time |                     Extraction time |
| --------------------- | -----------: | --------------------------------------------: | ----------------------------------: |
| 7z / LZMA2, non-solid |   174.81 MiB |                                      221.16 s |                             33.05 s |
| ZIP / Deflate         |   243.38 MiB |                                       64.08 s |                             27.76 s |
| zstd                  | Not measured | No suitable configured encoder/installer path | Unsupported as a native NSIS switch |

This single ZIP run extracted about 16% faster while producing a roughly 39% larger archive. It is **not a native NSIS LZMA-versus-zlib benchmark, not an optimized-payload benchmark, and not total installation time**. Build compression time is not customer installation latency. There is no defensible “fastest on Celeron” winner yet. Start with the supported existing LZMA2 path, compare normal versus maximum after pruning, and retain ZIP only if repeated low-end end-to-end measurements justify its size and update tradeoff. A custom zstd extractor adds executable/signing, integrity, interruption, repair and security obligations; it is not the recommended first change.

### 3.2 Windows I/O and Defender

Thousands of creates, metadata updates, ACL operations and file opens can dominate extraction; NTFS fragmentation and a full Defender scan of every write are not established causes merely from the file count. Bundling cuts these opportunities, but a large file may also receive scanning and unpacking scrutiny.

Use WPR/WPA or equivalent ETW to separate CPU, disk latency, create/open count, antivirus work and process startup. Capture Defender's `New-MpPerformanceRecording` and inspect it with `Get-MpPerformanceReport` on the release profile. Keep real-time protection enabled. Do not add broad exclusions, disable scanning, suppress durability or weaken signature checks for a benchmark. [Microsoft performance analyzer](https://learn.microsoft.com/en-us/defender-endpoint/tune-performance-defender-antivirus).

Benchmark fresh install, repair and update separately: the lifecycle also recursively resets ACLs, including PostgreSQL data and runtime directories. API bundling reduces runtime-tree ACL traversal; large existing databases may dominate repair instead. Optimize ACL scope only after proving equivalent access correction and protection of secrets/CA material, not by blindly removing `/T` or skipping repair checks.

### 3.3 PowerShell: the hypothesized repeated-host penalty is absent

[installer.nsh](P:/Projects/PharmaElectrons/apps/desktop/windows/installer.nsh) invokes one PowerShell host per lifecycle action. [lifecycle.ps1](P:/Projects/PharmaElectrons/apps/local-api/windows/lifecycle.ps1) performs service, ACL, firewall, bootstrap and health work inside that host. Updates may also invoke the old-version uninstall action; that is a distinct lifecycle phase, not dozens of nested PowerShell startups.

Ten bare `powershell.exe -NoLogo -NoProfile -NonInteractive -Command 'exit 0'` runs averaged 260.88 ms (235.30–285.57 ms). This machine does not support a claim of 10–20 seconds saved by consolidating hosts that are already consolidated.

There are multiple native `sc.exe` calls per service: automatic account configuration, description, restricted SID type, restart policy and failure flag. Retain their checked outcomes; introducing a custom SCM interop layer for a few spawns is unlikely to be the simplest durable first change. Instrument phase durations, native process counts, health polling and recursive ACL work before considering it.

Preserve `Invoke-CheckedCommand`'s process-handle wait and file-based stdout/stderr capture. The code explicitly avoids PowerShell redirected-pipe hangs when `pg_ctl start` leaves child handles open; a disposable diagnostic reproduced that pitfall. A naive replacement with convenient piped invocation can hang installation.

### 3.4 initdb: durability remains the default

Current flags include UTF8, `--locale=C`, SCRAM authentication, data checksums and normal synchronization. Initialization uses a staging cluster, bootstrap SQL and clean shutdown before promotion. Keep those properties.

The first disposable SCRAM/checksum initialization took 28.71 s. Subsequent warmed, unstarted synthetic-cluster comparisons used trust authentication solely in disposable test directories:

| Method                                     |  initdb | Explicit sync-only |   Total |
| ------------------------------------------ | ------: | -----------------: | ------: |
| Normal synchronization                     | 4.188 s |                  — | 4.188 s |
| `--no-sync`, then `--sync-only`            | 2.341 s |            1.968 s | 4.309 s |
| `--no-sync-data-files`, then `--sync-only` | 2.251 s |            0.549 s | 2.800 s |

These are single, ordered, cache-sensitive runs, not comparable cold-install certification. In this sample `--no-sync` merely shifted the cost and slightly increased total time. PostgreSQL warns against production use of unsynchronized initialization; version 18 also exposes the narrower data-file option for tooling that arranges synchronization. [initdb options](https://www.postgresql.org/docs/18/app-initdb.html).

Recommendation: leave current flags unchanged. A later staged optimization would have to complete and check a full synchronization barrier **before the ready marker, promotion, or use as authoritative service state**, with power-loss injection at every boundary and deterministic rejection of partial staging. A clean shutdown alone is not evidence that a new skipped-sync sequence is safe. Do not disable checksums, `fsync`, WAL durability or atomic posting, and do not add speculative buffer tuning without measured workload evidence.

### 3.5 V8 caching: measure second-start benefits, do not promise instant cold starts

Node 24.19 supports the module compile cache. If profiling shows parsing is material, enable it before loading the API bundle, using a service-owned ProgramData cache directory, strict ACLs and version/content-aware invalidation. A cache hit must never be required for correct operation. For a long-running service, consider an explicit flush after successful startup so reuse does not depend on graceful exit. Cache generation has first-run cost; coverage tests should run without it. [Node 24 module cache](https://r2.nodejs.org/docs/latest-v24.x/api/module.html).

The Electron custom `breev` protocol already registers `codeCache: true`; this is not a missing switch. Keep built-in Electron/Chromium caching and measure actual behavior. Electron-vite's optional bytecode plugin adds V8/Electron version coupling and source-introspection constraints; it is neither secret storage nor proof of faster startup. Custom V8 snapshots can alter existing startup optimizations and require new fuse/security proof. Neither is recommended before profiling the bundled build. [electron-vite bytecode constraints](https://electron-vite.org/guide/source-code-protection), [Electron fuse/snapshot behavior](https://www.electronjs.org/docs/latest/tutorial/fuses).

Measure desktop launch to usable authenticated workflow separately from API spawn-to-healthy, PostgreSQL readiness, boot-to-service-ready and first mTLS request. A screenshot appearing quickly must not hide a still-unusable authority service.

### 3.6 Main versus terminal extraction

Current role selection skips Main registration on Terminal, but the common `extraResources` tree is still extracted and payload validation still expects its components. Therefore role-aware lifecycle behavior is not role-aware extraction.

| Approach                                                                        | Benefit                                                                              | Cost / current disposition                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current unified artifact, pruned common payload                                 | One offline signed release; smallest change; approximately 480–495 MiB on both roles | Terminal still carries unused server files; recommended now                                                                                          |
| Unified artifact with separate desktop/Main archives selected before extraction | Terminal installed footprint approximately 313 MiB; avoids ~169 MiB of server writes | Installer download still includes both; requires role-scoped integrity, custom extraction, rollback, repair and update proofs; later investigation   |
| `BreevMainSetup.exe` and `BreevTerminalSetup.exe`                               | Terminal distribution and installation both smaller                                  | Two artifacts/signing and release matrices, wrong-artifact support cases, compatibility coordination and role transition policy; explicitly deferred |

For a future selective unified installer, select/resolve the persisted role before extraction, verify the appropriate manifest, and never extract server files just to delete them afterward. Do not allow an update to silently change role. Terminal should create no PostgreSQL cluster, API service, listener or firewall rule. No online runtime download is acceptable for the full offline contract. The approximately 313 MiB terminal figure is subtraction from current artifacts with locale filtering, not a built terminal installer.

## 4. Risks, observed proofs and remaining gaps

“Absolute zero regressions” cannot be established by source inspection or a handful of successful commands. The enforceable standard is: no known regression, no waived invariant, and all applicable release gates pass on the same signed artifact.

| Risk                                | Evidence obtained here                                                                                   | Required mitigation / remaining proof                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Nest DI loses metadata              | Existing tsc emits metadata; candidate bundles build                                                     | Corrected bundled full application startup, provider resolution and real route tests; keep `reflect-metadata` initialization |
| CJS migration asset path fails      | Actual broken `import.meta.dirname` transformation observed                                              | Correct transformation and run both entrypoints outside checkout; SQL/journal inventory and migration concurrency tests      |
| Authentication native addon omitted | Argon2 prebuild and loader traced                                                                        | Password creation/verification through shipped addon under service account, with no dev dependencies                         |
| PostgreSQL dependency stripped      | Static PE graph; clean bootstrap; pg_waldump failure found and corrected                                 | Clean-machine VC runtime proof, dynamic DLL-load and all supported tool/workflow coverage                                    |
| Arabic storage/collation changes    | Exact UTF-8 round-trip, explicit ICU collation query, timezone lookup passed                             | Existing/new DB sort/search golden cases; renderer and print tests in both languages                                         |
| Logical recovery breaks             | `pg_dump` custom archive + `pg_restore` passed; corrected Arabic row re-dumped/restored and byte-checked | Breev encrypted recovery workflow, role reconstruction, privileges, quarantine and clean-machine restore                     |
| Physical backup silently incomplete | `pg_basebackup` with streamed WAL and `pg_verifybackup` passed after retaining pg_waldump                | Boot restored cluster and execute application checks; full G-06 base+WAL/RPO/RTO drill still open                            |
| Desktop integrity weakened          | Existing ASAR contents and executable fuse bits inspected                                                | Signature verification, tamper rejection and actual hardened offline launch                                                  |
| Timing improvement overstated       | Archive, bootstrap and host-start microbenchmarks recorded                                               | Controlled repeated Defender-on installed-artifact tests on certified and stress profiles                                    |

The physical backup was taken before the corrected Arabic insertion; its verification is not proof that a physically restored Arabic row was checked. `pg_dump` covers a database, not automatically all cluster roles or external keys; backup utility success cannot prove Breev disaster recovery. [pg_dump scope](https://www.postgresql.org/docs/18/app-pgdump.html).

## 5. Explicit automated verification gate

Every stage must use a clean, reproducible candidate and fail closed. Store commands, exit codes, timestamps, artifact/manifest hashes and redacted transcripts. Unit tests and smoke tests cannot substitute for privileged Windows seams.

1. **Build and inventory.** Run frozen dependency installation, `pnpm check:boundaries`, `pnpm build`, `pnpm verify`, and `pnpm package:windows`; require no errors or warnings. Disable task cache for the acceptance build. Validate all package entries, legal notices, native architecture, no secrets/dev files, complete migration inventory and final signed-file hashes. Verify fuses/ASAR/signatures after packaging. Deliberately corrupt one DLL, addon, JS and SQL file and assert rejection.
2. **Database and migration seam.** In a disposable Windows image with no global PostgreSQL/Node or accidental VC++ installation, bootstrap the pruned payload using the production SCRAM/checksum flags. Execute shipped `migrate.cjs` as migration owner. Exercise clean migration, already-current rerun, concurrent invocation/advisory lock, interrupted migration and forward upgrade from supported live schema. Start the bundled API as runtime role; prove it cannot perform owner-only DDL. Run real PostgreSQL transaction, locking, immutable-row, idempotency and rollback tests. Byte-check Arabic parameters/results and preserve expected collation/search semantics.
3. **Installed service seam.** Verify Shawl supervises `node.exe dist/main.cjs` as `NT SERVICE\BreevLocalApi`, correct working directory and protected environment. Verify PG service dependency, automatic start without login, restricted SID/SCM and file ACLs, checked shutdown, crash recovery and bounded Ready transitions. Test API child crash, Shawl crash and PG outage separately. Assert PostgreSQL loopback 31311, local API loopback 31310, and only the intended scoped LAN listener 31312. Current loopback HTTP/PG transport must not be mislabeled LAN mTLS proof.
4. **Security and role matrix.** Run existing Main and Terminal installed proofs with the same two signed versions on restored snapshots. Include install, repair, injected failure, update, reboot, genuine uninstall and reinstall; preserve data/CA for repair/update/failure and delete full machine data on genuine uninstall. Reject invalid/conflicting roles. Terminal must have no Main service, cluster, listener or firewall rule. Confirm valid paired TLS 1.3 mTLS reaches the API; no certificate and foreign CA fail, offline and across service restart. Complete remaining G-05 production TPM/key and negative TLS cases at release.
5. **Disaster recovery seam.** Through the actual backup orchestration, create and restore logical recovery points using only the pruned binaries. Verify identities, roles, permissions, data checksums/reconciliation and Restore Quarantine. Include disk full, cancellation, corrupt backup and wrong-key failures without releasing quarantined data. Execute the approved base+WAL clean-machine restore drill and measure G-06 RPO ≤1 h / RTO ≤4 h; merely running `pg_verifybackup` is insufficient.
6. **UI and internationalization seam.** Run browser tests and the small Electron smoke layer, then launch the actual installed hardened artifact as a standard user offline. Cover Arabic RTL/English LTR, native glyph shaping and fallback fonts, light/dark, keyboard/scanner, focus, Narrator, 200% text, resizing, print/dialog adapters, custom protocol and narrow preload isolation. Verify real mTLS connection, denial/revocation, Main unavailable/restarted and recovery states. Never replace service readiness with an optimistic UI state.
7. **Performance acceptance.** Freeze identical versions, dataset, role, locale, hardware, Defender policy, power plan and storage free space. Randomize baseline/candidate order; use restored images/reboots for cold runs and a separate warm series. Collect at least 20 runs for an exploratory p95, expand the sample for release confidence, and retain raw distributions rather than a single mean. Record extraction, signature/hash work, PowerShell launch, ACLs, initdb, migration, service readiness, UI usability and first mTLS request separately. Report total p50/p95/p99, file operations, bytes, peak memory and disk latency. Run both certified four-core SSD and clearly labeled dual-core/HDD stress cases.

No measured total-install improvement is claimed here. A useful engineering objective is to reduce the measured extraction/ACL portion substantially while preserving full lifecycle correctness; set an absolute installation SLA only after the baseline is captured. File-count reduction cannot guarantee “seconds, not minutes,” especially when initialization, security scans or slow storage dominate.

## 6. Direct options comparison

Numbers below are engineering projections from measured component sizes, not rebuilt installer results. They exclude any extra clean-machine prerequisite budget.

| Option          |                                                                    Full installed footprint |                                           Packaged file count | Expected speed effect                                                                  | Regression / delivery risk                                                                   |
| --------------- | ------------------------------------------------------------------------------------------: | ------------------------------------------------------------: | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Conservative    |                                                                                    ~515 MiB |                                                       ~10,000 | Smaller PG/locales; most API tiny-file overhead remains                                | Lowest relative risk; still requires PG and locale proofs                                    |
| **Recommended** |                                                                            **~480–495 MiB** |                                                    **~1,100** | Largest practical tiny-file reduction; preserve standard compression and sync          | Moderate, concentrated in bundle/assets/native loader; gateable in small slices              |
| Aggressive      | Modest further Main reduction without replacing pinned runtimes; optional terminal ~313 MiB | Main still has hundreds of timezone files; terminal far fewer | Role-selective extraction, deeper DLL pruning, codec/cache/sync experiments might help | Highest complexity; several changes deferred or require approval; no numerical speed promise |

Conservative means developer/GUI PostgreSQL removal plus locales, retaining the loose API. Recommended adds the explicit runtime candidate and API bundling. Aggressive is not a license to remove ICU, licenses, graphics fallbacks, checksums or integrity controls. None supports a 285 MiB complete Main installation with the present Electron and Node binaries.

## 7. Step-by-step implementation roadmap

Implement and verify one usable slice at a time; do not execute the entire investigation as one broad change.

| Step                                                      | Exact files to change or extend                                                                                                                                                                                                                                                                                                                                                        | Completion evidence                                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Reconcile targets and scope                            | [spec.md](P:/Projects/PharmaElectrons/.scratch/issue-126/spec.md), [traceability.md](P:/Projects/PharmaElectrons/docs/traceability.md); reference existing quality/open gates                                                                                                                                                                                                          | Approved measured size/count definitions; correct metadata/native-addon assumptions; no silent requirement weakening or premature resolved status                                                          |
| 2. Add reproducible measurement and inventory tests       | New `apps/local-api/windows/payload-inventory.test.mjs`; extend [physical profile proof](P:/Projects/PharmaElectrons/tooling/windows/proof/Invoke-PhysicalProfileProof.ps1)                                                                                                                                                                                                            | Baseline JSON and redacted phase timings, signed artifact and host identity                                                                                                                                |
| 3. Prune PostgreSQL only                                  | [prepare-payload.mjs](P:/Projects/PharmaElectrons/apps/local-api/windows/prepare-payload.mjs), [payload-lock.json](P:/Projects/PharmaElectrons/apps/local-api/windows/payload-lock.json); new reviewed `apps/local-api/windows/postgresql-runtime-files.json`                                                                                                                          | Real clean bootstrap, Unicode, logical and physical recovery component tests; clean VC runtime prerequisite result                                                                                         |
| 4. Bundle API in isolation                                | [package.json](P:/Projects/PharmaElectrons/apps/local-api/package.json), new `apps/local-api/tsconfig.build.json`, new `apps/local-api/scripts/build-runtime.mjs`, [pnpm-lock.yaml](P:/Projects/PharmaElectrons/pnpm-lock.yaml)                                                                                                                                                        | No raw-TS metadata loss; exact JS/native/SQL/legal inventory; isolated full API and migration entrypoint tests                                                                                             |
| 5. Connect bundled runtime to packaging/service lifecycle | [prepare-payload.mjs](P:/Projects/PharmaElectrons/apps/local-api/windows/prepare-payload.mjs), [lifecycle.ps1](P:/Projects/PharmaElectrons/apps/local-api/windows/lifecycle.ps1), migration-path handling in [database-migrations.ts](P:/Projects/PharmaElectrons/apps/local-api/src/database-migrations.ts) only if needed, and owning tests                                          | Canonical `main.cjs` and `migrate.cjs` paths throughout payload validation, service registration and migration execution; remove obsolete `.js` deployment assumptions rather than adding fallback aliases |
| 6. Apply locales and comprehensive integrity              | [electron-builder.config.mjs](P:/Projects/PharmaElectrons/apps/desktop/electron-builder.config.mjs), [config unit tests](P:/Projects/PharmaElectrons/apps/desktop/electron-builder.config.unit.test.ts), payload verifier in lifecycle                                                                                                                                                 | Two locales, unchanged fuses/ASAR, correct final signed-byte inventory, negative tamper tests                                                                                                              |
| 7. Run installed seam and compare performance             | [Invoke-InstalledRuntimeProof.ps1](P:/Projects/PharmaElectrons/tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1), [Invoke-TerminalInstallerProof.ps1](P:/Projects/PharmaElectrons/tooling/windows/proof/Invoke-TerminalInstallerProof.ps1), [Confirm-Issue34Evidence.ps1](P:/Projects/PharmaElectrons/tooling/windows/proof/Confirm-Issue34Evidence.ps1); new issue-126 evidence | Same-candidate Main/Terminal lifecycle, restart, mTLS, recovery and bilingual UI proofs; controlled before/after distributions                                                                             |
| 8. Consider one measured speed follow-up                  | Compression configuration, cache initialization or narrowly timed lifecycle phase, whichever profiling justifies                                                                                                                                                                                                                                                                       | Separate benchmark and safety proof; do not combine codec, synchronization and role architecture changes                                                                                                   |

Before updating entrypoints, search all owning tests/proof scripts for `dist/main.js` and `dist/migrate.js`; update the canonical expectations together. Keep `electron.vite.config.ts` and the existing security fuse choices unchanged unless a separately measured need earns a change. Role-selective extraction would later require explicit work in `apps/desktop/windows/installer.nsh`, builder resource layout and role-scoped lifecycle validation; split artifacts are not authorized by this roadmap.

## 8. What was actually verified in this investigation

- `pnpm check:boundaries`: passed, 236 source files.
- `pnpm build`: passed, all three tasks cache hits; not a clean compilation proof.
- Existing packaged inventory, ASAR contents and fuse wire: inspected.
- Disposable PostgreSQL runtime candidate: initialized with production-like UTF8/C/SCRAM/checksum flags; Arabic byte round-trip, explicit ICU collation, timezone and PL/pgSQL probes passed; logical dump/restore passed; physical backup creation and verification passed after retaining `pg_waldump`.
- Compiled-JS esbuild experiment: bundle generation succeeded after optional-dependency exclusions; migration-path defect identified; corrected complete bundled-runtime gate not run.
- Archive extraction, PowerShell process startup and initdb synchronization microbenchmarks: performed under the limitations recorded above.
- `pnpm verify`, fresh `pnpm package:windows`, installed service-account/mTLS matrix, hardened bilingual GUI startup, production signatures, full disaster recovery and controlled low-end startup/installation benchmarks: **not run for this candidate**.

The component experiments used isolated temporary files and a standalone PostgreSQL test port, not Breev services or pharmacy data. The temporary server was stopped (`pg_ctl status`: no server running). Cleanup of the disposable fixture was blocked by the execution policy; it remains at `C:/Users/moata/AppData/Local/Temp/breev-pg-prune-audit-01da0e6b13584d64b2b016f36ab9bcc9` and contains only the diagnostic binaries, synthetic clusters and test backups. No claim of successful deletion is made.

The saved allowlist and this report are research evidence only; a future passing release run should produce the issue's requested `payload-pruning-proof.md` with reproducible full transcripts rather than treating this investigation as that proof.
