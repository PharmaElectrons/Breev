/**
 * The only two PostgreSQL failures a posting command may retry:
 * `40001` serialization failure and `40P01` deadlock detected. Both mean the
 * transaction was aborted before it could commit, so nothing it wrote exists
 * and rerunning the whole command is safe.
 *
 * Nothing else is retried. A business rejection that commits its evidence and
 * then throws carries no PostgreSQL code, so it is returned to the caller
 * unchanged: rerunning it would replay a decision that has already been
 * recorded. An ordinary database error is a fault, not contention.
 */
const TRANSIENT_TRANSACTION_CODES = new Set(["40001", "40P01"]);

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 15;
const DEFAULT_MAX_DELAY_MS = 120;

export interface CommandRetryOptions {
  /** Total attempts including the first. Defaults to 3. */
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Seam for deterministic tests; defaults to `Math.random`. */
  readonly random?: () => number;
  /** Seam for deterministic tests; defaults to a real timer. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export function isTransientPostingFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" && TRANSIENT_TRANSACTION_CODES.has(code);
}

/**
 * Runs a whole posting command, rerunning it from the top after a
 * serialization or deadlock abort.
 *
 * The unit of retry is the entire command, not a statement: `work` acquires
 * its own connection, opens its own transaction, and releases the connection
 * before returning or throwing, so a retried attempt shares nothing with the
 * aborted one. The command keeps its idempotency key across attempts by
 * construction — the key belongs to the request, not to the attempt — so a
 * rerun either produces the one outcome or replays the one already committed.
 */
export async function runWholeCommandWithRetry<T>(
  work: () => Promise<T>,
  options: CommandRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("A posting command needs at least one attempt");
  }
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? delay;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts || !isTransientPostingFailure(error)) {
        throw error;
      }
      await sleep(
        backoffMilliseconds(attempt, baseDelayMs, maxDelayMs, random),
      );
    }
  }
}

/**
 * Bounded exponential backoff with jitter in the upper half of the window, so
 * two commands that deadlocked with each other do not immediately collide
 * again while the wait stays short enough to keep a cashier waiting.
 */
function backoffMilliseconds(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const window = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(window * (0.5 + 0.5 * random()));
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
