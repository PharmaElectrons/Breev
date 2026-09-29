---
name: prototype-ui-transplant
description: Transplant visual UI components, layouts, typography, spacing, and dialogs from the checked-in prototype (`design/prototype/src/`) into the Breev desktop renderer (`apps/desktop/src/renderer/src/`) with pixel-perfection, strict scope isolation, and proper desktop state/IPC wiring.
---

# Prototype UI Transplant & Fidelity Skill

Use this skill whenever building, refactoring, or polishing any desktop UI screen, table, form, modal, drawer, or workflow in Breev.

This skill operationalizes the working agreement in `AGENTS.md` and `.agents/rules/frontend-prototype-fidelity.md` to ensure production screens match the prototype 1:1 visually while respecting Breev's offline-first, server-authoritative architecture.

---

## 1. Core Principle: Visual Truth vs. Architecture Authority

| Visual Presentation (Follow Prototype 100%) | Business & Architecture (Follow Breev Domain) |
| :--- | :--- |
| • Container hierarchy, flex/grid layout | • Server-authoritative calculations & posting |
| • Spacing, padding, gaps, margins | • Electron IPC & typed contracts (`*-api.ts`) |
| • Typography, font sizes, weights | • Exact integer money (cents / fils) |
| • Colors, palettes, shadows, borders | • Local PostgreSQL persistence (no Supabase) |
| • Button positions, icons, badges | • Tamper-evident audit logs & immutable records |
| • Modal transitions, drawers, sub-tabs | • Bilingual message dictionaries (`*-messages.ts`) |

---

## 2. Step-by-Step Transplant Procedure

### Step 1: Locate the Prototype Reference
Consult the validated screen mapping table:
- **Purchases:** `design/prototype/src/routes/purchases.tsx`, `components/suppliers-workspace.tsx`, `components/add-material-modal.tsx`, `components/batch-items-panel.tsx`
- **Sales POS:** `design/prototype/src/routes/index.tsx`, `lib/quick-access.ts`
- **Catalog:** `design/prototype/src/routes/products.tsx`, `components/add-material-modal.tsx`, `components/barcode-print.tsx`
- **Inventory:** `design/prototype/src/routes/inventory.tsx`, `components/initial-stock-audit.tsx`, `components/item-ledger-drawer.tsx`
- **Dashboard:** `design/prototype/src/routes/dashboard.tsx`, `components/notification-bell.tsx`
- **Order Basket:** `design/prototype/src/routes/cart.tsx`, `components/need-requests.tsx`
- **Settings:** `design/prototype/src/routes/settings.tsx`, `routes/employees.tsx`

### Step 2: Extract the Pure Visual JSX & Markup
Copy the layout structure, container wrappers, table headers, column orders, and button placements:
- Keep the exact tag hierarchy (`div`, `table`, `thead`, `tbody`, `button`, `span`, `input`).
- Replicate the CSS/Tailwind classes (padding, borders, radius, colors, flex arrangements).
- Retain Lucide icon selections and icon positions relative to labels.

### Step 3: Strip Out Incompatible Prototype Code
Remove all prototype-specific artifacts:
- ❌ Remove `@tanstack/react-router` (`createFileRoute`, `useNavigate`).
- ❌ Remove `@/integrations/supabase/client` (`supabase.from(...)`).
- ❌ Remove browser `localStorage` business persistence.
- ❌ Remove client-side floating-point financial arithmetic.
- ❌ Remove mock pharmacy seed data.

### Step 4: Wire to Breev Desktop Architecture
Connect the visual markup to Breev's robust desktop services:
- **Data Fetching & Mutations:** Use typed API clients in `apps/desktop/src/renderer/src/*-api.ts` backed by `packages/contracts`.
- **Exact Money Representation:** Ensure all monetary values use Breev's exact integer arithmetic, formatting via locale utilities (`preferences.ts`).
- **Bilingual Localization:** Move all user-facing strings (Arabic & English) into `apps/desktop/src/renderer/src/*-messages.ts`.
- **Keyboard Navigation:** Bind shortcuts (e.g., `F2` for quick add, `F9` for post, `Enter` to commit, `Esc` to close) matching prototype expectations.

### Step 5: Implement Exhaustive Nested Surfaces
A module task is incomplete if any nested surface is missing. Build out:
- Full-height item details sidebars.
- Drafts registers / saved baskets drawers.
- History / posted document review dialogs.
- Creation dialogs (e.g. Add Material modal).
- Safety, batch, and return workflow dialogs.
*Never use empty `onClick={() => {}}` or placeholder alerts.*

### Step 6: Enforce Strict Scope Isolation (Zero Collateral Regressions)
- **Do not edit shared global classes** in `apps/desktop/src/renderer/src/styles.css` if they affect other screens.
- **Scope all custom styles** under a parent module class (e.g., `.purchasing-screen-root .table-row`).
- **Never modify shared shell components** (`app-shell.tsx`, global navigation) in a way that shifts other modules.

### Step 7: Pre-Flight Quality & Regression Check
Before declaring work complete, run:
```powershell
pnpm format:write
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:browser
```
Verify that unrelated modules (Sales, Inventory, Catalog) continue to render without visual shifts or regressions.
