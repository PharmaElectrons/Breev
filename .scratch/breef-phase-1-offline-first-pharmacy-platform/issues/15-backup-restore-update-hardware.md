# 15 — Backup, restore, update, and hardware recovery

**What to build:** The Main Pharmacy Computer can recover from database, service, hardware, peripheral, and signed-update failures while preserving pharmacy-owned data and preventing duplicate business actions.

**Blocked by:** 01 — Foundation runtime seam; 07 — POS sales and continuous Cash Box.

**Status:** ready-for-agent

- [ ] Product-managed PostgreSQL health, startup, repair, encrypted hourly recovery points, daily verified snapshots, rolling retention, and off-device copy behavior are observable.
- [ ] Restore verification replays deletion/revocation/security state and keeps restored data quarantined until integrity checks pass.
- [ ] Signed installers, manifests, binaries, offline bundles, compatibility metadata, safe maintenance windows, and forward-only migrations are verified.
- [ ] Failed updates preserve a recoverable database and use binary rollback only when schema-compatible; no blind downgrade or data reset occurs.
- [ ] Printer, scanner, cash drawer, main-service, LAN, restart, and power-loss failures preserve posted business facts and provide safe recovery actions.
- [ ] Recovery evidence records RPO/RTO, hardware profile, OS/build, dataset, and operator outcome.
