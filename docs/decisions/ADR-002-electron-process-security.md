# ADR-002: Electron Process Security Boundary

- Status: **Proposed — Phase 0 review**
- Date: 2026-08-05
- Decision owners: Security / desktop platform
- Related: REQ-ARCH-007, R-003

## Context

The desktop renderer displays operational and patient data and will process untrusted strings, images, scanned input, and provider responses. Granting it Node, filesystem, database, shell, or broad IPC access would turn an XSS/navigation defect into machine or data compromise. The existing web prototype is not an Electron security design.

## Proposed decision

- `contextIsolation: true`, `nodeIntegration: false`, renderer sandbox enabled, remote module absent.
- Strict Content Security Policy; deny unapproved navigation, popups, permissions, downloads, and mixed content.
- Renderer performs domain work through the authenticated local HTTP API. It never opens PostgreSQL or reads arbitrary files.
- Preload exposes a versioned, typed, allow-listed surface only for desktop capabilities that cannot be normal HTTP operations, such as controlled file selection, printing, scanner/peripheral adapters, and update status.
- IPC validates payload, actor/session context, origin/window, size, file type/path capability, and rate; no generic invoke/eval/shell/filesystem bridge.
- Secrets and provider credentials remain in privileged server/main-process storage, never renderer bundles or browser storage.

## Alternatives considered

- Node-enabled renderer: simpler prototypes, unacceptable blast radius.
- Put all operations behind preload IPC: creates a second broad application API and couples domain logic to Electron.
- Treat the desktop as a remote cloud webview: breaks offline-first and local data ownership.

## Consequences

- Positive: compromised renderer has a narrow capability set; LAN/browser client can share the HTTP contract.
- Negative: printing, file, update, and peripheral flows need explicit adapters and tests.
- Verification: Electron security assertions, CSP/navigation tests, malicious IPC payload tests, and secret-scanning of renderer bundles.

## Open detail

Exact printing/scanner/cash-drawer APIs are decided from the supported hardware matrix in Q-021, without weakening this boundary.
