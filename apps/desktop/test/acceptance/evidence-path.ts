import path from "node:path";

/**
 * Where the milestone 2 acceptance harness writes its transcript and its
 * screenshots.
 *
 * The browser suites separate "run the suite" from "regenerate the tracked
 * audit record" (see `test/browser/evidence-path.ts`), because a plain run that
 * overwrites committed PNGs leaves a partially regenerated set in the working
 * tree when it fails partway. This harness keeps the same separation under its
 * own switch: `BREEV_M2_ACCEPTANCE_EVIDENCE=1` publishes into the tracked
 * `evidence/issue-59/acceptance/` bundle, and any other run lands at the same
 * relative path under the git-ignored `test-results/evidence/` tree.
 *
 * The switch alone would still leave a failed publish half-written, so the
 * opt-in is meant to be taken through
 * `pnpm --filter @breev/desktop test:acceptance:m2:publish`
 * (`scripts/regenerate-m2-acceptance.mjs`), which sets it, runs the harness,
 * and on failure restores the bundle — tracked files with `git checkout`, and
 * files the run itself created by deleting them. Setting the variable by hand
 * runs without that safety net.
 */
export function acceptanceEvidencePath(...segments: readonly string[]): string {
  const publish = process.env.BREEV_M2_ACCEPTANCE_EVIDENCE === "1";
  const root = publish
    ? "../../../../evidence"
    : "../../../../test-results/evidence";
  return path.resolve(
    import.meta.dirname,
    root,
    "issue-59",
    "acceptance",
    ...segments,
  );
}
