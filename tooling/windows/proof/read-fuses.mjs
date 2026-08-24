import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const desktopRequire = createRequire(
  path.resolve(import.meta.dirname, "../../../apps/desktop/package.json"),
);
const { FuseState, FuseV1Options, getCurrentFuseWire } =
  desktopRequire("@electron/fuses");

const executablePath = resolveArgument("--executable");
const outputPath = resolveArgument("--output");
await access(executablePath);

const wire = await getCurrentFuseWire(executablePath);
const expected = {
  EnableCookieEncryption: FuseState.ENABLE,
  EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
  EnableNodeCliInspectArguments: FuseState.DISABLE,
  EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
  GrantFileProtocolExtraPrivileges: FuseState.DISABLE,
  LoadBrowserProcessSpecificV8Snapshot: FuseState.DISABLE,
  OnlyLoadAppFromAsar: FuseState.ENABLE,
  RunAsNode: FuseState.DISABLE,
  WasmTrapHandlers: FuseState.ENABLE,
};
const actual = Object.fromEntries(
  Object.keys(expected).map((name) => [name, wire[FuseV1Options[name]]]),
);
const result = {
  schemaVersion: 1,
  executable: path.resolve(executablePath),
  executableSha256: createHash("sha256")
    .update(await readFile(executablePath))
    .digest("hex"),
  expected,
  actual,
  passed: Object.entries(expected).every(
    ([name, state]) => actual[name] === state,
  ),
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.passed) {
  process.exitCode = 1;
}

function resolveArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return path.resolve(value);
}
