# ADR-021: External Payments and Official E-Invoicing Boundary

- Status: **Accepted conditionally — licensed provider and official jurisdiction/legal/accountant validation required**
- Date: 2026-08-06
- Decision owners: Product / payments / accounting / legal / tax / security / operations
- Related: REQ-PAY-001–011, REQ-EINV-001–006, REQ-FUT-005, Q-019, ADR-005, ADR-006, ADR-013, R-010A, R-026

## Context

Breev's Core POS must work without becoming a payment intermediary or falsely claiming government e-invoice compliance. External collection has failure states that differ from invoice posting—especially timeouts, later settlement, refunds, and chargebacks—while Iraqi provider licences identify different roles. An electronic-looking receipt is also not necessarily an authority-accepted tax invoice, and inspected federal, Kurdistan government-billing, and customs digitization sources do not establish one interchangeable retail-pharmacy regime.

## Decision

### Provider, funds, and payment state

- Phase 0 selects no gateway. A future provider must be currently listed/licensed by the Central Bank of Iraq for the exact acquiring, processing, wallet, QR, or collection role used.
- The pharmacy owns its Merchant Account, provider contract, settlement bank account, and funds. Breev is a replaceable technical adapter; it does not custody money, aggregate merchants, issue payment rights, or present itself as a licensed payment provider.
- Prefer semi-integrated/tokenized terminals, QR, or licensed wallets. Breev sends minimum amount/reference data and never stores PAN, CVV, PIN, magnetic-stripe data, reusable payment credentials, or provider secrets in application data/logs.
- Each exact-IQD Payment Attempt is unique and idempotent. Pending, Confirmed, Failed, Unknown, Voided, Refund Pending, Refunded, and Chargeback are explicit states with provider references and immutable evidence. A timeout becomes Unknown and the original reference is queried/reconciled; Breev neither assumes success/failure nor retries blindly.

### Invoice, settlement, refund, and continuity

- Provider authorization/capture, Posted Invoice, Payment Settlement, Cash Box/receivable effect, Provider Refund, and Chargeback are related but separate records. No external result rewrites a posted invoice or directly invents stock/accounting effects.
- Settlement preserves gross customer amount, provider fee, net bank deposit, date/reference, and discrepancy. Refunds link to approved Return/Reversal workflows but retain independent permission, amount, idempotency, failure, and audit states; original evidence remains.
- Authenticated callbacks bind expected tenant, merchant, amount, currency, and reference and reject replay/mismatch/cross-tenant results.
- Electronic-payment failure never blocks cash/credit Free Core operation. Offline electronic acceptance exists only when provider-certified and contractually approved. Subscription expiry stops new paid initiation but does not hold pre-expiry reconciliation, void/refund/dispute evidence hostage; a documented provider-portal fallback is required.

### Official electronic tax invoices

- A Breev receipt, PDF, email, QR, or signature is not labelled an Official Electronic Tax Invoice without a validated applicable Iraqi/Kurdistan authority, taxpayer scope, mandate, technical specification, credential/certification, and acceptance process.
- Iraqi legal/accounting review must establish jurisdiction, document/correction types, numbering, fields/taxes, signatures/seals/QR, submission deadlines, retention/reporting, rejection, and outage/fallback rules. Kurdistan government `e-Psûle`, federal tax modernization, and customs commercial-invoice verification are not assumed to govern ordinary pharmacy retail invoices.
- A future adapter creates an immutable Tax Submission Snapshot of the exact posted invoice/correction version, payload/spec/authority, credentials, requests/responses, status, and correction chain. Rejection/cancellation never rewrites the invoice; only authority-approved credit/reversal/amendment/replacement/resubmission flows apply.
- Offline queueing or fallback is enabled only when and as the authority explicitly permits; Breev does not invent an offline compliance claim.

## Alternatives considered

- Breev-owned merchant aggregation: rejected because it creates licensing, custody, tenant, settlement, and exit risk.
- Mark timeout as failed and retry: rejected because it can double-charge the customer.
- Treat a successful provider response as the invoice: rejected because sales, stock, accounting, external money, and settlement have different authorities and lifecycles.
- Delete/rewrite invoices after chargeback/refund/rejection: rejected because it destroys the audit and correction chain.
- Build a generic “Iraqi e-invoice” QR now: rejected because the responsible jurisdiction and retail-pharmacy technical/legal requirements are not established by the inspected official evidence.

## Consequences

- Positive: cash remains reliable; future providers are replaceable/licensed; timeouts, fees, settlements, refunds, and disputes reconcile without corrupting invoices; tax compliance cannot be overstated.
- Negative: future work requires merchant onboarding, secure semi-integration, durable state queries/callbacks, settlement reconciliation, refund/dispute operations, and jurisdiction-specific legal/certification adapters.
- Release gate: current CBI role/licence, merchant/settlement contract, security/PCI responsibility map, provider test evidence, accountant posting/reconciliation examples, and official jurisdiction/spec/legal/accountant acceptance.

## Official evidence checked during Phase 0

- CBI licensed e-payment providers: https://cbi.iq/page/25
- CBI warning against unlicensed providers: https://cbi.iq/news/view/650
- Iraq General Commission for Taxes: https://tax.mof.gov.iq/
- Kurdistan government `e-Psûle` announcement (government invoices, initially electricity): https://gov.krd/dmi-ar/activities/news-and-press-releases/2026/february/%D8%A5%D8%B7%D9%84%D8%A7%D9%82-%D9%85%D9%86%D8%B5%D8%A9-%D8%A7%D9%84%D9%81%D8%A7%D8%AA%D9%88%D8%B1%D8%A9-%D8%A7%D9%84%D8%A3%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%D8%A9-e-ps%C3%BBle/
