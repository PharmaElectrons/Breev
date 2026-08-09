# Epic 12: Convert approved OCR extraction into a fully human-reviewed Purchase Draft

Type: epic
Status: needs-triage
Engineering phase: P8 — Messaging/OCR/AI
Blocked by: 05; OCR provider/privacy/benchmark gate
GitHub issue: #14
Parent GitHub specification: #2

## User Story

As a buyer, I want an eligible supplier invoice extracted into a source-linked draft that I must verify and correct, so that entry becomes faster without giving an external model authority over products, stock, prices, money, or accounting.

## Outcome

Deliver preflight gates, encrypted temporary source handling, idempotent OCR jobs, provider adapter, field location/confidence/provenance capture, critical-field confirmation UI, explicit master-data mapping, Breev-side exact recalculation, page allowance/usage, provider deletion outcome, and handoff into the manual Purchase Draft workflow.

## Expected workflow

1. Buyer selects a supplier invoice; Breev hashes/classifies it and blocks detected/expected patient data unless a separately approved basis/provider path exists.
2. Preflight verifies Tenant Entitlement, 80/100% page allowance, provider/model/region/DPA/no-training/deletion approval, file/page limits, and connectivity.
3. Durable job submits once and records provider/model/region/source hash/page/cost evidence; retries reuse idempotency context.
4. Extraction returns fields with source locations/confidence. Breev parses units/money and recalculates quantities, discounts, tax, and totals independently.
5. Buyer maps every unknown product/Supplier/unit/batch explicitly and confirms/corrects every critical field against the highlighted source.
6. Only a completed human review hands a normal Draft Invoice to Epic 05; purchase posting revalidates everything again.

## Invariants and failure behavior

- OCR never auto-creates or posts master data, stock, price, payable/payment, journal, or purchase.
- Provider confidence never replaces human confirmation or exact local calculation.
- At 100% allowance, new external jobs stop; manual offline purchasing remains available.
- Provider working copies are deleted promptly/max approved limit; Supplier Invoice Evidence is retained locally only under the posted-purchase policy.

## Acceptance scenarios

- Given an entitled eligible invoice, when extraction completes, then every critical value is source-linked and unconfirmed values prevent reviewed handoff.
- Given patient data, unapproved provider/region/model, expired Entitlement, or exhausted allowance, when preflight runs, then upload is blocked before external transfer and manual entry remains available.
- Given duplicate retry/callback and unknown mappings, when processed, then one provenance/job result exists and no duplicate master/business record is created.

## Planned child slices

- Source/preflight/privacy; durable job/provider adapter; extraction/provenance; local money/unit parser; review/highlights; explicit mapping; usage/allowance; deletion/evidence retention; manual handoff; benchmark/idempotency/failure suite.

## Gate and exclusions

- Provider/model/region benchmark on controlled Iraqi invoices plus DPA/no-training/deletion approval required. Patient-data OCR and automatic posting are excluded.

## Traceability

- US-023–030; OCR/purchase/privacy requirements; ADR-016–017, ADR-020, ADR-025.
