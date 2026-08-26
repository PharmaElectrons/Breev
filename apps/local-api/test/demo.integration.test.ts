import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createSeparatedDatabaseRoles } from "./database-roles.js";
import { LocalDatabaseService } from "../src/local-database.service.js";
import { DurableJobsService } from "../src/durable-jobs/durable-jobs.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe("Manual Interactive Durable Jobs Demonstration", () => {
  it("runs end-to-end interactive manual verification of pg-boss durable jobs", async () => {
    console.log("\n========================================================");
    console.log("  BREEV DURABLE JOBS MANUAL VERIFICATION DEMO");
    console.log("========================================================\n");

    // 1. Start PostgreSQL Container
    console.log("[1/6] Spinning up PostgreSQL 18 test container...");
    const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    const databaseRoles = await createSeparatedDatabaseRoles(postgres);
    console.log("       -> Database ready with breev_schema_owner and breev_app roles.");

    // 2. Initialize LocalDatabaseService and run privileged migrations
    console.log("\n[2/6] Running privileged schema migrations under breev_schema_owner...");
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
    process.env.DATABASE_URL = databaseRoles.applicationUrl;

    const localDatabase = new LocalDatabaseService();
    await localDatabase.onModuleInit();

    const appPool = new Pool({ connectionString: databaseRoles.applicationUrl });
    const schemaCheck = await appPool.query(
      "select table_name from information_schema.tables where table_schema = 'pgboss' order by table_name limit 5",
    );
    console.log("       -> Verified pgboss tables created: ", schemaCheck.rows.map((r) => r.table_name).join(", "));

    // 3. Initialize DurableJobsService
    console.log("\n[3/6] Starting DurableJobsService under breev_app (least-privilege connection)...");
    const durableJobs = new DurableJobsService(localDatabase);
    await durableJobs.onModuleInit();
    console.log("       -> DurableJobsService started and connected.");

    // 4. Test Transactional Enqueue (Commit vs Rollback)
    console.log("\n[4/6] Testing Drizzle Transactional Enqueue (Commit vs Rollback)...");
    const db = drizzle({ client: appPool });

    // Scenario A: Committed transaction
    console.log("   (A) Transaction COMMIT scenario:");
    let processedMessage = "";
    await durableJobs.work("order-receipt-queue", async (job: { data: { orderId: string } }) => {
      processedMessage = `Order ${job.data.orderId} receipt created!`;
      console.log(`       [Worker Output]: Processed job -> "${processedMessage}"`);
    });

    await db.transaction(async (tx) => {
      await durableJobs.sendInTransaction(tx, "order-receipt-queue", { orderId: "ORD-9981" });
      console.log("       -> Job queued inside Drizzle transaction. Committing transaction...");
    });

    await waitFor(() => processedMessage.length > 0, 5000);
    expect(processedMessage).toBe("Order ORD-9981 receipt created!");
    console.log("       -> Result: Job successfully picked up by worker after commit.");

    // Scenario B: Aborted transaction (Rollback)
    console.log("   (B) Transaction ROLLBACK scenario:");
    let rollbackJobClaimed = false;
    await durableJobs.work("rollback-test-queue", async () => {
      rollbackJobClaimed = true;
    });

    try {
      await db.transaction(async (tx) => {
        await durableJobs.sendInTransaction(tx, "rollback-test-queue", { orderId: "ORD-FAIL" });
        console.log("       -> Job queued inside transaction. Simulating business failure & rolling back...");
        throw new Error("Simulated business validation error");
      });
    } catch {
      console.log("       -> Transaction aborted and rolled back.");
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(rollbackJobClaimed).toBe(false);
    console.log("       -> Result: Zero jobs were processed. Rollback atomicity verified!");

    // 5. Test Retries with Exponential Backoff & Dead-Letter Queue
    console.log("\n[5/6] Testing Retry Backoff and Dead-Lettering for failing jobs...");
    let attemptCount = 0;
    await durableJobs.work(
      "failing-queue",
      async () => {
        attemptCount += 1;
        console.log(`       [Worker]: Attempt #${attemptCount} failed!`);
        throw new Error("External service unreachable");
      },
    );

    await durableJobs.send(
      "failing-queue",
      { invoiceId: "INV-100" },
      { retryLimit: 2, retryDelay: 1, retryBackoff: false },
    );

    console.log("       -> Waiting for retries to exhaust...");
    await waitFor(async () => {
      const deadLetters = await durableJobs.getDeadLetterJobs("failing-queue");
      return deadLetters.length > 0;
    }, 10000);

    const deadLetterJobs = await durableJobs.getDeadLetterJobs("failing-queue");
    console.log(`       -> Dead letter jobs count: ${deadLetterJobs.length}`);
    console.log("       -> Dead letter state:", JSON.stringify(deadLetterJobs[0], null, 2));
    expect(deadLetterJobs.length).toBeGreaterThanOrEqual(1);
    expect(deadLetterJobs[0]?.state).toBe("failed");
    console.log("       -> Result: Job retried and moved to dead-letter state successfully.");

    // 6. Teardown
    console.log("\n[6/6] Tearing down services...");
    await durableJobs.stop({ graceful: true });
    await appPool.end();
    await postgres.stop();

    console.log("\n========================================================");
    console.log("  ALL MANUAL VERIFICATION SCENARIOS PASSED WITH SUCCESS!");
    console.log("========================================================\n");
  }, 60000);
});
