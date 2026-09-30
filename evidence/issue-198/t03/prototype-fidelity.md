# T03 visual source and capture verification

30 September 2026. Agent verification is complete for the in-scope changes;
**stakeholder T03 PASS received**, based on agent verification, 30 September 2026.
The prototype files remain unchanged. See [acceptance record](manual-results.md).

## Reference and method

The authoritative reference is the Delta modal in
`design/prototype/src/routes/purchases.tsx` (starting at line 987), with
`design/prototype/src/styles.css`. The runtime-only reference harness
`.scratch/runtime/t03-prototype-reference.cjs` extracts the original modal JSX
through the TypeScript AST, renders it with React and its actual Lucide icon,
and compiles the original stylesheet through the installed Tailwind compiler.
Synthetic quantity 4→8/cost 80 IQD facts are supplied for comparison. No Supabase
connection or reference-app write occurs. Locally bundled font faces serve the
same fonts without remote requests. This is an isolated visual reference, not
an end-to-end certification of the prototype application.

Eight [reference captures](prototype-reference/) cover English/Arabic,
light/dark and 1280×800/1366×768. [Measured reference geometry](prototype-reference/metrics.json)
is consistently 640px width, 14px heading, 12px comparison table and 12px/16px
header padding. Fresh production captures use the real API/renderer and are
in [screenshots/](screenshots/).

## Found and corrected

The inherited desktop Delta modal was 864px wide, with larger headings/spacing,
a generic h3 underline, an emoji instead of FilePen, a decorated reference pill
and a non-wrapping Product pill. These were material differences from the current
prototype source. Within the Adjustment surface only, the candidate now uses:

- Fixed maximum 640px width, prototype heading/table sizes and header/cell spacing.
- Original FilePen SVG paths and the packaged ISC/MIT notice; no new dependency.
- Plain reference text and wrapping Product text, without the generic h3 border.
- The prototype's compact footer typography, input/button spacing and modal radius.
- A scrolling comparison area capped at 45vh; the action footer stays reachable.

All overrides are under `.purchase-adjustment`. No shared shell/global selector,
other module, prototype source, Quick Product or Purchase row-entry code changed.
The underlying editor containers and action order retain the accepted T02 baseline.

Required functional differences remain explicit: server-owned before/after
gross/allowance/discounted facts, inventory/Supplier effects, typed Reason,
hidden support references and explicit preservation choices; correct English/LTR
and translated column headings; exact currency labels; accessible focus/status
and stronger Breev contrast tokens. Those facts require extra rows and sometimes
footer/text wrapping. No literal pixel identity with different content or with
the prototype's untranslated/hard-coded RTL English view is claimed.

## Final proof

**9 browser cases passed in 1.7 minutes, exit 0**, after the final visual edits.
[Actual output](prototype-checkpoint-output.log) includes the four controls
locale/theme cases, four confirmation/restart/stale/uncertain-Post cases and
keyboard review/Return. The controls cases now assert the prototype's 640px
width, 14px heading, 12px table and absent h3 underline; all row columns must be
visible at normal desktop widths. Existing focus/axe, 640px window and 200% text
checks continue to pass. Fresh English/light and Arabic/dark captures were
visually inspected against the rendered reference.

Renderer typecheck/build, modified-file lint/format and the two focused workflow/
action unit files (8 tests) passed. Historical captures were restored after
retaining the new run separately; protected user-file hashes still match.
The reference harness first omitted Tailwind's required dependency callback and
used an incorrect asset path; both harness errors were corrected before any
successful reference capture. They are not product failures.

Windows Narrator listening and physical-profile/release certification are not
claimed. The earlier optional-note report remains open; current restart proof
does not establish its root cause. T03's local commit gate follows acceptance;
no push/PR or phase acceptance is claimed.

For acceptance, review the current captures or refresh the existing manual page
to load the latest built renderer before following [manual-test.md](manual-test.md).
Do not reload while intending to preserve unsaved local edits.
