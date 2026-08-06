# Source Inventory

Inspected on 2026-08-05 from `/mnt/data/Cefeldeen-clinic-pos`.

| ID | Source | Location | Inspection | Authority and findings |
|---|---|---|---|---|
| SRC-01 | Master architecture/build prompt | `breef/docs/requirements/Breef_Master_Architecture_Build_Prompt.md` | Read in full: 1,607 lines; SHA-256 `e01353f9…4923c` | Governs architecture, phases, artifacts, quality gates, and approval protocol. It is not a second independent requirements prompt. |
| SRC-02 | Product brief | `breef/docs/requirements/PROJECT_BRIEF.md` | Read in full: 630 lines; SHA-256 `0ddf4f1f…99c` | Primary consolidated product-requirements source. |
| SRC-03 | Arabic brief | `٢عربي-بريف.pdf` | All 11 pages extracted with layout preservation and read; SHA-256 `ef96be18…3953` | Original Arabic workflows and broad vision. Its older Laravel/SQLite suggestion and future-scope ideas are superseded where later sources disagree. |
| SRC-04 | Client/developer conversation | `converstation.md` | Read in full: 621 lines; SHA-256 `0feb9e40…fa2e` | Contains the latest clarifications and meeting summary; highest product authority when explicit. Includes Breev naming, continuous cash boxes, side-panel placement, SaaS/sync tiers, and first-release messaging clarifications. |
| SRC-05 | Existing UI repository | `frontend/` | Route, component, library, style, manifest, generated DB types, and all Supabase migrations inspected | Visual/interaction evidence only. TanStack Start + React 19 + Vite 8 + Tailwind 4/shadcn + React Query + Supabase. About 29k TypeScript/TSX/CSS lines including generated files. |
| SRC-06 | Published Lovable prototype | `https://pixel-perfect-capture-094.lovable.app/` | HTTP HEAD on 2026-08-05 returned 404 | No live UI could be recovered. Repository source is the available prototype record. |
| SRC-07 | New workspace scaffold | `breef/` | Full tree, manifests, TypeScript markers, tsconfigs, docs, and ADRs inspected | pnpm/Turborepo shape only. App/module/shared-package source files are name constants, totaling roughly 648 lines across manifests/config/source. No production architecture has been implemented. |
| SRC-08 | Repository instructions | `breef/AGENTS.md`, `breef/docs/agents/*.md`, `frontend/AGENTS.md` | Read before edits | Local Markdown issue tracking, default triage vocabulary, domain-doc locations, and Lovable history preservation rules. |

## Existing UI route inventory

### User-facing routes

`/`, `/auth`, `/dashboard`, `/purchases`, `/inventory`, `/products`, `/accounts`, `/patients`, `/messages`, `/employees`, `/settings`, `/reports`, `/cart`, `/integration`, `/clinic`, `/delivery`, `/ecommerce`, `/external-integration`, `/marketing`.

### Prototype server routes

- `/api/breef-ai`: forwards operational context to the Lovable AI gateway.
- `/api/purchase-ocr`: forwards invoice image data to the Lovable AI gateway.

These endpoints lack the production authentication, entitlement, provider-adapter, privacy, limit, validation, and audit boundaries required by the master prompt.

## UI state and data findings

- Router: TanStack file-based routes; many pages disable SSR.
- State: component state, React Query, browser `localStorage`, mock data, and direct Supabase access.
- Authentication: root-level silent login/signup with hard-coded credentials; `/auth` redirects to `/`.
- Authorization: role/permission management UI exists, but routes and domain actions do not consistently enforce it.
- Tenant boundary: absent from the prototype schema and most RLS policies allow any authenticated staff user.
- Styling: Arabic-first slate/emerald design; light/dark requirements are incomplete and much of the CSS is a single palette.
- Localization: language/direction provider exists, but most screen text is hard-coded Arabic.
- Persistence: Supabase schema includes products, patients, suppliers, sales/purchases, stock movements, batches, accounts, messages, employee and clinical tables; several important UI preferences and records remain browser-local.
- Financial consistency: document headers, lines, stock changes, and account changes are often separate client calls rather than one server transaction.
- History: the prototype can delete or overwrite records that the target system must preserve through reversals/amendments.

## Execution evidence

- `frontend/node_modules` and `breef/node_modules` are absent.
- `npm run build` in `frontend/` exits 127: `vite: command not found`.
- `npm run build` in `breef/` exits 127: `turbo: command not found`.
- Dependencies were not installed because Phase 0 forbids installation of the large dependency set.
- No backend, migration, or production code was written during discovery.

## Source limitations

- The PDF's technical-stack section is older than the governing architecture.
- `converstation.md` is a chronological conversation and mixes confirmed client statements with developer suggestions; only explicit client/meeting conclusions are treated as authoritative.
- The prototype demonstrates intended appearance and rough workflows but contains mocks, placeholders, future modules, and unsafe implementation shortcuts.
- The `breef/` scaffold was uncommitted at inspection time, so directory presence is evidence of an intended shape, not an accepted design.

## External primary accounting references consulted

- [IFRS Foundation — IAS 2 Inventories](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/): identifies FIFO or weighted-average cost for ordinarily interchangeable inventory and specific identification for non-interchangeable items. Local Iraqi accountant/legal validation remains mandatory.
- [IFRS Foundation — IAS 2 issued text, paragraph 11](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2022/issued/part-a/ias-2-inventories.pdf?bypass=on): trade discounts, rebates, and similar items are deducted from inventory purchase cost.
- [IFRS Interpretations Committee — discounts and rebates](https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2004/ias-2-discounts-and-rebates-nov-04.pdf) and [cash discounts](https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2002/ias-2-inventories-cash-discounts-aug-02.pdf): purchase-price and prompt-settlement discount guidance.
- [Iraqi Ministry of Health — inspection action covering expired/non-evaluated medicines](https://moh.gov.iq/?article=14707) and [WHO expired-stock procedure](https://iris.who.int/bitstream/handle/10665/360835/9789240049581-eng.pdf?sequence=1): support hard quarantine/removal rather than a checkout override for expired medicine.
