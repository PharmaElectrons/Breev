export function normalizeSearchQuery(
  query: string | undefined | null,
): string | null {
  if (typeof query !== "string") return null;
  const collapsed = query.trim().replace(/\s+/gu, " ");
  return collapsed.length > 0 ? collapsed : null;
}
