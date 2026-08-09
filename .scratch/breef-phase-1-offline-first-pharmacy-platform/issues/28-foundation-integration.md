# Task 28 / P1-12: Prove the offline desktop-to-local-API foundation seam

Type: task
Status: needs-triage
Blocked by: 20, 21, 22, 24, 25, 26, 27
GitHub issue: #30
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Tasks 20–22 and 24–27 → #22–#24, #26–#29

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a pharmacy owner, I want Breev to open locally, show accurate service status, and remain independent from cloud availability, so that the foundation proves the offline-first topology before pharmacy workflows are implemented.

## Phase

Phase 1 — Foundation

## Module

Desktop, Local API, local database lifecycle, and testing

## Goal

The Electron shell connects through the typed local HTTP contract to local health/readiness, handles unavailable/restart states accessibly, and passes an internet-disconnected integration smoke with no domain data.

## Source requirements

- US-001–009; REQ-ARCH-001–007, REQ-UX-001–004, REQ-UX-008–010, REQ-NFR-003–006, REQ-NFR-045–048; ADR-002–004, ADR-027; P1-12

## Preconditions

- Tasks 20–22 and 24–27 resolved; supported foundation test profile recorded.

## Scope

- Compose desktop, local API, and disposable local readiness dependency.
- Accurate starting/ready/unavailable/restarting UI with retry that never bypasses the local HTTP contract.
- Offline smoke, local service loss/recovery, foundation timing evidence, architecture/runbook updates.
- Time-box/document LAN-mode packaging proof without implementing pairing, trust, or domain calls.

## Out of scope

- Login, Tenant/user records, products, sales, domain schema, production LAN access/mTLS, cloud business connection, production installer.

## Files likely affected

- Desktop/local API composition/config, integration/Electron tests, testing fixtures, architecture and operator runbooks.

## Data changes

- No domain data or schema.

## API or IPC changes

- Consume only the versioned foundation health/readiness HTTP contracts; no new domain/IPC capability.

## Security considerations

- Renderer remains sandboxed and uses HTTP; LAN proof cannot weaken binding, trust, or preload defaults.

## Offline and sync considerations

- Integration must pass with internet blocked; cloud/sync remains optional and unimplemented.

## Accounting and inventory impact

- None.

## Test plan

- Clean start offline, desktop before API, API before DB-ready, API stop/restart, malformed response, retry/duplicate click, AR/EN/RTL/LTR keyboard/status, timing capture.

## Acceptance criteria

- Given internet and cloud are unavailable, when the supported local foundation starts, then the desktop reaches usable foundation state through the Local API.
- Given the desktop starts before the Local API or readiness dependency, when state changes, then it announces starting/unavailable status and later recovers without reload or data fabrication.
- Given a renderer inspection, when the integration runs, then no direct DB, filesystem, Node, or cloud-domain call is available.
- Given the recorded certified-candidate profile, when startup timing is measured, then environment and percentile evidence are captured without claiming final P11 certification.

## Documentation updates

- Update architecture/module map, startup/recovery runbook, Phase 1 task status, and map dependency readiness.

## Risks

- A demo-only shortcut could bypass production topology; timing could be mistaken for final certification; LAN proof could be confused with trusted pairing.

## Completion evidence

- Record exact offline method, environment, commands, test results, startup timings, screenshots/logs, and confirmed absence of domain schema/behavior.
