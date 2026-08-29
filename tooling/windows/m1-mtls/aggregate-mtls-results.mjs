/** Validates and aggregates the three peer case records without weakening one. */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CASE_CONTRACTS, PROOF_CASES } from "./peer-mtls-driver.mjs";

export function validateProofResults(results, correlation = {}) {
  if (!Array.isArray(results) || results.length !== PROOF_CASES.length) {
    throw new Error("All three mTLS proof cases must be present exactly once");
  }
  const byCase = new Map();
  for (const result of results) {
    if (
      typeof result !== "object" ||
      result === null ||
      typeof result.case !== "string" ||
      byCase.has(result.case)
    ) {
      throw new Error("The mTLS proof contains a malformed or duplicate case");
    }
    byCase.set(result.case, result);
  }
  for (const caseName of PROOF_CASES) {
    const result = byCase.get(caseName);
    const contract = CASE_CONTRACTS[caseName];
    if (result === undefined || result.passed !== true) {
      throw new Error(`The ${caseName} mTLS proof case was skipped or failed`);
    }
    if (
      result.assertion !== contract.assertion ||
      result.expectation !== contract.expectation ||
      result.identity !== contract.identity ||
      (correlation.runId !== undefined && result.runId !== correlation.runId) ||
      (correlation.sourceCommit !== undefined &&
        result.sourceCommit !== correlation.sourceCommit)
    ) {
      throw new Error(`The ${caseName} mTLS proof contract does not match`);
    }
  }
  assertAccepted(byCase.get("accepted"));
  assertRefused(byCase.get("foreign"), [
    "cert-chain-invalid",
    "mtls-cert-invalid",
    "mtls-cert-missing",
  ]);
  assertRefused(byCase.get("missing"), ["mtls-cert-missing"]);
  return Object.fromEntries(
    PROOF_CASES.map((name) => [name, byCase.get(name)]),
  );
}

function assertAccepted(result) {
  if (
    result.outcome !== "accepted" ||
    result.details?.accepted !== true ||
    result.details?.refusalAsserted !== false ||
    result.details?.statusCode < 200 ||
    result.details?.statusCode >= 300 ||
    result.details?.tlsProtocol !== "TLSv1.3" ||
    result.details?.peerCertificateAccepted !== true
  ) {
    throw new Error("The accepted case lacks its positive TLS 1.3 assertion");
  }
}

function assertRefused(result, expectedDenialCodes) {
  const middlewareRefusal =
    result.details?.refusalKind === "mtls-middleware" &&
    (result.details?.statusCode === 401 ||
      result.details?.statusCode === 403) &&
    expectedDenialCodes.includes(result.details?.denialCode);
  const handshakeRefusal =
    result.details?.refusalKind === "tls-handshake" &&
    typeof result.details?.tlsErrorCode === "string";
  if (
    result.outcome !== "refused" ||
    result.details?.accepted !== false ||
    result.details?.refusalAsserted !== true ||
    (!middlewareRefusal && !handshakeRefusal)
  ) {
    throw new Error(
      `The ${result.case} case does not explicitly prove an mTLS refusal`,
    );
  }
}

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function main(argv) {
  const inputDirectory = path.resolve(readArgument(argv, "--input-dir"));
  const outputPath = path.resolve(readArgument(argv, "--output"));
  const runId = readArgument(argv, "--run-id");
  const sourceCommit = readArgument(argv, "--source-commit");
  const results = await Promise.all(
    PROOF_CASES.map(async (caseName) =>
      JSON.parse(
        await readFile(path.join(inputDirectory, `${caseName}.json`), "utf8"),
      ),
    ),
  );
  const cases = validateProofResults(results, { runId, sourceCommit });
  const aggregate = {
    cases,
    finishedUtc: new Date().toISOString(),
    passed: true,
    runId,
    schemaVersion: 1,
    sourceCommit,
  };
  await writeFile(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`${outputPath}\n`);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2));
}
