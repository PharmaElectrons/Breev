# T04 accepted continuation state

1 October 2026. Read [README](README.md), [working defaults](working-defaults.md)
and [manual checkpoint](manual-checkpoint.md) before resuming.

- T01/T02/T03 accepted; T03 committed at
  `1256dcdf15e5f8c1b391d799ad5500f1e4403916` on
  `issue/198-m2-purchasing-integrity`.
- User authorized versioned defaults after the source review. T04 now has a
  complete implementation candidate and passing targeted proof, including four
  bilingual/theme browser cases and the real PostgreSQL forward migration.
- **T04 received explicit stakeholder PASS on 1 October 2026: “IT IS A PASS”.**
  This later decision accepts T04; the earlier PASS accepted T03 only.
- The full pre-commit chain ran once after PASS. See [the gate record](pre-commit-gate.md)
  for bounded request-fixture corrections, final affected reruns and unchanged
  CNG/Docker/crash-harness limits. Make the focused local T04 commit, then read
  and begin T05 under its own separate stakeholder checkpoint.
- G-01/G-02 and the earlier optional evidence-note disappearance follow-up stay
  open. No push/PR/merge or closure of #190/#198 is authorized here.
- Preserve the unrelated dirty `use-startup-connection.ts` and `tooling/dev.mjs`
  byte-for-byte and exclude them from staging. Their protected hashes remain in
  `.scratch/runtime/t03-gate-protected.json`; both were verified unchanged.
- Disposable regression PostgreSQL cluster on loopback 5551 and the separate
  T03 manual fixture on 5552 remain preserved. Use the existing task manifest;
  never guess credentials or use live pharmacy data.
