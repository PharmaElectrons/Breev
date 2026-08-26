# G-06: PostgreSQL-Native Durable Jobs Selection & Resilience Proof

Date: 26 August 2026  
Issue: GitHub #37 / Plan #06 (`06-prove-durable-jobs.md`)  
Base: `issue/06-durable-jobs`  
Repository: [PharmaElectrons/PharmaElectrons](https://github.com/PharmaElectrons/PharmaElectrons)

---

## 1. Technical Evaluation & Library Selection

Breev requires durable background job processing on offline Main devices without Redis, separate worker processes, or complex external infrastructure.

### 1.1 Candidate Comparison

| Dimension                         | `pg-boss` (v12.28.0)                                                | Graphile Worker (v0.16.6)                                | BullMQ / Redis                               |
| :-------------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------- | :------------------------------------------- |
| **Backend Storage**               | PostgreSQL native (`FOR UPDATE SKIP LOCKED`)                        | PostgreSQL native (`FOR UPDATE SKIP LOCKED`)             | Redis (separate server required)             |
| **Transactional Enqueue**         | Native with Drizzle ORM (`fromDrizzle`) and `pg.PoolClient`         | Native via raw SQL function execution (`add_job`)        | Not possible across DB & Redis without 2PC   |
| **Process Model**                 | Embedded in NestJS application runtime                              | Embedded or CLI worker                                   | Requires external Redis daemon               |
| **Role Separation & DDL**         | Supports external migration (`createSchema: false, migrate: false`) | Supports external migration via SQL files / client       | N/A (Redis keyspace)                         |
| **Lease Expiry & Crash Recovery** | Active supervisor (default 60s, configurable to 1s)                 | 4-hour default lock timeout (`NOW() - 4 hours`)          | Heartbeat / lock timeout                     |
| **Retries & DLQ Routing**         | Native exponential backoff & DLQ routing (`deadLetter`)             | Native backoff (`attempts^4 + 3`); no native DLQ routing | Native DLQ / Stream dead-lettering           |
| **Maintenance & Retention**       | Built-in partition management & automatic prune cycle               | Immediate delete on success; manual `cleanup`            | Redis TTL / Stream trimming                  |
| **Windows Compatibility**         | Pure TypeScript/JavaScript (zero native addons)                     | Pure TypeScript/JavaScript (zero native addons)          | Requires native / WSL Redis host             |
| **Decision**                      | **Selected (Leading Candidate)**                                    | **Fallback**                                             | **Rejected** (Violates offline architecture) |

### 1.2 Evaluation Rationale & Fallback Designation

1. **Why `pg-boss` (v12.28.0) Was Selected**:
   - **First-Class Drizzle ORM Adapter**: `fromDrizzle(tx, sql)` provides type-safe, atomic transactional enqueueing sharing the business transaction connection without raw SQL positional binding.
   - **Fast Crash & Lease Recovery**: The built-in supervisor detects expired active leases (`started_on + expire_seconds < now()`) within 60s (or seconds in test environments) and returns jobs to the queue.
   - **Least-Privilege Role Separation**: `createSchema: false, migrate: false` enables Breev to isolate all DDL to `breev_schema_owner` during migration and run workers under `breev_app` with zero DDL privileges.
   - **Built-in Dead-Letter Routing & Maintenance**: Native dead-letter routing to secondary queues and automatic maintenance loops (`plans.deletion`) prevent table bloat on long-running offline nodes.

2. **Why `Graphile Worker` (v0.16.6) Was Placed as Fallback**:
   - **No Drizzle ORM Adapter**: Enqueueing inside a Drizzle business transaction requires manually invoking `graphile_worker.add_job` via raw SQL with positional parameters.
   - **4-Hour Default Lock Timeout**: Crash recovery relies on a 4-hour lock timeout (`NOW() - INTERVAL '4 hours'`), which is unacceptable for offline POS/pharmacy systems requiring prompt recovery after power failure or restart.
   - **Lack of Native DLQ Routing**: Failed jobs remain in the main table with `last_error` rather than routing to dedicated observable dead-letter queues.

### 1.3 Version Pin

- `pg-boss`: `12.28.0` pinned in `apps/local-api/package.json`.

---

## 2. Privileged Migration Architecture & Least-Privilege Role Separation

Breev enforces a strict role boundary:

1. **Migration Connection (`breev_schema_owner`)**:
   - Short-lived connection opened only during `LocalDatabaseService.onModuleInit()`.
   - Runs under PostgreSQL advisory lock (`MIGRATION_LOCK_ID = 165_308_855`).
   - Executes Drizzle schema migrations and installs/updates `pgboss` schema via `boss.start()` / `boss.stop()`.
   - Explicitly grants only DML permissions (`USAGE` on schema, `SELECT, INSERT, UPDATE, DELETE` on tables, `USAGE, SELECT, UPDATE` on sequences, and `EXECUTE` on functions) to `breev_app`.
   - Closes and discards connection and memory credentials immediately after migration.
2. **Application Connection (`breev_app`)**:
   - Long-lived connection pool used by `DurableJobsService` and REST endpoints.
   - Initialized with `createSchema: false`, `migrate: false`.
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

The integration test suite (`apps/local-api/src/durable-jobs/durable-jobs.integration.test.ts` and `apps/local-api/src/durable-jobs/durable-jobs-crash.integration.test.ts`) verifies resilience scenarios on PostgreSQL 18:

| Failure Mode                        | Test Scenario                                                                 | Verified Behavior                                                                                                                                         |
| :---------------------------------- | :---------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Crash Before Claim**              | Job enqueued while worker is down / offline                                   | On worker startup, unclaimed jobs in `created` state are discovered and executed immediately.                                                             |
| **Crash Mid-Flight (Lease Expiry)** | Worker process crashes or drops while processing job                          | Active job lease expires (`expireInSeconds`); pg-boss supervisor marks job `retry` / returns it to queue; new worker reclaims and completes the job.      |
| **Restart After Side-Effect**       | Crash after external action (e.g. print/SMS)                                  | Job retry includes tracking token / deduplication key; idempotent worker detects previous completion and avoids duplicate action.                         |
| **Crash Before Outcome Recording**  | Worker completes external action, killed right before database outcome commit | Reclaimed job replays handler, reconciles external state idempotently, and commits exactly one recorded outcome in database.                              |
| **Worker Concurrency**              | Two independent service connections polling same queue with 50 jobs           | `FOR UPDATE SKIP LOCKED` guarantees exact-once claim; all 50 jobs executed with zero double-claims and zero race conditions.                              |
| **Retry with Backoff**              | Handler throws error across attempts                                          | Job fails, increments `retry_count`, applies exponential backoff delay, and upon exhausting `retryLimit` (3), moves to `failed` / dead-letter state.      |
| **Graceful Shutdown**               | `onApplicationShutdown()` called with active jobs                             | Service stops accepting new work, allows active in-flight worker to finish cleanly (`graceful: true`), and closes database connections without data loss. |

---

## 5. Verification Commands

```powershell
# Typecheck & Linting
pnpm typecheck
pnpm lint
pnpm check:boundaries

# Unit Tests
pnpm test:unit

# Real PostgreSQL Integration Tests
pnpm test:integration
```

---

## 6. Primary Source References

1. **pg-boss**:
   - Repository: [https://github.com/timgit/pg-boss](https://github.com/timgit/pg-boss)
   - Official Documentation: [https://pgboss.io](https://pgboss.io)
   - Drizzle Adapter Implementation: [https://github.com/timgit/pg-boss/blob/master/src/adapters/drizzle.ts](https://github.com/timgit/pg-boss/blob/master/src/adapters/drizzle.ts)
   - Configuration & Options: [https://github.com/timgit/pg-boss/blob/master/docs/configuration.md](https://github.com/timgit/pg-boss/blob/master/docs/configuration.md)
   - Execution & Scheduling Plans: [https://github.com/timgit/pg-boss/blob/master/src/plans.ts](https://github.com/timgit/pg-boss/blob/master/src/plans.ts)
2. **Graphile Worker**:
   - Official Documentation: [https://worker.graphile.org/docs](https://worker.graphile.org/docs)
   - SQL `add_job` Reference: [https://worker.graphile.org/docs/sql-add-job](https://worker.graphile.org/docs/sql-add-job)
   - Unlocking & Crash Recovery: [https://worker.graphile.org/docs/un-locking-jobs](https://worker.graphile.org/docs/un-locking-jobs)
   - Schema & Migrations: [https://worker.graphile.org/docs/migration](https://worker.graphile.org/docs/migration)
   - Maintenance & Cleanup: [https://worker.graphile.org/docs/cleanup](https://worker.graphile.org/docs/cleanup)
3. **PostgreSQL Documentation**:
   - Locking Clause (`FOR UPDATE SKIP LOCKED`): [https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
   - Advisory Locks: [https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
4. **Drizzle ORM**:
   - Transactions Guide: [https://orm.drizzle.team/docs/transactions](https://orm.drizzle.team/docs/transactions)
   - SQL Tag: [https://orm.drizzle.team/docs/sql](https://orm.drizzle.team/docs/sql)
