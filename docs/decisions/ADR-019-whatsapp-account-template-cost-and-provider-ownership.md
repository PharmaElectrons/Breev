# ADR-019: WhatsApp Account, Template, Cost, and Provider Ownership

- Status: **Accepted conditionally — provider contract and per-template policy/legal/pharmacist approval required**
- Date: 2026-08-06
- Decision owners: Product / messaging / privacy / legal / pharmacist / billing / operations / security
- Related: REQ-MSG-001–010, Q-017, ADR-016, ADR-017, R-015, R-015A, R-015C

## Context

WhatsApp can be useful for pharmacy service messages, but a Breev-owned or shared sender would blur the patient's pharmacy relationship, mix tenants, concentrate suspension risk, and make provider exit difficult. Meta also places responsibility for accurate business identity, opt-in, approved templates, regulated-health content, and account security on the business, while message prices and policies change by category and market.

## Decision

### Pharmacy ownership and Breev's role

- Each pharmacy owns its WhatsApp Business account, verified business identity, dedicated valid phone number, customer relationship, opt-ins, template content, and attributable provider costs. No account or sender number is shared across tenants.
- Breev connects only through the official WhatsApp Business Platform as a replaceable technical provider or provider-neutral adapter. It manages consent/policy checks, versioned templates, durable queues, provider status, usage attribution, and audit; it does not become the pharmacy brand or owner of its number/content.
- Pharmacy-granted access is minimum-scope and revocable. On authorized disconnect or provider change, Breev revokes credentials and exports supported configuration/template/delivery/audit evidence. Breev must not create contractual or technical lock-in, although number/provider migration remains subject to the platform's then-current rules.

### Templates, consent, and policy

- A pharmacy owner or named authorized user approves each immutable Arabic/English WhatsApp Template Version. Evidence includes purpose, language, Meta category, consent scope, content/version, submitter/approver, applicable provider-policy version, platform approval/pause/rejection state, and Trusted Breev Time.
- Business-initiated messages use platform-approved templates where required. Breev revalidates consent/opt-out, destination, template state, entitlement, provider/jurisdiction gate, and current policy both before enqueue and before send.
- Platform template approval is necessary but never sufficient: it cannot override ADR-016 patient consent/privacy rules, Iraqi law, pharmacist review, or regulated-medicine/health restrictions.
- Medicine marketing and health-detail templates remain disabled in Iraq until the exact use is permitted by current Meta policy and formally approved by Iraqi legal and pharmacist review. A generic service label is not an automatic exemption.

### Charges, callbacks, and tenant safety

- Meta/provider delivery cost belongs to the sending pharmacy and is attributed using the current recipient market, category, quantity, and provider rules. Any Breev plan allowance and overage is explicit before use and itemized; silent overages, hidden fees, and cross-tenant cost pooling are prohibited.
- Incoming provider callbacks are authenticated, bound to the expected pharmacy/account/number, idempotently deduplicated, and applied through ordering-safe status transitions. Unknown, replayed, or cross-tenant identifiers are rejected and audited without leaking patient content or provider secrets.

## Alternatives considered

- One Breev-owned number for all pharmacies: operationally simple but misleading to patients, unsafe for tenant isolation, and a single policy/suspension failure domain.
- Breev owns a separate number for every tenant: improves separation but still holds the pharmacy's public identity and migration leverage.
- Permit unofficial WhatsApp automation: rejected because it bypasses official policy, security, templates, and reliable delivery/status controls.
- Treat Meta template approval as final authorization: rejected because consent, geography, Iraqi law, professional rules, and health privacy remain independent gates.
- Hide messaging inside a flat subscription price: rejected unless an explicit included allowance and overage policy makes variable provider costs predictable.

## Consequences

- Positive: patients see the real pharmacy identity; account suspension, cost, consent, and audit remain tenant-specific; Breev can replace providers without owning the customer relationship.
- Negative: each pharmacy needs verified onboarding, sender/credential lifecycle, template governance, transparent metering, webhook isolation, and provider migration support.
- Release gate: select and contract an official provider/direct-platform model, validate onboarding and number migration in Iraq, approve the DPA/security/retention terms, and approve every enabled template category under current Meta policy plus Iraqi legal/pharmacist review.

## External policy evidence checked during Phase 0

- WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/
- WhatsApp Business Platform pricing: https://whatsappbusiness.com/products/platform-pricing/
- WhatsApp Business Terms: https://www.whatsapp.com/legal/business-terms
