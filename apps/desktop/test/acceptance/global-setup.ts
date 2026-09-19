import { randomUUID } from "node:crypto";

/**
 * Stamps one identifier on the whole acceptance run.
 *
 * Playwright starts a fresh worker process after a failing test, and each
 * worker holds its own in-memory transcript. Without a shared identifier the
 * last worker to finish would write only its own pass and overwrite the others,
 * so a run containing a recorded failure would silently lose every pass before
 * it. Global setup runs once, before any worker is forked, and the workers
 * inherit this value — so each of them can merge its records with the records
 * of the same run already on disk, and discard anything left over from an
 * earlier one.
 */
export default function globalSetup(): void {
  process.env.BREEV_M2_ACCEPTANCE_RUN_ID ??= randomUUID();
}
