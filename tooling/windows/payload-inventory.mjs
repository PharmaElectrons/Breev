import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const signable = new Set([
  ".exe",
  ".dll",
  ".node",
  ".sys",
  ".efi",
  ".scr",
  ".msi",
  ".cat",
  ".cab",
  ".xap",
  ".vbs",
  ".wsf",
  ".ps1",
]);

export async function recordPayloadFiles(root) {
  const files = [];
  async function walk(relative = "") {
    for (const entry of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error(`Payload links are forbidden: ${name}`);
      if (entry.isDirectory()) {
        await walk(name);
        continue;
      }
      if (!entry.isFile())
        throw new Error(`Payload entry is not a regular file: ${name}`);
      if (name === "payload-manifest.json") continue;
      if (/^\.env(?:\.|$)/i.test(entry.name))
        throw new Error(`Payload secrets are forbidden: ${name}`);
      const file = path.join(root, name);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      files.push({
        path: name,
        bytes: (await stat(file)).size,
        sha256: hash.digest("hex"),
      });
    }
  }
  await walk();
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Signing may change only signable files; SQL/JS/notices must still match the
// assembled inventory. Never bless extra files by simply regenerating a list.
export async function verifyPayloadFiles(root, expected, allowSigning = false) {
  if (!Array.isArray(expected) || expected.length === 0)
    throw new Error("Payload file inventory is missing");
  const names = new Set();
  for (const file of expected) {
    if (
      typeof file.path !== "string" ||
      !/^[a-zA-Z0-9_./+-]+$/.test(file.path) ||
      file.path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") ||
      file.path === "payload-manifest.json" ||
      names.has(file.path.toLowerCase()) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error("Payload file inventory is invalid");
    }
    names.add(file.path.toLowerCase());
  }
  const actual = await recordPayloadFiles(root);
  if (actual.length !== expected.length)
    throw new Error(
      "Payload file inventory does not match the installed files",
    );
  const expectedByPath = new Map(expected.map((file) => [file.path, file]));
  for (const file of actual) {
    const before = expectedByPath.get(file.path);
    if (!before) throw new Error(`Unexpected payload file: ${file.path}`);
    if (
      !(allowSigning && signable.has(path.extname(file.path))) &&
      (before.bytes !== file.bytes || before.sha256 !== file.sha256)
    ) {
      throw new Error(`Payload integrity failed: ${file.path}`);
    }
  }
  return actual;
}
