# Remediation Playbook: Rules & Circuit Breakers

When remediating defects discovered during PR audit, follow these strict rules to prevent git history corruption, infinite loops, and broken regressions.

---

## 1. Local Safety Baseline

Before making any code edits or rebasing:

```bash
# 1. Ensure you are on the PR branch
git checkout <PR_HEAD_BRANCH>

# 2. Create a timestamped/named backup pointer
git branch backup/pr-<PR_NUMBER>-pre-review

# 3. Verify working tree is clean
git status --short
```

If remediation goes off track or breaks irreparably, rollback is immediate:
```bash
git reset --hard backup/pr-<PR_NUMBER>-pre-review
```

---

## 2. The 2-Iteration Circuit Breaker

Remediation must converge quickly. Follow the **Max 2 Loops** rule:

```
[Iteration 1]
   │
   ├─► Analyze failing test / compiler error
   ├─► Apply minimal, cohesive fix beside owning code
   ├─► Run targeted test suite
   │
   └─► If GREEN ──► Run Full Regression ──► Done!
       │
       ▼
   If FAILS ──► Proceed to Iteration 2

[Iteration 2]
   │
   ├─► Re-evaluate failure classification (is this actually code, or env/test drift?)
   ├─► Apply second targeted adjustment
   ├─► Run targeted test suite
   │
   └─► If GREEN ──► Run Full Regression ──► Done!
       │
       ▼
   If FAILS ──► 🛑 CIRCUIT BREAKER TRIPPED
                1. Revert changes: git reset --hard backup/pr-<PR_NUMBER>-pre-review
                2. Document root cause and exact failure logs
                3. STOP and ask user for instructions
```

---

## 3. Remote Cleanliness (No Git Spam)

- **Keep all intermediate changes local**: Never run `git push` after every partial edit or broken test run.
- **Do not post commentary spam on GitHub**: Never comment on GitHub about internal compile retries.
- **Single cohesive commit**: Once all tests are green, commit the clean fixes:
  ```bash
  git add -A
  git commit -m "fix(<scope>): resolve review findings and test regressions"
  git push origin <PR_HEAD_BRANCH>
  ```

---

## 4. Regression Canary

Fixing one defect must never silently break another. 
Before declaring remediation complete, you must run the **authoritative regression suite**:

```bash
# Full repository verification seam
pnpm verify
```

If `pnpm verify` takes too long during iterative fixes, run the pyramid incrementally:
1. Targeted unit test: `pnpm --filter <pkg> test:unit`
2. Affected package build: `pnpm --filter <pkg> build`
3. Boundaries check: `pnpm check:boundaries`
4. **Final Gate**: Always run `pnpm verify` before pushing or merging.
