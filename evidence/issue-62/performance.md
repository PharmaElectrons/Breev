# Issue 62 POS performance benchmark

## Status

The repeatable API benchmark ran on 2 October 2026 against the isolated local
test database. It completed 1,000 measured samples for each operation, with
100 warm-up samples per operation. This is development-workstation evidence,
not evidence from the minimum certified Windows profile. It does not establish
end-to-end performance-target acceptance.

| API operation                     | Samples |       p50 |       p95 |       p99 |   Maximum |
| --------------------------------- | ------: | --------: | --------: | --------: | --------: |
| Product search                    |   1,000 | 109.78 ms | 143.90 ms | 152.56 ms | 176.88 ms |
| Barcode search to Sale Draft line |   1,000 |  40.73 ms |  76.55 ms |  86.36 ms | 127.14 ms |
| Durable Sale Draft line save      |   1,000 |  16.28 ms |  45.55 ms |  52.66 ms | 450.54 ms |

Capture time: `2026-10-02T10:25:43.779Z`. The database was PostgreSQL 18.6 on
loopback. API health returned HTTP 200 before and after sampling. Percentiles
use nearest rank (`sorted[ceil(p * n) - 1]`). The adjacent
[`performance-results.json`](./performance-results.json) records the machine,
dataset counts, run settings, and captured aggregate measurements. Individual
timing samples were not retained in this completed run. The benchmark script
now saves each full-precision sample for future runs, allowing independent
recalculation of future percentiles. This capture measured source commit
`a323155`, before current dev advanced to `8feb88a` and PR #203 removed the
patient-profile tables. The captured dataset included 5,000 synthetic patient
profiles. The runnable script below follows the current dev schema and no
longer seeds patient profiles, so a future run will not reproduce that part of
the captured dataset.

## Requirement and measurement boundary

Issue [#62](https://github.com/PharmaElectrons/Breev/issues/62) names the
provisional targets in `docs/quality.md`: product-search p95 <= 200 ms,
barcode-to-line p95 <= 300 ms, and durable draft-save p95 <= 250 ms. The
benchmark uses the real local API and PostgreSQL, without a renderer. Search
measures one loopback search request and response parse. Barcode-to-line
measures a barcode search followed by the real Sale Draft add-line request.
Draft-save measures a versioned quantity change; its response follows the
database transaction, and an additional read-after-write check verifies the
last saved state outside the timed samples. Warm-up samples are omitted from
the reported percentiles.

These results are API-seam baselines. They omit renderer input, rendering,
scanner hardware, LAN terminals, and peripherals, so they cannot establish the
quality document's end-to-end target acceptance. The recorded English locale
and light theme are declared run metadata only. The benchmark does not launch a
renderer or validate locale behavior, theme appearance, or accessibility.

## Dataset and workstation limits

The captured `a323155` fixture seeded 10,000 Products with unique barcodes,
1,000 Suppliers, and 5,000 synthetic Patient Profiles. After sampling it
contained 1,101 Sale Drafts. The current benchmark script seeds Products and
Suppliers only because current dev removes the patient-profile tables. Issue
#62 explicitly excludes posting, and the current slice has no posted Sale
Document tables. The fixture does not invent posted sales, purchase documents,
stock movements, or batches. It records zero posted sales, batches, and
movements; this is a representative Product-search and Sale-Draft dataset, not
the complete provisional quality reference dataset.

The provisional performance reference dataset specifies at least 20,000
batches and two years of history containing 200,000 posted Sale Documents.
G-16 confirms or revises those figures. Collect that evidence when the owning
posting/history capabilities exist. Capture certified performance only on the
supported minimum profile after G-16 confirms the dataset and thresholds.

The workstation was Windows 11 Pro 10.0.26200 x64, Intel Core i7-9750H
2.60 GHz (6 cores / 12 threads), and 16,986,574,848 bytes of RAM. Node was
v24.19.0. The run recorded English locale, light theme, Main role, and loopback
API plus local PostgreSQL; internet and peripheral state were not measured.
Locale and theme are metadata, not validation results. This remains
development-workstation evidence.

## Running the benchmark

Run from the repository root in PowerShell. The benchmark reads the PostgreSQL
password from
`D:\Cefeldeen-clinic-pos\issue-62-postgres\password.txt`; the secret is never
printed. It defaults to loopback host `127.0.0.1`, port `56462`, user
`breev_test_admin`, and database `breev_issue_62_test`. Set these environment
variables to override the password-file path and connection endpoint:

- `BREEV_BENCH_POSTGRES_PASSWORD_FILE`
- `BREEV_BENCH_POSTGRES_HOST`
- `BREEV_BENCH_POSTGRES_PORT`
- `BREEV_BENCH_POSTGRES_USER`
- `BREEV_BENCH_POSTGRES_DATABASE`

The helper resets the selected database schema, so run only when this dedicated
disposable database is idle and its contents may be discarded.

```powershell
pnpm --filter @breev/local-api build
$env:BREEV_BENCH_ALLOW_DESTRUCTIVE_RESET = "issue-62-disposable-database-only"
$env:BREEV_BENCH_SAMPLE_COUNT = "1000"
$env:BREEV_BENCH_LOCALE = "en"
$env:BREEV_BENCH_THEME = "light"
$env:BREEV_BENCH_ROLE = "Main"
$env:BREEV_BENCH_NETWORK_STATE = "Loopback API and local PostgreSQL; internet and peripherals not measured"
$env:BREEV_BENCH_OS_DESCRIPTION = "Windows 11 Pro"
$env:BREEV_BENCH_HARDWARE_PROFILE = "development-only"
node .\evidence\issue-62\pos-performance.benchmark.mjs
```

The benchmark refuses non-loopback database hosts and databases whose names do
not end in `_test`, `_bench`, or `_perf`. For later certified testing, configure
a dedicated disposable local database, set the connection overrides above,
preserve the loopback and disposable-database checks, set accurate OS/hardware
metadata, and run only after confirming the certified profile and G-16-approved
dataset. Each run prints and saves machine-readable JSON, including full sample
values, counts, p50/p95/p99, profile, health, and provisional target references.
Keep that output with the reviewed certification record.
