# Epic 09: Keep Patient Profiles, consent, access, retention, and clinical safety explicit

Type: epic
Status: needs-triage
Engineering phase: P7 — Patients
Blocked by: 02, 07; legal/pharmacist/licensing gates
GitHub issue: #11
Parent GitHub specification: #2

## User Story

As a patient and pharmacist, I want optional profile and approved health/communication context handled separately from immutable transaction facts, so that ordinary sales remain private while permitted uses are attributable, revocable, and clinically honest.

## Outcome

Deliver optional Patient Profiles, verified destinations, Necessary Processing Basis, purpose-specific Consent Events, withdrawal, independent role access, transaction/profile links, retention/deletion outcomes, export/support boundaries, and only licensed deterministic advisory clinical evaluation with `Not Evaluated` safety behavior.

## Expected workflow

1. Ordinary sale asks whether identity is genuinely required; otherwise it remains Anonymous Sale.
2. Required minimum identity is recorded under a documented basis and transaction snapshot; optional profile/contact/health/message use presents its own bilingual purpose.
3. Affirmative grant/denial/withdrawal appends a Consent Event scoped to Patient, purpose, channel/destination, provider context, and policy version.
4. Every use separately checks user access plus current purpose/basis, consent, destination, provider/jurisdiction, retention, and Entitlement.
5. Withdrawal stops future/queued optional use and seeks provider cancellation/deletion while preserving required historical evidence.
6. Clinical evaluation runs only when approved licensed data, mappings, freshness, and kill-switch state permit; otherwise result is `Not Evaluated`, never “safe.”

## Invariants and failure behavior

- Consent never grants staff access and never transfers between Patients sharing a phone.
- Profile edits/deletion/link removal never rewrite posted financial, stock, tax, or required identity facts.
- Advisory Clinical Alerts are distinct from non-overridable expiry/recall/quarantine Regulatory Hard Blocks.
- No diagnosis, prescribing, dosage, or unlicensed inference.

## Acceptance scenarios

- Given an ordinary cash sale with no necessary identity, when posted, then no Patient Profile is required or auto-created.
- Given consent is withdrawn after a message is queued, when send-time checks run, then sending is cancelled/held and the outcome is recorded.
- Given clinical content is missing, stale beyond limit, unmapped, invalid, or killed, when evaluation is requested, then `Not Evaluated` is displayed/snapshotted and Core POS remains usable.

## Planned child slices

- Optional profile lifecycle; necessary-basis identity; verified destinations/representatives; consent policy/events; withdrawal/queue integration; retention/deletion ledger/link detach; patient export/support access; clinical source/mapping/bundle; deterministic evaluation/snapshots/kill switch.

## Gate and exclusions

- ADR-016/017 Iraqi legal/pharmacist review and ADR-018 commercial licence/mapping/bilingual validation are mandatory. Clinic/doctor workflow and broad clinical advice are excluded.

## Traceability

- US-046–047, US-071–077; patient/privacy/clinical requirements; ADR-016–018, ADR-025.
