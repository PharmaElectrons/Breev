# ADR 0002: The Main Pharmacy Computer is the local authority

**Status:** Accepted, 2026-08-23

## Context

Breev must process sales without an internet connection and support additional terminals on the pharmacy's LAN. Changes across domains must commit atomically. The local backend must keep running when a user closes an Electron window. Direct database access from a terminal would bypass the local API's authority. A server owned by an Electron process would stop with that user's session.

## Decision

Run the local NestJS API and a private, Breev-managed PostgreSQL instance as two independent Windows services on the Main Pharmacy Computer. Both services start automatically. PostgreSQL accepts connections only through the loopback interface.

Every Electron client is an untrusted presentation client. Clients call the local API through authenticated HTTPS REST. Terminals must also use paired device trust and mTLS. Only the local API may authenticate and authorize users, enforce entitlements, perform calculations, acquire locks, post transactions, write audit records, and persist data.

The installer includes pinned PostgreSQL binaries for Windows and pinned Node runtime components. Breev tests and releases these components as one set. The exact service wrapper, service account, ports, and installation flow remain open until a proof validates them. This proof gate does not permit manual third-party setup.

## Alternatives considered

- A cloud-primary system with a local cache violates offline Free Core.
- If Electron starts the API and database, other terminals depend on one UI and user session. Updates would also mix the UI lifecycle with the lifecycle of a live server.
- Direct PostgreSQL connections from terminals bypass the required application, security, and transaction boundary.
- A separate SQLite database on each terminal, followed by a merge, creates multiple authorities and unsafe financial and inventory conflicts.

## Consequences

Breev owns installation, service health, secrets, firewall rules, migrations, backup and restore, repair, and coordinated updates. Closing Electron does not stop the local API or PostgreSQL. A failure of the Main Pharmacy Computer or LAN stops additional terminals by design. Breev does not create a secondary database automatically.

Evidence: [PostgreSQL Windows distribution](https://www.postgresql.org/download/windows/), [`pg_ctl` service support](https://www.postgresql.org/docs/current/app-pg-ctl.html), [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model). T3 Code's supervised local backend is precedent for separating the client from the server. Its process lifetime does not fit this decision.
