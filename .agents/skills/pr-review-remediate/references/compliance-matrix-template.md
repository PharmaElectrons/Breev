# Compliance & Review Templates

Use these standardized templates when acting as a reviewer on a Pull Request.

The reviewer flow follows a **two-step review trail**:
1. **Initial Review (Phase 3)**: Post findings, compliance gaps, and planned remediation.
2. **Resolution Review (Phase 5)**: Post resolution changelog, verification proof, and formal approval.

---

## Template 1: Initial Reviewer Findings & Gap Analysis (Phase 3)

Use when submitting the initial review on the PR:
```bash
gh pr review <PR_NUMBER> --comment --body "<TEMPLATE_1_CONTENT>"
# or with --request-changes if changes are blocking
```

```markdown
# 🔍 QA & Systems Review: Initial Audit & Findings

**Target PR**: #[PR_NUMBER] — `[HEAD_BRANCH]`  
**Target Base**: `[BASE_BRANCH]`  
**Linked Issue**: #[ISSUE_NUMBER]  
**Reviewer Verdict**: [🟡 Changes Required / 🟢 Ready for Integration / 🔴 Blocked by Invariant Violation]

---

### 1. Empirical Test Baseline
- **Static Validation** (Lint, Format, Typecheck, Build): `[PASS / FAIL]`
- **Unit & Contract Tests**: `[PASS / FAIL]`
- **Persistence & Integration Tests** (Real PostgreSQL): `[PASS / FAIL]`
- **Smoke & Packaging Tests**: `[PASS / FAIL]`

---

### 2. Item-by-Item Compliance Matrix

| Criterion / Acceptance Scenario | Status | Verified Seam / Evidence | Findings & Notes |
|---|---|---|---|
| 1. [Requirement Description] | 🟢 Verified | `apps/foo/test/bar.unit.test.ts` | Fully satisfied by PR implementation. |
| 2. [Requirement Description] | 🟡 Incomplete | N/A | Missing edge-case handling for offline timeout. |
| 3. [Requirement Description] | 🔴 Invariant Risk | `src/auth/guard.ts` | Allows unauthenticated fallback; violates ADR 0002. |
| 4. [Target / Performance Metric] | ⚪ Accepted Trade-off | Payload measured at 481 MiB | Historical target (285 MB) unachievable due to ICU/Node. |

**Status Legend**:
- 🟢 **Verified**: Completely implemented, robustly tested through real seams.
- 🟡 **Incomplete / Missing**: Partial implementation or missing required scenario tests.
- 🔴 **Invariant Risk**: Violates core system boundaries, security rules, or introduces data corruption risks.
- ⚪ **Accepted Trade-off**: Documented physical/technical constraint differing from initial speculative target.

---

### 3. Non-Functional & Invariant Findings
- **Data & Transaction Invariants**: [Observations on atomic posting, immutability, rollback]
- **Security & Privacy**: [Observations on preload IPC guards, credential leaks, renderer isolation]
- **Accessibility & Localization**: [Arabic RTL & English LTR parity, WCAG 2.2 AA]
- **Performance & Sizing**: [Measured artifact sizes, file counts, memory]

---

### 4. Planned Remediation Actions
- [ ] Fix: [Specific defect 1, e.g. fix failing type check in migrate.cjs]
- [ ] Fix: [Specific defect 2, e.g. add missing Arabic locale pak]
- [ ] Escalate: [Trade-off or spec deviation requiring human confirmation]
```

---

## Template 2: Post-Remediation Resolution & Final Sign-Off (Phase 5)

Use when submitting the final review after fixes have been applied and verified:
```bash
gh pr review <PR_NUMBER> --approve --body "<TEMPLATE_2_CONTENT>"
```

```markdown
# ✅ QA & Systems Review: Remediation Resolution & Final Approval

**Target PR**: #[PR_NUMBER] — `[HEAD_BRANCH]`  
**Target Base**: `[BASE_BRANCH]`  
**Reviewer Verdict**: 🟢 **Approved & Verified**

---

### 1. Remediation Summary & Updates
The findings identified in the initial review have been resolved on the branch:
- **Commit**: `[COMMIT_HASH]` — `[COMMIT_MESSAGE]`
- **Key Changes Applied**:
  - `[file/path/1]`: [Brief explanation of what was fixed]
  - `[file/path/2]`: [Brief explanation of what was fixed]

---

### 2. Final Compliance Matrix

| Criterion / Acceptance Scenario | Initial Status | Final Status | Verification Seam |
|---|---|---|---|
| 1. [Requirement Description] | 🟢 Verified | 🟢 Verified | Passing unit tests |
| 2. [Requirement Description] | 🟡 Incomplete | 🟢 Verified | Remediated & passing integration test |
| 3. [Requirement Description] | 🔴 Invariant Risk | 🟢 Verified | Rewritten with createIpcGuard |
| 4. [Target / Performance Metric] | ⚪ Trade-off | ⚪ Accepted | Documented physical constraint |

---

### 3. Definitive Verification Proof
- **Full Suite Run**: `pnpm verify` passed with **0 errors**.
  - Lint, format, typecheck: **PASS**
  - Unit & boundary tests: **PASS**
  - Real PostgreSQL integration tests: **PASS**
  - Packaged desktop smoke tests: **PASS**
- **Artifact & Performance Verification**:
  - Measured payload size: `[X] MiB` (File count: `[Y]`)
  - Installer size: `[Z] MiB`
  - Integrity hash locks: **Verified matching SHA-256**

---

### 4. Integration Readiness
All acceptance scenarios and core system invariants are confirmed. Branch is clean, aligned with `[BASE_BRANCH]`, and ready for immediate merge.
```
