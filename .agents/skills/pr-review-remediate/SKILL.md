---
name: pr-review-remediate
description: >-
  Perform an end-to-end technical review, audit, gap analysis, bounded remediation, and merge on Pull Requests.
  Use this skill whenever asked to review, audit, verify, remediate, or merge a PR, whether given a PR alone or
  a PR together with an Issue. Enforces empirical verification first, failure classification, local git safety,
  circuit breakers on fixes, compliance reporting, and clean integration into the base branch.
---

# PR Review, Audit & Remediation Lifecycle

This skill equips the agent to perform an authoritative, end-to-end QA, systems audit, and remediation loop on a Pull Request.

It integrates the repository's foundational rules and complete GitHub automation:
- **Project Rules & Invariants**: See [references/project-rules.md](references/project-rules.md) for engineering agreements from `AGENTS.md`, `docs/quality.md`, `docs/architecture.md`, and local issue tracking conventions (`.scratch/`).
- **GitHub CLI Operations**: See [references/github-cli-instructions.md](references/github-cli-instructions.md) for complete `gh` and `git` command sequences, CI watching, and conflict handling.

It supports two operating modes:
- **PR Alone**: Deduces context, detects linked issues, verifies diff against base branch, audits invariants, fixes defects, and merges.
- **PR + Issue Combined**: Ingests issue acceptance criteria and local specifications, performs gap analysis, resolves defects, updates issue specs, merges PR, and closes the issue.

---

## Intake & Scope Extraction

Begin by determining whether the input is **PR Alone** or **PR + Issue**.

### Case A: PR Alone
1. Fetch PR details using the GitHub CLI:
   ```bash
   gh pr view <PR_NUMBER> --json number,title,body,headRefName,baseRefName,isDraft,mergeable
   ```
2. Inspect the PR title, body, and commit messages for linked issue references (e.g., `fixes #123`, `closes #123`, or `issue-123`).
   - If an issue is referenced, fetch it: `gh issue view <ISSUE_NUMBER>` and check for `.scratch/issue-<ISSUE_NUMBER>/spec.md`.
   - If no issue is referenced, the PR description and acceptance criteria within the PR body serve as the primary source of truth.

### Case B: PR + Issue Combined
1. Fetch PR details:
   ```bash
   gh pr view <PR_NUMBER> --json number,title,body,headRefName,baseRefName,isDraft,mergeable
   ```
2. Fetch Issue details and local specification:
   ```bash
   gh issue view <ISSUE_NUMBER>
   ```
   Check for local spec: `.scratch/issue-<ISSUE_NUMBER>/spec.md` (or `.scratch/<slug>/spec.md`).
3. Extract all explicit **Acceptance Scenarios**, **Non-functional Requirements**, and **Exclusions**.

---

## Phase 1: Local Safety & Branch Alignment

Never modify branches without establishing a recovery point.

1. **Fetch and checkout**:
   ```bash
   git fetch origin <BASE_BRANCH> <HEAD_BRANCH>
   git checkout <HEAD_BRANCH>
   ```
2. **Create local safety backup reference**:
   ```bash
   git branch backup/pr-<PR_NUMBER>-pre-review
   ```
3. **Align with base integration branch**:
   ```bash
   git merge origin/<BASE_BRANCH>
   ```
   If trivial syntax merge conflicts exist, resolve them cleanly. If architectural conflicts exist, halt and report.

---

## Phase 2: Empirical Baseline & Failure Classification

**Run automated verification BEFORE reading the code.** Empirical test results ground the audit in facts.

1. **Run Static Validation**:
   ```bash
   pnpm lint
   pnpm format:check
   pnpm typecheck
   pnpm build
   ```
2. **Run Real Seam & Workspace Tests**:
   ```bash
   pnpm test:unit
   pnpm test:integration
   pnpm test:boundaries
   ```
3. **Run Smoke & End-to-End Suites (if touched)**:
   ```bash
   pnpm test:browser
   pnpm test:smoke
   ```
4. **Classify Any Failures**:
   If any check fails, consult [references/failure-classification.md](references/failure-classification.md):
   - **Product / Code Defect**: Proceed to remediation.
   - **Environment / Missing Prerequisite** (e.g. local PostgreSQL Windows service down, `BREEV_TEST_POSTGRES_ADMIN_URL` unset): Diagnose environment. **NEVER** edit application code to bypass an environment failure.
   - **Host / Sandbox Limitation** (e.g. Windows DPAPI, symlink denial): Escalate to Windows CI (`gh workflow run Verify --ref <HEAD_BRANCH>`).
   - **Test Drift**: Update outdated test assertion if the requirement intentionally changed.

---

## Phase 3: In-Depth Gap Analysis & Invariant Audit

Inspect the git diff (`git diff origin/<BASE_BRANCH>...HEAD`) against acceptance criteria across 5 core dimensions:

1. **Functional Completeness**:
   - Are all acceptance scenarios from the issue or PR description satisfied?
   - Are edge cases handled (offline, timeouts, invalid input, duplicate calls)?
2. **Data & Transaction Invariants**:
   - Atomic multi-table updates (debits equal credits, stock conservation).
   - Immutable historical records (posted invoices/receipts reject mutations).
   - Real PostgreSQL persistence (triggers, locks, schemas, RLS).
3. **Security & Boundary Isolation**:
   - Renderer isolation (zero raw Node/filesystem access from UI).
   - Preload IPC guardrails (Zod schema validation, rate-limiting, sender verification).
   - Zero credential or patient PII leakage in diagnostics, logs, or exports.
4. **Performance, Sizing & Artifact Targets**:
   - Measure actual bundle/payload sizes or runtimes.
   - **Rule on Spec Deviations**: If a historical speculative target (e.g., `< 285 MB`) conflicts with essential runtime requirements (ICU catalogs, timezone data, Node runtime), **DO NOT prune critical runtime files**. Classify as an *Accepted Technical Trade-off* requiring human note, not a bug to hack away.
5. **Accessibility & Parity**:
   - Parity between Arabic RTL and English LTR layouts.
   - WCAG 2.2 AA standards (visible focus, semantic roles, Narrator support).

Generate a structured findings matrix using [references/compliance-matrix-template.md](references/compliance-matrix-template.md) (Template 1).

---

## Phase 4: Decision Gate & Controlled Remediation

Evaluate the audit findings:

### Decision Paths:
- **Path A: Clean / Fully Passing**: Skip remediation, proceed directly to Phase 5.
- **Path B: Spec / Architectural Deviation Detected**: If addressing an issue requires dropping features, changing security boundaries, or accepting unachievable targets, **STOP**, post the Compliance Matrix as a review comment (`gh pr review <PR_NUMBER> --comment --body "<FINDINGS>"`), and wait for user direction.
- **Path C: Deterministic Functional Defects** (compiler errors, failing unit/integration tests, broken exports):
  Proceed to post the initial reviewer findings and enter the remediation loop.

### Step 4.1: Submit Initial Reviewer Reply (Findings & Plan)
Post the initial audit findings on the PR using GitHub's native review system:
```bash
gh pr review <PR_NUMBER> --comment --body "<INITIAL_FINDINGS_AND_COMPLIANCE_MATRIX>"
```
*(Use Template 1 from `compliance-matrix-template.md`. If GitHub prevents self-review because the token authored the PR, fallback to `gh pr comment`).*

### Step 4.2: Controlled Remediation Rules (Circuit Breaker)
Consult [references/remediation-playbook.md](references/remediation-playbook.md):
1. **Max 2 Iterations**: If the fix does not pass tests within 2 attempts, revert via `git reset --hard backup/pr-<PR_NUMBER>-pre-review`, halt, and report the blocker.
2. **Keep Iterations Local**: Do NOT push intermediate broken commits or post comment spam on GitHub.
3. **Apply Minimal Cohesive Fix**: Place fixes beside owning code; preserve unrelated comments.
4. **Run Regression Canary**: Run the failing test, then run `pnpm verify`.
5. **Clean Commit & Push**:
   ```bash
   git add -A
   git commit -m "fix(<scope>): resolve review findings and test regressions"
   git push origin <HEAD_BRANCH>
   ```

---

## Phase 5: Release Sign-Off & Land into Base Branch

Once all local tests and CI checks are green:

1. **Run Authoritative Verification**:
   ```bash
   pnpm verify
   ```
2. **Mark PR Ready for Review (if draft)**:
   ```bash
   gh pr ready <PR_NUMBER>
   ```
3. **Submit Final Reviewer Reply (Resolution & Approval)**:
   Post the update and formal approval on the PR using Template 2 from `compliance-matrix-template.md`:
   ```bash
   gh pr review <PR_NUMBER> --approve --body "<REMEDIATION_SUMMARY_AND_APPROVAL_PROOF>"
   ```
   *(If GitHub prevents self-review, fallback to `gh pr comment`).*
4. **Merge to Base Branch**:
   ```bash
   gh pr merge <PR_NUMBER> --merge --delete-branch
   ```
   *(Or `--squash` if repo policy dictates squash merges).*

---

## Phase 6: Issue Reconciliation & Documentation

If a linked issue was resolved:
1. **Update Local Spec**:
   In `.scratch/issue-<ISSUE_NUMBER>/spec.md`:
   - Set `Status: resolved`.
   - Update `## Completion evidence` with test run IDs, metrics, and commit hashes.
   - Append resolution summary under `## Answer`.
2. **Close GitHub Issue**:
   ```bash
   gh issue comment <ISSUE_NUMBER> --body "Resolved via PR #<PR_NUMBER>. All acceptance scenarios verified passing."
   gh issue close <ISSUE_NUMBER>
   ```
3. **Clean Up Local Backup**:
   ```bash
   git branch -D backup/pr-<PR_NUMBER>-pre-review
   ```
