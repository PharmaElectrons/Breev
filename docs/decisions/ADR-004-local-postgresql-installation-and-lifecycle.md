# ADR-004: Local PostgreSQL Installation and Lifecycle

- Status: **Accepted — Phase 1 validation pending**
- Date: 2026-08-05
- Decision owners: Platform / release / operations
- Related: Q-002, Q-003, Q-020, R-001, R-020

## Context

Local PostgreSQL is the authoritative pharmacy store during internet outages. Installing a database is not just copying binaries: service identity, directory permissions, ports, credentials, start order, health, backups, upgrades, repair, uninstallation, and rollback affect availability and data safety.

## Decision

Install a product-managed, private PostgreSQL instance as a Windows service through the signed installer:

- dedicated least-privilege service identity and product-specific data directory;
- localhost/private-interface exposure only as required by the local API, with no renderer/terminal DB credentials;
- generated credentials stored with OS-protected secret facilities;
- explicit local API/DB version compatibility and forward migration gate;
- automated encrypted backup plus restore verification;
- installer repair and upgrade that never deletes the data directory;
- health/readiness and operator-visible recovery instructions.

The stakeholder approved this direction on 2026-08-05. Phase 1 must still run a disposable Windows proof before the packaging/lifecycle implementation is considered validated.

The approved local backup policy is: encrypted hourly recovery points, a daily verified snapshot, 30-day rolling retention, at least one configured off-device copy, a quarterly restore drill, recovery point objective no worse than one hour, and recovery time objective no worse than four hours.

## Alternatives considered

- Require customer-managed PostgreSQL: reduces installer work but creates inconsistent support/security and poor pharmacy usability.
- Ship a child-process/“portable” PostgreSQL: simpler isolation in demos but weaker service recovery, upgrades, and process ownership unless carefully engineered.
- SQLite: simpler packaging but conflicts with the governing PostgreSQL architecture and LAN/concurrency/accounting needs.
- Containers: heavy and operationally unsuitable for typical pharmacy Windows PCs.

## Consequences

- Positive: predictable service lifecycle and support boundary.
- Negative: installer privilege, Windows service, version upgrade, antivirus, port, and backup complexity becomes product responsibility.
- Failure rule: a failed application/update migration must stop safely and preserve the last recoverable DB/backup; it must not auto-reset.

## Required evidence before acceptance

Fresh install, reboot/start ordering, non-admin app use, port conflict, service crash/recovery, backup/restore against the approved RPO/RTO, upgrade, rollback/repair, uninstall-with-data-preservation, and minimum supported Windows tests.
