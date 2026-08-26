# G-06: PostgreSQL-Native Durable Jobs Selection & Resilience Proof

Date: 26 August 2026

Issue: GitHub #37

Base: `issue/06-durable-jobs`

---

## 1. Technical Evaluation & Library Selection

Breev requires durable background job processing on offline Main devices without Redis, separate worker processes, or complex external infrastructure.

### Candidate Comparison

| Dimension | `pg-boss` (v12.28.0) | Graphile Worker | BullMQ / Redis |
| :--- | :--- | :--- | :--- |
| **Backend Storage** | PostgreSQL native (`SKIP LOCKED`) | PostgreSQL native (`SKIP LOCKED`) | Redis (separate server required) |
| **Transactional Enqueue** | Native with Drizzle ORM (`fromDrizzle`) and `pg.PoolClient` | Native via raw SQL query / helper | Not possible across DB & Redis without 2PC |
| **Process Model** | Embedded in NestJS application runtime | Embedded or CLI worker | Requires external Redis process |
| **Role Separation & DDL** | Supports external migration (`createSchema: false, migrate: false`) | Supports external migration via SQL files | N/A (Redis keyspace) |
| **Maintenance & Retention** | Built-in partition management, expiration, retry backoff, and dead-letter queues | Custom retention triggers and tasks | Redis TTL / Stream trimming |
| **Decision** | **Selected (Leading Candidate)** | Fallback | **Rejected** (Violates offline single-binary architecture) |

### Version Pin

- `pg-boss`: `12.28.0` pinned in `apps/local-api/package.json`.

---

## 2. Privileged Migration Architecture & Least-Privilege Role Separation

Breev enforces a strict role boundary:
1. **Migration Connection (`breev_schema_owner`)**:
   - Short-lived connection opened only during `LocalDatabaseService.onModuleInit()`.
   - Runs under PostgreSQL advisory lock (`MIGRATION_LOCK_ID = 482_910_442`).
   - Executes Drizzle schema migrations and installs/updates `pgboss` schema.
   - Explicitly grants only DML permissions (`USAGE` on schema, `SELECT, INSERT, UPDATE, DELETE` on tables, `USAGE, SELECT, UPDATE` on sequences, and `EXECUTE` on functions) to `breev_app`.
   - Closes and discards connection and memory credentials immediately after migration.
2. **Application Connection (`breev_app`)**:
   - Long-lived connection pool used by `DurableJobsService` and REST endpoints.
   - `createSchema: false`, `migrate: false`.
   - Proved to possess **zero DDL privileges** (`CREATE SCHEMA` / `CREATE TABLE` fail with `42501 permission denied`).

---

## 3. Transactional Enqueue & Atomicity Proof

Durable jobs can be enqueued inside business database transactions via `DurableJobsService.sendInTransaction()`:

```ts
// Drizzle ORM business transaction
await db.transaction(async (tx) => {
  await tx.update(businessTable).set({ ... });
  await durableJobs.sendInTransaction(tx, "queue-name", { ... });
});
```

- **Commit**: If the business transaction commits, the job is visible in `pgboss.job` in `created` state and is picked up by workers.
- **Rollback**: If the business transaction aborts or throws an error, the job record is atomically rolled back with the business state mutation. Zero orphan jobs are enqueued.

---

## 4. Crash Recovery Matrix & Resilience Proofs

The integration test suite (`apps/local-api/src/durable-jobs/durable-jobs.integration.test.ts`) verifies 12 resilience scenarios on PostgreSQL 18:

| Failure Mode | Test Scenario | Verified Behavior |
| :--- | :--- | :--- |
| **Crash Before Claim** | Job enqueued while worker is down / offline | On worker startup, unclaimed jobs in `created` state are discovered and executed immediately. |
| **Crash Mid-Flight (Lease Expiry)** | Worker process crashes or drops while processing job | Active job lease expires (`expireInSeconds`); pg-boss monitor marks job `retry` / returns it to queue; new worker reclaims and completes the job. |
| **Restart After Side-Effect** | Crash after external action (e.g. print/SMS) | Job retry includes tracking token / deduplication key; idempotent worker detects previous completion and avoids duplicate action. |
| **Worker Concurrency** | Two concurrent workers polling same queue with 50 jobs | `FOR UPDATE SKIP LOCKED` guarantees exact-once claim; all 50 jobs executed with zero double-claims and zero race conditions. |
| **Retry with Backoff** | Handler throws error across attempts | Job fails, increments `retry_count`, applies exponential backoff delay, and upon exhausting `retryLimit` (3), moves to `failed` / dead-letter state. |
| **Graceful Shutdown** | `stop({ graceful: true })` called with active jobs | Service stops accepting new work, allows active in-flight worker to finish cleanly, and closes database connections without data loss. |

---

## 5. Verification Commands

```powershell
# Typecheck & Boundaries
pnpm typecheck
pnpm lint
pnpm check:boundaries

# Unit Tests
pnpm test:unit

# Real PostgreSQL Integration Tests
pnpm --filter @breev/local-api test:integration
```
