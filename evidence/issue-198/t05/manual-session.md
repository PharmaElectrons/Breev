# T05 interactive session

The original headed browser is retained after the master-edit/restart stage;
the stakeholder used its Adjustment and reported the save defect described in
[the repair record](evidence-save-defect.md). It uses the production Desktop renderer, real local API
and a newly initialized task-only PostgreSQL 18 cluster on `127.0.0.1:5554`.
This is a renderer/API acceptance session, not packaged Electron proof.

Session root:
`P:\Projects\PharmaElectrons\.scratch\runtime\t05-manual-ff757481a092404eb86707488fa529e8`

- `manual.log`: fixture startup and stage progress.
- `manual-ready.png`: prepared draft capture before manual work.
- `postgres/`, `postgres.log`: retained disposable database.
- `t05.manual.test.ts`, `playwright.config.ts`: exact generated fixture.
- `master-before-after.json`: generated after the operator Posted the primary
  invoice and Resumed the first pause. It records equal historical responses
  before and after real Product/Supplier edits and API restart.

Two drafts are independent: `MANUAL-T05-REVIEW` for Post/immutable review and
`MANUAL-T05-CORRECTION` for intentional Product/unit correction. Twenty-two
posted `MANUAL-T05-NAV-*` invoices provide scroll/navigation fixtures.

Keep Inspector paused during manual work. Refresh the Breev page once before
starting to load the final renderer bundle, after saving/cancelling any active
edit. First Resume waits for the primary invoice to be posted, changes current
masters through the real API, restarts that API and proves historical response
equality. It then pauses again for navigation/visibility checks. Resume is
fixture control and never stakeholder PASS. Final Resume ends the session;
the database and logs remain retained. See [the detailed steps](manual-test.md).

The distinct T04 cluster on 5553 and earlier manual fixtures remain preserved.
Do not reset their schemas or stop unrelated application/database processes.
T05 subsequently received explicit PASS after repair; see
[the checkpoint](manual-checkpoint.md). The original process still runs the
pre-repair API. A separate retry process on 5555 runs the corrected API; do not
confuse the two or use either manual cluster for regression-suite schema resets.

