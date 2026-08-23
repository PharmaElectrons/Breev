# ADR 0003: Explicit cloud authority and sync

**Status:** Accepted for the authority model and One-Way-first sequence, 2026-08-23

## Context

The local system controls core operations and must keep working offline. The cloud needs resumable reporting. A deferred future tier may request limited edits, but it cannot introduce dual writes, silent overwrites, or distributed transactions.

## Decision

M4 creates `cloud-api` for cloud-owned tenant, subscription, device, and licence state. It does not sync or edit pharmacy data.

M7 adds at-least-once One-Way Sync. The local business transaction writes a versioned outbox entry. The cloud commits inbox deduplication and its read projection in one transaction. The cloud acknowledgement then advances a durable local checkpoint. Local posting never waits for sync.

Posted operational and financial facts remain under permanent local authority. A future higher tier may request changes only through Cloud Commands for an explicit field-ownership allowlist. Each command has a unique identity, an expiry, and an expected version. The local system alone validates and applies the command. The cloud marks it `Applied` only after the local system acknowledges it.

A version conflict preserves Base, Current Local, and Requested Cloud. Resolution requires a new authorized local decision. Breev never uses direct dual writes, last-write-wins, timestamp wins, CRDTs, or a generic merge engine.

The first cloud deployment uses one managed PostgreSQL database with immutable tenant IDs. Application code verifies tenant scope, and `FORCE ROW LEVEL SECURITY` adds another tenant boundary. Provider and region remain gated.

## Alternatives considered

- Direct local and cloud writes cannot form one atomic transaction across an internet failure.
- A generic two-way merge or CRDT cannot infer ownership or safely merge financial and stock facts.
- A database for each tenant offers stronger physical isolation. Contracts and scale do not yet justify its cost and operating burden.
- A broker and microservices add no value for one API and a PostgreSQL-backed outbox.

## Consequences

At M4, protected commercial operations may change only cloud-owned tenant, subscription, device, and licence state. At M7, the first remote pharmacy-data UI remains read-only and shows freshness and backlog.

Every sync schema carries a version for the supported in-flight horizon. Before a release removes compatibility, the team drains affected work or coordinates the update. Breev does not keep fallback decoders indefinitely. Any future editable pharmacy field needs explicit approval and tests before the team adds it to the allowlist.

Evidence: [AWS transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html), [HTTP `If-Match`](https://www.rfc-editor.org/rfc/rfc9110.html), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
