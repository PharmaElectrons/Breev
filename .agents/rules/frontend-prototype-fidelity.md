# Frontend Implementation & Prototype Fidelity Rules

These rules are non-negotiable across all Breev desktop renderer tasks. Every agent and developer working on UI, layout, styling, or workflow screens must follow these invariants.

---

## 1. Prototype as the Authoritative Visual Source of Truth

The checked-in prototype under `design/prototype/src/` is the authoritative source for visual composition, layout, spacing, typography, button placement, card hierarchy, and nested dialogs.

- **Never invent custom UI layouts**: If a screen or component exists in `design/prototype/`, do not design a new layout or rearrange buttons, tables, cards, or toolbars.
- **Visual Transplant Pattern**:
  1. Inspect the equivalent prototype file under `design/prototype/src/`.
  2. Extract the visual JSX structure, container tags, flex/grid hierarchies, and CSS classes directly into the desktop component (`apps/desktop/src/renderer/src/`).
  3. Strip out prototype-only constructs: `@tanstack/react-router`, `@/integrations/supabase/client`, client-side floating-point arithmetic, and browser `localStorage`.
  4. Wire the extracted visual components to Breev's desktop state, typed API calls (`*-api.ts`), server-authoritative calculations, and localized message catalogues (`*-messages.ts`).

---

## 2. Exhaustive & Validated Module Mapping Matrix

Every desktop module defined in `apps/desktop/src/renderer/src/module-ids.ts` maps to specific files in `apps/desktop/src/renderer/src/` and corresponding sources in `design/prototype/src/`:

| Module (`ModuleId`) | Desktop Production Files (`apps/desktop/src/renderer/src/`) | Prototype Visual Source (`design/prototype/src/`) | Required Nested Surfaces & Modals |
| :--- | :--- | :--- | :--- |
| **`purchases`** (Purchasing) | `purchasing-screen.tsx`<br>`purchase-row-entry.tsx`<br>`purchase-item-details.tsx`<br>`suppliers-workspace.tsx`<br>`posted-purchase-review.tsx`<br>`purchase-adjustment-workflow.tsx`<br>`purchase-return-workflow.tsx` | `routes/purchases.tsx`<br>`components/suppliers-workspace.tsx`<br>`components/add-material-modal.tsx`<br>`components/batch-items-panel.tsx`<br>`components/need-requests.tsx` | - Full-height Item Details sidebar<br>- Drafts register / saved invoices modal<br>- Posted purchase invoices review drawer<br>- Add Material / quick-product dialog<br>- Batch safety review panel<br>- Purchase returns workflow dialog<br>- Purchase adjustments dialog<br>- Suppliers 3-card workspace & statement modal |
| **`sales`** (Sales POS) | `sales-screen.tsx`<br>`sales-workspace-view.tsx`<br>`sales-invoice-view.tsx`<br>`sales-calculator.tsx`<br>`sales-price-dialog.tsx`<br>`sales-quick-access-panel.tsx` | `routes/index.tsx`<br>`lib/quick-access.ts` | - Full-height item details sidebar<br>- Customer search & selection panel<br>- Quick access category buttons<br>- Split payment / cashier modal<br>- Price edit & discount dialog<br>- Suspended carts / drafts register |
| **`products`** (Catalog) | `catalog-screen.tsx`<br>`product-form.tsx`<br>`product-record.tsx` | `routes/products.tsx`<br>`components/add-material-modal.tsx`<br>`components/barcode-print.tsx`<br>`components/batch-items-panel.tsx` | - Product search rail & generated-name banner<br>- Dense form canvas (Arabic name on own line)<br>- Barcode print preview panel<br>- Batch item inspection panel<br>- Fast product creation dialog |
| **`inventory`** (Inventory) | `inventory-screen.tsx`<br>`count-session-screen.tsx`<br>`count-session-review.tsx`<br>`batch-safety-panel.tsx`<br>`batch-safety-review.tsx` | `routes/inventory.tsx`<br>`components/initial-stock-audit.tsx`<br>`components/item-ledger-drawer.tsx` | - 4 summary valuation cards<br>- Stock movement & item ledger drawer<br>- Count sessions / stocktake audit dialog<br>- Count session approval review modal<br>- Batch safety & expiry warning panel |
| **`dashboard`** (Dashboard) | `home-screen.tsx`<br>`system-overview.tsx` | `routes/dashboard.tsx`<br>`components/notification-bell.tsx` | - KPI analytical summary cards (sales, debts, near-expiry)<br>- Top-selling & most profitable analytics table<br>- Unified notifications / alert center |
| **`basket`** (Order Basket) | `basket-screen.tsx`<br>`basket-quantity.ts` | `routes/cart.tsx`<br>`components/need-requests.tsx`<br>`lib/procurement-cart.ts` | - Reorder basket table & quantity editor<br>- Supplier order confirmation workflow<br>- Inter-pharmacy shortage/needs requests panel |
| **`settings`** (Settings & Identity) | `settings-screen.tsx`<br>`user-management-panel.tsx`<br>`role-editor.tsx`<br>`devices-panel.tsx`<br>`terminal-pairing-screen.tsx` | `routes/settings.tsx`<br>`routes/employees.tsx`<br>`components/tawajud-workspace.tsx` | - System preferences & smart color flags<br>- Employee directory & credentials manager<br>- Custom role & permissions matrix editor<br>- Terminal pairing & hardware device panel |

*Note on deferred/excluded routes:* Per `docs/traceability.md`, `routes/clinic.tsx` is permanently excluded from scope. `accounts.tsx`, `reports.tsx`, `patients.tsx`, and `messages.tsx` are Phase Two deferred modules and render `UnavailableSurface` in the desktop app until their milestone is authorized.

---

## 3. Exhaustive Nested Surface Requirement (Full Depth)

A screen or module implementation is **strictly incomplete** if any of its nested pages, sub-tabs, workflow modals, drawers, or secondary dialogs are omitted or left as stubbed placeholders.

For every assigned screen, you must implement all associated nested surfaces to match their prototype counterparts:
- Every dialog, modal, drawer, and tab listed in the mapping table above must be fully implemented.
- Empty `onClick={() => {}}` handlers, dummy buttons, unstyled alerts, or `alert("TODO")` dialogs are prohibited.
- Modals must be interactive, maintain their own focus traps, and synchronize their state back to the parent module upon confirm or dismiss.

---

## 4. Strict Scope Isolation & Blast-Radius Quarantine (Zero Collateral Regressions)

**Modifying or corrupting any visual pixel, layout, spacing, or component outside the assigned task boundary is strictly prohibited.**

1. **Zero Global Style Bleed**:
   - Do NOT edit global rules, root classes, or base utilities in `apps/desktop/src/renderer/src/styles.css` (e.g., `.btn`, `.input`, `.card`, `.modal-backdrop`, typography resets) if doing so could shift or alter other modules (Sales, Inventory, Catalog, Settings, Shell).
   - All feature-specific styling must be strictly scoped under a parent container class (e.g., `.purchasing-screen-root .table-row`, `.suppliers-workspace-card`) to guarantee zero style leakage.
2. **Shared Component Immutability**:
   - Never alter shared primitives or shell wrappers (`app-shell.tsx`, global navigation bars, common layout scaffolding) in a way that shifts other screens.
   - If specialized behavior or styling is needed for the active module, encapsulate or compose it locally within that module's files.
3. **Pre-Flight Non-Regression Verification**:
   - Before completing work on any module, inspect unrelated primary screens (e.g., Sales POS, Catalog, Inventory) to verify that they render without visual shifts, layout breaks, or CSS collisions.

---

## 5. UI Quality & Accessibility Checklist

Before marking any frontend task complete:
- [ ] Visual structure, button locations, and typography match the prototype 1:1.
- [ ] All nested modals, drawers, and secondary workflows are fully implemented and styled.
- [ ] All action buttons, inputs, and form controls are wired to real handlers and `*-api.ts` calls.
- [ ] Arabic (RTL) and English (LTR) visual alignments and spacing are preserved.
- [ ] Action bars and tables include `overflow: auto` and `min-height: 0` / `min-block-size: 0` to remain fully accessible within the 1280x800 viewport.
- [ ] Pre-flight formatting and lint checks pass: `pnpm format:write && pnpm format:check && pnpm lint && pnpm typecheck`.
