# Automated baseline results

Capture date: 2026-09-29. Source commit reported by the packaged harness:
`7164fbff6ab56ee99d46463b7d148e874a5b12cc`.

## Passing seams

| Seam | Result |
|---|---|
| Contracts unit tests | 9 files, 204 tests passed. |
| Desktop unit baseline | 56 files and 629 tests passed. One stale scope-registry expectation failed, was corrected to the accepted T02 registry, and its focused rerun passed 7/7. |
| Local API unit baseline | 49 files and 619 tests passed; 12 CNG tests were skipped after the host-limited suite setup failure classified below. |
| M2 real-PostgreSQL integration sweep | 9/11 files passed; 88 tests passed, 1 failed, and 1 skipped. Both failed files are host limitations described below, not product failures. |
| Build and package | `pnpm build` passed; `pnpm package:desktop` passed. |
| Packaged functional/timing subset | Clause 1, Clause 2, and item-panel scope passed in all four locale/theme combinations: 12/12. |
| Packaged independent Inventory subset | Item-panel scope and integer-unit/Count scenario passed in all four combinations: 8/8. |
| Later-scope quarantine browser seam | The bilingual check that later accounting/report/OCR/legal-print actions are absent while Adjustment and Return remain visible passed 1/1 after narrowing its accessible-name match to tolerate the existing decorative emoji. |
| Type safety | Desktop Node acceptance harness and renderer typechecks passed after the baseline-harness updates. |

## Product defects reproduced

| Defect | Reproduction and classification |
|---|---|
| Missing unchanged-line explanation | Clause 3 functionally showed only `Adjusted Line Item`, calculated 4→8 as +4, posted the Adjustment, posted a separate Return, and linked both records. It then failed 4/4 locale/theme passes because the required “Unchanged lines create no stock or value effects” statement (and Arabic equivalent) is absent. Product/UI defect; retained failing assertion. |
| Reorder accessibility | The Sales-to-reorder flow preserved the Sale Draft byte-for-byte and added the Product, then failed 4/4 locale/theme passes on axe rule `scrollable-region-focusable`. Product/accessibility defect. |

These results are before-state evidence. They are not waived by T03 and must be
remediated in the owning later phase before Milestone 2 final acceptance.

## Host-limited or harness findings

| Finding | Classification |
|---|---|
| `inventory-safety.integration.test.ts` expected a POSIX `SIGKILL`; Windows reports a null signal for the terminated child. | Host/platform-limited assertion. The underlying persistence checks passed; no product change made. |
| `inventory-reorder-authorization.integration.test.ts` and the Local API CNG unit suite could not create a Windows machine-store CNG key (`Access denied`). | Host/profile security limitation. CNG/DPAPI behavior was not weakened or bypassed. |
| Acceptance selectors for duplicate module links, collapsed preference controls, the Supplier combobox, posted-invoice tab, and prototype-transplanted Adjustment controls had drifted. | Test-harness defect. Selectors were narrowed to current accessible/stable seams without weakening product assertions. |
| Intermittent removal of Chromium temporary user-data journals returned `EBUSY` after some failing runs. | Windows cleanup limitation after the substantive assertion; not a Breev product failure. |

## Performance baseline

`performance.json` contains four successful packaged end-to-end samples per
operation (English/Arabic × light/dark). Observed ranges were:

- Product search: 317.3–334.2 ms; four-sample p95 334.2 ms.
- Barcode-to-line: 142.1–200.4 ms; four-sample p95 200.4 ms.
- Durable draft save: 1506.3–1698.1 ms; four-sample p95 1698.1 ms.

The measurements include keyboard input and rendered acknowledgement. Four
samples establish a before-state only; they do not certify a production p95 or
change the provisional target owned by G-16.
