import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { acceptanceEvidencePath } from "./evidence-path.js";
import type { ExecutableProvenance, LocalApiProvenance } from "./provenance.js";

/**
 * The acceptance transcript.
 *
 * `docs/quality.md` puts Windows release evidence on the packaged build
 * against real PostgreSQL and asks for a recorded pass or fail per clause
 * rather than one overall verdict. This module is that record: an array of
 * takes, each one a clause, a client scenario, the sales-side reorder action, a
 * named piece of milestone scope, or the bilingual pass, with every step's
 * action, what it expected, what it observed, and whether it passed. A take's
 * verdict is `pass` only when every one of its steps passed, so a record can
 * never claim more than its steps do.
 */

export type TranscriptKind =
  "bilingual" | "clause" | "reorder" | "scenario" | "scope";
export type Locale = "ar" | "en";
export type Theme = "dark" | "light";

/**
 * `assertion` steps carry a check the run made; `note` steps carry a fact the
 * run establishes without one. They are distinguished so a reader counting
 * evidence never mistakes a note for a passing assertion.
 */
export type TranscriptStepKind = "assertion" | "note";

export interface TranscriptStep {
  readonly action: string;
  readonly expected: string;
  readonly kind: TranscriptStepKind;
  observed: string;
  pass: boolean;
}

export interface TranscriptRecord {
  readonly breevEnvironmentVariables: readonly string[];
  readonly executable: ExecutableProvenance;
  finishedAt: string;
  /**
   * Every record id this pass is expected to produce. A flow that never ran —
   * because an earlier one failed and the serial group stopped — is then
   * visibly missing rather than silently absent.
   */
  readonly flowsExpected: readonly string[];
  readonly id: string;
  readonly kind: TranscriptKind;
  readonly localApi: LocalApiProvenance;
  readonly locale: Locale;
  readonly postgresImage: string;
  /** Identifies the run, so several workers can write one transcript. */
  readonly runId: string;
  readonly screenshots: string[];
  readonly sourceCommit: string;
  readonly startedAt: string;
  readonly steps: TranscriptStep[];
  readonly theme: Theme;
  readonly title: string;
  verdict: "fail" | "pass";
  readonly workingTreeStatus: string;
}

export interface TranscriptContext {
  readonly breevEnvironmentVariables: readonly string[];
  readonly executable: ExecutableProvenance;
  readonly flowsExpected: readonly string[];
  readonly localApi: LocalApiProvenance;
  readonly locale: Locale;
  readonly postgresImage: string;
  readonly sourceCommit: string;
  readonly theme: Theme;
  readonly workingTreeStatus: string;
}

const records: TranscriptRecord[] = [];

/**
 * The identifier `global-setup.ts` stamped on this run. The fallback only
 * applies when the harness is driven without that setup, in which case a single
 * worker is the whole run anyway.
 */
const RUN_ID = process.env.BREEV_M2_ACCEPTANCE_RUN_ID ?? randomUUID();

export class Take {
  public constructor(private readonly record: TranscriptRecord) {}

  /**
   * Runs one observable step. The step's own assertions live inside `observe`,
   * which returns the text the transcript records as observed. A throwing step
   * is recorded as failed with the thrown message and then rethrown, so a
   * failure is never quietly absorbed into a passing verdict.
   */
  public async step(
    action: string,
    expected: string,
    observe: () => Promise<string>,
  ): Promise<string> {
    const step: TranscriptStep = {
      action,
      expected,
      kind: "assertion",
      observed: "",
      pass: false,
    };
    this.record.steps.push(step);
    try {
      const observed = await observe();
      step.observed = observed;
      step.pass = true;
      return observed;
    } catch (caught) {
      step.observed = caught instanceof Error ? caught.message : String(caught);
      this.record.verdict = "fail";
      throw caught;
    }
  }

  /**
   * Records a fact the run establishes without an assertion of its own — for
   * example the boundary of what this seam can prove. It is a step so that it
   * appears in order with the rest, and it never invents a pass for behaviour
   * nothing checked.
   */
  public note(action: string, expected: string, observed: string): void {
    this.record.steps.push({
      action,
      expected,
      kind: "note",
      observed,
      pass: true,
    });
  }

  public addScreenshot(fileName: string): void {
    this.record.screenshots.push(fileName);
  }
}

export async function runRecord(
  context: TranscriptContext,
  descriptor: {
    readonly id: string;
    readonly kind: TranscriptKind;
    readonly title: string;
  },
  body: (take: Take) => Promise<void>,
): Promise<void> {
  const record: TranscriptRecord = {
    breevEnvironmentVariables: context.breevEnvironmentVariables,
    executable: context.executable,
    finishedAt: "",
    flowsExpected: context.flowsExpected,
    id: descriptor.id,
    kind: descriptor.kind,
    localApi: context.localApi,
    locale: context.locale,
    postgresImage: context.postgresImage,
    runId: RUN_ID,
    screenshots: [],
    sourceCommit: context.sourceCommit,
    startedAt: new Date().toISOString(),
    steps: [],
    theme: context.theme,
    title: descriptor.title,
    verdict: "fail",
    workingTreeStatus: context.workingTreeStatus,
  };
  records.push(record);
  try {
    await body(new Take(record));
    record.verdict = record.steps.every((step) => step.pass) ? "pass" : "fail";
  } finally {
    record.finishedAt = new Date().toISOString();
  }
}

/**
 * Writes the transcript as the repository's own Prettier would.
 *
 * The bundle is a tracked milestone artifact, and `pnpm format:check` runs over
 * the whole tree, so a record written with `JSON.stringify` alone would leave
 * the evidence dirty after every run and invite a hand edit between the run and
 * the commit. Formatting here with Prettier's API, under the repository's
 * resolved configuration, makes a fresh run's output already check-clean.
 */
export async function writeTranscript(): Promise<string> {
  const transcriptPath = acceptanceEvidencePath("transcript.json");
  await mkdir(path.dirname(transcriptPath), { recursive: true });
  const merged = [
    ...(await recordsFromOtherWorkers(transcriptPath)),
    ...records,
  ]
    // Chronological, which is also pass order and flow order within a pass.
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const { format, resolveConfig } = await import("prettier");
  const options = await resolveConfig(transcriptPath);
  await writeFile(
    transcriptPath,
    await format(JSON.stringify(merged, null, 2), {
      ...options,
      filepath: transcriptPath,
      parser: "json",
    }),
    "utf8",
  );
  return transcriptPath;
}

/**
 * The records of this same run that another worker already wrote. Anything left
 * from an earlier run is dropped, so the file always describes exactly one run.
 */
async function recordsFromOtherWorkers(
  transcriptPath: string,
): Promise<readonly TranscriptRecord[]> {
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(transcriptPath, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(existing)) {
    return [];
  }
  const mine = new Set(records.map((record) => record.id));
  return (existing as TranscriptRecord[]).filter(
    (record) => record.runId === RUN_ID && !mine.has(record.id),
  );
}
