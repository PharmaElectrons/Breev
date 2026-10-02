# Issue #62 completion evidence

**Local implementation checks are recorded below; supported-Windows CNG and minimum-profile/G-16 evidence remain open.** This record does not certify release readiness or the minimum supported Windows profile.

Issue #59 is closed. The stakeholder confirmed Milestone 3 funding in this session on 2 October 2026. The worktree started from `dev` at `a323155`. Dev advanced to `8feb88a` and then `1fec386b` while the slice was in progress; the branch now includes `1fec386b`. The API benchmark remains a historical baseline for `a323155`.

## Scope covered

Scope basis: the Sale workflow in [workflows.md](../../docs/workflows.md#sell-and-settle), the misc-cost requirement in [Phase One scope §5.3](../../docs/requirements/breev-phase1-mvp-scope.md#53-quick-item-creation-from-the-sales-screen), and the panel and drawer requirement in [§5.6](../../docs/requirements/breev-phase1-mvp-scope.md#56-item-details-panel-and-cash-drawer-balance).

- Durable Sale Draft commands, versioning, idempotent retry, misc-line cost, restart recovery, product context, and versioned quick-access settings are exercised in [sale-draft.integration.test.ts](../../apps/local-api/src/sales/sale-draft.integration.test.ts).
- Permission grants, denial paths, drawer-balance scoping, and wholesale-price redaction are exercised in [sale-draft-authorization.integration.test.ts](../../apps/local-api/src/sales/sale-draft-authorization.integration.test.ts). The built-in permission vocabulary is in [authorization.ts](../../apps/local-api/src/identity-access/authorization.ts).
- Strict Sale request and response schemas, exact misc cost, quick-access settings, product context, and signed drawer-balance values are covered in [sales.test.ts](../../packages/contracts/src/local-rest/sales.test.ts).
- Exact Sale Draft quantity, price, and discount arithmetic has unit coverage in [sale-draft-arithmetic.unit.test.ts](../../apps/local-api/src/sales/sale-draft-arithmetic.unit.test.ts). Inventory consumption and risk indicators have unit coverage in [inventory-risk.unit.test.ts](../../apps/local-api/src/inventory/inventory-risk.unit.test.ts).
- Renderer scenarios for settings persistence, uncertain retry, version conflict, category and thumbnail management, drawer permission, and the item panel are present in [sales.browser.test.ts](../../apps/desktop/test/browser/sales.browser.test.ts). The `1fec386b` browser run passed all 34 Sales scenarios. The separate full Purchasing file run after a test-only Axe timing correction passed its ordinary cases; five Devices scenarios remain unavailable on this host because of the CNG prerequisite described below.

The forward migrations preserve the line-kind constraints while allowing a misc line to carry a nonzero cost in [0036_sale_misc_cost.sql](../../apps/local-api/drizzle/0036_sale_misc_cost.sql). [0037_sale_panel_and_drawer.sql](../../apps/local-api/drizzle/0037_sale_panel_and_drawer.sql) persists panel preferences, links cash journal lines to an employee drawer, and adds `sales.drawer_balance.view` and `sales.wholesale_price.view`. The migration grants the new permissions to owner and manager roles and advances role and pharmacy revisions; [custom-roles-migration.integration.test.ts](../../apps/local-api/src/identity-access/custom-roles-migration.integration.test.ts) checks those revision changes.

Posting, patient workflows, and tender or settlement flows remain outside this issue's scope. Their absence is not evidence that those Phase One capabilities are complete.

Drawer balances sum only cash journal lines explicitly assigned to the authenticated employee. Historical entries remain unassigned; no employee attribution is inferred. Cash posting and other future cash writers must populate `drawer_user_id` before their activity appears in this display.

A final read-only review found no material Sales blockers. It confirmed draft/audit-only writes, tenant/versioned settings, both drawer permissions and actor-scoped cash sums, and wholesale-price redaction.

## Checks reported for the `8feb88a`-based tree

| Check | Result |
| --- | --- |
| Formatting, lint, typecheck, and build | Passed on the `8feb88a`-based tree |
| Contracts unit suite | Passed, 223 tests |
| Desktop unit suite | Passed, 608 tests across 52 files |
| Local API unit suite | Host-limited: 695 passed, 12 skipped; one Pharmacy CA/CNG suite failed when Windows denied MachineKey creation with `CngKey.Create`. |
| Local API integration suite | Host-limited: 299 passed, 35 skipped, 16 failed across 350 tests; the failures followed Pharmacy CA/CNG initialization. No Sale Draft, migration, or inventory failure was reported. |
| Sales browser spec | Passed, 34/34 |
| Wider browser/device suite | Pending in the `8feb88a`-based run; one licensed Devices pairing case was blocked in the local CNG chain. |
| CNG verification on supported Windows CI | Pending |
| Certified minimum profile and G-16 | Pending |
## Checks after sync to `1fec386b`

| Check | Result |
| --- | --- |
| Affected migration targets | Passed across targeted runs: 8 affected files and 20 distinct tests across sequential runs. |
| Desktop packaged smoke | Passed, 3/3 with exit 0 on the existing package; fresh starts took 7,006 ms and 9,949 ms, and warm restart passed. |
| Full desktop browser suite | Initial 184-scenario run: 142 passed, 2 failed, 1 skipped, 39 not run; no aggregate rerun was completed. |
| Sales scenarios | Passed, 34/34; the after screenshots above are from the successful Sales run. |
| Purchasing browser file after test correction | Passed, 47/51; four opt-in cases were skipped: T01, T02, T03, and the G-16 `REFERENCE_VOLUME` case. |
| Devices browser coverage | Five device-dependent scenarios remain unavailable on this host because Pharmacy CA MachineKey creation was denied by Windows. |
| Final local checks | Steps 45–48 passed: format write/check, lint and boundaries across 651 source files, and workspace typecheck. After the one-line Purchasing test edit, step 49 desktop Node TypeScript passed; steps 51–52 full format check and git diff check passed. |
| Supported Windows CNG verification | Pending. |

The initial browser run recorded two failures. One Devices pairing case was host-limited on this machine: Windows denied creation of the Pharmacy CA MachineKey, CA initialization failed, and the API health check returned `ECONNREFUSED`. The other was Purchasing T06 in English light. Axe sampled during the sidebar fade at about 0.692 opacity and measured 3.64:1 for the #7a8891 text composite on white. The Purchasing test now waits for CSS `opacity: 1` before Axe; the separate full-file rerun passed 47 cases with four opt-in skips. This was a test-only timing correction; runtime CSS and the contrast assertion were unchanged.

An earlier packaged smoke exceeded a 15-second startup budget. The later 3/3 run passed with measured starts under 10 seconds; the earlier timeout did not establish a product failure.

The licensed Devices pairing path is host-limited on this machine. Windows denied creation of the Pharmacy CA MachineKey; CA initialization failed, followed by `ECONNREFUSED` from the API health check. This does not indicate a POS product or schema defect. Supported-Windows CNG verification remains outstanding.

## Performance and visual evidence

The [POS performance report](./performance.md) records 1,000 API samples per operation on a development workstation. It reports p95 values of 143.90 ms for product search, 76.55 ms for barcode-to-line, and 45.55 ms for durable draft save. The run used the real local API and PostgreSQL, but did not include the renderer, scanner, LAN, or peripherals. These results do not establish end-to-end acceptance on the certified minimum profile.

Minimum-profile performance remains pending. The reference dataset still requires G-16 confirmation, and the full history and batch workload depends on posting/history capabilities that this issue excludes. The benchmark report records these limits and the recorded machine and dataset details.

## Screenshots

Before: [Sale invoice, English light theme](./before/sale-invoice-en-light.png)

After, selected item panel:

- [English, light](./after/sales-item-panel-1280x800-en-light.png)
- [English, dark](./after/sales-item-panel-1280x800-en-dark.png)
- [Arabic, light](./after/sales-item-panel-1280x800-ar-light.png)
- [Arabic, dark](./after/sales-item-panel-1280x800-ar-dark.png)

After, presentation settings:

- [English, light](./after/sales-presentation-modal-en-light.png)
- [English, dark](./after/sales-presentation-modal-en-dark.png)
- [Arabic, light](./after/sales-presentation-modal-ar-light.png)
- [Arabic, dark](./after/sales-presentation-modal-ar-dark.png)
- [Settings at 200 percent](./after/sales-presentation-fields-en-light-200-percent.png)
- [Quick-access category editing](./after/sales-presentation-quick-access-en-light.png)
