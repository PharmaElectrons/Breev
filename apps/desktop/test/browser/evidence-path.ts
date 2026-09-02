import path from "node:path";

/**
 * Resolves where a browser suite should write an evidence screenshot.
 *
 * Verifying the browser suite and regenerating the tracked `evidence/`
 * audit record used to be the same command: any plain `test:browser` run
 * silently overwrote committed PNGs, and a run that failed partway left a
 * partially regenerated set committed nowhere but sitting dirty in the
 * working tree. Regenerating the tracked record is now a separate,
 * explicit action — `pnpm --filter @breev/desktop test:browser:regenerate-evidence`,
 * which sets `BREEV_REGENERATE_EVIDENCE=1` and, only on a fully passing
 * run, leaves the refreshed files in `evidence/` for review; a failing
 * regeneration run reverts `evidence/` via `git checkout` so a partial
 * result never lingers as a dirty tracked file (see
 * apps/desktop/scripts/regenerate-evidence.mjs).
 *
 * Without that opt-in, the identical screenshot lands under the
 * git-ignored `test-results/evidence` tree at the same relative path, so
 * debugging still gets full captures but a plain suite run never touches
 * git.
 */
export function evidencePath(...segments: readonly string[]): string {
  const regenerate = process.env.BREEV_REGENERATE_EVIDENCE === "1";
  const root = regenerate
    ? "../../../../evidence"
    : "../../../../test-results/evidence";
  return path.resolve(import.meta.dirname, root, ...segments);
}
