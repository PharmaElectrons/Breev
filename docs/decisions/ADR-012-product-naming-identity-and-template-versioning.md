# ADR-012: Product Naming, Identity, and Template Versioning

- Status: **Accepted — Phase 0**
- Date: 2026-08-05
- Decision owners: Product / catalog / UI
- Related: REQ-CAT-001, REQ-CAT-001A, Q-009, R-025

## Context

The Arabic brief defines different naming grammars for pharmaceutical and general products. The prototype implements only part of the general grammar and overloads some search fields. If a generated string becomes product identity, two legitimate products can collide and template edits can rewrite receipts/history. Arabic search must work without contaminating the English display name.

## Decision

- Catalog toggles between two structured modes.
- Pharmaceutical English display order: Trade Name → Strength/Concentration → Dosage Form → Manufacturer.
- General/medical-device English display order: Company/Manufacturer → Sub-brand/Series → Type/Use → Property/Degree → Target/Audience → Size/Volume.
- Empty optional components are omitted without duplicate spaces or separators.
- Arabic Search Name is independent, displayed below English, and indexed for normalized sequential/fuzzy search; it is never appended to the English display.
- Components are stored separately. The current display name is a read-only derived value carrying its Naming Template Version.
- Template definitions are configurable and versioned so a later field-order change can regenerate current catalog names without changing posted documents.
- Posted invoice, purchase, movement, and audit snapshots preserve their transaction-time names and template/version facts.
- Exceptional manual override requires a privileged permission and records previous/generated name, replacement name, actor, device, time, and reason.
- Product identity and uniqueness rely on internal UUIDv7 plus approved SKU, barcode, or registration constraints—not generated name alone.

The stakeholder approved these controls on 2026-08-05.

## Alternatives considered

- One free-text name: flexible, but produces inconsistent search, duplicates, and poor structured reporting.
- Generated name as unique identity: breaks when fields/templates change and cannot distinguish same-named products.
- Append Arabic to English: harms display/labels and couples two independent search representations.
- Rewrite historical snapshots after regeneration: destroys transaction evidence.

## Consequences

- Positive: consistent labels/search and safe template evolution without historical mutation.
- Negative: catalog UI and imports must collect/normalize structured components and handle template versions.
- Verification: golden component examples, empty-field formatting, AR/EN fuzzy search, collisions, override authorization/audit, regeneration, and immutable historical snapshot tests.
