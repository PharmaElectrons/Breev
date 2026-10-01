# T06 focused verification

Implementation based on accepted T05 local commit, 1 October 2026. T06 received
explicit stakeholder manual PASS on that date and remains uncommitted. This
record contains focused inner-loop verification. The stakeholder later initiated
the consolidated full outer gate; its [separate report](full-gate/report.md)
records the complete run, affected retries and unresolved findings. It is not a
fully green repository gate. Manual T06 acceptance does not imply phase
acceptance or release approval.

The stakeholder subsequently gave separate explicit
[Phase 1 PASS](../phase-1-checkpoint.md), retaining the reported findings.

Do not sum failed/repeated runs or overlapping test counts.

| Focused seam | Result | Log |
| --- | --- | --- |
| Contracts | 219 passed, 10 files | `logs/t06-contracts-verified.log` |
| Exact Inventory unit decomposition | 2 passed | `logs/t06-inventory-unit.log` |
| Desktop panel/REST cancellation/protected row unit tests | 33 passed, 3 files | `logs/t06-desktop-unit-verified.log` |
| Real PostgreSQL T06 projection/redaction/reconciliation | 3 passed; 22 outside selection | `logs/t06-postgres-verified.log` |
| T06 locale/theme/browser status cases | 4 passed, 42.7 seconds | `logs/t06-browser-verified.log` |
| Protected header/restart and keyboard/Quick Product browser flows | 2 passed within combined run; that run also had 1 T06 pass, 1 connection-state test setup failure and 2 not run | `logs/t06-browser-final.log` |
| Reference-volume measurement | 1 passed, four variants, 20 samples per seam/variant | `logs/t06-reference-attempt-7.log`, `performance/m2-reference-volume.json` |
| API/node/renderer type checks and Desktop build | Exit 0 at recorded checks | `logs/t06-api-type-verified.log`, `logs/t06-node-type-verified.log`, `logs/t06-renderer-type-verified.log`, `logs/t06-desktop-build-session-key.log` |
| Modified source formatting and lint | Exit 0; protected unrelated files excluded | `logs/t06-format-verified.log`, `logs/t06-lint-verified.log` |
| Historical media preservation | All 848 pre-gate and 1,259 prior manifest hashes verified separately; one new keyboard video archived before restoration | `logs/t06-media-restored.log` |

The final connection-state retry fails only the panel transport with
`internetdisconnected`, keeping the existing shell health/identity connection
seam independent. Entire-browser offline can legitimately remove this editor
after its health poll. The disconnected `baseUrl` panel status also has English
and Arabic unit coverage. This does not claim a whole-offline API can resolve
a new barcode or accept a server write.

Checks cover exact Inventory movements versus projection, physical units,
configured expiry/business date, missing versus zero, frozen references after
Catalog edits, restart, independent permissions/settings, foreign pharmacy
context and device rejection, valuation mismatch without inventory writes,
stale requests, loading/error/offline/denied recovery, keyboard saving while
the panel is held, locale/theme/accessibility and responsive text/layout.

Performance fixture is the M2 portion of provisional reference volume: 10,000
products, 20,000 batches, 1,000 suppliers, constrained synthetic movements
distributed over two years. It does not manufacture later Patient Profiles
or claim 200,000 posted sale documents. Host facts, p95/p99 and raw samples are
recorded separately; this developer workstation is not a certified minimum
profile. Host: Windows build 26200, Intel i5-9300H, 8 logical processors,
21,319,532,544 bytes installed/available-to-runtime memory. These are a browser
renderer plus production local API over loopback, healthy with panel reads
intentionally delayed 4 seconds. Timing includes Playwright actions/assertion
observation; p99 of 20 samples is the maximum and is not statistically certified.

| Variant | Search p95 / p99 ms | Barcode p95 / p99 ms | Durable save p95 / p99 ms |
| --- | --- | --- | --- |
| English light | 449.4 / 474.5 | 113.1 / 144.2 | 139.3 / 232.8 |
| English dark | 426.4 / 460.5 | 89.0 / 118.0 | 122.3 / 135.7 |
| Arabic light | 414.7 / 439.1 | 115.6 / 134.0 | 142.5 / 146.1 |
| Arabic dark | 413.4 / 440.6 | 77.4 / 115.1 | 129.5 / 236.7 |

Search exceeds the provisional 200ms p95 target. Barcode and durable save are
below their 300ms/250ms p95 targets on this fixture, while the panel is delayed.
The existing protected 180ms search debounce and Catalog ordered-name scan
remain unchanged; no claim of measured before/after regression or certified
target acceptance is made. Search remediation/profile acceptance remains
open under G-16 and cannot justify changing the protected keyboard flow here.
The opt-in reference test must run alone with `BREEV_T06_REFERENCE_VOLUME=1`,
so its bulk seed does not alter other correctness scenarios.

Protected unrelated hashes remain exactly
`27ACD8E447DEE24964A1137E441FBF7F91F7748F8246010FF5BA5CD7C0EA913B`
for `use-startup-connection.ts`, and
`73AAF0EE0779D110862F5E9A062DB5F8625AA3075D338FAB6C6622146C1D3E3B`
for `tooling/dev.mjs`. The index is empty, branch unchanged. No reset/clean,
remote operation or old manual database reset occurred.

G-16/Narrator/physical-profile,
professional gates and the previously recorded CNG/Docker/Windows limitations
remain open. No security checks, atomicity or permission rules were weakened.

Early attempts found T06 scroll accessibility and fact-card shrink/wrapping
defects, repaired through scoped CSS/focus. Other failures were test contract
registry maintenance, wrong fixture packaging, SQL enum/alias setup, obsolete
hidden compatibility selectors, offline-before-barcode setup, and benchmark
Escape/route cleanup sequencing. A reconciliation test originally depended on
stock from a deselected case; it now posts its own Product fixture. Raw attempts remain preserved and are not
presented as extra passing proof.
