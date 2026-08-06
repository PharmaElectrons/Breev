# ADR-017: Retention, Deletion, Export, Backup Restoration, and Support Access

- Status: **Accepted conditionally — Iraqi legal and pharmacist validation required**
- Date: 2026-08-06
- Decision owners: Product / privacy / legal / pharmacist / accounting / security / support
- Related: REQ-PAT-002, REQ-PAT-005, REQ-PAT-010, REQ-PAT-012–021, REQ-NFR-002, REQ-NFR-013–016, Q-015, R-001, R-011, R-015A, R-015B, R-023

## Context

Breev holds records with different purposes and authorities: immutable commercial/accounting facts, required debtor or dispensing identity, optional CRM/health data, consent evidence, provider payloads, technical logs, backups, exports, and support artifacts. A single retention period or generic delete button would either destroy required history or retain sensitive data indefinitely. Backup restore and external providers also make deletion a continuing state transition rather than one database operation.

## Decision

### Versioned policy and provisional periods

- Every record class has a versioned/configurable Retention Policy with a named starting event. Provisional values are not represented as confirmed Iraqi legal requirements.
- Posted commercial, inventory, payment, accounting records, and the audit needed to interpret them provisionally remain seven years after fiscal-year close, final settlement, or other applicable closing event, whichever is later. Ten years is selectable only with documented Iraqi legal/tax/accounting/contractual/risk advice.
- Legally required dispensing, prescription, controlled-medicine, and health record classes, starting events, and periods are release-blocked until Iraqi legal/pharmacist validation.
- Consent event history remains provisionally seven years after the last event or purpose termination, whichever is later, subject to complaint/dispute/investigation/hold or approved longer requirement.
- Optional Patient Profile CRM/health facts become eligible for deletion, detachment, or irreversible anonymization on withdrawal or three years of inactivity unless another documented basis applies; active debt, required dispensing, dispute, investigation, and hold are evaluated separately first.
- Provisional technical defaults: ordinary message content at most 12 months; sensitive health-message content 90 days unless documented longer purpose; delivery/consent-compliance metadata 3 years; inactive drafts/temp uploads 90 days from last meaningful activity; external AI/OCR working data deleted promptly with provider maximum 30 days and zero-retention preferred; ordinary technical logs 90 days; security-incident logs at least one year and through investigation/closure; support files/screenshots 30 days after ticket closure; backups 30 rolling days. Security, deletion, export, support, and high-risk audit may use longer approved classes.

### Identity separation, deletion, and holds

- The data model separates required transaction/debtor identity, optional CRM identity, optional health facts, and optional-profile links to posted transactions. Optional health/CRM detail is not copied unnecessarily into immutable document snapshots.
- Where posted identity is not required, an eligible optional profile link may be removed/anonymized without changing financial, stock, tax, or accounting facts.
- Irreversible anonymization means no Breev/pharmacy/provider/reasonably available party can reconnect the record using a retained key, map, identifier, or attribute combination. Reversible pseudonymization is named honestly and is not deletion/anonymization.
- The pharmacy or explicitly authorized representative is the operational decision-maker. Breev Support cannot independently delete pharmacy records because a person contacts Breev. A request verifies identity/authority, pharmacy/record scope, grounds and holds, required authorization, and result.
- Every affected record class receives one result: Deleted; Irreversibly anonymized; Retained—active debt; Retained—legal/professional requirement; Retained—scoped legal hold; Provider deletion pending; Provider deletion failed; Not found; or Rejected—identity/authority not verified.
- A Legal Hold records reason, data scope, authorizer, start, review, expected expiry/release condition, and final release. It suspends disposal only inside its scope.

### Providers, deletion ledger, backup restoration, and media

- Provider-held data remains `Provider deletion pending` or `Provider deletion failed` until provider confirmation. Contracts support deletion requests/limits and prohibit unauthorized training/reuse.
- A protected minimal Deletion Ledger/tombstone prevents deleted/anonymized profiles, messaging permissions, and health facts from reappearing. After restoring an older backup, Breev reapplies the Deletion Ledger, legal holds, revocations, and subsequent security changes before ordinary access.
- Backup archives age out naturally under the 30-day rolling policy rather than being individually rewritten.
- End-of-period disposal is controlled deletion or irreversible anonymization, never silent indefinite retention. Media reuse/disposal uses approved sanitization appropriate to sensitivity and storage technology.

### Export and support access

- Patient export requires permission plus verified identity/authority; shared-phone control alone is insufficient. Temporary cloud links expire within 24 hours, are revocable/use-limited, encrypted in transit/at rest, audited, and exclude other people sharing a number. Provide human-readable and structured formats where appropriate.
- Support access is disabled by default, ticket-bound, owner-authorized, named, strongly authenticated, least-privilege, read-only by default, time-limited, automatically revoked, and fully audited. Shared accounts and standing unrestricted access are prohibited.
- Support sees patient data only when necessary after preferring redaction, masks, test data, and the smallest scope. Download/export/screenshot/direct-DB/write each requires separate elevation and justification.
- Emergency support uses a documented break-glass grant with stronger authorization, short expiry, owner notification, detailed activity logging, and mandatory post-access review.

### Mandatory release validation

Iraqi legal and pharmacist validation remains a release gate for required dispensing/health records; commercial/accounting applicability to pharmacies/electronic POS; debtor/dispute retention; patient deletion/access; guardian/proxy requests; and mandatory reporting/preservation duties.

## Alternatives considered

- One global retention period: cannot reconcile accounting, health, consent, transient provider, and support purposes.
- Hard-code ten years as Iraqi law: unsupported by the Phase 0 evidence and unnecessarily retains some data.
- Let Breev Support approve deletion directly: bypasses the pharmacy's record authority and legal context.
- Rewrite every backup on deletion: operationally risky; a protected ledger plus pre-release replay preserves the result.
- Call pseudonymized data anonymous: understates re-identification risk.
- Standing support access: convenient but incompatible with least privilege and meaningful owner authorization.

## Consequences

- Positive: records expire by explicit class/basis without corrupting immutable ledgers; restored backups/providers/support cannot silently bypass deletion decisions.
- Negative: Breev needs policy versioning, start-event calculation, structural identity separation, request/hold/outcome workflows, a protected deletion ledger, restore quarantine/replay, provider confirmation, export controls, and just-in-time support access.
- Verification: boundary/date fixtures, active-debt/hold scenarios, anonymization re-identification review, multi-class request outcomes, provider failure, backup resurrection tests, shared-phone export denial, support elevation/expiry, break-glass review, and media-sanitization evidence.
