import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Keyboard operation of the packaged renderer.
 *
 * The renderer commits focus together with the view it belongs to (see
 * `src/renderer/src/committed-focus.ts`), so every helper here asserts with an
 * auto-waiting `toBeFocused()` before it sends a key and never synchronizes on
 * a sleep or a frame. Nothing in this module clicks: an acceptance pass has to
 * be reachable by keyboard alone, so a control is reached by focusing it and
 * operated by pressing a key, exactly as a cashier would.
 */

/**
 * Puts focus on a control and waits until it is actually there.
 *
 * The renderer moves focus itself in the commit that renders a view
 * (`committed-focus.ts`), so a focus request issued while such a commit is in
 * flight can be overwritten a moment later. Asking again until focus settles
 * is what a person at the keyboard does, and it keeps the harness's own
 * navigation from being mistaken for a product assertion: where the product is
 * supposed to place focus, the flow asserts that with its own `toBeFocused`.
 */
export async function focusControl(control: Locator): Promise<void> {
  await expect(async () => {
    await control.focus();
    await expect(control).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

export async function pressOn(
  page: Page,
  control: Locator,
  key: string,
): Promise<void> {
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}

/** Focus the control and press Enter — the keyboard equivalent of pressing it. */
export async function activate(page: Page, control: Locator): Promise<void> {
  await focusControl(control);
  await page.keyboard.press("Enter");
}

export async function typeInto(
  page: Page,
  control: Locator,
  text: string,
): Promise<void> {
  await focusControl(control);
  await page.keyboard.type(text);
}

/** Select the whole field and type over it, leaving focus where it was. */
export async function replaceValue(
  page: Page,
  control: Locator,
  text: string,
): Promise<void> {
  await focusControl(control);
  await page.keyboard.press("ControlOrMeta+A");
  if (text === "") {
    await page.keyboard.press("Delete");
  } else {
    await page.keyboard.type(text);
  }
  await expect(control).toHaveValue(text);
}

/**
 * Moves a native `<select>` to one option with the arrow keys, which is how a
 * closed select is operated by keyboard on Windows. The option list is read
 * first so the walk is a known number of presses rather than a guess.
 */
export async function selectByKeyboard(
  page: Page,
  select: Locator,
  value: string,
): Promise<void> {
  await focusControl(select);
  // The Node test project carries no DOM library, so the option and select
  // shapes are named structurally rather than through `lib.dom`.
  const values = await select
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option as unknown as { value: string }).value),
    );
  const target = values.indexOf(value);
  if (target === -1) {
    throw new Error(
      `The select has no option ${value}; it offers ${values.join(", ")}`,
    );
  }
  const current = await select.evaluate(
    (element) =>
      (element as unknown as { selectedIndex: number }).selectedIndex,
  );
  const key = target > current ? "ArrowDown" : "ArrowUp";
  for (let step = 0; step < Math.abs(target - current); step += 1) {
    await page.keyboard.press(key);
  }
  await expect(select).toHaveValue(value);
}

/**
 * Enters an ISO date into a native date control.
 *
 * A native date control has no locale-stable key sequence: the segment order
 * follows the browser's own locale, not the document's. The helper types the
 * date first and only falls back to the control's value API when the typed
 * sequence did not land on the requested date, and it reports which path it
 * took so the transcript can say so rather than overclaim.
 */
export async function enterDate(
  page: Page,
  control: Locator,
  isoDate: string,
): Promise<"typed" | "value-api"> {
  const [year = "", month = "", day = ""] = isoDate.split("-");
  await focusControl(control);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(`${month}${day}${year}`);
  if ((await control.inputValue()) === isoDate) {
    return "typed";
  }
  await control.fill(isoDate);
  await expect(control).toHaveValue(isoDate);
  return "value-api";
}

/**
 * The renderer formats every number with `Intl.NumberFormat` for the active
 * locale (`src/renderer/src/preferences.ts`), so Arabic shows Arabic-Indic
 * digits. Assertions compare against the same formatting rather than against
 * Latin digits the Arabic screen never shows.
 */
export function localeDigits(
  value: bigint | number,
  locale: "ar" | "en",
): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-IQ" : "en-IQ").format(
    value,
  );
}

/**
 * Arabic letter mark, the two directional marks, and the two isolate
 * terminators, named by code point so they stay visible in the source.
 */
const BIDI_MARKS = new RegExp(
  `[${[0x06_1c, 0x20_0e, 0x20_0f, 0x20_68, 0x20_69]
    .map((code) => String.fromCodePoint(code))
    .join("")}]`,
  "gu",
);

/** Bidi isolation and direction marks carry no meaning for a text assertion. */
export function stripBidiMarks(value: string): string {
  return value.replace(BIDI_MARKS, "");
}
