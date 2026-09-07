/**
 * Breev's exact Product-name search rule.
 *
 * Query and stored names take the same deliberately small normalization path:
 * case-fold with JavaScript's Unicode lowercase mapping, remove simple ASCII
 * and Arabic punctuation, collapse whitespace, and trim. Arabic letters are
 * otherwise untouched: this function does not rewrite alef/hamza forms,
 * remove tatweel, or strip diacritics.
 *
 * A normalized query is split on spaces. Each part consumes characters from
 * the normalized name as a subsequence. The cursor never moves backwards, so
 * the next part can begin only after the previous part finished. Matching is
 * neither prefix-anchored nor word-anchored.
 */
const SIMPLE_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~،؛؟]/gu;

export function normalizeProductSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(SIMPLE_PUNCTUATION, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function matchesOrderedProductName(
  storedName: string,
  query: string,
): boolean {
  const normalizedName = Array.from(normalizeProductSearchText(storedName));
  const normalizedQuery = normalizeProductSearchText(query);
  if (normalizedQuery.length === 0) {
    return false;
  }

  const parts = normalizedQuery.split(" ");
  let cursor = 0;

  for (const part of parts) {
    for (const character of part) {
      while (
        cursor < normalizedName.length &&
        normalizedName[cursor] !== character
      ) {
        cursor += 1;
      }
      if (cursor === normalizedName.length) {
        return false;
      }
      cursor += 1;
    }
  }

  return true;
}
