import { randomBytes } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Writes a validated JSON payload through a same-directory staging file. The
 * destination is never exposed to the renderer and a partially written file
 * cannot be mistaken for a completed export.
 */
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
