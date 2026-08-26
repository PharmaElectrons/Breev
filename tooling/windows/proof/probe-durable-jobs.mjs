import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";

const action = readArgument("--action");
const databaseUrl = await readDatabaseUrl();
const queueName = readOptionalArgument("--queue") ?? "issue37_proof_queue";
const outputPath = readOptionalArgument("--output");

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5_000,
  max: 5,
});

try {
  switch (action) {
    case "setup-witness": {
      await pool.query(`
        create table if not exists public.issue37_durable_jobs_witness (
          id text primary key,
          job_id text not null unique,
          queue_name text not null,
          payload jsonb not null,
          execution_count integer not null default 1,
          executed_at timestamp with time zone not null default now(),
          status text not null
        );
      `);
      writeOutput({ action: "setup-witness", passed: true });
      break;
    }

    case "enqueue-batch": {
      const count = Number.parseInt(readArgument("--count"), 10);
      const batchId = readArgument("--batch-id");
      const boss = new PgBoss({
        connectionString: databaseUrl,
        createSchema: false,
        migrate: false,
        schema: "pgboss",
        supervise: false,
      });
      await boss.start();
      try {
        await boss.createQueue(queueName, {
          retryLimit: 3,
          retryDelay: 1,
          retryBackoff: true,
          expireInSeconds: 30,
        });
        const jobIds = [];
        for (let i = 0; i < count; i++) {
          const jobId = await boss.send(queueName, { batchId, index: i });
          if (jobId !== null) {
            jobIds.push(jobId);
          }
        }
        writeOutput({
          action: "enqueue-batch",
          batchId,
          count,
          enqueued: jobIds.length,
          jobIds,
        });
      } finally {
        await boss.stop({ graceful: false });
      }
      break;
    }

    case "enqueue-scheduled": {
      const delaySeconds = Number.parseInt(readArgument("--delay-seconds"), 10);
      const scheduledId = readArgument("--scheduled-id");
      const boss = new PgBoss({
        connectionString: databaseUrl,
        createSchema: false,
        migrate: false,
        schema: "pgboss",
        supervise: false,
      });
      await boss.start();
      try {
        await boss.createQueue(queueName, {
          retryLimit: 3,
          retryDelay: 1,
          retryBackoff: true,
          expireInSeconds: 30,
        });
        const jobId = await boss.send(
          queueName,
          { scheduledId },
          { startAfter: delaySeconds },
        );
        writeOutput({
          action: "enqueue-scheduled",
          scheduledId,
          jobId,
          startAfterSeconds: delaySeconds,
        });
      } finally {
        await boss.stop({ graceful: false });
      }
      break;
    }

    case "work-batch": {
      const expectedCount = Number.parseInt(
        readArgument("--expected-count"),
        10,
      );
      const timeoutMs = Number.parseInt(
        readOptionalArgument("--timeout-ms") ?? "30000",
        10,
      );
      const boss = new PgBoss({
        connectionString: databaseUrl,
        createSchema: false,
        migrate: false,
        schema: "pgboss",
        supervise: true,
      });
      await boss.start();
      const processed = [];
      let duplicateAttemptDetected = false;

      try {
        await boss.work(queueName, { batchSize: 1 }, async (jobs) => {
          for (const job of jobs) {
            const client = await pool.connect();
            try {
              await client.query("begin");
              // The UNIQUE constraint on job_id in witness table guarantees duplicate detection
              await client.query(
                `insert into public.issue37_durable_jobs_witness
                  (id, job_id, queue_name, payload, execution_count, executed_at, status)
                 values ($1, $2, $3, $4, 1, now(), 'completed')
                 on conflict (job_id) do update set
                   execution_count = public.issue37_durable_jobs_witness.execution_count + 1,
                   status = 'duplicate_execution'`,
                [
                  `witness_${job.id}_${Date.now()}`,
                  job.id,
                  job.name,
                  JSON.stringify(job.data),
                ],
              );
              await client.query("commit");
              processed.push(job.id);
            } catch (err) {
              await client.query("rollback");
              duplicateAttemptDetected = true;
              throw err;
            } finally {
              client.release();
            }
          }
        });

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline && processed.length < expectedCount) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        writeOutput({
          action: "work-batch",
          expectedCount,
          processedCount: processed.length,
          processedJobIds: processed,
          duplicateAttemptDetected,
          passed:
            processed.length >= expectedCount && !duplicateAttemptDetected,
        });
      } finally {
        await boss.stop({ graceful: true, timeout: 5_000 });
      }
      break;
    }

    case "enqueue-failing": {
      const failId = readArgument("--fail-id");
      const dlqName = readOptionalArgument("--dlq") ?? "issue37_proof_dlq";
      const boss = new PgBoss({
        connectionString: databaseUrl,
        createSchema: false,
        migrate: false,
        schema: "pgboss",
        supervise: false,
      });
      await boss.start();
      try {
        await boss.createQueue(dlqName);
        await boss.createQueue(queueName, {
          retryLimit: 2,
          retryDelay: 1,
          retryBackoff: true,
          deadLetter: dlqName,
          expireInSeconds: 5,
        });
        const jobId = await boss.send(queueName, { failId, shouldFail: true });
        writeOutput({ action: "enqueue-failing", failId, jobId, dlq: dlqName });
      } finally {
        await boss.stop({ graceful: false });
      }
      break;
    }

    case "work-and-fail": {
      const timeoutMs = Number.parseInt(
        readOptionalArgument("--timeout-ms") ?? "15000",
        10,
      );
      const boss = new PgBoss({
        connectionString: databaseUrl,
        createSchema: false,
        migrate: false,
        schema: "pgboss",
        supervise: true,
      });
      await boss.start();
      let failureCount = 0;
      try {
        await boss.work(queueName, { batchSize: 1 }, async (jobs) => {
          for (const job of jobs) {
            failureCount++;
            throw new Error(
              `Intentional test failure on attempt ${failureCount} for job ${job.id}`,
            );
          }
        });
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline && failureCount < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        writeOutput({
          action: "work-and-fail",
          failureCount,
          passed: failureCount >= 2,
        });
      } finally {
        await boss.stop({ graceful: true, timeout: 3_000 });
      }
      break;
    }

    case "verify-witness": {
      const batchId = readOptionalArgument("--batch-id");
      const query = batchId
        ? `select id, job_id, queue_name, payload, execution_count, status
           from public.issue37_durable_jobs_witness
           where payload->>'batchId' = $1`
        : `select id, job_id, queue_name, payload, execution_count, status
           from public.issue37_durable_jobs_witness`;
      const params = batchId ? [batchId] : [];
      const result = await pool.query(query, params);
      const duplicates = result.rows.filter(
        (r) => r.execution_count > 1 || r.status === "duplicate_execution",
      );
      writeOutput({
        action: "verify-witness",
        totalRows: result.rows.length,
        duplicateRows: duplicates.length,
        passed: duplicates.length === 0 && result.rows.length > 0,
        rows: result.rows,
      });
      break;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
} finally {
  await pool.end();
}

async function readDatabaseUrl() {
  const direct = readOptionalArgument("--database-url");
  if (direct) return direct;
  const file = readOptionalArgument("--database-url-file");
  if (file) {
    const content = await readFile(file, "utf8");
    return content.trim();
  }
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  if (process.env.DATABASE_URL_FILE) {
    const content = await readFile(process.env.DATABASE_URL_FILE, "utf8");
    return content.trim();
  }
  throw new Error("No database URL or database URL file provided");
}

function readArgument(name) {
  const value = readOptionalArgument(name);
  if (value === undefined) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function readOptionalArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function writeOutput(data) {
  const json = JSON.stringify(data, null, 2);
  if (outputPath) {
    writeFile(outputPath, `${json}\n`, "utf8").catch((err) => {
      process.stderr.write(`Failed to write output file: ${err.message}\n`);
    });
  }
  process.stdout.write(`${json}\n`);
}
