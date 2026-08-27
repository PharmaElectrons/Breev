import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = [
  /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/u,
  /\bcreateHmac\b/u,
  /\bHMAC\b/u,
  /LICEN[CS]E_(?:PRIVATE|SIGNING|SHARED)_?(?:KEY|SECRET)?/iu,
];

export async function inspectLicenceArtifacts(roots) {
  const files = [];
  for (const root of roots) await collectFiles(root, files);
  if (files.length === 0)
    throw new Error("No Breev build artifacts were found");

  const violations = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(content)) violations.push(`${file}: ${pattern.source}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Private or shared licence-signing material reached an artifact:\n${violations.join("\n")}`,
    );
  }
  return files.length;
}

async function collectFiles(root, files) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(target, files);
    } else if (/\.(?:c?js|json|mjs)$/u.test(entry.name)) {
      files.push(target);
    }
  }
}

const invokedPath =
  process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const count = await inspectLicenceArtifacts([
    path.join(repositoryRoot, "apps/desktop/out"),
    path.join(repositoryRoot, "apps/local-api/dist"),
    path.join(repositoryRoot, "packages/contracts/dist"),
  ]);
  process.stdout.write(
    `Inspected ${count} Breev artifact files; no signing secret found.\n`,
  );
}
