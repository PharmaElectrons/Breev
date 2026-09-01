# Quality and definition of done

## Test through real seams

| Layer | Required evidence |
|---|---|
| Pure domain | Put Vitest unit and property tests beside the module. Cover exact money, conversions, state transitions, authorization and entitlement policy, pricing, WAC conservation on the Primary Supplier Cost, and posting-template balance. Test through the module's narrow public interface. |
| Local persistence | Run integration tests against the supported real PostgreSQL version. Cover migrations, constraints, triggers, roles, transactions, failure and rollback after every step, locks, contention, idempotency races, immutable rows, durable jobs, backup metadata, and reconciliation. Do not mock repositories to make these claims. |
| Cloud persistence | Use real PostgreSQL to test verified tenant context, `FORCE RLS`, cross-tenant negative cases, inbox deduplication, replay, checkpoints, projections, deletion, Restore Quarantine, and subscription authority. |
| Contracts/adapters | Test runtime schemas for local REST, preload, sync, and every actual provider. Cover success, timeout, duplicate and reordered messages, forged callbacks, mismatched tenant, amount, or reference, redaction, cancellation, and the provider-deletion outcome. |
| Renderer | Run browser Playwright against a real local API test instance and a small typed desktop fake. Cover complete keyboard and scanner flows, draft recovery, errors, denials, offline states, Arabic and English, RTL and LTR, light and dark themes, focus, screen-reader semantics, and resizing. |
| Electron | Keep a small outer Playwright smoke layer. Test app launch, the absence of Node and global IPC, the exact preload interface, navigation denial, the custom protocol, health and version handling, the print and dialog adapter, and updater handoff. Electron automation is experimental. It does not replace hardened-artifact checks. |
| Windows release | Use Windows CI and physical-profile tests. Prove signatures, fuses, ASAR, installer behavior, services, ACLs, ports, firewall rules, Main and terminal behavior, peripherals, close and restart behavior, offline and LAN failures, update, repair, uninstall, backup, restore, data preservation, and clean-machine recovery. |

Use Testcontainers or another direct, disposable fixture for the supported PostgreSQL version. Do not create a persistence abstraction just for tests. Keep configuration central. Keep helpers local until the extraction test in [`architecture.md`](architecture.md) passes. Evidence: [Testcontainers PostgreSQL](https://node.testcontainers.org/modules/postgresql/), [Playwright Electron](https://playwright.dev/docs/api/class-electron), [Vitest projects](https://vitest.dev/guide/projects).

## Windows release seam by milestone

The Windows release row lists the whole obligation. [`open-decisions.md`](open-decisions.md) G-05, G-06, and G-07 record which part of it milestone 1 proves, under the stakeholder decision of 29 August 2026.

A milestone-1 change on this seam proves the installed lifecycle and the LAN security boundary. A clean install reaches Ready, a machine restart returns to Ready, repair recovers without touching pharmacy data or the pharmacy CA, an injected failure rolls back and preserves any existing data directory, update preserves role-specific state, and a genuine uninstall removes the complete Breev machine-data root without recreating role state. A terminal presenting a valid device certificate completes TLS 1.3 mTLS and reaches the API, and a client with no certificate or a foreign-CA certificate is refused. All of it runs offline with development/test signing, and it may run on the unactivated certification-candidate guest `breev-issue-34-win11`. Loopback-only PostgreSQL, the scoped firewall rule, ASAR and fuse hardening, and least-privilege database roles and ACLs hold at every milestone.

The unified-installer role matrix runs on restored disposable snapshots with the same two signed `BreevSetup.exe` versions. The existing Main proof remains unchanged. The Terminal proof must correlate that passing Main result, reject invalid and conflicting roles, prove repair, injected failure, and update preserve the Terminal role and synthetic pairing-state witness, prove genuine uninstall removes the role and complete Breev data root, and prove reinstall requires a fresh role selection while no Breev service, Main database state, Breev listener, or Breev firewall rule exists. Assisted-page release review separately covers both radio choices, Main default, cancel/back behavior, keyboard and Narrator semantics, English and Arabic Windows display environments, and supported display scaling. A static or non-elevated test is not certification evidence.

The release gate proves what those three gates defer: production signing, the licensed activated candidate named in Supported-environment proof below, the physical-machine pass, the full sequence in [`evidence/issue-34/README.md`](../evidence/issue-34/README.md), the platform-TPM key proof with its rejection transcripts, and base backup plus WAL with the clean-machine restore drill.

## Mandatory invariant tests

- Trigger every posting failure point. Prove that the document, stock and value, settlement, AP, AR, Cash Box, journal, audit, idempotency, and outbox all roll back together.
- Duplicate retries and retries after a timeout post once. Two terminals that contend for stock cannot make it negative. A deadlock or serialization retry reruns the whole command safely.
- Debits equal credits. Quantity and carrying amount conserve. Final depletion leaves no phantom quantity or value. Gross, discount, net, correction, and source values reconcile to accountant golden examples. No floating-point value crosses an authoritative interface.
- Posted facts reject updates and deletes, including maintenance-adjacent paths. Reports reconcile independently and cannot invoke mutations.
- Server-boundary tests explicitly allow and deny each permission, entitlement, tenant, user, device, Step-Up, Dual Control, expected-version, and sensitive-field case.
- Test visible behavior when the internet, cloud, a provider, printer, scanner, drawer, local API, PostgreSQL, disk, backup, or process fails. A peripheral or provider retry cannot replay a transaction.
- Outbox entries and jobs survive a crash before claim, after claim, after external success, and before Breev records the outcome. Duplicate and out-of-order callbacks are safe, as is restore replay.
- Expiry, grace, clock rollback, certificate renewal, revocation, CA rotation, an incompatible terminal, and a paid-to-Free-Core transition never hide data or disable core operation.

## Requirement acceptance scenarios

These client-stated examples are acceptance tests, not negotiable targets.

- Search: "panadol gs" returns "Panadol Extra GSK"; "extra" returns every item containing "Extra"; Arabic, English, and barcode queries all match instantly.
- Margin: cost 80 with a 20% margin yields a selling price of 100 before rounding (margin on selling price, not markup); rounding to 250/500/1,000 IQD applies only when enabled.
- Units: 1 pack = 4 strips — purchasing 1 pack records 4 strips in the base unit; a stocktake entry of "2 packs + 1 strip" converts to 9 strips at that ratio; no fractional base-unit balance ever posts.
- Purchase adjustment: changing a posted line quantity from 4 to 8 posts exactly +4; unchanged lines create no movements; an adjustment whose delta would break the balance or batch state is blocked.
- Supplier settlement: the mandatory five-invoice test — Primary Supplier Cost 5,000, Cost After Discount 4,650, paid 4,500, actual allowance 500, allowance difference 150 — ends with a zero supplier balance and unchanged original invoices, percentages, and average cost.
- Card sale: sale 1,000,000 with a 10,000 commission keeps revenue at 1,000,000, records net received 990,000 in the card account, posts the commission as an expense, and never touches the physical drawer.
- Devices: four devices operate simultaneously over LAN; an authorized user signs in from any licensed device; raising the permitted count requires no code change.
- Reconciliation: an employee drawer zeroed at start of work, compared at end of work, transfers the matched amount to the treasury and leaves the discrepancy visible or in the discrepancies account.

## Usability and accessibility

Core sales, purchasing, counting, corrections, patient flows, reports, dialogs, receipts, and exports target WCAG 2.2 AA. Use WCAG2ICT where it applies. These flows require semantic names, roles, and values. They also require meaningful DOM and focus order independent of visual RTL, visible focus, keyboard operation without timing-specific keystrokes, status that does not rely on color, announced validation and asynchronous status, reduced motion, and readable output.

The provisional measurable targets are normal-text contrast ≥4.5:1, large-text contrast ≥3:1, 200% text resizing without loss of critical content or function, and pointer targets ≥24×24 CSS pixels. Primary cashier controls target 44×44 where the layout permits. Validate Arabic with RTL and English with LTR in both themes. Exercise rapid scanning, slow responses, restart, offline operation, validation, denial, and dialogs. Test with real Windows Narrator. Confirm function shortcuts through user observation and conflict testing. The old F1 through F4 and F12 proposal is not a requirement.

## Performance targets

Use a realistic dataset on the minimum certified profile. The provisional reference dataset is at least 10,000 products, 20,000 batches, 1,000 suppliers, 5,000 Patient Profiles, and two years of history with 200,000 sale documents; G-16 confirms or revises these values with the certified results. Target:

| Interaction | Provisional target |
|---|---:|
| Product search | p95 ≤200 ms |
| Barcode to line | p95 ≤300 ms |
| Durable draft save | p95 ≤250 ms |
| Sale post, excluding physical print | p95 ≤1.5 s; p99 ≤3 s |
| Cold/warm desktop start | p95 ≤5 s / ≤3 s |
| Print handoff | p95 ≤1 s |
| Additional-terminal local request | p95 ≤500 ms |

Record p95 and p99, the dataset, OS and hardware, locale and theme, Main or terminal role, network state, and health state. Developer-machine speed is not evidence. Performance work must never remove atomicity, validation, audit, safety, or authority checks. Final thresholds, accessibility exceptions, and remediation require release approval.

## Supported-environment proof

The initial certification candidate is a licensed, Microsoft-supported, broad-deployment Windows 11 Pro x64 release with at least 12 months of security support remaining. The current candidate is 25H2. Windows Home, ARM64, Server, modified or unlicensed installations, and unsupported versions are outside initial certification. Windows 10 receives migration assistance only under applicable ESU.

The provisional minimum Main profile has a supported four-core x64 CPU, 8 GB RAM, a 256 GB SSD, and a 1366×768 display. The recommended profile has 16 GB RAM, a 512 GB SSD with 25% free, a 1920×1080 display, Ethernet, and a tested UPS for the Main computer, router, and switch. The UPS target is a 15-minute controlled shutdown. Disable sleep and hibernation during operating hours. Production requires TPM 2.0, Secure Boot, current servicing, BitLocker with recovery available to the pharmacy, standard-user operation, and services that do not depend on an interactive login.

Initial peripherals are certified 80 mm ESC/POS USB or Ethernet receipt printers, Windows-driver A4 printers, USB HID 1D or 2D scanners with a configurable suffix, and printer-driven RJ11 or RJ12 drawers. Scales, labels, customer displays, proprietary or direct drawers, and SDK hardware require separate certification. Maintain a versioned profile with the exact model, driver, firmware, connection, workflows, limits, and support state. Support for unlisted hardware is best effort.

## Change-level definition of done

A change is done only when:

1. it names its source requirement and acceptance behavior, with no excluded or deferred behavior added;
2. its simplest complete design has been compared with established precedent and the current documentation and types for its dependencies;
3. it preserves module ownership, security boundaries, and data boundaries, without adding an abstraction that current requirements do not justify;
4. it implements applicable validation, authorization, entitlement, tenant and device checks, audit, exact arithmetic, transaction and idempotency behavior, offline and restart behavior, and failure handling;
5. the tests above pass at the appropriate real seam, including negative and recovery cases;
6. Arabic and English, RTL and LTR, keyboard and focus, theme, accessibility, and every applicable UI state pass;
7. diagnostics redact secrets and unnecessary patient data while retaining safe correlation, actor, pharmacy, device, and outcome evidence;
8. schema and contract changes move forward, carry versions, pass restore tests, and remain coordinated without obsolete compatibility paths;
9. it updates documentation, traceability, ADRs, open gates, runbooks, and evidence once in their authoritative locations;
10. lint, formatting, strict typecheck, build, unit, integration, contract, and UI tests pass from a clean checkout, along with applicable Windows packaging and security checks.

Use a current, maintained security toolchain. The Electron security-scanner decision and its replacement checklist live in [`architecture.md`](architecture.md).
