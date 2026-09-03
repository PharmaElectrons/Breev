import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Shared spawn/health/stop plumbing for the browser and smoke suites that
 * boot a real `local-api` child process. Every suite used to spawn the
 * child with no listener on stdout/stderr/exit/error, so a boot failure
 * surfaced only as a generic "did not report healthy" message with the
 * child's own diagnosis gone. That silence caused a real misdiagnosis once
 * (a PowerShell "Access denied" storm was blamed on the wrong file because
 * nothing captured what the API actually said as it died). This module
 * buffers a bounded tail of the child's output and its exit state so a
 * readiness failure can name what really happened.
 */

const MAX_TAIL_BYTES = 4_096;

interface ProcessDiagnostics {
  errorMessage: string | undefined;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
  stdoutTail: string;
}

const diagnosticsByChild = new WeakMap<
  ChildProcessWithoutNullStreams,
  ProcessDiagnostics
>();

/**
 * Spawns a `local-api` child process, buffering a bounded tail of its
 * stdout/stderr and recording its exit code/signal/spawn error so
 * {@link waitForHealth} can report them on failure.
 */
export function spawnLocalApiProcess(
  executablePath: string,
  env: NodeJS.ProcessEnv,
  execArgv: readonly string[] = [],
): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [...execArgv, executablePath], {
    env,
  });

  const diagnostics: ProcessDiagnostics = {
    errorMessage: undefined,
    exitCode: null,
    signal: null,
    stderrTail: "",
    stdoutTail: "",
  };
  diagnosticsByChild.set(child, diagnostics);

  child.stdout.on("data", (chunk: Buffer) => {
    diagnostics.stdoutTail = appendBounded(
      diagnostics.stdoutTail,
      chunk.toString("utf8"),
    );
  });
  child.stderr.on("data", (chunk: Buffer) => {
    diagnostics.stderrTail = appendBounded(
      diagnostics.stderrTail,
      chunk.toString("utf8"),
    );
  });
  child.once("exit", (code, signal) => {
    diagnostics.exitCode = code;
    diagnostics.signal = signal;
  });
  child.once("error", (error) => {
    diagnostics.errorMessage = error.message;
  });

  return child;
}

function appendBounded(existing: string, addition: string): string {
  const combined = existing + addition;
  return combined.length > MAX_TAIL_BYTES
    ? combined.slice(combined.length - MAX_TAIL_BYTES)
    : combined;
}

/**
 * Polls `<baseUrl>/health` until it reports `status`, or throws naming the
 * child's exit state and its last output. Every branch of the poll loop —
 * including a response with the wrong status — delays before retrying;
 * previously the delay lived only in the `catch`, so an API that answered
 * with the wrong status busy-spun for the whole deadline.
 */
export async function waitForHealth(
  baseUrl: string,
  status: "healthy" | "repair-required",
  child: ChildProcessWithoutNullStreams,
  deadlineMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      // The process is already gone; further polling cannot succeed.
      break;
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      const body = (await response.json()) as { status?: string };
      if (body.status === status) {
        return;
      }
    } catch {
      // Not reachable yet (still starting, or between restarts); retry.
    }
    await delay(100);
  }
  throw new Error(describeHealthFailure(baseUrl, status, child));
}

function describeHealthFailure(
  baseUrl: string,
  status: string,
  child: ChildProcessWithoutNullStreams,
): string {
  const diagnostics = diagnosticsByChild.get(child);
  const exitState =
    diagnostics?.errorMessage !== undefined
      ? `failed to start: ${diagnostics.errorMessage}`
      : child.exitCode !== null || child.signalCode !== null
        ? `exited with code ${String(child.exitCode)} signal ${String(child.signalCode)}`
        : "still running";
  const stderrTail = diagnostics?.stderrTail.trim() ?? "";
  const stdoutTail = diagnostics?.stdoutTail.trim() ?? "";
  const parts = [
    `Local API did not report ${status} at ${baseUrl} (${exitState}).`,
  ];
  if (stderrTail.length > 0) {
    parts.push(`--- stderr tail ---\n${stderrTail}`);
  }
  if (stdoutTail.length > 0) {
    parts.push(`--- stdout tail ---\n${stdoutTail}`);
  }
  return parts.join("\n");
}

export async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
