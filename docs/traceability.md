# Source and requirement traceability

## Fixed evidence baseline

Local Git retains the full pre-consolidation repository documentation at commit `6ddc0431b58a43efdbc3bf2899e3f6251cd69c82`, dated 9 August 2026. Current docs do not duplicate it. To inspect an old file locally, use `git show 6ddc043:<path>`.

| Source | Evidence and authority |
|---|---|
| `docs/requirements/Breef_Master_Architecture_Build_Prompt.md` | Contains 1,607 lines, SHA-256 `e01353f9540ef8c656206aac2a64a79149d26cbd8f9af3db9cfe3deb5fe4923c`. It governs engineering constraints and staged-delivery intent, but does not authorize blindly creating its sample tree. |
| `docs/requirements/PROJECT_BRIEF.md` | Contains 630 lines, SHA-256 `0ddf4f1fd4442afac309d799218ecc776bb57ec112e199cde30398e600ed499c`. It is the primary consolidated product brief. |
| Original Arabic brief | The evidence pass extracted and read all 11 pages, SHA-256 `ef96be18…3953`. Later evidence supersedes its older technology and future scope where they differ. This checkout does not contain the original file. |
| Client/developer conversation | The evidence pass read 621 lines, SHA-256 `0feb9e40…fa2e`. Only explicit client and meeting conclusions have highest authority. This checkout does not contain the original file. |
| Prototype repository | The earlier review inspected about 29k TS/TSX/CSS lines as visual and workflow evidence only. The prototype used direct Supabase/browser state and unsafe multi-write behavior, which this baseline rejects. The recorded `/mnt/data/Cefeldeen-clinic-pos` path is now absent. |
| Current scaffold | Contains five app and twenty-five package marker workspaces and thirty lines of TypeScript total. It has no production behavior or accepted seams. |

The old consolidated register contains **238** requirement rows. This file maps every row family to its current authoritative location. A family row records coverage. It does not replace individual acceptance details. Before implementing a gated or future family, read its original rows at the fixed commit and update current docs with the approved behavior.

## Coverage matrix

| Requirement family | Count | Current authoritative representation | Disposition |
|---|---:|---|---|
| `REQ-ARCH-001` through `012` | 12 | `architecture.md`, `delivery.md`, ADRs | Current docs retain all confirmed constraints and reject the sample package tree as a proposal. |
| `REQ-UX-000` through `010` | 11 | `product.md`, `workflows.md`, `quality.md`, root `AGENTS.md` | Current docs retain Breev naming, language/theme/states, side-panel scope, keyboard/accessibility, and prototype authority. |
| `REQ-CAT-001`, `001A`, and `002` through `006` | 7 | `domain.md`, `workflows.md`, M1/M3 | Current docs cover all naming, identity, search, package, quick-create, and supplier rules. |
| `REQ-INV-001` through `013` | 13 | `domain.md`, `workflows.md`, G-01/G-02, M1/M3 | Current docs cover movement/negative-stock/batch/FEFO/valuation/block/cadence/disposition/expiry-correction rules. |
| `REQ-PUR-001` through `007` | 7 | `product.md`, `domain.md`, `workflows.md`, M1/M3 | Current docs cover the exact row sequence, discount, atomic post, immutability/snapshots, and OCR boundary. |
| `REQ-OCR-001` through `012` | 12 | `domain.md`, OCR workflow, G-10, M6 | Current docs cover the safety/continuity/qualification/quota boundary. When gate promotion begins, consult the original rows for provider-specific details. |
| `REQ-SAL-001` through `012` | 12 | `domain.md`, sell/correction workflows, M1/M2 | Current docs cover draft, price, settlement, Cash Box, atomic/immutable/correction/exact-money rules. |
| `REQ-PAY-001` through `011` | 11 | `domain.md`, G-12, M6 | This family is deferred. Current docs retain provider/custody/security/idempotency/unknown/settlement/refund/callback/expiry boundaries. At promotion, consult the original rows for exact adapter acceptance. |
| `REQ-EINV-001` through `006` | 6 | `product.md`, `domain.md`, G-13 | This family is deferred, and Breev must not make a false "official" claim. At promotion, consult the original rows for the exact future authority workflow. |
| `REQ-ACC-001` through `007` | 7 | `domain.md`, G-01, M1 through M3, `quality.md` | Current docs cover double entry, rule ownership, postings, times/backdating, write-off, and professional gates. |
| `REQ-REP-001` through `002` | 2 | `domain.md`, architecture ownership, M1/M8 | Reports remain read-only, reconciled, and access-controlled. |
| `REQ-IAM-001` through `021` | 21 | `product.md`, `domain.md`, pairing/subscription workflows, G-03 through G-05, M1/M2/M4 | Current docs cover identity/permission/entitlement/device/licence/grace/free-core/step-up/dual-control rules. The exact permission matrix remains gated. |
| `REQ-SYN-001` through `010` | 10 | `domain.md`, sync workflow, architecture, G-14/G-15, M7 | Current docs cover one-way, authority, outbox/inbox, future commands/conflicts, and draft prices. Two-way implementation remains deferred. |
| `REQ-PAT-001` through `029` | 29 | `domain.md`, patient workflow, G-08/G-11, provisional retention table, M5/M6 | Current docs cover core separations and privacy/external-link/connector gates. Consult the original rows for detailed conditional connector activation only if this family is promoted. |
| `REQ-CLN-001` through `013` | 13 | `product.md`, `domain.md`, patient/clinical workflow, G-09 provisional timing, M6 | Current docs cover prohibitions, sources, mappings, severities, snapshots, updates/freshness/kill switch, and release gates. |
| `REQ-MSG-001` through `010` | 10 | `product.md`, `domain.md`, messaging workflow, G-11, M6 | Current docs retain WhatsApp as the only candidate and cover ownership/templates/costs/callback plus the Iraq content gate. Other channels remain deferred. |
| `REQ-AI-001` | 1 | `product.md`, `domain.md`, G-09/G-10, M6 | This family remains optional, entitled, privacy-reviewed, and non-authoritative. |
| `REQ-NFR-001` through `049` | 49 | `architecture.md`, `quality.md`, G-04 through G-07/G-14/G-16, M0/M4/M7/M8 | Current docs cover security, recovery, cloud, hardware, updates, performance, and accessibility. During the M8 evidence audit, consult the original rows for detailed release checklists. |
| `REQ-FUT-001` through `005` | 5 | `product.md` scope boundaries and delivery promotion rule | This family remains deliberately deferred. Do not create placeholder architecture. |
| **Total** | **238** | | The rows above represent every requirement or trace it to gated promotion or release-audit evidence. |

## Governing reconciliations

| Conflict in old docs | Governing result in this baseline |
|---|---|
| Breef vs Breev | Breev is the company and product. New identifiers use `breev`/`@breev/*`. Old spellings get no compatibility layer. |
| Laravel/SQLite/direct Supabase vs NestJS/PostgreSQL/Drizzle | The later architecture governs. The renderer never owns data or business logic. |
| Prototype "95% complete" | The prototype supplies visual composition evidence only. It does not establish product behavior, security, persistence, or readiness. |
| Side panel everywhere | The product panel exists only in Sales and Purchasing. |
| Forced shifts | Breev uses continuous Cash Boxes with optional reconciliation. |
| Clinic and broad future routes | Breev excludes Clinic and defers or hides the other named capabilities. |
| Mutable/delete history and direct quantity | Breev uses immutable snapshots, linked corrections, and movement-derived inventory. |
| Prototype purchase order | The confirmed Item/Barcode → Quantity → Cost → Selling Price → Expiry → Enter (next row) sequence governs. |
| Whole IQD/open rounding | The later decision confirms signed integer fils, exact intermediates, and no automatic cash rounding. Accountant golden rules remain gated. |
| Human numbering "open" | The confirmed direction uses UUIDv7 plus local pharmacy/type/year sequences. Final legal and accountant presentation remains gated. |
| WAC/FIFO/last purchase ambiguity | WAC is the default. FIFO is the setup-time, accountant-reviewed alternative. Last purchase is a reference only, and FEFO remains separate. |
| Supplier discount ambiguity | Net purchase-price discounts reduce acquisition cost. Later rebates adjust inventory/COGS. Genuine expense and financing remain separate. |
| Negative stock/expiry cadence/map-only concern | Later explicit stakeholder requirements confirm hard negative-stock/block rules and daily/monthly expiry behavior. |
| Grace "open" | The later decision confirms seven inclusive days and Free Core on day eight. Trusted-time implementation remains gated. |
| WhatsApp ownership "open" | Breev requires a pharmacy-owned dedicated identity/number/template/cost. Provider/template/legal/pharmacist release remains gated. |
| Two-way sync ownership "open" | Breev confirms command/field ownership, expected-version, and conflict semantics. The capability remains deferred. |
| 27 proposed/stale ADRs | Current docs place product rules in domain/workflow/gates and retain only four hard-to-reverse structural ADRs. |
| Amendment model "open" | Financial corrections use Return, Reversal, and replacement only; an amendment is limited to a non-financial note. Printed correction presentation remains G-01-gated. |
| Master prompt Phase 1 cloud/commercial scope | Subscription and commercial operations move to M4 under the earn-a-workspace rule; the prompt's own phases were internally inconsistent about this. |
| Master prompt Arabic reporting and task-template process | Replaced by the root `AGENTS.md` working agreement. The bilingual product requirement is unchanged. |

Engineering elaborations beyond the register — multiple package barcodes, the named startup states, the PostgreSQL-native job library, contracts subpath seams, and the loopback CSRF/Origin proofs — are design decisions under the working agreement, not new product requirements.

## Research used to choose, not invent

- Electron, T3 Code, VS Code, and Bitwarden provided precedents for isolated renderers, named preload methods, constrained navigation/protocols, typed privileged-server boundaries, and hardened packaging. Breev also requires its API to outlive the desktop and serve LAN terminals.
- Shopify, Square, Odoo, and Oracle Retail provided precedents for durable/saved carts, scan-review-confirm receiving/counting, linked corrections, one stock unit plus package conversions, batch traceability, and explicit provider-offline states. Breev keeps stronger local authority and pharmacy safety rules.
- PostgreSQL and Drizzle support the required exact types, constraints, transactions, locks, RLS, outbox/job claims, backups, and Windows service lifecycle. Breev does not need repository frameworks, Redis, or a broker for those jobs.
- IAS 2/IFRIC provide accounting precedents for WAC/FIFO and purchase-cost discount treatment. Iraqi accountant and legal validation still govern Breev.
- OWASP/AWS/Azure tenant guidance supports default deny, verified tenant context, authorization on every request, and layered isolation. PostgreSQL RLS adds defense in depth but cannot be the only check.
- JWS/JWT/TUF and Windows protected-key APIs support signed offline claims and rollback evidence. They also establish that a signature cannot make a fully offline editable clock perfectly trustworthy.
- Official WhatsApp policy, CBI lists, and Iraqi/Kurdistan materials support provider/template/role-specific gates. They also support the decision not to claim a current pharmacy e-invoice mandate.

Primary citations sit next to the decisions in `architecture.md`, `domain.md`, and the four ADRs. External research never promotes a provider or resolves a regulated gate.

## Consolidation record

The consolidation removed the previous 46-file `docs/` tree instead of archiving it inside current documentation.

- The requirements and contradiction registers became this coverage index.
- The project context and glossary became root `CONTEXT.md`.
- Three workflow inventories became `workflows.md`.
- The architecture/module map and 27 ADRs became `architecture.md` plus four ADRs.
- Questions and risks became `open-decisions.md`.
- Two phase plans became vertical milestones.
- Three agent-convention files became root `AGENTS.md`.

The consolidation deleted repeated requirement prose and stale statuses. Git records the history.

A final independent review on 23 August 2026 validated the consolidation against the 238-row register, the governing sources, and the old ADRs, then restored compressed confirmed rules to their owning documents: the three-tier unit model, the additional sale item, invalid-batch resolution, below-cost permission, support-access defaults, the OCR patient-data block and Supplier Invoice Evidence, export identity rules, grace-period draft and warning behavior, mDNS/DNS-SD discovery, the decided permission names, UTC time storage, and clinical kill-switch and Essential-Drugs-List rules. It also recorded the second-opinion architecture refinements now in `architecture.md` and the sharpened G-04/G-05/G-14/G-15 gate evidence.
