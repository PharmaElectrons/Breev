# ADR-011: Windows Packaging, Signing, and Updates

- Status: **Superseded by ADR-024 for the approved update-safety policy; packaging tool choice remains unresolved**
- Date: 2026-08-05
- Decision owners: Desktop platform / release / operations
- Related: REQ-NFR-001, Q-021, Q-022, ADR-004, ADR-024, R-020, R-029

## Context

The product is Windows-first and must install Electron, the local API, local PostgreSQL, service configuration, shortcuts, and recovery/update machinery without risking pharmacy data. Choosing Forge/Builder/NSIS/WiX before proving service/database and signing/update constraints would be premature.

## Proposed decision

- Deliver a signed x64 Windows installer for the documented supported Windows 10/11 baseline first.
- Installer is idempotent and owns application binaries/services while treating the database data directory and backups as preserved customer data.
- Separate application version, API/contract version, and database compatibility/migration state.
- Updates use signed manifests/artifacts, staged release channels, download verification, preflight health/disk/backup checks, maintenance-window awareness, post-update health checks, and rollback/repair.
- Never apply a disruptive update during an active posting/payment/backup/migration; never downgrade a DB blindly.
- Provide explicit offline installer, repair, diagnostics bundle with redaction, and rollback/recovery runbooks.
- Code-signing keys are protected outside CI source and use least-privilege release workflows.

Phase 1 compares Electron Forge/package tooling and NSIS/WiX/service integration against these criteria; no tool is selected by this draft.

## Alternatives considered

- Auto-update only the Electron bundle: cannot safely coordinate local API/PostgreSQL/contracts.
- Manual zip deployment: weak authenticity, service lifecycle, repair, and support.
- Microsoft Store only: may simplify distribution but may conflict with service/database/peripheral requirements and offline customer support.

## Consequences

- Positive: update convenience cannot silently override data safety or offline availability.
- Negative: signing, release channels, migration compatibility, rollback, and Windows service integration require dedicated infrastructure and test machines.

## Required evidence before acceptance

Q-021/Q-022 answers plus clean install, upgrade from supported versions, interrupted update, signature failure, antivirus/permission issues, port conflict, DB migration failure, rollback/repair, uninstall/reinstall with preserved data, and offline install tests.
