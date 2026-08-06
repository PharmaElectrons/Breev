# ADR-022: Cloud Region, Recovery, Monitoring, and Incident Operations

- Status: **Accepted provisionally — Phase 2 provider/region/support review and pre-Phase-9 deployment revalidation required**
- Date: 2026-08-06
- Decision owners: Product / cloud platform / security / privacy / legal / operations / support
- Related: REQ-NFR-002, REQ-NFR-017–026, Q-020, ADR-013, ADR-017, R-001, R-011, R-027

## Context

Breev's paid cloud services will hold tenant-isolated projections, subscriptions, licences, provider jobs, and operational metadata, but the Main Pharmacy Computer remains authoritative for core local business operations. Phase 0 therefore needs measurable cloud recovery and support boundaries without prematurely buying a vendor, choosing a permanent region, or allowing a cloud outage to stop the pharmacy.

The stakeholder approved this policy as a provisional baseline and explicitly requested that the provider, region, support, and commercial choices be discussed again in Phase 2. Because deployment occurs later, the chosen configuration must also be revalidated before Phase 9.

## Decision

### Provider, region, and data location

- Phase 0 selects no cloud provider, primary region, disaster-recovery region, support plan, or commercial commitment.
- Phase 2 compares currently supported nearby Middle East regions—initial candidates include AWS Bahrain/UAE, Azure Qatar/UAE, and supported Google Cloud Middle East regions—against Iraqi legal/data-residency review, patient-data restrictions, latency, service availability, contractual safeguards, support, subprocessors, and total cost.
- A versioned Cloud Data Location Matrix must identify where each database, file store, backup, log, queue, support path, and subprocessor operates, including country/region and permitted transfer. Breev must not silently move data to a different region or subprocessor.
- Production and test environments are isolated. Non-production uses synthetic or irreversibly anonymized data unless a separately approved exceptional process exists.

### Availability, protection, and recovery

- Production uses managed PostgreSQL in a multi-zone/high-availability configuration supported by the selected provider. Cloud data and backups are encrypted in transit and at rest; key administration, backup administration, and ordinary production access are separated.
- The cloud recovery target is RPO no greater than 15 minutes and RTO no greater than 4 hours. Retain at least 30 days of point-in-time recovery plus daily protected snapshots under a policy that prevents an ordinary compromised application identity from deleting every recovery copy.
- Verify an automated restore at least monthly and run a documented end-to-end recovery drill at least quarterly. Backup completion alone is not recovery evidence.
- A restored environment stays in Restore Quarantine until the Deletion Ledger, legal holds, device/certificate revocations, and later security changes are replayed and verified.
- Each pharmacy's approved local backup remains independent. Cloud storage, synchronization, or disaster recovery never replaces local recovery.
- Target 99.9% monthly availability for paid cloud functionality. Cloud failure may delay cloud views, provider work, sync, or licence reconciliation, but it must not stop Free Core POS, LAN operation, printing, local reports/history, local backup/export, or access to pharmacy-owned data.

### Monitoring and privacy

- Monitor cloud API availability/latency/errors, database health/capacity, tenant-isolation failures, authentication anomalies, synchronization backlog, provider queues/dead letters, licence issuance, backup completion, restore readiness, and suspicious bulk access/export.
- Alerts must be actionable and routed to named on-call owners. Logs and metrics exclude secrets and unnecessary patient data and follow ADR-017's versioned retention and access boundaries.
- A privacy-safe public/service status view may identify affected capabilities and regions but must not expose pharmacy, patient, security-sensitive, or tenant-specific details.

### Incident response and support

- `SEV-1` covers confirmed/suspected breach, cross-tenant exposure, material corruption, total cloud outage, or licence/control-plane outage. Provide 24/7 response, acknowledge within 15 minutes, notify affected pharmacy owners within 1 hour when impact is known or reasonably suspected, and update at least hourly until containment/recovery.
- `SEV-2` covers widespread paid-cloud degradation without loss of safe local Core POS: acknowledge within 1 hour and update at least every 4 hours.
- `SEV-3` covers limited non-critical failures: acknowledge by the next business day.
- Preserve forensic evidence and apply scoped Legal Holds without silently extending unrelated data retention. Issue a written incident summary within five business days after resolution unless investigation or law requires a justified revised date.
- The selected provider/support contract must offer 24/7 escalation for critical infrastructure incidents. Internal ownership, escalation contacts, customer communications, recovery authority, and post-incident review must be documented and tested.

## Alternatives considered

- Select a vendor and cheapest nearby region during Phase 0: rejected because legal/residency, supported-service, contract, subprocessor, and commercial evidence is incomplete.
- One availability zone with nightly backup: rejected because it cannot support the approved RPO/RTO or survive common zone/application compromise scenarios.
- Treat a successful backup job as proof of recovery: rejected because an unusable or security-stale restore still fails the business.
- Make cloud availability a prerequisite for sales: rejected because Breev is offline-first and the Free Core POS/data boundary survives subscription and cloud outages.
- Let provider timestamps/status alone determine incident severity: rejected because tenant isolation, data integrity, licences, and provider queues require Breev-specific impact classification.

## Consequences

- Positive: cloud outages cannot hold local operations hostage; provider selection becomes evidence-driven; recovery is measurable and tested; privacy deletion, revocation, and legal-hold state survives restoration; customers receive predictable critical-incident communication.
- Negative: multi-zone databases, protected recovery copies, monitoring, on-call coverage, support contracts, restore tests, and incident exercises increase recurring cost and operational work.
- Phase 2 gate: approve a comparison of candidate provider, primary/DR region, supported services, Cloud Data Location Matrix, cost, contract/DPA, support plan, and operating ownership. This review does not itself deploy production cloud infrastructure.
- Pre-Phase-9 gate: revalidate current provider/service availability, data locations/subprocessors, legal and privacy requirements, capacity, pricing, RPO/RTO evidence, restore drills, monitoring, and incident runbooks before deployment.

## Official service evidence checked during Phase 0

- AWS RDS Multi-AZ deployments: https://aws.amazon.com/rds/features/multi-az/
- AWS RDS automated backups and point-in-time recovery: https://aws.amazon.com/rds/features/backup/
