# Windows service-wrapper candidates for issue #34

**Research date:** 2026-08-24  
**Decision status:** Proof candidate only. G-06 and G-07 remain open.

## Recommendation for the proof

Use the pinned Shawl 1.9.0 x64 binary to run both the pinned Node `local-api` process and `postgres.exe` as independent SCM services. Give the services separate Windows virtual accounts and protected paths. Keep WinSW as the fallback if real Windows evidence exposes a Shawl defect.

This recommendation is deliberately narrower than a final wrapper decision. The issue #34 Windows run still has to prove service control, child-tree termination, clean PostgreSQL shutdown, child and wrapper crash recovery, virtual-account ACLs, reboot behavior, and signing.

## Candidate evidence

| Candidate                   | Current evidence                                                                                                                                                                             | Result for this proof                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Shawl 1.9.0                 | Released 2026-05-03; native x64 release; restart delay, logging, stop timeout, and a Windows Job Object option for descendant cleanup.                                                       | Lead candidate. Small native wrapper with the required process behavior. |
| WinSW 2.12.0 / 3 alpha      | Rich account, recovery, dependency, stop, and logging configuration. The stable release is from 2023; v3 remains prerelease and its released native builds target unsupported .NET releases. | Maintained fallback, not the smallest current candidate.                 |
| `node-windows` 1.0.0-beta.8 | Latest release is from 2022 and adds a JavaScript monitor around an old bundled WinSW.                                                                                                       | Rejected for the proof.                                                  |
| NSSM 2.24                   | Stable release is from 2014; the project directs modern-Windows users to a 2017 prerelease.                                                                                                  | Rejected for the proof.                                                  |
| `sc.exe` alone              | Registers and configures services but does not turn `node.exe` into an SCM-aware service process.                                                                                            | Configuration tool, not a wrapper.                                       |
| Custom native host          | Could meet the contract but would add new security-sensitive lifecycle code.                                                                                                                 | YAGNI unless maintained wrappers fail on Windows.                        |

Primary sources: [Shawl 1.9.0 release](https://github.com/mtkennerly/shawl/releases/tag/v1.9.0), [Shawl CLI](https://github.com/mtkennerly/shawl/blob/v1.9.0/docs/cli.md), [Shawl Job Object code](https://github.com/mtkennerly/shawl/blob/v1.9.0/src/process_job.rs), [Shawl service code](https://github.com/mtkennerly/shawl/blob/v1.9.0/src/service.rs), [WinSW releases](https://github.com/winsw/winsw/releases), [WinSW v2 configuration](https://github.com/winsw/winsw/blob/v2/doc/xmlConfigFile.md), [`node-windows` releases](https://github.com/coreybutler/node-windows/releases), and [NSSM downloads](https://nssm.cc/download).

The repository pins the Shawl release ZIP to SHA-256 `f883c5d09c9beae2efaeabd8513e7d3f57cd1d0864cec3df4f4a7b6ee904351c` and the extracted `shawl.exe` to `0985555b71e7f943b8f3fc639952a9890aa62e66617942a2d0996985fe8e7c6d`.

## Why PostgreSQL uses the same wrapper

PostgreSQL 18.6's native Windows `pg_ctl` service path waits for the postmaster and then reports the service stopped, but its service exit code remains success when the postmaster dies. SCM recovery actions therefore cannot be relied on to restart a crashed postmaster. The relevant implementation is in PostgreSQL's [`pg_ctl.c`](https://github.com/postgres/postgres/blob/REL_18_6/src/bin/pg_ctl/pg_ctl.c#L1624-L1715).

Shawl instead supervises `postgres.exe -D <protected data directory>` directly. On an ordinary stop it sends Ctrl-C; PostgreSQL maps that on Windows to `SIGINT`, which requests fast shutdown and rolls back active transactions before the shutdown checkpoint. See PostgreSQL's [Windows signal handler](https://github.com/postgres/postgres/blob/REL_18_6/src/backend/port/win32/signal.c#L374-L387) and [postmaster shutdown handling](https://github.com/postgres/postgres/blob/REL_18_6/src/backend/postmaster/postmaster.c#L2043-L2063).

This is `pg_ctl`-class registration rather than a manual third-party setup path: the installer registers and owns the pinned wrapper and PostgreSQL binary as one tested set. The real Windows run must still verify that interpretation against actual restart and mid-transaction behavior.

## Identity and secret boundaries

The candidate uses `NT SERVICE\BreevLocalApi` and `NT SERVICE\BreevPostgreSQL`. Windows virtual accounts need no managed password and yield separate service identities. The API receives only an ACL-protected path to its runtime database URL; role secrets are not placed in the service command line. The PostgreSQL account receives its own data and log directories. Microsoft documents [virtual accounts](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-service-accounts#virtual-accounts), [automatic services](https://learn.microsoft.com/en-us/windows/win32/services/automatically-starting-services), and [service security](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights).

The database proof pin is PostgreSQL 18.6-1 x64, sourced from the [official Windows download route](https://www.postgresql.org/download/windows/). PostgreSQL documents `listen_addresses` separately from [`pg_hba.conf`](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html); both must be constrained. The proof configuration binds only `127.0.0.1` and `::1` and permits only SCRAM-authenticated loopback hosts.
