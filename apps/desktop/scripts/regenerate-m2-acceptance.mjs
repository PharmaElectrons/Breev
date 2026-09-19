import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// Publishing the tracked milestone 2 acceptance bundle is a deliberate,
// explicit action, never a side effect of an ordinary acceptance run (see
// apps/desktop/test/acceptance/evidence-path.ts). This script sets the opt-in
// env var so the harness writes its transcript and screenshots into
// evidence/issue-59/acceptance/ instead of the git-ignored test-results tree,
// then — because a run that fails partway must never leave a partially
// regenerated bundle in the working tree — restores that directory on any
// failure.
//
// The restore does the work in this order, and the order matters because the
// bundle is untracked until the milestone commit lands:
//
//   1. a temporary copy taken before the run is put back over the directory.
//      This is what actually protects an untracked bundle: `git checkout`
//      knows nothing about files git has never seen, so an overwritten PNG
//      would otherwise stay overwritten.
//   2. `git checkout` restores whatever is tracked — which is nothing today
//      and everything once the bundle is committed.
//   3. files that did not exist before the run are deleted.
//
// A failed attempt therefore cannot destroy a previously good bundle, whether
// or not it has been committed yet.
//
// `--allow-recorded-failures` is for the case where a failing assertion IS the
// evidence: the build does not do what a clause or scope item says, the harness
// keeps the assertion, and the transcript has to carry that verdict. The flag
// keeps the bundle only when the run was *complete* — every record id listed in
// each record's `flowsExpected` is present — so a run that stopped early is
// still reverted. It never suppresses the failure: the exit status is the
// harness's own, and the failing records are named on the way out.

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const desktopRoot = path.resolve(import.meta.dirname, "..");
const bundle = path.join(repositoryRoot, "evidence/issue-59/acceptance");
const bundleRelative = "evidence/issue-59/acceptance";

const allowRecordedFailures = process.argv.includes(
  "--allow-recorded-failures",
);
const before = listFiles(bundle);
const snapshot =
  before.size === 0
    ? null
    : mkdtempSync(path.join(os.tmpdir(), "breev-m2-acceptance-bundle-"));
if (snapshot !== null) {
  cpSync(bundle, snapshot, { recursive: true });
}

// Resolve Playwright's own CLI entry point and run it with this Node, rather
// than a bare `playwright` through a shell: no PATH lookup, no shell quoting,
// and no deprecation warning about unescaped arguments.
// `@playwright/test` is the package whose `bin` is the runner, and `./cli` is
// the subpath its `exports` map publishes.
const playwrightCli = createRequire(
  path.join(desktopRoot, "package.json"),
).resolve("@playwright/test/cli");

const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", "--config", "playwright.acceptance.config.ts"],
  {
    cwd: desktopRoot,
    env: { ...process.env, BREEV_M2_ACCEPTANCE_EVIDENCE: "1" },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0 && allowRecordedFailures) {
  const complete = describeCompleteness();
  if (complete.missing.length === 0) {
    console.warn(
      "[regenerate-m2-acceptance] The harness reported failures and " +
        "--allow-recorded-failures was given. Every expected flow ran, so the " +
        "bundle is kept as the record of those failures.\n" +
        `  failing records: ${complete.failing.join(", ") || "(none in the transcript)"}`,
    );
    if (snapshot !== null) {
      rmSync(snapshot, { force: true, recursive: true });
    }
    process.exit(result.status ?? 1);
  }
  console.error(
    "[regenerate-m2-acceptance] --allow-recorded-failures was given, but the " +
      `run did not reach every expected flow (missing: ${complete.missing.join(", ")}). ` +
      "A partial bundle is not a record, so it is being restored.",
  );
}

if (result.status !== 0) {
  console.error(
    "[regenerate-m2-acceptance] The acceptance harness failed, so " +
      `${bundleRelative} may hold a partial regeneration. Restoring it.`,
  );
  const revert = spawnSync("git", ["checkout", "--", bundleRelative], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (revert.status !== 0) {
    console.error(
      "[regenerate-m2-acceptance] No tracked files to restore there, or the " +
        "restore failed; removing whatever this run created instead.",
    );
  }
  for (const file of listFiles(bundle)) {
    if (!before.has(file)) {
      rmSync(file, { force: true });
    }
  }
  if (snapshot !== null) {
    cpSync(snapshot, bundle, { recursive: true });
    rmSync(snapshot, { force: true, recursive: true });
  }
  console.error(
    `[regenerate-m2-acceptance] Check \`git status\` under ${bundleRelative} ` +
      "before committing anything.",
  );
  process.exit(result.status ?? 1);
}

if (snapshot !== null) {
  rmSync(snapshot, { force: true, recursive: true });
}

console.log(
  `[regenerate-m2-acceptance] Bundle regenerated. Review \`git status\` and ` +
    `\`git diff\` under ${bundleRelative} before committing.`,
);

/**
 * Reads the transcript the run just wrote and reports which expected flows are
 * missing and which records failed. A run that did not reach every flow its own
 * records say to expect is partial, whatever its exit status.
 */
function describeCompleteness() {
  let records;
  try {
    records = JSON.parse(
      readFileSync(path.join(bundle, "transcript.json"), "utf8"),
    );
  } catch {
    return { failing: [], missing: ["(no transcript was written)"] };
  }
  const present = new Set(records.map((record) => record.id));
  const expected = new Set(records.flatMap((record) => record.flowsExpected));
  return {
    failing: records
      .filter((record) => record.verdict !== "pass")
      .map((record) => record.id),
    missing: [...expected].filter((id) => !present.has(id)),
  };
}

function listFiles(directory) {
  const files = new Set();
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const candidate = path.join(directory, entry);
    if (statSync(candidate).isFile()) {
      files.add(candidate);
    }
  }
  return files;
}
