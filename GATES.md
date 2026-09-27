# Gates: compact Products workspace frame

OWNS: GATES.md, apps/desktop/src/renderer/src/catalog-messages.ts, apps/desktop/src/renderer/src/catalog-screen.tsx, apps/desktop/src/renderer/src/identity-state-provider.tsx, apps/desktop/src/renderer/src/product-form-drafts.ts, apps/desktop/src/renderer/src/product-form.tsx, apps/desktop/src/renderer/src/product-movement-history.tsx, apps/desktop/src/renderer/src/product-record.tsx, apps/desktop/src/renderer/src/styles.css, apps/desktop/test/browser/catalog.browser.test.ts, apps/desktop/test/browser/inventory.browser.test.ts, docs/traceability.md, today/2026-09-27-plan.md, today/2026-09-27-products-redesign.md

Scope: Implement the compact Products redesign through two-step create, edit-ready selected cards, bounded movement history, and archive/merge while preserving catalog authority boundaries and existing Sales edits.

- [x] G1: Catalog routes, contracts, permission enforcement, movement read contract, browser coverage, visual authority, and starting working-tree changes are reconciled with the plan.
      EVIDENCE: Reviewed navigation.ts and catalog-screen.tsx route handling; contracts/local-rest/index.ts product and movement contracts; catalog.controller.ts permission checks; catalog.browser.test.ts existing search/create/archive/merge/theme coverage; docs/traceability.md visual evidence; git status showing only five Sales files modified before this task.

- [x] G2: Desktop renderer typecheck succeeds with the compact frame changes.
      CHECK: pnpm --filter @breev/desktop typecheck && echo CATALOG_FRAME_TYPECHECK_OK
      EXPECT: CATALOG_FRAME_TYPECHECK_OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=f18f93b9dbb6b7b88435d0976b29061a6ee2cba2e966ef2f5be8d0bc62453646; exit=0; EXPECT=matched; output-sha256=9430d63b2e71e2a09c1794a40df3922e64fbe4b87725a99b6522e8c6d89aa668; output-bytes=108; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries

- [x] G3: The Local API reports healthy against the disposable PostgreSQL setup used by its existing integration test.
      CHECK: pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts test/health.integration.test.ts && echo LOCAL_API_HEALTH_TEST_PASSED
      EXPECT: LOCAL_API_HEALTH_TEST_PASSED
      EVIDENCE: automatic-evidence=v1; definition-sha256=cc1137f47990538dc7f73efed8488f9c3792830987ac287e2dd3bf0ef9abc17d; exit=0; EXPECT=matched; output-sha256=a3c585c5dd7812deb31377667af553d3e6ea82f83d11ba72df99c36933e4897b; output-bytes=261; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries

- [x] G4: Catalog browser coverage passes, including the 1280x800 persistent-action assertion and existing server-backed search flows.
      CHECK: pnpm build && pnpm --filter @breev/desktop exec playwright test test/browser/catalog.browser.test.ts --config playwright.browser.config.ts && echo CATALOG_BROWSER_PASSED
      EXPECT: CATALOG_BROWSER_PASSED
      EVIDENCE: automatic-evidence=v1; definition-sha256=fd551e951ea3283cae05163df29189bc95625e26f6fbe1f16db262195bceb5d0; exit=0; EXPECT=matched; output-sha256=064660a3a965d376f76e91cfc4ebb62876c12216e960cb164c18607e3fc80577; output-bytes=8583; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries

- [x] G5: Changed Catalog renderer, browser test, and tracker files pass the repository formatter; the Catalog CSS selectors are verified without reformatting the shared Sales stylesheet.
      CHECK: pnpm exec prettier --check apps/desktop/src/renderer/src/catalog-messages.ts apps/desktop/src/renderer/src/catalog-screen.tsx apps/desktop/src/renderer/src/identity-state-provider.tsx apps/desktop/src/renderer/src/product-form-drafts.ts apps/desktop/src/renderer/src/product-form.tsx apps/desktop/src/renderer/src/product-movement-history.tsx apps/desktop/src/renderer/src/product-record.tsx apps/desktop/test/browser/catalog.browser.test.ts apps/desktop/test/browser/inventory.browser.test.ts today/2026-09-27-plan.md today/2026-09-27-products-redesign.md && echo CATALOG_FORMAT_CHECK_OK
      EXPECT: CATALOG_FORMAT_CHECK_OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=6abec2622793e657f9e8ed2b1566a05ab223d001c5dcb7fb18543d0ae356a389; exit=0; EXPECT=matched; output-sha256=47b9ce0ddef9299105f071bfa51ae05c023ec1fb5285b4733f45e169e172ee99; output-bytes=91; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries

- [x] G6: The workspace panels scroll independently and persistent actions remain reachable in the target viewport.
      EVIDENCE: The passing Catalog browser run asserts computed 740px workspace height, independently scrollable rail/form, sticky create actions, and selected-record footer visibility at 1280x800. Screenshot review: test-results/evidence/client-prototype-adoption/after/products-create-workspace-1280x800-en-light.png and products-selected-card-1280x800-en-light.png show both panels and actions within the viewport.

- [x] G7: The diff review confirms product styling is scoped and the pre-existing Sales edits remain intact.
      EVIDENCE: Catalog frame selectors are scoped beneath .catalog-workspace/.catalog-form-card/.catalog-record-card, and the Products page overflow override is limited to data-products-workspace. Existing sales-calculator.tsx, sales-invoice-view.tsx, sales-messages.ts, sales-workspace-view.tsx remain separate unchanged-from-task-start worktree entries; the shared styles.css retains their existing Sales hunks alongside the Catalog-only hunks. No Catalog changes were made to those Sales TSX files.

- [x] G8: Product creation uses two steps, preserves values on Back/Continue, shows mode-specific identity inputs and a generated read-only name, and creates only after required unit/pricing fields pass; duplicate barcode denial preserves and focuses the offending value.
      CHECK: pnpm build && pnpm --filter @breev/desktop exec playwright test test/browser/catalog.browser.test.ts --config playwright.browser.config.ts && echo CATALOG_CREATE_FLOW_PASSED
      EXPECT: CATALOG_CREATE_FLOW_PASSED
      EVIDENCE: automatic-evidence=v1; definition-sha256=e896279037b3881c5a1b8d8bffefbc0c267756cbefe55fe3f7ae11687213b843; exit=0; EXPECT=matched; output-sha256=7c474eedfd8e928be5aea7a1bc0c21182ca25cdb3474a0f16025931f2b0dfcc5; output-bytes=8604; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries

- [x] G9: Active products open edit-ready with persistent Save/Cancel; secondary settings, archive/merge confirmation, and error/conflict handling preserve current server contracts.
      CHECK: pnpm build && pnpm --filter @breev/desktop exec playwright test test/browser/catalog.browser.test.ts --config playwright.browser.config.ts --grep "barcode suggest, print|Keyboard packaging and percentage pricing|Invalid package ratio|A network failure preserves an edit|A revision conflict keeps the draft|Archive uses confirmation|Archive and merge actions" && echo CATALOG_EDIT_ACTIONS_PASSED
      EXPECT: CATALOG_EDIT_ACTIONS_PASSED
      EVIDENCE: automatic-evidence=v1; definition-sha256=6d09c01a2ba7b8a3ed380781807153ae306c0900bdfb22142ea4bd0e33524030; exit=0; EXPECT=matched; output-sha256=bbe8d8f6f4d3fb11b36b6d20bf3b0acfbca3622c139e6d1d90f17187bd9b98f2; output-bytes=5659; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries

- [x] G10: Movement history loads only for inventory.review, shows returned movement kinds and redacts valuation when the API denies it; traceability records the UX decision and forbidden Product controls remain absent.
      CHECK: pnpm build && pnpm --filter @breev/desktop exec playwright test test/browser/catalog.browser.test.ts test/browser/inventory.browser.test.ts --config playwright.browser.config.ts && echo CATALOG_HISTORY_BOUNDARIES_PASSED
      EXPECT: CATALOG_HISTORY_BOUNDARIES_PASSED
      EVIDENCE: automatic-evidence=v1; definition-sha256=8da2901289dd48af4af96b08e5146548d7bce8e80ba30aaa9d576d8608c9a022; exit=0; EXPECT=matched; output-sha256=bb38234de5739858d32a680be73ebbc647b75252c296cb25d7e2ecf2d9bbbc98; output-bytes=9546; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries

- [x] G11: Final Catalog checks cover keyboard, focus, Arabic/English themes, small-window and 200% text reflow; changed app/test/docs files pass lint, typecheck, and formatting.
      CHECK: pnpm exec eslint apps/desktop/src/renderer/src/catalog-messages.ts apps/desktop/src/renderer/src/catalog-screen.tsx apps/desktop/src/renderer/src/identity-state-provider.tsx apps/desktop/src/renderer/src/product-form-drafts.ts apps/desktop/src/renderer/src/product-form.tsx apps/desktop/src/renderer/src/product-movement-history.tsx apps/desktop/src/renderer/src/product-record.tsx apps/desktop/test/browser/catalog.browser.test.ts apps/desktop/test/browser/inventory.browser.test.ts && pnpm --filter @breev/desktop typecheck && pnpm exec prettier --check apps/desktop/src/renderer/src/catalog-messages.ts apps/desktop/src/renderer/src/catalog-screen.tsx apps/desktop/src/renderer/src/identity-state-provider.tsx apps/desktop/src/renderer/src/product-form-drafts.ts apps/desktop/src/renderer/src/product-form.tsx apps/desktop/src/renderer/src/product-movement-history.tsx apps/desktop/src/renderer/src/product-record.tsx apps/desktop/test/browser/catalog.browser.test.ts apps/desktop/test/browser/inventory.browser.test.ts docs/traceability.md today/2026-09-27-plan.md today/2026-09-27-products-redesign.md && echo CATALOG_FINAL_CHECKS_PASSED
      EXPECT: CATALOG_FINAL_CHECKS_PASSED
      EVIDENCE: automatic-evidence=v1; definition-sha256=db0e156bd4ef1e6d0dbb2ef3dcc722d01b95772d4ea0e3f1cafefd3e46b4390e; exit=0; EXPECT=matched; output-sha256=4bebaef5e7fb0b8ae41391e087cc9465af72e84f94efd70a0c999b6b3557c560; output-bytes=175; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Cefeldeen-clinic-pos\breef; path=8bcb1601364f/27 entries
