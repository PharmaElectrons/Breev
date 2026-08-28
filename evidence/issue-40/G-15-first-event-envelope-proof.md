# G-15 first local event envelope (milestone-1 portion)

Date: 28 August 2026

Issue: GitHub [#40](https://github.com/PharmaElectrons/PharmaElectrons/issues/40)

Base: `662353de0aac8eb111f46ada13fdc2e99ccea0e5` (`dev`)

This record closes only the milestone-1 portion of G-15: the first local event envelope, its transaction binding, its retention, and the rule for changing its shape safely. It does not close G-15. The wire portion — the publication allowlist, batching, checkpoint guarantees, the commit-ordering rule, and resnapshot — stays open for [#96](https://github.com/PharmaElectrons/PharmaElectrons/issues/96) in milestone 4, and no sync surface exists yet to argue about. The repository's authoritative documents were intentionally not edited under the issue instruction, following the same practice as [`../issue-35/G-05-loopback-proof.md`](../issue-35/G-05-loopback-proof.md) and [`../issue-41/G-06-local-recovery-proof.md`](../issue-41/G-06-local-recovery-proof.md); therefore `docs/open-decisions.md` correctly still lists G-15 as open, and this file is the recorded decision the wire portion will build on.

## The envelope decision

Envelope v1 is exactly seven fields, stored as one row in `posting_outbox_entries`:

| Field             | Column                     | Decision                                                                                                                       |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | `id uuid`                  | The event's identity, a UUIDv7 produced by the database's `uuidv7()` default and checked by a UUIDv7 constraint on the column  |
| `pharmacyId`      | `pharmacy_id uuid`         | The tenant the event belongs to, a foreign key to `pharmacies`                                                                 |
| `eventType`       | `event_type text`          | A dot-namespaced name, allowlisted by a `check` constraint in the migration (`pharmacy.settings.changed` today)                |
| `envelopeVersion` | `envelope_version integer` | An integer per event type, starting at 1, constrained to be positive                                                           |
| `occurredAt`      | `occurred_at timestamptz`  | The domain occurrence time, taken from `statement_timestamp()` inside the posting transaction — explicitly not the commit time |
| `correlationId`   | `correlation_id uuid`      | The command's idempotency key, so an event, its audit fact, and its recorded result all name the same request                  |
| `payload`         | `payload jsonb`            | Privacy-safe JSON only; authoritative money and quantities travel as decimal integer strings, never as binary floating point   |

A trailing `recorded_at timestamptz` records when the row reached the table. It is bookkeeping, not part of the envelope: the domain time is `occurred_at`, and a reader that wants to know when Breev wrote the row can look, but nothing in the envelope contract depends on it.

Two absences are deliberate. First, the envelope carries no delivery, claim, or checkpoint state. Publication state belongs to separate tables that #96 will define, so envelope rows stay append-only and a redelivery can never rewrite history to look like it never happened. Second, the row is immutable at the database: the `reject_posting_fact_mutation` trigger refuses every `update` and `delete`, including from the schema owner, which is what makes "append-only" a property of the database rather than a habit of the code.

Event type names are a contract in themselves. `POSTING_EVENT_TYPES` in `apps/local-api/src/posting/outbox.ts` publishes them, and a name is never reused for a different meaning.

## Transaction binding

The envelope row is inserted by the posting transaction itself, through `appendOutboxEntry(client, …)`, which takes the transaction-bound client and nothing else. There is no path that writes an envelope outside the command that produced it, so the event exists if and only if the command committed. The settings command writes `pharmacy_settings`, its audit fact, its envelope, its idempotency result, and its post-commit job in that one transaction; an injected failure at any of the five write points leaves none of them behind.

A durable job may reference an envelope but never replaces it, which is the rule `docs/architecture.md` states for post-commit work. The settings post-commit job payload is `{outboxEntryId, pharmacyId}` — the identity of a row that already exists and the tenant it must belong to. The worker reads that row, checks the pharmacy, and records one outcome in `posting_post_commit_outcomes`. It has no code path into `pharmacy_settings` and no way to produce an envelope, so a retry, a duplicate delivery, or a claim recovered after a crash resumes the same envelope instead of recreating anything.

## Ordering caveat

Neither the UUIDv7 identity nor the insertion order nor `recorded_at` proves commit order. UUIDv7 is generated when the row is inserted, and two transactions can insert in one order and commit in the other; a reader ordering by `id` or by `recorded_at` is ordering by when writing started, not by when the change became visible. This is recorded here as a non-decision on purpose: milestone 1 publishes nothing, so nothing depends on the answer yet. The commit order rule — how a consumer establishes a total order it can trust, and what it must do when it cannot — is the G-15 wire portion and belongs to #96.

## Retention

Envelope rows are kept indefinitely in milestone 1. There is no publication, so there is no acknowledgement, and pruning an event that nothing has consumed would destroy the only record that the event happened. #96 defines pruning together with the publication it depends on, under one rule: an envelope is never pruned before its publication has been acknowledged. Rows are never mutated at any point in their life, so retention is only ever a question of when a row may be removed, never of when it may be rewritten.

## Safe schema-change rule

1. Columns may only be added. An added column must be nullable or carry a default, because existing rows are immutable and cannot be backfilled.
2. Any change to the shape or the meaning of a payload increments that event type's `envelope_version`. A field that changes units, a field that changes from optional to required, and a field that is removed are all shape changes.
3. Retired versions stay listed in the registry (`POSTING_ENVELOPE_VERSIONS`) for as long as rows carrying them exist. The registry is the list of what readers must still understand, not the list of what writers still produce; `CURRENT_ENVELOPE_VERSIONS` is the latter.
4. Readers reject an unknown event type or an unknown version through `assertSupportedEnvelope` rather than guessing at its shape. Guessing is how a consumer silently mis-reads money.
5. Event types are never renamed. A new meaning gets a new name, and the migration's allowlist grows forward.

## Idempotency-store supersession

The settings command's idempotency moved from the actor-scoped `identity_command_results` to the pharmacy-and-command-kind `posting_command_results`, which is the scope `docs/domain.md` requires. Existing `identity_command_results` rows for this command were deliberately not migrated.

The reason is that `expectedRevision` arbitration makes a stale retry harmless. A retry that arrives after the upgrade finds no recorded result, executes, and meets the settings row's current revision under the lock. Its `expectedRevision` is by definition the revision it saw before the original posting, so it loses the comparison and is answered `409 version-conflict` — recorded and replayable — rather than posting a second change. The failure mode a migration would prevent therefore does not exist. No production installation exists either, so there is no historical row anywhere that this decision could affect. The other identity commands keep their existing store unchanged, and the historical rows stay where they are as evidence.

## Claim-to-test map

Every claim below is proved by a test that runs against real PostgreSQL 18.6 in a container, or by a pure unit test where the claim is about a pure rule. File paths are relative to the repository root.

### Issue #40 acceptance criteria

1. **The settings command posts exactly once through authorization, revalidation, and one atomic transaction containing the change, audit fact, idempotency result, and outbox row.**
   - `apps/local-api/src/identity-access/settings-posting.integration.test.ts`: `posts the settings change, its audit, its event, and one durable outcome`.
2. **Same-key retry returns the committed result without reposting; the same key with a different payload is rejected; concurrent identical requests yield one committed outcome.**
   - `apps/local-api/src/identity-access/settings-posting.integration.test.ts`: `replays the committed result for the same key and body`; `refuses a reused key that carries a different request`; `records a stale expected revision and replays it without re-executing`; `commits once when two identical requests arrive together`.
   - `apps/local-api/src/posting/posting-infrastructure.integration.test.ts`: `lets exactly one of two identical concurrent commands execute`; `refuses a reused key that carries a different request`; `replays a stored terminal rejection with its own status`; `replays for a second actor because the scope is the pharmacy and command`; `keeps one key independent across command kinds`.
3. **Any injected failure inside the transaction rolls back every record together.**
   - `apps/local-api/src/identity-access/settings-posting.integration.test.ts`: `rolls every written record back together when any write is refused` — a schema-owner rule is injected in turn on `pharmacy_settings`, `posting_audit_records`, `posting_outbox_entries`, `posting_command_results`, and the pg-boss job table, and after each refusal none of the five exists.
4. **The allocator issues pharmacy-wide per-type-and-year sequences with no duplicates under concurrency; gaps are permitted, audited, and never backfilled or reused.**
   - `apps/local-api/src/posting/posting-infrastructure.integration.test.ts`: `never hands the same number to two concurrent allocations`; `returns the same number to a retry that carries the same correlation`; `converges when two attempts of one command race for its number`; `leaves a rolled-back command an audited gap that is never reused`; `issues a number only to the correlation that allocated it`; `refuses to delete an allocation or rewind an issued one`; `refuses to rewind, retarget, or erase a number sequence`.
   - The settings command carries no business document number: `apps/local-api/src/identity-access/settings-crash.integration.test.ts`: `gives the settings command no business document number, through every crash and recovery above`.
5. **All locking follows the published deterministic order, and a serialization or deadlock abort safely reruns the whole command via the retry helper.**
   - `apps/local-api/src/posting/lock-order.unit.test.ts`: `publishes the documented order exactly`; `names the five stages docs/architecture.md publishes, in that sequence`; `accepts a whole command walked stage by stage`; `names the published order when it rejects a step`.
   - `apps/local-api/src/posting/command-retry.unit.test.ts`: `treats $label as transient` for `40001` and `40P01`; `treats $label as permanent` for committed denials, unique violations, immutability triggers, permission denials, lock timeouts, and non-error values; `never reruns the command after $label`; `reruns the whole command after a deadlock and returns the later result`; `gives up after three attempts and rethrows the last abort`; `bounds the backoff window and jitters inside its upper half`.
   - `apps/local-api/src/posting/posting-infrastructure.integration.test.ts`: `reruns the deadlocked command and reuses the number it allocated` — a real `40P01` from two clients taking locks in opposite order.
6. **The audit writer is append-only with privacy-safe fields; posted rows reject updates and deletes at the database level.**
   - `apps/local-api/src/posting/posting-infrastructure.integration.test.ts`: `refuses to rewrite or erase 'posting_command_results'`, `… 'posting_audit_records'`, `… 'posting_outbox_entries'`, `… 'posting_post_commit_outcomes'` — each proved under the production application privileges and again against the schema owner, so the trigger rather than the grant is the oracle.
7. **The outbox row carries the recorded G-15 first envelope, written atomically with the command; the envelope design, retention, and schema-change rule are recorded as G-15 closure evidence.**
   - `apps/local-api/src/posting/posting-infrastructure.integration.test.ts`: `records an envelope only when the posting transaction commits`.
   - `apps/local-api/src/identity-access/settings-posting.integration.test.ts`: `posts the settings change, its audit, its event, and one durable outcome` — asserts the stored `event_type`, `envelope_version`, `correlation_id`, `pharmacy_id`, payload, and UUIDv7 identity.
   - `apps/local-api/src/posting/outbox.unit.test.ts`: `publishes the event type names domain readers depend on`; `registers exactly the envelope versions that exist today`; `registers the current version of every known event type`; `accepts the registered envelope of a known event`; `rejects $label` for a future, zero, negative, and fractional version, an unknown event type, and a prototype key; `names the envelope it refused`.
   - This record is the written decision itself.
8. **The post-commit job runs only after commit, survives the four crash points, and cannot replay the business command.**
   - `apps/local-api/src/identity-access/settings-crash.integration.test.ts`: `survives a crash before claim …`; `survives a crash after claim …`; `survives a crash after external success …`; `survives a crash before Breev records the outcome …`; `records nothing new when the same job is delivered a second time`.
   - `apps/local-api/src/identity-access/settings-posting.integration.test.ts`: `returns the one committed outcome after a killed service restarts`; and the outcome-after-envelope clock assertion in `posts the settings change, its audit, its event, and one durable outcome`, which proves the job ran after the commit and not before it.

### Claims made in this record

- **The envelope is written by the posting transaction and exists if and only if the command committed** — `posting-infrastructure.integration.test.ts`: `records an envelope only when the posting transaction commits`; `settings-posting.integration.test.ts`: `rolls every written record back together when any write is refused`.
- **The envelope row is immutable** — `posting-infrastructure.integration.test.ts`: `refuses to rewrite or erase 'posting_outbox_entries'`.
- **`correlationId` is the command's idempotency key** — `settings-posting.integration.test.ts`: `posts the settings change, its audit, its event, and one durable outcome`, which reads the audit fact, the envelope, and the recorded result by the same key.
- **`occurredAt` is a domain time carried by the envelope, and the post-commit outcome is recorded after it** — `settings-posting.integration.test.ts`: the `recordedAfterEnvelope` assertion in `posts the settings change, its audit, its event, and one durable outcome`.
- **Readers reject an envelope version they do not know rather than guess** — `outbox.unit.test.ts`: `rejects $label`; `names the envelope it refused`.
- **The post-commit job carries only `{outboxEntryId, pharmacyId}` and cannot replay the command** — `settings-posting.integration.test.ts`: `posts the settings change, its audit, its event, and one durable outcome` asserts the job payload; every scenario in `settings-crash.integration.test.ts` re-reads the settings revision, the settings row's `updated_at`, the audit facts with their identifiers and clocks, the envelope with its clocks, and the recorded result with its clock after the kill, the supervision, the retries, and the recovery, and requires them byte-identical to the moment the command committed.
- **Money on the wire is a decimal integer string and no binary floating point crosses an authoritative interface** — `apps/local-api/src/posting/money.unit.test.ts`: `round-trips ${wire} byte for byte`; `parses to the exact amount, not to a rounded double`; `rejects ${label} because binary floating point cannot carry an amount`; `refuses to put a forged floating point value on the wire`; `adds exactly past the range doubles can represent`; `separates amounts that a double would collapse into one`; `exposes no multiplication, division, rounding, or allocation`.
- **The idempotency key and the current version are part of the published command contract** — `packages/contracts/src/local-rest/index.test.ts`: `requires idempotency and current versions for command %s`, which includes `pharmacySettingsUpdateRequestSchema`; and `publishes the migrated schema version and an unchanged REST surface`.

## Evidence and transcripts

The crash battery is not a simulation. `apps/local-api/src/identity-access/settings-crash.integration.test.ts` posts each settings change through the packaged `dist/main.js` over real HTTP with the Main device binding, then decides who claims the resulting job. A schema-owner rule on the pg-boss job table holds every settings post-commit job at a start time an hour away and gives it a two-second lease, which removes the race between the commit and the kill: the running API cannot claim a job it cannot see, so each scenario kills the API first — `SIGKILL`, exit signal asserted — and only then releases the job to the process that is meant to receive it. The payload, the queue, the atomic binding to the posting transaction, and every recorded fact are exactly what production writes; only the moment a worker may claim the job is under the test's control. The shortened lease matches the two-second lease `apps/local-api/src/durable-jobs/durable-jobs.integration.test.ts` sends its own crash-battery jobs with, for the same reason: a sixty-second lease cannot be observed expiring inside a test run.

The worker that dies is a forked operating-system process (`apps/local-api/src/identity-access/test-helpers/settings-crash-child.test.ts`) that kills itself with `process.kill(process.pid, "SIGKILL")` at the point under test, after handing its parent an event naming that point and waiting for the channel to take it — so where the process died is asserted, not inferred from a timer. The worker that recovers is never a fixture: in every scenario it is the real `SettingsPostCommitService` inside a restarted API, and the one durable write it performs comes from the production writer `recordPostCommitOutcome`, whose `on conflict do nothing` is the convergence being proved.

```text
$ corepack pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts src/identity-access/settings-crash.integration.test.ts
pharmacy settings post-commit crash battery (PostgreSQL 18.6, packaged dist/main.js over HTTP)
  ✓ survives a crash before claim …                                    915ms
  ✓ survives a crash after claim …                                    5541ms
  ✓ survives a crash after external success …                         4443ms
  ✓ survives a crash before Breev records the outcome …               5343ms
  ✓ records nothing new when the same job is delivered a second time  1631ms
  ✓ gives the settings command no business document number …             2ms
Test Files  1 passed (1)
     Tests  6 passed (6)
  Duration  22.14s
run three times consecutively: 6 passed each time, no flake
```

Each of the four crash scenarios asserts the same closing invariant: exactly one settings change (revision and `updated_at` unchanged from the moment the command committed), exactly one `succeeded` audit fact with its original identifier and clock, exactly one envelope with its original clocks, exactly one recorded command result with its original clock, and exactly one `acknowledged` post-commit outcome. Where the kill landed is asserted rather than assumed: the after-claim scenario requires the fork to have died before it read anything, the before-outcome-recording scenario requires it to have died holding the pharmacy it had just verified, and the after-external-success scenario requires the outcome row to exist while the job is still uncompleted. Recovery is asserted as a real second delivery of the same row — the job reaches `completed` with its retry counter advanced — and the after-external-success scenario additionally requires that redelivery to leave the outcome row's `recorded_at` untouched, which is what "converged on the row that was already there" means in practice.

```text
$ corepack pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts src/identity-access/settings-posting.integration.test.ts src/posting/posting-infrastructure.integration.test.ts
pharmacy settings posting pipeline (real HTTP, packaged dist/main.js)   8 passed
posting infrastructure PostgreSQL seam                                18 passed
  idempotency arbitration                                              5 passed
  document number allocator                                            6 passed
  outbox envelopes                                                     1 passed
  append-only posting facts                                            5 passed
  whole-command retry after a real deadlock                            1 passed
Test Files  2 passed (2)
     Tests  26 passed (26)
```

```text
$ corepack pnpm test:unit
@breev/contracts   41 passed (2 files)
@breev/desktop     48 passed (6 files)
@breev/local-api  343 passed | 1 skipped (14 files)
  posting seam: canonical-hash 20, lock-order 52, money 168, command-retry 19, outbox 11
deliberate boundary violations failed as expected
```

```text
$ corepack pnpm lint
eslint: passed
boundary check passed (123 source files)

$ corepack pnpm typecheck
4 tasks passed

$ corepack pnpm build
3 tasks passed

$ corepack pnpm check:licence-artifact
Inspected 58 Breev artifact files; no signing secret found.
```

The crash helper files are named `*.test.ts` but neither `*.unit.test.ts` nor `*.integration.test.ts`. The first keeps them out of `dist` — `apps/local-api/tsconfig.build.json` excludes `src/**/*.test.ts`, and the built `dist/identity-access` directory contains no helper — and the second keeps Vitest from collecting a worker process as if it were a suite.

## Full worktree validation

Pending driver verification: the full `pnpm verify` transcript and the detached clean-checkout transcript are appended here by the final review before the pull request opens.

## Open before G-15 closes

All of the following belong to [#96](https://github.com/PharmaElectrons/PharmaElectrons/issues/96) and none of it is started here:

- The publication allowlist: which event types and which fields may leave the pharmacy, and how a field is added to that list.
- Batching and the wire format, including how a batch is framed and how a partial batch is retried.
- Checkpoint guarantees: what a consumer records, what it may assume after a gap, and what a Breev installation may assume about a checkpoint it did not write.
- The commit order rule left open above, and what a consumer must do when it cannot establish one.
- Resnapshot: when a consumer must be rebuilt from state rather than from events, and how that is triggered and detected.
- Pruning, which follows publication and never precedes an acknowledged one.
