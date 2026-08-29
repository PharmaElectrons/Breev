/**
 * Redacts secret shapes out of one guest-pulled evidence file, then fails
 * closed if any shape survives.
 *
 * `tooling/windows/libvirt/transfer-windows-evidence.sh` delegates the same
 * duty to `Export-Issue34Evidence.ps1`, which only rejects. Rejection alone is
 * not enough here: the milestone-1 phases pull PowerShell transcripts whose
 * error text can legitimately quote a connection URL, and discarding the whole
 * transcript would discard the failure it was capturing. So each shape is first
 * replaced in place, and the surviving-match scan afterwards is the real gate:
 * while any pattern still matches, nothing is written and the caller fails.
 *
 * Every replacement keeps the file's syntax intact — a redacted phase record
 * must stay parsable JSON — and every pattern refuses to match its own
 * replacement, so the survivor scan reports real leaks rather than the markers
 * this file just wrote.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REDACTION = "<REDACTED>";

const RULES = Object.freeze([
  {
    name: "private-key-block",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?!<REDACTED>-----END)[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
    replacement: `-----BEGIN PRIVATE KEY-----${REDACTION}-----END PRIVATE KEY-----`,
  },
  {
    // The character class excludes < and >, so the replacement below cannot be
    // matched again.
    name: "postgresql-connection-url",
    pattern: /postgres(?:ql)?:\/\/[^\s"'<>\\]+/gi,
    replacement: `postgresql://${REDACTION}`,
  },
  {
    name: "device-binding-secret",
    pattern: /"(deviceSecret|sessionToken)"(\s*:\s*)"(?!<REDACTED>")[^"]*"/g,
    replacement: `"$1"$2"${REDACTION}"`,
  },
  {
    // The value alternatives are ordered escaped-string, quoted-string,
    // single-quoted, bare token, and none of them may run past the delimiter
    // that closes the value. A greedy \S+ here would eat the closing quote of
    // the surrounding JSON string and leave an unparsable record behind.
    name: "password-assignment",
    pattern:
      /\b(PGPASSWORD|BREEV_WINDOWS_CERTIFICATE_PASSWORD|CERTIFICATE_PASSWORD|PASSWORD)(\s*[=:]\s*)(?!<REDACTED>)(\\"(?:[^"\\]|\\.)*?\\"|"[^"\n]*"|'[^'\n]*'|[^\s"'\\,;}\]]+)/gi,
    replacement: `$1$2${REDACTION}`,
  },
  {
    // A pgpass line is host:port:database:user:password. The replacement keeps
    // only two colons, so it can never satisfy the four this pattern needs.
    name: "pgpass-line",
    pattern: /^[ \t]*(127\.0\.0\.1|::1|localhost):\d+:[^:\n]*:[^:\n]*:.*$/gm,
    replacement: `$1:0:${REDACTION}`,
  },
]);

const inputPath = path.resolve(readArgument("--input"));
const inPlace = process.argv.includes("--in-place");
const outputArgument = readOptionalArgument("--output");
if (!inPlace && outputArgument === undefined) {
  throw new Error(
    "Pass --in-place or --output so the sanitized result has a destination",
  );
}
const outputPath =
  outputArgument === undefined ? inputPath : path.resolve(outputArgument);

const original = await readFile(inputPath, "utf8");
let sanitized = original;
const redactions = [];
for (const rule of RULES) {
  const matches = sanitized.match(rule.pattern);
  if (matches === null) {
    continue;
  }
  redactions.push({ rule: rule.name, count: matches.length });
  sanitized = sanitized.replace(rule.pattern, rule.replacement);
}

const survivingPatterns = RULES.filter((rule) =>
  // A fresh regex per scan: the shared literals carry /g and therefore a
  // mutable lastIndex that would make a later test() skip the start of input.
  new RegExp(rule.pattern.source, rule.pattern.flags).test(sanitized),
).map((rule) => rule.name);

const result = {
  schemaVersion: 1,
  input: inputPath,
  output: outputPath,
  bytesBefore: Buffer.byteLength(original, "utf8"),
  bytesAfter: Buffer.byteLength(sanitized, "utf8"),
  redactions,
  survivingPatterns,
  clean: survivingPatterns.length === 0,
};

if (result.clean) {
  await writeFile(outputPath, sanitized, "utf8");
}
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.clean) {
  process.exitCode = 1;
}

function readArgument(name) {
  const value = readOptionalArgument(name);
  if (value === undefined) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}

function readOptionalArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}
