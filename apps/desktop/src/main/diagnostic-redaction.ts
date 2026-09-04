const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|clinical|diagnosis|invitation|key|name|national.?id|note|passphrase|password|patient|phone|prescription|secret|session|token)/iu;
const PEM_BLOCK = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const EGYPT_NATIONAL_ID = /(?<!\d)[23]\d{13}(?!\d)/gu;
const LONG_IDENTIFIER = /(?<!\d)\d{10,16}(?!\d)/gu;
const PHONE =
  /(?<![\dA-Za-z])(?:\+?20|0020)?[\s().-]*01[0125](?:[\s().-]*\d){8}(?!\d)/gu;
const SENSITIVE_ASSIGNMENT =
  /\b(?:api[-_]?key|authorization|cookie|password|passphrase|secret|session|token)\b\s*[:=]\s*[^\s,;]+/giu;
const URL_CREDENTIAL = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu;
const SENSITIVE_QUERY =
  /([?&](?:api[-_]?key|auth|code|password|secret|session|token)=)[^&#\s]+/giu;

export function redactDiagnosticText(value: string): string {
  return value
    .replace(PEM_BLOCK, REDACTED)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(URL_CREDENTIAL, `$1${REDACTED}@`)
    .replace(SENSITIVE_QUERY, `$1${REDACTED}`)
    .replace(SENSITIVE_ASSIGNMENT, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, REDACTED)
    .replace(EGYPT_NATIONAL_ID, REDACTED)
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
    result[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : redactDiagnosticValue(item, depth + 1);
  }
  return result;
}

export function containsDiagnosticCanary(value: string): boolean {
  return /(?:patient-name-canary|national-id-canary|phone-canary|prescription-canary|token-canary|secret-canary)/iu.test(
    value,
  );
}
