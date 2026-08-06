# ADR-026: Local External Links and Outbound Automation

- Status: **Accepted provisionally — connector, field, provider, and legal/privacy validation required before activation**
- Date: 2026-08-06
- Decision owners: Product / patients / privacy / integrations / security / operations
- Related: REQ-PAT-022–029, Q-024, ADR-016, ADR-017, ADR-019, ADR-021, ADR-025, R-015A, R-031

## Context

The prototype contains an external patient/invoice table and placeholders for webhooks, Sheets, and other integrations. A local read-only relationship view is materially different from sending patient-linked data to an external recipient. Confusing the two could turn an optional paid connector into an unreviewed health-data export or allow an external system to mutate local accounting facts.

## Decision

### Free local relationship view

- The Free Core external-link table is local-only, read-only, permissioned, and auditable. It may show authorized links between a Patient Profile/necessary identity and invoices or other approved local records.
- It cannot edit, delete, post, reverse, settle, or otherwise mutate patient, invoice, debt, stock, Cash Box, tax, or accounting records. Posted facts remain owned by their local domain modules.
- Local links can be detached or anonymized under ADR-017 without changing immutable financial, stock, tax, or accounting facts.

### Paid outbound integration contract

- Webhooks, Google Sheets, Zapier, broad APIs, and similar external connectors are separately entitled paid capabilities. Each connector is a versioned Outbound Integration Contract naming purpose, recipient/provider, region/transfer, retention, fields, consent/lawful basis, quota/cost, security terms, and owner authorization.
- The contract uses the minimum field allow-list. Operational identifiers/statuses such as event ID, invoice number, date, total, payment status, or due amount may be eligible after review. Patient names/phones, health facts, prescriptions, diagnoses, allergies, medicine histories, and clinical content are blocked by default and require a separately approved purpose, consent/basis, provider contract, and Iraqi legal/pharmacist review.
- No external connector can directly edit local authoritative records. Inbound callbacks are authenticated, tenant-bound, replay/idempotency protected, status-only unless a separately approved local command exists, and never overwrite posted facts.
- Outbound jobs are durable, encrypted, tenant-bound, auditable, cancellable, and revalidate consent/basis, entitlement, field allow-list, provider/jurisdiction gate, destination, and policy version at enqueue and send. Withdrawal or policy change stops unsent work and requests provider deletion where possible; Breev records provider confirmation/failure honestly.
- Shared phone control, a copied link, or a connector token is not patient identity or consent. Provider changes, material field/purpose/region/retention/subprocessor/training changes block new jobs until the contract is revalidated.

## Alternatives considered

- Put the table in the cloud and automatically expose it to connectors: rejected because the free local relationship view and outbound health-data processing have different authorities and consent.
- Allow generic webhooks with arbitrary JSON: rejected because field scope, patient minimization, retention, and tenant isolation become untestable.
- Let integrations write back directly: rejected because posted invoices, stock, payments, Cash Box, and journals are local-authoritative.
- Treat a phone number or integration token as consent: rejected by ADR-016; purpose, destination, identity, and lawful basis remain separate.

## Consequences

- Positive: pharmacies can use a useful local view without accidental disclosure, and future integrations remain replaceable, paid, scoped, and auditable.
- Negative: each connector needs a contract, provider/security/privacy review, durable queue and callback tests, field mapping, cost/retention controls, and revalidation on material change.
- Release gate: no outbound patient-linked automation is activated until its contract, provider terms/region, consent/basis, Iraqi legal/pharmacist review, security tests, deletion behavior, and owner approval are complete.
