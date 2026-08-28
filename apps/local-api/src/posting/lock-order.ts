/**
 * The published deterministic posting lock order.
 *
 * docs/architecture.md §"Local module ownership": "`local-api` publishes one
 * deterministic lock order -- draft, number sequence, period, batch/stock,
 * valuation -- that every posting use case follows." §"Local API and
 * PostgreSQL": "Lock affected rows with `FOR UPDATE` in the published
 * deterministic order: draft, number sequence, period, batch/stock, valuation.
 * ... After a serialization or deadlock abort, retry the whole idempotent
 * command."
 *
 * This constant IS that publication. The governing documents are frozen for
 * this milestone, so the order lives here, in the one place every posting use
 * case can import, and the documents above are its citation rather than its
 * home.
 *
 * The rule the order enforces: two concurrent commands that need the same rows
 * take them in the same sequence, so neither can hold a row the other is
 * waiting for. Acquiring out of this order is what manufactures the deadlock
 * (PostgreSQL error 40P01) that the whole-command retry helper then has to
 * absorb; acquiring in this order means a wait is only ever a wait.
 *
 * A command may skip any stage it does not touch -- the settings command locks
 * only the draft stage, and a sale that allocates no number skips the number
 * sequence -- but it may never go back, and it may never take one stage twice.
 * {@link assertLockStageProgression} is the pure check for both.
 */
export const POSTING_LOCK_STAGES = [
  /**
   * Draft: the command's own document or aggregate row -- the pharmacy
   * settings row, the draft invoice, the record the command exists to change.
   * It comes first so two commands aimed at the same document serialize
   * against each other before either touches shared infrastructure.
   */
  "draft",
  /**
   * Number sequence: the per-pharmacy human-readable document counter. Taken
   * after the draft so a command never holds the counter -- the row every
   * other posting command in the pharmacy also wants -- while it waits for a
   * document row.
   */
  "number-sequence",
  /**
   * Period: the accounting period state that decides whether the posting date
   * is still open. Taken before any inventory or valuation work, because a
   * closed period must reject the command before it has moved any stock.
   */
  "period",
  /**
   * Batch/stock: batch rows, their physical quantities, and the derived
   * on-hand balances that FEFO picking reads. The widest contended set, so it
   * is taken as late as the work allows and released with the transaction.
   */
  "batch-stock",
  /**
   * Valuation: weighted-average-cost state and the cost allocations posted
   * from it. Last, because valuation consumes the batch and stock decisions
   * made in the previous stage and nothing else waits behind it.
   */
  "valuation",
] as const;

/** One stage of {@link POSTING_LOCK_STAGES}. */
export type PostingLockStage = (typeof POSTING_LOCK_STAGES)[number];

/**
 * Asserts that a posting command acquires `next` after `previous` in the
 * published order. Pure: it holds no state and tracks nothing across calls, so
 * each call is exactly one claim about two stage names.
 *
 * Throws when `next` is the same stage as `previous` (a stage is taken once,
 * with every row it needs, not reopened later) or comes before it (the
 * out-of-order acquisition that creates deadlocks). Skipping stages is
 * allowed. An unrecognised stage name is a `TypeError`: the order is a closed
 * set, and a typo in a stage name would otherwise pass the check silently.
 */
export function assertLockStageProgression(
  previous: PostingLockStage,
  next: PostingLockStage,
): void {
  const previousIndex = stageIndex(previous);
  const nextIndex = stageIndex(next);
  if (nextIndex === previousIndex) {
    throw new Error(
      `Posting lock stage "${previous}" cannot be acquired twice in one command`,
    );
  }
  if (nextIndex < previousIndex) {
    throw new Error(
      `Posting lock stage "${next}" cannot be acquired after "${previous}": the published order is ${POSTING_LOCK_STAGES.join(", ")}`,
    );
  }
}

function stageIndex(stage: PostingLockStage): number {
  const index = (POSTING_LOCK_STAGES as readonly string[]).indexOf(stage);
  if (index === -1) {
    throw new TypeError(
      `Unknown posting lock stage ${describeStage(stage)}: the published order is ${POSTING_LOCK_STAGES.join(", ")}`,
    );
  }
  return index;
}

/**
 * Names a rejected stage for the error message without assuming it is a
 * string: an untyped caller can reach here with anything, and a message
 * builder that throws its own `TypeError` (`JSON.stringify` on a bigint,
 * interpolating a symbol) would hide the mistake it exists to report.
 */
function describeStage(stage: PostingLockStage): string {
  return typeof stage === "string"
    ? JSON.stringify(stage)
    : `a ${typeof stage} value`;
}
