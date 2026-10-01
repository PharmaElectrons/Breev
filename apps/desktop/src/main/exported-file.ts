import { randomBytes } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Writes a validated export payload through a same-directory staging file. The
 * destination is never exposed to the renderer and a partially written file
 * cannot be mistaken for a completed export.
 */
export class ExportTooLargeError extends Error {
  public constructor() {
    super("Export exceeds the safe export limit");
    this.name = "ExportTooLargeError";
  }
}

export interface ExportStaging {
  readonly handle: Awaited<ReturnType<typeof open>>;
  readonly temporaryPath: string;
}

export async function openExportStaging(
  filePath: string,
): Promise<ExportStaging> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  return {
    handle: await open(temporaryPath, "wx", 0o600),
    temporaryPath,
  };
}

export async function appendExportStaging(
  staging: ExportStaging,
  chunk: string,
  writtenBytes: number,
  maximumBytes: number,
): Promise<number> {
  const bytes = Buffer.byteLength(chunk, "utf8");
  if (writtenBytes + bytes > maximumBytes) throw new ExportTooLargeError();
  await staging.handle.write(Buffer.from(chunk, "utf8"));
  return writtenBytes + bytes;
}

export async function commitExportStaging(
  staging: ExportStaging,
  filePath: string,
): Promise<void> {
  await staging.handle.sync();
  await staging.handle.close();
  await rename(staging.temporaryPath, filePath);
}

export async function abortExportStaging(
  staging: ExportStaging,
): Promise<void> {
  await staging.handle.close().catch(() => undefined);
  await rm(staging.temporaryPath, { force: true }).catch(() => undefined);
}

export async function writeExportedJson(
  filePath: string,
  serialized: string,
  maximumBytes: number,
): Promise<void> {
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error("Export exceeds the safe export limit");
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
