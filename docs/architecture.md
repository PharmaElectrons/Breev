# Architecture and repository boundaries

## Chosen system

```text
Electron client ── authenticated HTTPS/REST ──> local API Windows service ── loopback ──> PostgreSQL Windows service
                                                        │
                                                        ├─ PostgreSQL-backed jobs/outbox/backups
                                                        └─ optional HTTPS One-Way Sync ──> cloud API + cloud PostgreSQL
```

The Main Pharmacy Computer runs all three local components. An Additional POS Terminal runs only the Electron client and talks to the Main Pharmacy Computer's API. Closing Electron never stops the local service or other terminals. The cloud deployment is separate and optional. Local posting never depends on it.

### Unified Windows installation roles

Windows uses one signed, offline, per-machine artifact named `BreevSetup.exe`. One artifact is simpler for pharmacy deployment and support than parallel Main and Terminal downloads: the operator cannot choose an obsolete or mismatched package, both roles receive the same hardened Electron build, and the updater has one signed artifact and channel to verify. The assisted installer defaults to **Main Pharmacy Server & Station (Primary Computer)** and offers **Additional POS Terminal (Cashier / Sales Counter)** as the other native radio option. Unattended deployment uses `/S /ROLE=main` or `/S /ROLE=terminal`; role values are exact and lower-case.

| Lifecycle | Main | Additional POS Terminal |
|---|---|---|
| Install | Validates the common signed payload, prepares private PostgreSQL data, registers `BreevPostgreSQL` and `BreevLocalApi`, applies the scoped LAN rule when LAN is enabled, migrates, and reaches local API Ready. | Validates the same common signed payload, creates only the terminal configuration boundary, and registers no service, private database, listener, or firewall rule. |
| Launch | Electron uses the loopback local API owned by the Windows services. | Electron starts the terminal discovery/pairing runtime and reaches only the paired Main API over the approved device channel. |
| Repair/update | Resolves the installed Main role before replacing application files; preserves the database, configuration, and pharmacy CA. | Resolves the installed Terminal role before replacing application files; preserves pairing state and continues to prohibit every Main-only footprint. |
| Uninstall/reinstall | A genuine uninstall removes application files, services, processes, Breev firewall rules, and `%ProgramData%\Breev`, including the database, configuration, pharmacy CA, and installed role. A later assisted install is clean and asks for a role again. | A genuine uninstall removes application files and `%ProgramData%\Breev`, including the installed role and pairing state. A later assisted install is clean and asks for a role again. |

The machine role authority is the ASCII file `%ProgramData%\Breev\config\device-role`, containing exactly `main` or `terminal` without a newline. The lifecycle writes it atomically only after the selected role reaches its readiness boundary. It is administrator-owned and readable by ordinary users; Terminal mutable state remains under `%ProgramData%\Breev\config\terminal` with its narrower ACL. Breev does not duplicate the role in the registry or a machine environment variable, avoiding competing authorities. A packaged Windows Electron process reads this file before creating the runtime; invalid, unreadable, missing-Terminal, or conflicting state produces Repair required instead of guessing. A missing file remains Main only for a legacy installation whose preserved state is not Terminal state. Repair and electron-builder's `--updated` old-version removal preserve this authority; a genuine uninstall deletes its entire data root and recreates no state file.

This chosen stack differs from the client's proposed technologies (SQLite, Laravel/PHP), which the scope labels "planned". It satisfies every underlying business constraint — offline-first local operation, a main device hosting the database behind a local service, secondary devices that never open the raw database file, and one-way cloud sync. [`traceability.md`](traceability.md) records the reconciliation.

This is a modular monolith with three eventual deployables, one real shared package, and no microservices:

```text
apps/
  desktop/                 # Electron main + preload + React renderer
  local-api/               # NestJS local authority, domains, PostgreSQL, local jobs
  cloud-api/               # added with paid licensing; later adds One-Way Sync
packages/
  contracts/               # runtime-validated wire/preload/sync schemas and inferred types
```

The first implementation phase contains only `desktop`, `local-api`, and `contracts`. Create `cloud-api` when milestone 4 delivers automated subscription and licence issuance. Do not create it as an empty placeholder. Extend that same deployable with One-Way Sync later in milestone 4. Continue using pnpm and Turborepo for these workspaces.

## Workspace and process boundaries

The checked-in five-app, twenty-five-package placeholder has thirty lines of marker TypeScript and no implementation. A domain concept does not need its own npm package. Keep each domain in a cohesive feature module within `local-api`. Import rules and public module functions must prevent cross-module table access and dependency cycles.

Extract a workspace only when it has at least two real consumers that need the same semantics and evolve independently, and it contains meaningful complexity. Removing that package would otherwise have to duplicate that complexity or expose it to its consumers. Tests, two folders in one app, or a cloud concept that merely shares a name with a local concept do not count as a second consumer. Extract a process only when independent availability, privilege, release, or measured scaling requires one.

| Current placeholder | Disposition |
|---|---|
| `apps/desktop`, `apps/local-api` | Replace directly with the real runtimes and `@breev/*` identifiers. |
| `apps/cloud-api` | Delete the marker; create the real deployable with milestone 4's licensing and control-plane implementation. |
| `apps/super-admin` | Remove. Keep initial protected operations and reporting in `cloud-api`. Split them only if deployment or security ownership diverges. |
| `apps/migration-tools` | Remove. Schema migrations, repair, and operational commands live with the database-owning app. Add an importer only for a real external source. |
| all `packages/modules/*` | Move each concept into a cohesive feature module inside the owning app. Do not publish or version these modules as packages. |
| `contracts`, `validation`, `sync-protocol` | Replace with one `contracts` package whose runtime schemas are the source of inferred wire types. Do not share entities/Drizzle rows. |
| — `contracts` internal shape | Expose separate subpath entry points per transport seam — local REST, preload, and later sync — with no root barrel, so importing one seam grants no access to another. A REST contract defines method, path, and status codes with its schemas, not schemas alone. Sync schemas are versioned and never mutated in place. Keep wire schemas literal (money as decimal integer strings, no coercion or transforms); map to domain values in the receiving adapter. Zod is the leading runtime-schema candidate. |
| database packages | Remove. Schema, migrations, credentials, backup, and recovery belong to `local-api` or `cloud-api`. |
| money, units, audit, permissions, entitlements, shared-kernel | Remove as packages. Keep their cohesive types and policies in the local module that owns them. Do not create a global miscellaneous module. |
| UI, i18n, testing | Keep inside the current consumer. Extract only after a second real UI/test consumer exposes stable repeated complexity. |

Do not add generic repository ports, a unit-of-work wrapper, event-sourced aggregates, CQRS or an event bus, a workflow engine, a connector SDK, a provider registry, Redis or BullMQ, a separate worker, an API gateway, or an analytics platform. None meets a current requirement.

## Local module ownership

The table assigns ownership. It does not prescribe matching folders or classes.

| Module | Owns | Public operations |
|---|---|---|
| Identity/access | users, roles, permissions, sessions, Step-Up/Dual Control policy | verified execution context and named authorization checks |
| Licensing/devices | signed licences, Trusted Breev Time state, terminal pairing/certificates/revocation | entitlement/device checks; no user-permission inference |
| Catalog | products, generated names, barcodes, packaging, suppliers/archive/merge | product/package/supplier facts; no stock balance |
| Purchasing | Purchase Draft/Post, Purchase Invoice Adjustment (Delta), Purchase Return, and supplier settlement intent | `postPurchase`, `postPurchaseAdjustment`, `postPurchaseReturn` orchestration |
| Inventory | batches/status, movements, physical allocation, WAC valuation arithmetic and state, cost allocations, frozen carrying amounts, counts/reorder | availability/allocation/movement/valuation operations inside caller transaction |
| Sales | Sale Draft/Post/Return/Reversal, price evidence, tender intent | `postSale`, `postReturn`, `reverseSale` orchestration |
| Accounting | posting-template rule versions, AP/AR/Cash Box, balanced journals/periods; consumes Inventory's valuation facts | pure preview plus posting operations inside caller transaction |
| Patients | optional profile, necessary identity, typed facts, consent/access/retention state | purpose-limited authorized commands/queries |
| Integrations | one real OCR, WhatsApp, payment, or tax adapter when its gate closes | provider DTO mapping and idempotent durable jobs only |
| Sync | outbox/inbox/checkpoints, One-Way projections, later Cloud Command lifecycle | consumes public domain queries/commands; never writes another module's tables |
| Reporting | read-only composition/views over owner-provided projections | no command/posting interface |

Each posting use case owns its workflow and its transaction: `Sales.postSale` owns sale orchestration, `Purchasing.postPurchase` owns purchase orchestration. `local-api` infrastructure supplies the concrete database and a small whole-command retry helper — there is no separate global posting coordinator, repository port, or unit-of-work wrapper. Inside the transaction, the use case calls transaction-aware Inventory, Accounting, audit, idempotency, numbering, and outbox operations; those internal functions may accept the concrete Drizzle transaction and write only their owning module's tables. Framework-free domain policies and types calculate decisions and facts and do not import Nest, Drizzle, PostgreSQL, Electron, React, or transport code.

`local-api` infrastructure owns the shared posting records — idempotency results, human-number sequences, outbox rows, the append-only audit writer — and the exact integer-fils money primitives that several modules use. Public module and use-case functions never expose Drizzle. A module must not commit a nested business transaction or read another module's tables; cross-module foreign keys remain allowed for database integrity. `local-api` publishes one deterministic lock order — draft, number sequence, period, batch/stock, valuation — that every posting use case follows. Direct synchronous calls coordinate atomic work in the single process. Create an outbox or job event only for asynchronous work that starts after commit.

## Electron trust boundary

Treat the renderer as an untrusted browser:

- Set `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. Enforce a strict CSP and use a currently supported Electron release. Load no remote content. Renderer code must not import filesystem, Node, database, or Nest code.
- Serve packaged assets through a restricted secure custom scheme such as `breev://app`. Never serve arbitrary `file://` paths.
- Deny navigation and new windows by default. Allowlist external HTTPS destinations. Disable production devtools and unused protocols. Validate every IPC sender frame, payload, size, and rate.
- Expose only named asynchronous preload methods for browser-inaccessible capabilities such as approved print, dialog, and update actions. Validate payloads in both preload and main. Never expose `ipcRenderer`, channel names, generic send or request methods, paths, shell commands, secrets, or repositories.
- Send every pharmacy command and query through the typed local REST client. Electron main owns only OS and application lifecycle. It contains no business rules.
- Keep server state in the typed HTTP and query layer. Keep only transient form and focus state in React. Durable drafts and configuration live in the local API. Limit browser storage to non-critical per-device presentation preferences.
- Set Electron fuses to disable `runAsNode`, Node options, and inspect paths. After packaging proof, enable ASAR integrity and `OnlyLoadAppFromAsar`.

All terminal-to-main traffic uses mutual TLS and individual authorization. Prefer TLS 1.3. Permit TLS 1.2 only as a securely configured fallback. Disable TLS 1.0 and 1.1, lower-version fallback, TLS 1.3 0-RTT, plaintext and anonymous modes, certificate-warning bypass, and accept-any-certificate behavior.

A loopback address does not establish Main-client trust. The milestone 1 runtime-proof stage must prove device and session binding for state-changing REST. It must also prove exact-Origin and CORS enforcement plus CSRF and DNS-rebinding defenses. The proof must use current browser and Electron behavior and [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Keep the desktop build Vite-compatible. Production builds use `electron-vite` for main, preload, and renderer and electron-builder's assisted per-machine NSIS target for `BreevSetup.exe`. The completed comparison keeps Electron Forge with MakerWix only as the issue-34 evidence harness; it adds no production dependency. The release proof still covers signing, Electron fuses, role-specific service and database lifecycle, repair, update, and recovery. G-07 retains the final signing identity, release host, and update policy.

Evidence: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context bridge](https://www.electronjs.org/docs/latest/api/context-bridge), [protocols](https://www.electronjs.org/docs/latest/api/protocol/), [fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [electron-vite](https://electron-vite.org/guide/), [electron-builder NSIS](https://www.electron.build/docs/nsis/), and [Electron Forge Vite status](https://www.electronforge.io/config/plugins/vite).

The old master prompt asked the team to evaluate Electronegativity. Its official repository now states that maintainers are not actively maintaining it, so Breev will not use it as a production dependency. Retain the requested coverage through a current Electron-checklist review and automated assertions. Those assertions cover window preferences, CSP, custom protocol, navigation, the preload interface, imports, Electron fuses, and hardened artifacts. G-16 selects any additional maintained scanner. Evidence: [Doyensec Electronegativity](https://github.com/doyensec/electronegativity).

Current T3 Code demonstrates sandboxed windows, named preload methods, a privileged local backend, typed client/server contracts, and backend readiness checks. Its process lifetime does not fit Breev. T3's coding backend can run under desktop supervision. Breev's pharmacy API must outlive every UI and serve other terminals. Breev also does not need T3's Effect, WebSocket, SSH, WSL, or multi-client layers.

VS Code and Bitwarden demonstrate strict runtime-specific imports, navigation control, custom protocols, and hardened packaging. Breev does not copy their extension or password-manager architectures. Evidence: [T3 Code workspace](https://github.com/pingdotgg/t3code/blob/4d12e52223f3fcd4813b9bc52cd9cb3f2bd19539/docs/internals/workspace-layout.md), [T3 desktop window](https://github.com/pingdotgg/t3code/blob/4d12e52223f3fcd4813b9bc52cd9cb3f2bd19539/apps/desktop/src/window/DesktopWindow.ts), [VS Code organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization), [Bitwarden desktop window](https://github.com/bitwarden/clients/blob/cce8a341c88790387fab9c5c6eb6dd3aa7e6491d/apps/desktop/src/main/window.main.ts).

## Local API and PostgreSQL

The local NestJS API is the only local business and database authority. It owns authentication, authorization, entitlements, validation, transactions, idempotency, Drizzle schema and migrations, audit, outbox, TLS and device checks, health, version and schema handshakes, diagnostics, jobs, backup coordination, and sync publication. It applies request and rate limits, and it hashes passwords with a current memory-hard algorithm following [OWASP Password Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); Argon2id is the leading candidate.

Secrets never enter source code, the renderer, logs, or ordinary plaintext database fields. Limit operational evidence to privacy-safe fields for the pharmacy, actor, device, correlation or idempotency key, action, time, reason, before and after values, and outcome where applicable.

PostgreSQL runs from pinned distributable binaries as a private, product-managed Windows service. It uses a dedicated least-privilege account and data directory. It listens only on loopback. LAN clients can reach only the TLS local API. Keep the application and schema-owner roles separate. Posted tables deny ordinary updates and deletes. Database constraints and triggers enforce identities, balanced journals, relationships, quantities, allowed states, and tenant isolation.

Secure first initialization creates one pharmacy CA. Windows machine key storage restricts its non-exportable private key to the Breev service. Use TPM or Platform Crypto backing where available. A software-key fallback uses restrictive ACLs and records its lower assurance; it exists only for non-certified best-effort installations, because certified production hardware requires TPM 2.0. Repair and reinstall never silently replace the pharmacy CA.

Trust and certificate validation checks the chain, expected server or device role, installation identity, validity, revocation, and private-key possession. Lifecycle audit records exclude private keys, reusable pairing secrets, and recoverable QR data. PostgreSQL supports embedding its Windows ZIP binaries, and `pg_ctl` can register a Windows service. Evidence: [Windows distribution](https://www.postgresql.org/download/windows/), [`pg_ctl`](https://www.postgresql.org/docs/current/app-pg-ctl.html), [connection settings](https://www.postgresql.org/docs/current/runtime-config-connection.html).

Use short transactions at the default isolation level. Enforce uniqueness and checks with database constraints. Lock affected rows with `FOR UPDATE` in the published deterministic order: draft, number sequence, period, batch/stock, valuation. Reserve `SERIALIZABLE` for a demonstrated predicate invariant. After a serialization or deadlock abort, retry the whole idempotent command.

Store authoritative IQD in PostgreSQL `bigint`. Store exact rates and intermediate values in `numeric` or a maintained arbitrary-precision decimal dependency configured from strings. Evidence: [PostgreSQL transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html), [isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html), [Drizzle transactions](https://orm.drizzle.team/docs/transactions).

## Durable work, backup, and cloud

One local API process runs all durable jobs, and PostgreSQL is their only durable store. Do not hand-write the generic queue mechanics — claiming, leases, abandoned-job recovery, uniqueness, scheduling, retries, backoff, dead letters, retention, and shutdown. Use a maintained PostgreSQL-native job library embedded in the API process: `pg-boss` is the leading candidate because it can enqueue inside an existing database transaction; Graphile Worker is the fallback. The library's schema migrations run through Breev's privileged migration path, its version is pinned, and milestone 1 proves it on Windows with Drizzle, including crash points, restore, and transactional enqueue. Perform provider work outside any claim transaction, then record the outcome separately; provider idempotency and reconciliation stay mandatory because provider calls remain at least once.

The versioned sync outbox remains a Breev-owned domain record with its own identity, checkpoints, and replay state; a library job may reference an outbox row but never replaces it. This design handles expiry evaluation, outbox publication, backup coordination, provider calls, and cleanup without Redis or a worker service. Extract a separate process only when measured scaling or availability requirements demand it. Evidence: [pg-boss](https://github.com/timgit/pg-boss), [Graphile Worker](https://worker.graphile.org/docs), [PostgreSQL locking clause](https://www.postgresql.org/docs/current/sql-select.html), [Nest queues and their Redis dependency](https://docs.nestjs.com/techniques/queues).

Local recovery must provide encrypted hourly recovery points and daily verified snapshots. Retain them for a rolling 30 days and configure at least one off-device destination. Run a clean-machine restore drill every quarter. The required RPO is ≤1 hour, and the required RTO is ≤4 hours.

Use PostgreSQL-supported base backup, WAL, and PITR tools as needed. `pg_dump` alone does not prove the RPO. Every restore enters quarantine before normal use. Evidence: [PostgreSQL backup methods](https://www.postgresql.org/docs/current/backup.html), [continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html), [`pg_verifybackup`](https://www.postgresql.org/docs/current/app-pgverifybackup.html).

Starting in milestone 4, `cloud-api` is one NestJS deployable with its own managed PostgreSQL. It owns tenant, subscription, device, and licence authority, plus a minimal protected operations UI. One-Way Sync ingestion and read projections extend the same deployable.

Initial tenancy uses immutable `tenant_id`, verified application context, query, job and storage scoping, cross-tenant negative tests, and `FORCE ROW LEVEL SECURITY` as defense in depth. Inside the one deployable, keep machine licensing, sync ingestion, remote read views, and operator actions in separate route namespaces with distinct authentication audiences and guards; give sync ingestion its own rate, body, and connection-pool limits; provide no generic table editor, SQL console, or tenant-bypass role; and audit every cross-tenant operator action with its reason and target tenant. The One-Way milestone has no broker, microservice, separate admin backend, or Cloud Command path. Provider, region, and recovery choices remain gated. Free Core never needs this service at transaction time.

## Deployment and versioning

A signed per-machine installer owns the installation. It places desktop binaries under Program Files and mutable database, configuration, log, and backup state under protected ProgramData. The installer installs pinned Node, the local API service, and the PostgreSQL service. It initializes secrets and ACLs, configures the firewall and API TLS, and proves readiness. Uninstall, repair, and failed updates preserve pharmacy data. A separate explicit destructive authorization is the only exception.

Desktop, local API, PostgreSQL compatibility, local schema, and sync contract form one tested release set. Sign, stage, and integrity-check every update. Release-signing keys never live in source control or ordinary CI files. After a signed critical-update deadline passes, Breev isolates only the unsafe capability; it never blocks Main-computer Free Core sales. Show each update to the owner, and check the maintenance state before applying it. Use only forward schema changes for live databases. Do not add compatibility parsers for the obsolete placeholder code.

For active offline fleets, publish an explicit minimum compatible version and in-flight sync horizon. Before removing an old live contract, drain the affected work or require a coordinated update. Never accumulate indefinite fallback handlers. Never attempt a blind database downgrade.

See [`adr/`](adr/) for the alternatives and [`open-decisions.md`](open-decisions.md) for installer, signing, Windows, hardware, service account, trusted-time, backup destination, and cloud-provider gates.
