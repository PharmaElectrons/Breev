# ADR 0004: Secure coordinated Windows delivery

**Status:** Accepted safety direction; tooling decision open pending the milestone 1 runtime proof, 2026-08-23

## Context

Breev ships an Electron client, a local API service, a PostgreSQL service, schemas, and device trust. It may also support offline terminals. A partial or untrusted update can leave a pharmacy unable to work or corrupt its only local authority. The confirmed frontend build uses Vite. A Windows installer must also manage the local services, so a generic Electron zip is not enough.

## Decision

Keep the build compatible with Vite. Package the desktop client, pinned service runtimes, compatibility manifest, and schema requirements as one signed and tested release set.

During the milestone 1 runtime-proof stage, compare the leading `electron-vite` with `electron-builder` and NSIS candidate against Electron Forge and any Windows installer layer it requires. Select and record the build, packager, updater, and installer only after proving signed installation, update, repair, and restore. After selection, use one production stack.

The updater must verify signed hashes and manifests. It must support staged Internal, Pilot, Stable, and Emergency channels. Before an update, it must check system health, free disk space, backups, and compatibility. It must stop new transactions and jobs, let active ones finish safely, then create a fresh encrypted recovery point.

Migrations must move forward only. They must support resumption and record each version in a journal. The audit log must record the update outcome. Breev may restore an old binary only after proving that it supports the current schema. If the pharmacy creates new work after an update, prefer a forward repair. Repair and uninstall must preserve data and trust state by default. Free Core must always include security updates, repair, offline updates, backup, export, and recovery.

## Alternatives considered

- Forge with its experimental Vite plugin offers general packaging and established security tools. The runtime proof must validate its Vite path and fit with a service installer.
- `electron-vite` with electron-builder and NSIS is the current leading candidate. It offers a compact three-target build and established support for signing, fuses, and updates. The runtime proof must still cover the service and database lifecycle.
- A manual Vite, packager, and custom updater stack would repeat standard work for builds, fuses, signing, updates, and targets. Choose it only if the runtime proof shows that the standard tools leave an unavoidable gap.
- Independent component updates can create unsupported combinations of the desktop client, API, and schema.
- A blind database rollback can lose posted work or cause Breev to read it incorrectly.

## Consequences

Treat Windows installation and recovery as tested product work. Before release, G-05 through G-07 and G-16 must settle the final tool choice, code-signing custody, service wrapper, installer UX, update host and deadlines, hardware profile, and rollback drills. Accepting this ADR does not settle the tooling choice.

Evidence: [electron-vite build](https://electron-vite.org/guide/build), [electron-builder fuses](https://www.electron.build/docs/tutorials/adding-electron-fuses/), [Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/), [Electron Forge Vite status](https://www.electronforge.io/config/plugins/vite).
