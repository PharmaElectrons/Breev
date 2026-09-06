---
name: breev-release
description: Prepare and orchestrate a Breev Windows release when the user asks to release Breev, cut a version, create a release, or ship the desktop installer. Covers SemVer and changelog preparation, dev-to-main review, protected tagging, GitHub Actions monitoring, and draft verification. Do not use for ordinary CI fixes or local packaging alone.
---

# Breev Release

Turn a release request into the complete Breev release-control flow while preserving branch protection and unrelated work.

## Current contract

- `dev` is the default development branch; protected `main` contains reviewed release candidates.
- An exact protected `vMAJOR.MINOR.PATCH` tag on a commit contained in `main` triggers `.github/workflows/release.yml`.
- Root and desktop versions, tag, packaged version, and the dated `CHANGELOG.md` section must match.
- The current pre-production workflow builds an unsigned draft prerelease with no secrets. It is flow-validation evidence only and must never be published as a stable client release.
- A request to release authorizes preparation, pushing the release metadata to `dev`, opening the `dev` to `main` PR, enabling safe auto-merge when available, tagging the approved merge, monitoring CI, and verifying the draft. It does not authorize bypassing review or publishing an unsigned draft.
- Production signing, stable publication, and auto-update remain blocked until G-07 closes them.

## Execute

Read [the release runbook](references/release-runbook.md) completely, then execute it rather than merely describing it.

If the user supplies a version, use it after validation. Otherwise inspect changes since the latest stable tag and select the next SemVer: patch for compatible fixes and maintenance, minor for compatible user-visible capability, and major for incompatible stable behavior. Before `1.0.0`, treat incompatible development behavior as a minor bump unless an established public contract requires a major bump. Ask only if the evidence supports materially different versions.

Do not use a dirty checkout to assemble release metadata. Preserve unrelated changes by using a clean worktree or fresh checkout from `origin/dev`. Never stage with `git add .`.

The required teammate approval on `main` is a real human gate. Never approve the agent's own PR, add a bypass actor, lower the ruleset, move a tag, replace release assets, or publish an unsigned draft to make the flow complete. Use auto-merge when supported, wait when practical, and report the exact approval or check still required when the gate remains pending.

After the tag is pushed, follow the Actions run through completion. Verify the draft prerelease, asset allowlist, checksums, source SHA, version, payload-lock hash, fuse evidence, and `release-metadata.json` fields `releaseKind: development-test`, `publishable: false`, and `signingMode: unsigned-development`.

Finish with links to the release PR, tag, Actions run, and draft Release plus a concise pass/fail account. A failed or partial release is not success.
