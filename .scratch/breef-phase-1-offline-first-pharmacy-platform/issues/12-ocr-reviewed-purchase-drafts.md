# 12 — OCR-reviewed purchase drafts

**What to build:** An entitled buyer can submit an eligible supplier invoice to an approved OCR provider and receive a source-linked, locally recalculated OCR Draft that still requires complete human review before purchasing effects are posted.

**Blocked by:** 05 — Purchasing, batches, expiry, inventory, and valuation.

**Status:** ready-for-agent

- [ ] Provider, model, region, Tenant entitlement, page allowance, privacy, no-training, and patient-data gates run before external processing.
- [ ] Extraction preserves field locations, confidence, provider/model/region, source hash, job identity, page count, and deletion outcome in an OCR Provenance Snapshot.
- [ ] Every critical quantity, cost, discount, total, date, batch, and expiry field is highlighted for human confirmation or correction.
- [ ] Breev independently maps units and recalculates exact quantities, IQD totals, discounts, and taxes; provider confidence never posts business effects.
- [ ] Unknown products, Suppliers, units, or batches require explicit resolution and cannot create duplicates silently.
- [ ] Page allowance warnings/stops, idempotent retries, temporary provider retention, and manual offline fallback are tested.
