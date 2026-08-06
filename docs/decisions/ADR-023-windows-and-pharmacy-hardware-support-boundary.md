# ADR-023: Windows and Pharmacy Hardware Support Boundary

- Status: **Accepted provisionally — exact release and certified-model matrix must be revalidated before Phase 11**
- Date: 2026-08-06
- Decision owners: Product / desktop platform / security / release / support / pharmacy operations
- Related: REQ-NFR-001, REQ-NFR-027–034, Q-021, ADR-004, ADR-011, ADR-015, R-020, R-028

## Context

Breev is a Windows-first offline pharmacy workstation whose local database, printing, scanning, cash drawer, LAN service, and recovery behavior depend on the operating system and physical hardware. An unbounded promise to support every Windows edition and peripheral would make releases unsafe and support unpredictable. The previous discovery suggestion to use Windows 10/11 is also no longer suitable as a permanent baseline because ordinary Windows 10 support ended in 2025.

The stakeholder approved this as a provisional Phase 0 boundary and requested that exact choices be discussed again when the project reaches production hardware certification. It is therefore a design baseline, not a lifetime promise for Windows 25H2 or any specific peripheral model.

## Decision

### Windows certification

- The initial certification target is licensed Windows 11 Pro x64, version 25H2. At an actual release, Breev must target a Microsoft-supported broad-deployment x64 Windows 11 release with at least 12 months of security support remaining and re-run the compatibility suite.
- Windows 11 26H1 is accepted only when factory-installed on a specifically certified new device while Microsoft treats it as a hardware-specific release. Windows Home, ARM64, Windows Server, modified/unlicensed builds, and unsupported Windows releases are outside initial production certification.
- Windows 10 is not accepted for a new production installation. An organization enrolled in Microsoft's applicable Extended Security Updates may receive a documented, time-limited migration exception, but that does not make Windows 10 the supported production baseline.
- TPM 2.0, UEFI Secure Boot, current security servicing, and BitLocker protection are required. Recovery-key ownership and recovery procedure must be documented so encryption protects pharmacy data without making Breev or subscription status the only recovery path.
- Pharmacy operation uses a standard Windows user. Administrator elevation is limited to installation, approved maintenance, and recovery. Breev services start independently of interactive sign-in; sleep and hibernation are disabled during operating hours.

### Main-computer profile and power/network continuity

- Minimum candidate profile: supported four-core x64 CPU, 8 GB RAM, 256 GB SSD, and 1366×768 display. Recommended production profile: 16 GB RAM, 512 GB SSD with at least 25% free capacity, 1920×1080 display, and wired Ethernet.
- Rotating HDD-only main computers are not certified. Main computer, router, and network switch use a UPS sized for a controlled shutdown, targeting at least 15 minutes under the pharmacy's tested load.
- DHCP reservation or a stable local address may improve discovery, but IP address, router, Wi-Fi presence, and Windows computer name are never terminal trust anchors under ADR-015.

### Peripheral classes and certification

- Initial receipt support targets 80 mm ESC/POS thermal printers over USB or Ethernet. A4 printing uses a supported Windows printer driver. Printing is mediated through the trusted desktop/main-process adapter, never unrestricted renderer hardware access.
- Initial scanner support targets USB HID keyboard-wedge 1D/2D scanners with a configurable Enter/Tab suffix and tested behavior across the approved Arabic/English input workflow.
- Initial cash-drawer support targets RJ11/RJ12 drawers driven by the certified receipt printer's pulse interface. Manual opening requires a named permission, reason/audit as applicable; transaction-triggered opening is linked to the cash event.
- Direct serial/USB drawers, scales, label printers, customer displays, and devices requiring proprietary SDKs are supported only after a separate adapter and certification decision.
- A versioned Certified Hardware Profile records the exact Windows release/architecture, computer or minimum profile, peripheral model, driver, firmware, connection, tested workflow, known limitation, and support status. Devices outside it are explicitly best-effort, not advertised as certified.

### Failure behavior

- A printer failure cannot roll back, delete, or duplicate a Posted Invoice. Breev preserves the posted result, reports `Print failed`, and offers an audited reprint of the immutable snapshot.
- A scanner failure never blocks manual barcode/product entry. A cash drawer failure never changes the recorded cash sale; Breev reports the physical failure and provides only authorized recovery actions.
- Peripheral reconnection/retry must not replay the business transaction. Hardware health and test-print/scan/drawer diagnostics are separated from sale posting.

## Alternatives considered

- Continue supporting Windows 10 and every Windows 11 edition: rejected because unsupported or weakly controlled operating systems create security, lifecycle, and support risk.
- Promise any ESC/POS/HID device works: rejected because vendors differ in command sets, encoding, drivers, firmware, and cash-drawer behavior.
- Couple successful posting to successful printing: rejected because a paper or spooler fault must not corrupt or repeat stock, cash, accounting, or invoice facts.
- Use IP address or LAN discovery as device identity: rejected by ADR-015 because local network addressing changes and can be spoofed.
- Require proprietary peripheral SDKs in the core: rejected because it creates unnecessary vendor lock-in; certified adapters remain replaceable.

## Consequences

- Positive: the release has a testable support promise, current OS security, predictable peripheral behavior, graceful failure, and a clear route for later hardware additions.
- Negative: some existing pharmacy PCs and low-cost peripherals will require upgrade, replacement, migration assistance, or best-effort status; maintaining a certification lab and compatibility matrix adds recurring work.
- Phase 11 gate: recheck Microsoft's lifecycle and Electron/Node/PostgreSQL compatibility, select exact supported Windows releases and device models, test Arabic/English keyboard and print output, power-loss/restart, driver/update/rollback, USB/Ethernet reconnect, scanner suffixes, drawer pulses, print-failure/reprint, and documented support procedures before release.

## Official evidence checked during Phase 0

- Windows 11 release information: https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information
- Windows 10 end of support: https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support
- Windows 11 hardware requirements: https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements
- BitLocker overview and edition requirements: https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/
