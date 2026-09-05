const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PARTS = new Set([
  "address",
  "age",
  "amount",
  "authorization",
  "balance",
  "clinical",
  "cookie",
  "cost",
  "credential",
  "diagnosis",
  "doctor",
  "dosage",
  "financial",
  "invitation",
  "invoice",
  "key",
  "name",
  "note",
  "passphrase",
  "password",
  "patient",
  "phone",
  "prescription",
  "price",
  "sale",
  "secret",
  "session",
  "supplier",
  "token",
  "weight",
]);
const PEM_BLOCK = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const EGYPT_NATIONAL_ID = /(?<!\d)[23]\d{13}(?!\d)/gu;
const LONG_IDENTIFIER = /(?<!\d)\d{10,16}(?!\d)/gu;
const GROUPED_IDENTIFIER = /(?<!\d)(?:\d[\s().-]*){10,16}(?!\d)/gu;
const PHONE =
  /(?<![\dA-Za-z])(?:\+?20|0020)?[\s().-]*01[0125](?:[\s().-]*\d){8}(?!\d)/gu;
const INTERNATIONAL_PHONE =
  /(?<![\dA-Za-z])(?:\+|00)[1-9](?:[\s().-]*\d){7,14}(?!\d)/gu;
const SENSITIVE_FREE_TEXT =
  /\b(?:address|age|balance|diagnosis|doctor|dosage|dose|dr\.?|invoice|medical notes?|prescri(?:bed|ption)|supplier costs?|weight)\b[^\r\n,;]{0,96}/giu;
const SENSITIVE_ASSIGNMENT =
  /\b(?:api[-_]?key|authorization|cookie|password|passphrase|secret|session|token)\b\s*[:=]\s*[^\s,;]+/giu;
const URL_CREDENTIAL = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu;
const SENSITIVE_QUERY =
  /([?&](?:api[-_]?key|auth|code|password|secret|session|token)=)[^&#\s]+/giu;

export function redactDiagnosticText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(PEM_BLOCK, REDACTED)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(URL_CREDENTIAL, `$1${REDACTED}@`)
    .replace(SENSITIVE_QUERY, `$1${REDACTED}`)
    .replace(SENSITIVE_ASSIGNMENT, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, REDACTED)
    .replace(INTERNATIONAL_PHONE, REDACTED)
    .replace(EGYPT_NATIONAL_ID, REDACTED)
    .replace(GROUPED_IDENTIFIER, REDACTED)
    .replace(SENSITIVE_FREE_TEXT, REDACTED)
    .replace(LONG_IDENTIFIER, REDACTED);
}

export function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === "string") return redactDiagnosticText(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 1_000)
      .map((item) => redactDiagnosticValue(item, depth + 1));
  }
  if (typeof value !== "object") return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 1_000)) {
    result[key] = isSensitiveKey(key)
      ? REDACTED
      : redactDiagnosticValue(item, depth + 1);
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  const parts = key
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
  return (
    parts.some((part) => SENSITIVE_KEY_PARTS.has(part)) ||
    parts.join("") === "nationalid"
  );
}

export function containsDiagnosticCanary(value: string): boolean {
  return /canary/iu.test(value);
}
