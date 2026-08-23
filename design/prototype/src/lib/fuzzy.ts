// Substring + Levenshtein fuzzy matching for medicine pickers.
// Score: exact substring => distance 0. Otherwise min edit distance between
// query and any word/prefix window in the haystack. Lower is better.

function normalize(s: string) {
  return (s || "").toLowerCase().trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Returns a score (lower = better). Substring hit wins. */
export function fuzzyScore(query: string, haystack: string): number {
  const q = normalize(query);
  const h = normalize(haystack);
  if (!q) return 0;
  if (!h) return 999;
  if (h.includes(q)) return 0;
  // Windowed Levenshtein against each whitespace-separated token & full string.
  const tokens = h.split(/\s+/).filter(Boolean);
  let best = levenshtein(q, h.slice(0, Math.min(h.length, q.length + 3)));
  for (const t of tokens) {
    best = Math.min(best, levenshtein(q, t));
    if (t.length > q.length) {
      // sliding window inside long tokens
      for (let i = 0; i + q.length <= t.length; i++) {
        best = Math.min(best, levenshtein(q, t.slice(i, i + q.length)));
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

export type Scored<T> = { item: T; score: number };

/** Filter + rank. Threshold defaults to a lenient 2-edit tolerance. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  fields: (t: T) => string[],
  opts: { limit?: number; threshold?: number } = {},
): Scored<T>[] {
  const q = normalize(query);
  if (!q) return items.slice(0, opts.limit ?? items.length).map((item) => ({ item, score: 0 }));
  const threshold = opts.threshold ?? Math.max(2, Math.floor(q.length / 4));
  const out: Scored<T>[] = [];
  for (const item of items) {
    let best = Infinity;
    for (const f of fields(item)) {
      const s = fuzzyScore(q, f);
      if (s < best) best = s;
      if (best === 0) break;
    }
    if (best <= threshold) out.push({ item, score: best });
  }
  out.sort((a, b) => a.score - b.score);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Nearest single suggestion (for "Did you mean?" hint). */
export function nearestSuggestion<T>(
  query: string,
  items: T[],
  fields: (t: T) => string[],
): { item: T; score: number } | null {
  const q = normalize(query);
  if (!q || items.length === 0) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    for (const f of fields(item)) {
      const s = fuzzyScore(q, f);
      if (!best || s < best.score) best = { item, score: s };
      if (best.score === 0) return best;
    }
  }
  return best && best.score <= Math.max(3, Math.floor(q.length / 2)) ? best : null;
}
