# Windows Lifecycle Proof Gates Ledger (Issue-43 / Milestone-1)

Run ID: `8c44f773-e4ce-4b85-836c-ab79782092ef`
Source Commit: `0b3f5a4e5e478abe3d3fcd20c7a1108eafe079f5`
Evidence Directory: `evidence/issue-43/8c44f773-e4ce-4b85-836c-ab79782092ef/`

| Gate    | Phase       | Status | Details / Evidence File                                                                                                          |
| ------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Gate 0  | baseline    | PASSED | `baseline.json` (running prior install, 31310 loopback only)                                                                     |
| Gate 1  | transfer    | PASSED | `transfer.json` (103.8MB payload transferred & extracted to C:\breev-m1\payload)                                                 |
| Gate 2  | clean-slate | PASSED | `clean-slate.json` (DestructiveUninstall cleanly purged services and data)                                                       |
| Gate 3  | install     | PASSED | `install.json` (Fresh install healthy, bound 192.168.134.154:31312 + 127.0.0.1:31310, firewall active, PostgreSQL loopback-only) |
| Gate 4  | restart     | PASSED | `restart.json` (Guest reboot verified; services auto-start, /health healthy, LAN listener bound before interactive login)        |
| Gate 5  | repair      | PASSED | `repair.json` (Runtime damaged & recovered via Repair; m1-marker.json, PG_VERSION, and CA state 100% preserved)                  |
| Gate 6  | rollback    | PASSED | `rollback.json` (Injected failure BeforeReadiness caught & rolled back cleanly, data preserved, then restored to healthy)        |
| Gate 7  | peer-mtls   | PASSED | `peer-mtls/` (`accepted.json` 200 TLSv1.3, `foreign.json` 403, `missing.json` 401, `aggregate.json` passed)                      |
| Gate 8  | uninstall   | PASSED | `uninstall.json` (Services & firewall removed; C:\ProgramData\Breev, marker, and PG_VERSION preserved)                           |
| Gate 9  | destructive | PASSED | `destructive.json` (Refused without auth flags; authorized run purged services, firewall, database, and all pharmacy data)       |
| Gate 10 | summary     | PASSED | `summary.json` (All 10 lifecycle phases passed; overallPassed: true)                                                             |
