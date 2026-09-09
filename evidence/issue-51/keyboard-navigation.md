# Posted purchase review keyboard run

- Date: 2026-09-09
- Command: `pnpm --filter @breev/desktop exec playwright test test/browser/purchasing.browser.test.ts --config playwright.browser.config.ts`
- Result: 14 passed (58.1s)
- Scenario: `searches and reviews immutable purchases entirely by keyboard`

The run focused the **Posted invoices** launcher and opened it with Enter, verified
initial focus in search, submitted a search with Enter, opened a result, traversed
stable previous/next navigation and its end announcement, opened and closed the
current Supplier and Item drill-downs with focus restoration, staged Adjustment
and Return routes, closed each layer with Escape, and returned focus to the
launcher. The same run checked that no delete control exists and that axe reports
no dialog violations.

The companion evidence directory contains the posted list and detail at the same
test seam in English and Arabic, in both light and dark themes.
