# Task 24 / P1-08: Validate the managed PostgreSQL Windows lifecycle on disposable data

Type: task
Status: needs-triage
Blocked by: 17, 19
GitHub issue: #26
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Tasks 17 and 19 → #19, #21

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a pharmacy owner, I want evidence that Breev can install, start, stop, repair, back up, and restore its private PostgreSQL service without deleting pharmacy data, so that the chosen lifecycle is safe before domain tables exist.

## Phase

Phase 1 — Foundation

## Module

Local database operations proof

## Goal

A time-boxed Windows proof validates or revises ADR-004 using a disposable database and records exact outcomes and unresolved release work.

## Source requirements

- US-001–002, US-097–099; REQ-ARCH-010, REQ-NFR-002–003, REQ-NFR-027–030, REQ-NFR-041–043; ADR-004, ADR-023, ADR-024; P1-08

## Preconditions

- Tasks 17 and 19 resolved; disposable Windows environment available; destructive tests target only the named disposable instance.

## Scope

- Prove service identity/data directory, port/credentials, startup order, health, controlled stop/crash recovery, backup/restore, repair, and data-preserving uninstall behavior.
- Record OS/hardware/profile, commands, timings, failures, security/AV observations, RPO/RTO implications.

## Out of scope

- Production installer choice, production credentials/data, domain schema, certification claim, blind destructive recovery.

## Files likely affected

- Disposable proof scripts/config, ADR-004 evidence, recovery/runbook docs; no production migration.

## Data changes

- Disposable proof records only; no domain schema or production data.

## API or IPC changes

- None.

## Security considerations

- Least-privilege service, protected generated credentials, verified paths/instance, and no renderer/terminal DB access.

## Offline and sync considerations

- All lifecycle and recovery proof work is local; no synchronization behavior.

## Accounting and inventory impact

- None; no accounting or inventory schema may be created.

## Test plan

- Fresh install, reboot/start order, standard-user app access, port conflict, crash/restart, encrypted backup, verified restore, repair, uninstall preserving data.

## Acceptance criteria

- Given a clean supported Windows proof machine, when the lifecycle installs and reboots, then the private service becomes ready without interactive user sign-in.
- Given a port conflict, crash, corrupt config, or failed repair step, when detected, then the proof stops safely and preserves the disposable data directory and last recoverable backup.
- Given a verified backup, when restored into quarantine, then integrity checks pass before it is marked usable and measured RPO/RTO are recorded.

## Documentation updates

- Update ADR-004 and recovery/runbook notes with pass/fail evidence and unresolved P11 work.

## Risks

- Proof environment may not be representative; cleanup could target the wrong instance. Validate exact paths and identity before every destructive proof step.

## Completion evidence

- Record OS/hardware, service identity, exact commands/paths, timings, RPO/RTO, backup/restore integrity, failures, and remaining decisions.
