import { spawnSync } from "node:child_process";
import path from "node:path";

// Regenerating the tracked evidence/ audit record is a deliberate, explicit
// action, never a side effect of an ordinary `test:browser` run (see
// apps/desktop/test/browser/evidence-path.ts). This script sets the opt-in
// env var so the browser suite writes screenshots into evidence/ instead of
// the git-ignored test-results/evidence tree, then — because a run that
// fails partway must never leave a partially regenerated set committed to
// the working tree — reverts evidence/ with `git checkout` on any failure.
// A passing run leaves the refreshed files in evidence/ for review.

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const desktopRoot = path.resolve(import.meta.dirname, "..");

const result = spawnSync(
  "playwright",
  ["test", "--config", "playwright.browser.config.ts"],
  {
    cwd: desktopRoot,
    env: { ...process.env, BREEV_REGENERATE_EVIDENCE: "1" },
    shell: true,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "[regenerate-evidence] The browser suite failed, so evidence/ may hold " +
      "a partial regeneration. Reverting evidence/ to its last committed " +
      "state.",
  );
  const revert = spawnSync("git", ["checkout", "--", "evidence/"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (revert.status !== 0) {
    console.error(
      "[regenerate-evidence] Could not revert evidence/ automatically — " +
        "check `git status` before committing anything under evidence/.",
    );
  }
  process.exit(result.status ?? 1);
}

console.log(
  "[regenerate-evidence] Evidence regenerated. Review `git status` and " +
    "`git diff` under evidence/ before committing.",
);
