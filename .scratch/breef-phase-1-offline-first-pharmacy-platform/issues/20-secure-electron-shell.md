# Task 20 / P1-04: Build the secure Electron shell and narrow desktop bridge

Type: task
Status: needs-triage
Blocked by: 19
GitHub issue: #22
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Task 19 → #21

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a pharmacy owner, I want the desktop renderer isolated from Windows, secrets, and the database, so that untrusted UI content cannot become machine-level access.

## Phase

Phase 1 — Foundation

## Module

`apps/desktop`

## Goal

An Electron main/preload/renderer skeleton enforces the ADR-002 boundary and exposes only a versioned, typed, allow-listed desktop capability surface.

## Source requirements

- US-001–002; REQ-ARCH-005, REQ-ARCH-007, REQ-NFR-003, REQ-NFR-034; ADR-002; P1-04

## Preconditions

- Task 19 resolved; any temporary bridge capability is named and non-domain-specific.

## Scope

- Sandbox, context isolation, disabled Node integration/remote, strict CSP and navigation/window/permission/download controls.
- Minimal typed preload contract with origin, payload, size, and capability validation.
- Security assertions and malicious payload/navigation tests.

## Out of scope

- Domain commands, unrestricted file/shell/device access, production printer/scanner/update adapters, packaging selection.

## Files likely affected

- `apps/desktop` main/preload/renderer entrypoints, contracts, security tests, ADR-002 verification notes.

## Data changes

- None.

## API or IPC changes

- Add only named, versioned desktop-only IPC types; local domain work remains HTTP-only.

## Security considerations

- Deny by default; no secret/browser storage, generic invoke, shell, arbitrary file, Node, or database capability.

## Offline and sync considerations

- Shell starts offline and has no synchronization behavior.

## Accounting and inventory impact

- None.

## Test plan

- Electron security assertion, CSP, popup/navigation/download/permission denial, invalid IPC, renderer Node/FS/DB access attempts.

## Acceptance criteria

- Given the production BrowserWindow configuration, when security assertions inspect it, then sandbox and context isolation are on and Node/remote access is unavailable.
- Given an unlisted origin, channel, oversized payload, or malformed request, when it invokes preload, then the call is rejected and safely logged.
- Given no internet, when the shell launches, then it renders the local foundation without contacting or embedding a remote page.

## Documentation updates

- Update the desktop process/capability boundary documentation.

## Risks

- Development flags may differ from packaged/production configuration; tests must inspect the production path.

## Completion evidence

- Record Electron security assertions, malicious-input results, and renderer bundle scans.
