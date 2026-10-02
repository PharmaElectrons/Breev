# Agent comparison — final review candidate

The agent opened the actual prototype and current PNGs, including both desktop
sizes, Arabic/light and Arabic/dark, Summary/Step-Up, nested warnings, edited
Supplier terms, optional row controls and refusal states. Comparisons use original
rasters. The compact HTML gallery links full-size images.

| Pair / inspection | Observed comparison and decision |
| --- | --- |
| Populated invoice / selected item rail | Same compact metadata → rows → totals/actions hierarchy, local fonts, thin dividers and 320px rail at 1366. Accepted five-field order replaces the prototype's 12-column order; exact units and authoritative review remain readable. At 1280 the accepted rail becomes a band. |
| Empty and Saved Drafts | Search/table and selected-row hierarchy retained. Accepted inline register preserves the invoice state. Data-dependent supplier/invoice counts are not compared as pixel errors. |
| Adjustment start/edit | Original context, compact header/row canvas, protected fields and action hierarchy retained. Corrected copy and saved before/after facts preserve immutability rather than mutating the prototype original. |
| Delta Summary | Prototype and current outer widths are 640px; current tables and exact stock/Supplier/header facts require more height. Content scrolls within the viewport with 16px outer clearance. Safe Cancel and explicit confirm remain reachable; native backdrop/inertness supports nested warnings. |
| Return edit / Summary / Step-Up | Compact two-column input hierarchy and local semantic totals replace the previous oversized isolated section. Return's exact carrying/Supplier adjustment, evidence, password and explicit post have no authoritative prototype counterpart; the bounded modal follows its card/dialog tokens. |
| Supplier profile / terms / archived / merged | List/profile/toolbar, compact fields and allowance stepper retained. M2 profile uses the accepted full width; live balance, credit utilization, ledger and statement stay excluded. Archived selectable text uses full opacity for contrast while the state badge remains. Conflict/reload and merged read-only states remain explicit. |
| Optional controls at desktop/narrow/text sizes | Original details popover and handlers retained. Its own scroll and viewport bounds prevent the overlap/clipping identified by actual tests. The old upward-placement rule is explicitly overridden at band widths. Narrow row canvases scroll locally so item input width and actions remain usable. |
| Arabic and dark adaptations | Logical direction, Arabic local font, monetary mono text, spacing and nested placement inspected. The prototype hard-codes RTL and has no dark tokens; current LTR/dark references are intentionally not fabricated. Existing Breev semantic tokens supply contrast. |
| Shared header | Prototype 64px versus accepted Breev 60px is a preserved shared-shell difference. No shell or global CSS change is justified by this feature. |

Purchasing pixel equality is not a meaningful acceptance threshold where the
prototype has different columns, direction, placeholder totals, deferred ledger
and non-authoritative state. Those differences are explicitly classified in the
[visual contract](visual-contract.md); no masking or arbitrary tolerance hides
them. Geometry, actual rendering, focus and action reachability supply the
bounded evidence. Unrelated modules use an exact, unmasked raster comparison.

Physical Windows Narrator, packaged-Electron preview clipping and professional
gates retain their actual open status. Agent visual inspection does not constitute
stakeholder acceptance.

Dialog captures taken after the automated Tab/Shift+Tab cycle may show its last
action focused. Safe initial Cancel/Continue focus is asserted before that cycle;
those screenshots are not evidence of a destructive default. Native inertness
prevents a human from activating the background Back button while a Summary is
open. The simultaneous warning-above-Summary stack is tested through the existing
leave callback; the human walkthrough uses the actual Summary → workflow → leave
warning keyboard path.

The native glyph-font diagnostic confirms IBM Plex Sans Arabic Regular/Bold for
the invoice heading, review heading and tabs, alongside Segoe UI Emoji for the
decorative icon. This verifies rendered glyphs, not just declared CSS font names.
