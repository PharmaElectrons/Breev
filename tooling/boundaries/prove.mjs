import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const checker = path.resolve(import.meta.dirname, "check.mjs");
const fixtures = path.resolve(import.meta.dirname, "fixtures");

expectPass("valid");
expectFailure("cross-module-table", ["Cross-module table access"]);
expectFailure("cycle", ["Dependency cycle"]);
expectFailure("renderer", ["node:fs", "pg", "@nestjs/common", "../main/index"]);
expectFailure("contracts-root", ["Contracts root import"]);

process.stdout.write("Deliberate boundary violations failed as expected.\n");

function runFixture(name) {
  return spawnSync(
    process.execPath,
    [checker, "--root", path.join(fixtures, name)],
    { encoding: "utf8" },
  );
}

function expectPass(name) {
  const result = runFixture(name);
  if (result.status !== 0) {
    throw new Error(`Valid boundary fixture failed:\n${result.stderr}`);
  }
}

function expectFailure(name, expectedMessages) {
  const result = runFixture(name);
  if (result.status === 0) {
    throw new Error(`Invalid boundary fixture ${name} passed`);
  }
  for (const message of expectedMessages) {
    if (!result.stderr.includes(message)) {
      throw new Error(
        `Boundary fixture ${name} did not report ${message}:\n${result.stderr}`,
      );
    }
  }
}
