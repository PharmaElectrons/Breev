# ADR-020: Supplier-Invoice OCR Provider, Review, and Data Boundary

- Status: **Accepted conditionally — successful Iraqi-invoice benchmark and provider contract/DPA required**
- Date: 2026-08-06
- Decision owners: Product / purchasing / accounting / privacy / legal / integrations / billing
- Related: REQ-PUR-007, REQ-OCR-001–012, Q-018, ADR-006, ADR-016, ADR-017, R-015, R-015D

## Context

Supplier-invoice OCR can speed purchase entry, but one misread digit, unit, discount, batch, or expiry can corrupt stock, payable, carrying cost, and profit. Cloud document services also differ in Arabic invoice semantics, Iraqi currency/layout performance, processing region, retention, training rights, and page pricing. A confident extraction therefore remains untrusted input, and provider selection must follow local evidence rather than a marketing capability list.

## Decision

### Qualification and provider choice

- Phase 0 selects no provider. Azure Document Intelligence is only the leading benchmark candidate because its current prebuilt invoice documentation lists Arabic and documents same-request-region temporary storage/deletion after 24 hours; IQD and Iraqi layouts are not assumed supported without tests. Google and other contract-eligible options may be compared.
- Each provider/model/region must pass a controlled representative OCR Benchmark Corpus of Arabic, English, and mixed Iraqi supplier invoices, including major supplier layouts, scans, and phone photos. Production requires at least 99% exact match for critical quantity/cost/discount/tax/total/date/batch/expiry fields and at least 95% usable line extraction.
- A material provider, model, region, or extraction-policy change repeats privacy review and qualification. Failure leaves manual entry in place and approves no provider.

### Draft and human-review boundary

- Extraction creates only an OCR Draft with no business effect. It cannot create products/suppliers/batches, post purchases, change prices/costs, move stock, make payments, or create journals.
- Every critical field is displayed with its highlighted source location and must be confirmed or corrected by an authorized human. Confidence never constitutes approval; unknown product/supplier/unit/batch mappings require explicit resolution and cannot create duplicates silently.
- Breev independently parses and recalculates packaging quantities, exact IQD amounts, discounts, taxes, lines, and totals under approved domain rules. Provider normalization and arithmetic are suggestions only.
- An immutable OCR Provenance Snapshot records the local source hash, unique job, provider/model/version, region, field locations/confidences, extracted and corrected values, reviewer, times, page count/charge, provider-deletion outcome, and final state. Idempotent retries/callbacks cannot create duplicate drafts or untracked charges.

### Data, retention, and continuity

- Provider approval requires a DPA/contract covering the approved region/transfers, subprocessors, encryption, incident duties, deletion evidence, no general-model training or unrelated reuse, and minimum data. Provider working copies/results delete promptly, never exceeding 30 days; zero/24-hour retention is preferred.
- Ordinary supplier invoices without patient data require no patient consent. Expected/detected patient data blocks ordinary external OCR unless redacted or separately approved under ADR-016.
- The encrypted local original becomes Supplier Invoice Evidence when linked to a posted purchase and follows ADR-017's applicable commercial-record policy. Unposted/abandoned uploads follow the 90-day draft rule; provider copies remain temporary.
- OCR is page-entitled: warn owner/admin at 80%, stop external jobs at 100%, never auto-charge overage, and allow only explicit page purchase or visible capped overage. Offline, outage, expiry, quota, or rejection never blocks manual purchasing or access to preserved drafts/evidence.

## Alternatives considered

- Select Azure directly from published Arabic support: rejected because language support does not prove IQD, supplier-layout, field, or image-quality performance.
- Auto-post high-confidence results: rejected because provider confidence is not business authorization and small digit errors have material effects.
- Keep provider documents indefinitely for debugging/training: rejected because working copies are not the authoritative commercial archive.
- Count invoices rather than pages: rejected because provider cost and work commonly vary with page count.
- Permit automatic overage to avoid interruption: rejected because manual purchasing remains available and surprise charges are unnecessary.

## Consequences

- Positive: OCR may save entry time without becoming an inventory/accounting authority; provider accuracy, privacy, retention, cost, and change risk are measurable and replaceable.
- Negative: Breev needs a governed benchmark corpus, source-highlight review UI, local recalculation, durable/idempotent jobs, provider deletion evidence, page metering, and periodic requalification.
- Release gate: approve the benchmark evidence, provider/model/region, DPA/security/subprocessor/no-training/deletion terms, page pricing, and incident/support owner before production activation.

## External provider evidence checked during Phase 0

- Azure prebuilt invoice and Arabic language support: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt
- Azure storage/deletion behavior: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/faq
- Google Document AI processor/language/region listings: https://docs.cloud.google.com/document-ai/docs/processors-list
