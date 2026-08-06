# ADR-027: POS Performance and Accessibility Baseline

- Status: **Accepted provisionally — benchmark evidence on certified hardware and final accessibility review required before release**
- Date: 2026-08-06
- Decision owners: Product / UX / desktop platform / QA / pharmacy operations
- Related: REQ-UX-008–010, REQ-NFR-045–049, Q-025, ADR-023, ADR-025, R-018, R-032

## Context

Breev's pharmacy workstation must be fast under barcode-heavy use while remaining usable in Arabic/RTL and English/LTR, with keyboard-first operation and accessible feedback. “Fast” and “accessible” need observable acceptance targets on the certified low-end computer; the exact values remain subject to benchmark evidence rather than being silently weakened later.

## Decision

### Provisional local performance targets

Measure p95 (and p99 for posting) on the minimum Certified Hardware Profile with a realistic pharmacy dataset, offline, and with the local API/database healthy:

- Product search results: p95 ≤200 ms.
- Barcode scan to visible invoice line: p95 ≤300 ms.
- Durable draft save: p95 ≤250 ms.
- Complete sale posting—stock, payment, journal, audit, and outbox: p95 ≤1.5 seconds and p99 ≤3 seconds, excluding physical printer time.
- Cold startup to usable POS: p95 ≤5 seconds; warm startup ≤3 seconds.
- Print handoff to the Windows spooler: p95 ≤1 second.
- Additional-terminal local requests: p95 ≤500 ms under the certified LAN profile.
- Core sales, inventory, accounting, printing, and local reports have no internet dependency.

These are acceptance targets, not permission to drop atomicity, validation, audit, or safety checks to gain speed. Final thresholds may be adjusted only with benchmark evidence and owner approval.

### Accessibility baseline

- Target WCAG 2.2 Level AA for Electron-rendered content, applying W3C WCAG2ICT guidance where a web-specific criterion does not directly map to desktop software.
- Every core flow is keyboard-operable with visible, stable focus and logical Arabic/RTL and English/LTR order. Screen readers receive correct names, roles, values, and state/error announcements.
- Normal text meets 4.5:1 contrast and large text 3:1. Text supports 200% resizing without loss of critical content/function. Pointer targets meet at least 24×24 CSS pixels; primary cashier controls target 44×44 where layout permits.
- Color is never the sole meaning. Offline, blocked, approval, printer, scanner, validation, and success states have accessible text/status feedback. Reduced-motion behavior is supported.
- Receipts, reports, exports, approval dialogs, and destructive-action confirmations remain readable and complete in both languages.

### Verification

- Test minimum and recommended computers, main and additional terminals, offline/restart, Arabic/English, RTL/LTR, keyboard-only operation, screen-reader checks, printer/scanner/drawer failure, and recovery paths.
- Record dataset, hardware profile, OS/build, locale/theme, network state, percentile measurements, accessibility findings, and remediation in release evidence. No production claim is made from a fast developer machine alone.

## Alternatives considered

- “Fast enough” without percentiles: rejected because it hides slow-tail failures during real pharmacy workloads.
- Optimize by skipping validation or atomic posting: rejected because speed cannot trade away inventory, cash, accounting, safety, or audit correctness.
- Mouse/touch-only design: rejected because barcode and keyboard-heavy pharmacy workflows require equivalent keyboard operation.
- Color-only warnings and status: rejected because they fail accessibility and are unsafe for expiry, approval, and offline states.

## Consequences

- Positive: cashier responsiveness and accessibility become testable product qualities across languages and hardware.
- Negative: benchmark datasets, assistive-technology checks, RTL/LTR fixtures, and performance telemetry require ongoing QA work; dense POS layouts may need careful scaling and focus design.
- Release gate: final performance thresholds, WCAG2.2 AA evidence, WCAG2ICT interpretation, and any approved exceptions are documented before production release.

## Official evidence checked during Phase 0

- W3C WCAG 2.2 Recommendation: https://www.w3.org/TR/WCAG22/
- W3C WCAG2ICT guidance: https://www.w3.org/WAI/standards-guidelines/wcag/non-web-ict/
