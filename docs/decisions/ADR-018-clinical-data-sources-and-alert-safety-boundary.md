# ADR-018: Clinical Data Sources and Alert Safety Boundary

- Status: **Accepted conditionally — commercial licence and pharmacist release validation required**
- Date: 2026-08-06
- Decision owners: Product / clinical / pharmacist / legal / platform / security
- Related: REQ-CLN-001–013, Q-016, ADR-016, ADR-017, R-014, R-014A

## Context

The prototype contains heuristic medicine suggestions, but a pharmacy system must not imply clinical safety from incomplete patient information, uncertain Iraqi-product mappings, unlicensed data, stale offline content, or a missing alert. Iraqi regulatory sources answer registration, recall, and restriction questions; they do not replace a licensed clinical interaction knowledge base. A production boundary must therefore separate regulatory authority, clinical knowledge, professional judgement, and ordinary POS availability.

## Decision

### Sources, licence, and approved scope

- Breev uses Iraqi regulatory authority sources for registration, recalls, restrictions, and regulatory sale controls, and a separately licensed commercial source for normalized ingredients and clinical safety content. The Iraq Essential Drugs List is not treated as a registration or interaction database.
- Phase 0 selects no clinical vendor. Before release, the contract must explicitly permit Breev's commercial pharmacy use in Iraq, multi-tenant use, offline/on-device bundles, display, professionally reviewed translation, immutable audit snapshots, and safety-related use. Public or research access alone is insufficient.
- Initial scope is deterministic drug–drug and drug–allergy evaluation, plus duplicate-therapy alerts only when licensed content and pharmacist validation support them.
- Diagnosis, prescribing, dosage, pregnancy, renal/hepatic adjustment, contraindication, disease-interaction, and other therapeutic advice are excluded unless separately licensed, designed, and pharmacist-validated.

### Mapping and interpretation

- Iraqi products link to normalized active ingredients through pharmacist-reviewed, versioned Clinical Product Mappings. Missing, ambiguous, or invalid mapping returns `Not Evaluated`, never `Safe`.
- Contraindicated/major alerts require pharmacist review and a recorded decision; cashiers see only `Pharmacist review required`. Moderate alerts are visible but non-disruptive; minor alerts are available on demand.
- Clinical Alerts are advisory and pharmacist-overridable with a reason. Official recall, expiry, quarantine, and validated regulatory sale controls are separate non-overridable Regulatory Hard Blocks.
- No alert never means that use is safe, particularly when patient history or mapping is incomplete.
- Safety-critical Arabic and English text is professionally translated and pharmacist-validated; unreviewed machine translation cannot supply production clinical guidance.

### Evidence, offline updates, and failure behavior

- Every evaluation appends an immutable Clinical Evaluation Snapshot containing medicine/input IDs, mapping versions, dataset/version dates, rule versions, severity/result, displayed guidance, actor, acknowledgement, decision, and Trusted Breev Time. Later content changes never rewrite it; ADR-017 governs retention.
- Offline content arrives as a signed Clinical Data Bundle. Breev validates its signature, schema, mappings, and compatibility, activates it in stages, and can return to a last-known-good bundle.
- Critical safety/recall content applies within 24 hours of receipt; normal content applies within seven days. Freshness is checked daily. More than 30 days stale produces a persistent pharmacist/owner warning; more than 90 days stale makes evaluation unavailable/`Not Evaluated`, never reassuring.
- An audited Clinical Kill Switch can disable clinical evaluation when integrity or safety is doubtful. Core POS and Regulatory Hard Blocks continue independently.

### Required liability wording

Production guidance must communicate in validated Arabic and English: “Breev provides clinical decision support using licensed data and the information available at evaluation time. It does not diagnose, prescribe, determine dosage, or replace pharmacist or physician judgment. Absence of an alert does not confirm safety.”

## Alternatives considered

- Reuse prototype heuristics: rejected because their evidence, licensing, scope, and clinical validation are inadequate.
- Treat a public list or research dataset as sufficient: rejected because regulatory purpose and commercial safety-content rights differ.
- Block every alert or let cashiers override it: rejected because clinical advisories require pharmacist judgement while regulatory sale blocks must remain hard controls.
- Keep showing old results indefinitely while offline: rejected because stale content creates false reassurance.
- Disable POS when clinical content fails: rejected because Core POS continuity and regulatory blocking must not depend on optional clinical evaluation.

## Consequences

- Positive: Breev preserves ordinary pharmacy operations while making source authority, uncertainty, professional review, hard blocks, data freshness, and historical evidence explicit.
- Negative: the feature requires commercial licensing, pharmacist mapping/review operations, bilingual content validation, signed bundle distribution, freshness monitoring, immutable snapshots, and safety incident controls.
- Release gate: no production Clinical Alert until a source contract, Iraqi-product mapping process, pharmacist validation plan, bilingual wording, update SLA evidence, and clinical-content operational owner are formally approved.
