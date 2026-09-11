import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Keyboard input is only meaningful once focus has settled where the screen
 * put it. The renderer commits focus together with the view it belongs to
 * (see `src/renderer/src/committed-focus.ts`), so a browser test synchronizes
 * on that committed state with an auto-waiting `toBeFocused()` assertion and
 * never on a sleep, a frame, or a raw DOM query.
 *
 * Rules for renderer browser tests:
 *
 * - After any action that switches views or closes a dialog, assert the
 *   control the screen restores focus to with `toBeFocused()` before moving
 *   focus yourself or pressing a key.
 * - Send a key only through this helper (or after your own `toBeFocused()`
 *   assertion), never straight after `locator.focus()`.
 * - Read the DOM through locators, which wait for the element, not through
 *   `page.evaluate` with `document.querySelector`, which sees whatever is in
 *   the document at that instant, including a transient re-render.
 */
export async function pressKeyOnFocused(
  page: Page,
  control: Locator,
  key: string,
): Promise<void> {
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}
