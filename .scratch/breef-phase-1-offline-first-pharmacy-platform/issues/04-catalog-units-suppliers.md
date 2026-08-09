# Epic 04: Maintain a searchable product, packaging, barcode, and Supplier catalog

Type: epic
Status: needs-triage
Engineering phase: P3 — Domain kernels/catalog
Blocked by: 02
GitHub issue: #6
Parent GitHub specification: #2

## User Story

As a pharmacy administrator, I want to maintain products, packaging units, barcodes, and Suppliers in Arabic and English without rewriting history, so that purchases and sales identify the correct item quickly and consistently.

## Outcome

Deliver stable product/Supplier identities, pharmaceutical/general structured naming, versioned templates, independent Arabic Search Name, exact integer Packaging Conversions, barcode aliases, multilingual/fuzzy search, archive/deactivation, and immutable snapshot contracts.

## Expected workflow

1. An authorized user chooses Pharmaceutical or General item mode and enters structured components plus the independent Arabic Search Name.
2. Breev derives the current English display using the active Naming Template Version; generated text is not identity.
3. The user selects a canonical Inventory Unit and defines only positive integer package ratios; later ratio changes create a new effective version.
4. The user assigns validated SKU/registration identifiers and one or more unique barcode aliases.
5. Search normalizes exact barcode/SKU/registration and Arabic/English sequential/fuzzy terms, returning active items first.
6. Referenced products/Suppliers are archived, not deleted; posted snapshots remain unchanged after master-data edits.

## Invariants and failure behavior

- Internal UUIDv7 is identity; display name alone is never unique identity.
- No packaging version may reinterpret posted quantities or current Stock Movements.
- Barcode uniqueness is Pharmacy/Tenant scoped under the approved rule and ambiguity is never resolved silently.
- Catalog owns no on-hand quantity; Supplier maintenance creates no payable by itself.

## Acceptance scenarios

- Given structured pharmaceutical components with optional blanks, when saved, then the correct ordered English display is generated without duplicate separators and Arabic remains separate/searchable.
- Given a barcode already assigned incompatibly, when another product claims it, then save fails with the conflicting record and no partial alias is created.
- Given a referenced product is edited or archived, when old invoices are viewed, then their transaction-time name/unit/template snapshots are unchanged.

## Planned child slices

- Stable IDs and catalog contracts; naming/templates; units/conversion versions; barcode aliases; normalized multilingual search; Supplier lifecycle; archive/snapshot behavior; permission/audit tests.

## Gate and exclusions

- Requires approved money/unit/identifier decisions and Epic 02. No stock, batch, purchase posting, clinical content, or automatic country medicine database.

## Traceability

- US-010–017; REQ-CAT-001 onward; ADR-005, ADR-007, ADR-012.
