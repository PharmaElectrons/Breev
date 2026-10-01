# T06 prototype and isolation review

Visual authority: `design/prototype/src/components/app-shell.tsx`:
`ProductInfoSidebar`, `FractionCell`, `Row`. The checked-in source was read and
its three functions rendered directly by
`.scratch/runtime/t06-prototype-reference.cjs`, without Supabase or product
code changes. Four reference images and measured 320px width / 11px heading
are retained in `prototype-reference/`.

Current captures in `browser/positive-*.png` retain the accepted Purchasing
sidebar: title dot, name/barcode hierarchy, fraction cards, first fact-card
order (packaging → min/max → wholesale), separators, collapse control,
320px side placement at wide widths, and accepted bounded band at narrow
widths. Text wrapping, a keyboard-focusable scroll area and nonshrinking fact
cards are scoped to `.purchasing-authoritative-panel`.

The prototype's third card is a mock clinical/dosage inference, its stock
limits use the wrong physical unit, and consumption/days-of-supply are zero
without authoritative history. T06 uses two real units for Pack/Strip, server
base-unit limits, and localized unavailable Reporting fields. Current expiry,
retail/wholesale, valuation, M2 batch status and saved Purchase row-cost
references come from their owners, not the prototype arithmetic. These
truthfulness changes are explicitly required by T06, not pixel differences
silently accepted as new requirements.

The baseline desktop palette/type rules and accepted responsive shell remain
unchanged. This is a bounded hierarchy/interaction comparison, not a claim
that the complete desktop matches every prototype pixel or that phase-wide
visual acceptance passed. Four current locales/themes, 1366×768, 1280×800,
1024×768 and 200% text are checked in the focused browser cases.

Isolation review: no `styles.css`, shared shell, Inventory screen/component,
Quick Product handler, keyboard handler or column progression implementation
is changed. The existing `PurchaseItemSelection` type gains only an optional
preferences revision; the row entry selection effect supplies that revision
so cost-setting changes invalidate old panel reads. Inventory's existing
`PurchaseItemPanel` continues using its unchanged implementation.
