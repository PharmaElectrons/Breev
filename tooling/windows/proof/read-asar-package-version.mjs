import { createRequire } from "node:module";
import path from "node:path";

const forgeRequire = createRequire(
  path.resolve(import.meta.dirname, "../forge-comparison/package.json"),
);
const { extractFile } = forgeRequire("@electron/asar");

const asarPath = path.resolve(readArgument("--asar"));
const packageJson = JSON.parse(
  extractFile(asarPath, "package.json").toString(),
);
if (typeof packageJson.version !== "string") {
  throw new Error("The packaged ASAR has no application version");
}
process.stdout.write(`${packageJson.version}\n`);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
