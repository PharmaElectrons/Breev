# ADR-016: Patient Purpose, Basis, and Consent Boundary

- Status: **Accepted conditionally — Iraqi legal and pharmacist release validation required**
- Date: 2026-08-06
- Decision owners: Product / privacy / legal / pharmacist / integrations
- Related: REQ-PAT-001–011, REQ-MSG-001, REQ-AI-001, Q-014, Q-015, Q-017, Q-018, R-011, R-013, R-015, R-015A

## Context

An ordinary pharmacy sale does not require a longitudinal patient record. Some workflows genuinely require identity or contact data—for example credit-account management or a legally required dispensing record—while CRM profiles, health facts, reminders, marketing, and external provider processing are optional and more intrusive. Treating all processing as one consent, or treating a supplied phone number as permission, would obscure the real basis and expose sensitive health data.

## Decision

### Necessary processing versus optional profile

- Ordinary Core POS sales are anonymous unless identification is genuinely required for a documented legal, professional, contractual, credit-account, or business purpose.
- Necessary data uses its documented lawful/business basis and minimum necessary scope; Breev does not present artificial optional consent for processing that is actually required.
- Immutable transaction history is distinct from the optional longitudinal Patient Profile. A posted invoice may retain required party facts under its applicable basis, but linking transactions into identifiable CRM/health history requires its own approved purpose and basis.
- A phone number collected for one required purpose authorizes no profiling, marketing, WhatsApp, health storage, or external AI/OCR use.

### Purpose-specific optional consent

- Separate purposes cover: optional Patient Profile/longitudinal purchase history; allergies/conditions/prescriptions/other health facts; service reminders; marketing; each external messaging channel; and external AI/OCR involving patient data. One purpose/channel never authorizes another.
- Consent is informed, affirmative, specific, unbundled, and presented in Arabic and English. Preselection, silence, continued use, or mere phone-number provision is not consent. Denial cannot block an ordinary service that does not need that processing.
- Consent is an immutable event history, not an overwritten status. Each granted/denied/withdrawn event preserves patient, purpose/category, policy/notice version, language, channel/provider/verified destination, actor/source/device, Trusted Breev Time, evidence, and guardian/proxy identity/relationship/authority where applicable.
- Minors or people lacking decision capacity use an appropriately authorized representative or other legally accepted basis. Age/capacity/guardian rules remain configurable until Iraqi validation.

### Messaging boundary

- WhatsApp consent binds patient, verified phone number, pharmacy, permitted message categories, provider, and policy version. Service updates, reminders, credit messages, marketing, and any approved health communication are separate category choices with easy inside/outside-channel opt-out.
- Opt-in never overrides provider policy, geography, medicine-advertising restrictions, professional rules, or Iraqi law. Every category passes a provider-policy/jurisdiction gate. Medicine/medical-product promotional messaging in Iraq is disabled by default until its exact use is formally approved.
- Default message text minimizes privacy exposure on previews/shared phones. Medicine names, conditions, prescriptions, or other health facts require a separately approved workflow. Consent does not transfer between patients sharing a family phone; changed destinations require verification and new consent where applicable.

### External AI/OCR and provider approval

- External processing of patient data is blocked without approved consent or another specifically validated basis. Notice discloses provider, purpose, data categories, processing/storage region, cross-pharmacy/country transfer, retention/deletion, subprocessors, training use, and withdrawal.
- Supplier-invoice OCR with no patient data needs no patient consent.
- Consent alone never approves a provider. Contractual/technical approval also requires data-processing terms, encryption, restricted subprocessors, incident duties, deletion commitments, minimum-necessary data, and no general-model training on pharmacy patient data unless separately and lawfully approved.
- A material provider/purpose/region/retention/subprocessor/training change blocks new jobs pending renewed notice and revalidated consent/basis.

### Withdrawal, access, and release gate

- Withdrawal stops future optional processing and cancels unsent messages/queued jobs. For transmitted work, Breev requests cancellation/deletion where possible and records the provider-confirmed result; it never claims deletion without confirmation.
- Withdrawal does not retrospectively invalidate completed lawful processing or erase immutable invoices, accounting, required dispensing/debt records, or consent evidence. ADR-017 governs retention, deletion, and anonymization.
- Consent to store health facts does not grant staff access. Health access is independently role-controlled, minimum-necessary, and audited; cashier/non-clinical roles do not receive it by default.
- Patient health profiles, external patient-data AI/OCR, medicine-related messaging, and guardian-consent workflows cannot release until Iraqi legal and pharmacist review is formally documented.

## Alternatives considered

- One bundled “privacy consent”: simpler UI, invalid purpose boundaries and poor withdrawal semantics.
- Infer permission from phone number or sale: surprises patients and violates provider expectations.
- Require consent for legally necessary records: misleading because denial cannot truly stop the processing.
- Let provider selection follow consent automatically: ignores contractual, jurisdiction, security, and policy restrictions.
- Delete all history on withdrawal: corrupts accounting/legal records and consent evidence.

## Consequences

- Positive: anonymous core sales remain fast; optional sensitive uses are explicit, independently withdrawable, provider-aware, and auditable.
- Negative: consent policy/versioning, destination verification, provider/jurisdiction gates, representative rules, queue cancellation, and provider deletion confirmation add workflow complexity.
- Release gate: Iraqi counsel and pharmacist must validate bases, notice text, age/capacity/representative rules, medicine messaging, health-profile scope, and external processing before affected features ship.
