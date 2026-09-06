# Breev release runbook

Use this runbook after reading the repository baseline, `docs/workflows.md`, `docs/architecture.md`, `docs/open-decisions.md` G-07, and ADR 0004.

## 1. Establish the release identity

1. Fetch `origin` and verify `dev`, `main`, and tags without changing the user's working tree.
2. Confirm no existing tag or GitHub Release uses the intended version.
3. Review `main..dev`, merged pull requests, labels, and `CHANGELOG.md`. Use an explicit user version when supplied; otherwise apply the SemVer rule in `SKILL.md`.
4. Use today's ISO date for the changelog release heading.

## 2. Prepare from clean `origin/dev`

Use a clean, disposable Git worktree when the active checkout is dirty. Resolve and verify its absolute path before later cleanup.

Update only:

- root `package.json` version;
- `apps/desktop/package.json` version;
- `CHANGELOG.md`, retaining an empty `[Unreleased]` section and moving client-visible changes into `## [VERSION] - YYYY-MM-DD`;
- `pnpm-lock.yaml` only if the workspace version is represented there.

Write changelog entries for users and support. Group meaningful changes under Added, Changed, Fixed, Security, or Removed; omit internal commit noise. Validate:

```powershell
pnpm install --frozen-lockfile
pnpm check:release-version
pnpm test:release-tooling
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit
git diff --check
```

Classify unrelated baseline failures precisely. Do not weaken a test or include unrelated fixes in the release metadata commit.

Commit only the named version/changelog files with `chore(release): prepare vVERSION`. Synchronize again and push the exact commit to `dev`; reject and re-evaluate on a non-fast-forward race.

## 3. Obtain protected-main approval

Create or reuse one pull request from `dev` to `main` titled `Release vVERSION`. Its body must summarize the changelog, identify unsigned development status, list verification evidence, and state that tagging occurs only after merge.

Wait for required checks and one teammate approval. Enable squash auto-merge if repository settings allow it. Never self-approve or alter the ruleset. After merge, fetch `main` and verify:

- the merge result is contained in `origin/main`;
- root and desktop versions still equal `VERSION`;
- the dated changelog section remains present;
- `node tooling/release/verify-version.mjs --tag vVERSION` passes.

## 4. Tag and monitor

Abort if `vVERSION` exists locally or remotely. Create an annotated tag on the exact verified `origin/main` commit and push only that tag:

```powershell
git tag -a vVERSION MAIN_SHA -m "Breev vVERSION"
git push origin refs/tags/vVERSION
```

Locate the `Release unsigned Windows test installer` run for that tag. Follow it until terminal state. On failure, inspect the failed job and logs, classify the failure, and fix forward with a higher version if release identity or assets already exist. Rerun only an infrastructure failure that cannot change release bytes or identity.

## 5. Verify the draft

The resulting GitHub Release must be both draft and prerelease, titled as an unsigned development test, and target the tagged `main` SHA. It must contain only:

- `BreevSetup.exe`;
- `BreevSetup.exe.blockmap`;
- `SHA256SUMS.txt`;
- `fuses.json`;
- `release-metadata.json`;
- GitHub provenance attestations associated with those subjects.

Download the assets to a disposable directory and run the SHA-256 manifest check. Inspect metadata for the exact tag, version, source SHA, payload lock, workflow run, unsigned development mode, and `publishable: false`. Retain the draft for internal testing. Windows SmartScreen or unknown-publisher warnings are expected.

## 6. Stop conditions and recovery

- If review is pending, leave auto-merge enabled when safe and report the PR link and required reviewer action.
- If checks fail, do not merge or tag.
- If the tag exists but no run started, inspect workflow presence on the tagged commit and the Actions event before changing anything.
- If a draft or asset already exists, do not overwrite it. Inspect the partial state; delete only with explicit user authorization when no distributed artifact depends on it, otherwise issue a higher patch version.
- Never move or recreate a protected tag.
- Never publish an unsigned development draft. Production publication requires the separately approved signing workflow and release evidence.
