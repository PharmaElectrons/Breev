# GitHub CLI (`gh`) & Git Instructions

Complete manual of GitHub CLI (`gh`) and Git commands required during the review, audit, remediation, and merge lifecycle.

---

## 1. Inspection & Scope Extraction

### Pull Request Inspection
```bash
# View PR metadata (title, body, branches, status)
gh pr view <PR_NUMBER> --json number,title,body,headRefName,baseRefName,isDraft,mergeable,state

# View complete PR diff
gh pr diff <PR_NUMBER>

# View files changed in the PR
gh pr diff <PR_NUMBER> --name-only

# Check status of automated checks on the PR
gh pr checks <PR_NUMBER>
```

### Issue Inspection
```bash
# View GitHub issue metadata and description
gh issue view <ISSUE_NUMBER>

# View issue comments
gh issue view <ISSUE_NUMBER> --comments
```

---

## 2. Branch Synchronization & Local Safety

### Checkout & Align
```bash
# Fetch target branches from origin
git fetch origin <BASE_BRANCH> <HEAD_BRANCH>

# Checkout PR branch
git checkout <HEAD_BRANCH>

# Create local safety pointer before modifying state
git branch backup/pr-<PR_NUMBER>-pre-review

# Merge latest base branch to ensure clean integration
git merge origin/<BASE_BRANCH>
```

### Handling Merge Conflicts
- If there are conflicts, inspect them: `git status`
- If conflicts are trivial (e.g. package version increments, formatting), resolve cleanly and run `git commit`.
- If conflicts indicate conflicting architectural changes on the base branch, **STOP and ask the user for direction**.

### Rolling Back
If remediation attempts break the branch:
```bash
git reset --hard backup/pr-<PR_NUMBER>-pre-review
git clean -fd
```

---

## 3. Continuous Integration (CI) Automation

### Triggering Workflows
```bash
# Trigger the main verification workflow on the PR branch
gh workflow run Verify --ref <HEAD_BRANCH>

# List recent workflow runs for the workflow
gh run list --workflow=Verify --limit 5

# Watch a running workflow until completion
gh run watch <RUN_ID>

# View failed logs if CI fails
gh run view <RUN_ID> --log-failed
```

---

## 4. Formal Reviewer Trail (Two-Stage Replies)

The agent must interact as a **formal PR reviewer** using GitHub's native PR Review mechanism (`gh pr review`).

### Review Reply 1: Initial Audit & Findings (Phase 3)
After completing the empirical baseline and code audit, post the initial findings as a reviewer:
```bash
# If defects or gaps exist (submits formal review comment with Compliance Matrix)
gh pr review <PR_NUMBER> --comment --body "<INITIAL_FINDINGS_AND_COMPLIANCE_MATRIX>"

# Or request changes if team policy requires blocking state:
# gh pr review <PR_NUMBER> --request-changes --body "<INITIAL_FINDINGS_AND_COMPLIANCE_MATRIX>"
```

### Review Reply 2: Post-Remediation Updates & Approval (Phase 5)
After remediating defects locally, pushing the verified commit, and proving `pnpm verify` is green, post the update as a formal review approval:
```bash
# Submit formal review approval detailing fixes and test verification proof
gh pr review <PR_NUMBER> --approve --body "<REMEDIATION_SUMMARY_AND_APPROVAL_PROOF>"
```

### Self-Review Policy Handling
If the GitHub token belongs to the PR author, GitHub blocks `gh pr review --approve` on your own PR.
- If blocked with `Unprocessable Entity: Can not approve your own pull request`:
  Fallback gracefully to:
  ```bash
  gh pr comment <PR_NUMBER> --body "<REMEDIATION_SUMMARY_AND_APPROVAL_PROOF>"
  ```

### Undrafting
```bash
# If the PR is marked as draft, convert to ready for review
gh pr ready <PR_NUMBER>
```

---

## 5. Integration & Merge

### Merging the PR
```bash
# Merge using standard merge commit and delete remote branch
gh pr merge <PR_NUMBER> --merge --delete-branch

# Or merge using squash commit (if repo convention specifies squash)
gh pr merge <PR_NUMBER> --squash --delete-branch
```

### Handling Merge Denials / Blockers
- **Draft Status**: Run `gh pr ready <PR_NUMBER>` first.
- **Required Reviews**: If branch protection blocks self-merging without external approval, state the requirement clearly to the user instead of trying to force it.
- **Failing Required Checks**: Run `gh pr checks <PR_NUMBER>` to identify blocking CI jobs.

---

## 6. Issue Reconciliation & Cleanup

### Commenting & Closing Issue
```bash
# Post resolution proof comment on the GitHub issue
gh issue comment <ISSUE_NUMBER> --body "Resolved via PR #<PR_NUMBER>. All acceptance scenarios verified passing."

# Close the GitHub issue
gh issue close <ISSUE_NUMBER>
```

### Local Cleanup
```bash
# Once merged and verified, clean up local backup branch
git branch -D backup/pr-<PR_NUMBER>-pre-review
```
