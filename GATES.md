# Gates: Purchasing UI/UX Parity and GitHub Issue Creation

OWNS: GATES.md, .scratch/purchasing/issues/01-purchasing-flow-ui-ux-defects-and-prototype-parity.md

Scope: Investigate purchasing flow and UI/UX defects across desktop review, adjustment, and return screens, compare against prototype, and publish a comprehensive GitHub issue with embedded screenshot evidence.

- [x] G1: Deep dive comparison between prototype (`design/prototype/src/routes/purchases.tsx`) and desktop implementation completed across creation, drafting, versioning, editing, deletion, and return flows.
      EVIDENCE: Verified across 6 lifecycle stages. Prototype uses in-memory cursor with direct Supabase inserts and hard deletions, while Breev uses PostgreSQL durable drafts, atomic posting, and immutable delta revisions.

- [x] G2: Root causes identified with exact file and line numbers for all 5 user screenshots: broken button styling, empty modal sprawl, untranslated English enums, raw error code/UUID dump, and form alignment flaws.
      EVIDENCE: Traced to `apps/desktop/src/renderer/src/styles.css` (lines 3536–3550, lines 6714–6830), `purchase-adjustment-workflow.tsx` (lines 162–166, lines 364–368, lines 397–401), and `purchase-return-workflow.tsx` (lines 120–123).

- [x] G3: Scope boundary audit documented distinguishing missing prototype features from intentional Breev architectural invariants (immutable delta adjustments vs mutable in-place deletion).
      EVIDENCE: Documented OCR import (deferred Milestone 4), negative stock import (candidate Milestone 2/3), and confirmed hard deletion cannot replace Breev's audited delta adjustments.

- [x] G4: Defect screenshots hosted on GitHub branch with verified direct image URLs.
      EVIDENCE: Pushed 5 PNG assets to `origin/evidence/purchasing-ui-defects`. Verified HTTP 200 via `curl.exe -I https://raw.githubusercontent.com/PharmaElectrons/Breev/evidence/purchasing-ui-defects/evidence/purchasing-ui-defects/01-posted-purchase-review-broken-buttons.png`.

- [x] G5: Comprehensive GitHub issue successfully created on `PharmaElectrons/Breev` with labels, reproduction steps, technical evidence, and embedded images.
      EVIDENCE: Created issue #189 (https://github.com/PharmaElectrons/Breev/issues/189) with labels bug, needs-triage, area/desktop, type/bug.

- [x] G6: Local issue artifact created in `.scratch/purchasing/issues/` matching Breev issue format.
      EVIDENCE: Created `p:\Projects\PharmaElectrons\.scratch\purchasing\issues\01-purchasing-flow-ui-ux-defects-and-prototype-parity.md`.

- [x] G7: Output audited and verified against `/unslop` rules (no em dashes, sentence case headings, no promotional or sycophantic language, plain technical speech).
      EVIDENCE: Verified all headings are sentence case, punctuation uses commas and periods without em dashes, and language is direct technical prose.
