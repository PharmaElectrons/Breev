/** Only exact server-generated count-session grammars are presentation text. */
export function generatedReferenceDisplay(
  reference: { readonly documentType: string; readonly label: string },
  locale: "ar" | "en",
  number: (value: bigint) => string,
  timestamp: (value: string) => string,
): string {
  const { label } = reference;
  if (reference.documentType !== "count-session") return label;
  const numbered = /^(C[1-9][0-9]*\/[0-9]{4}) · line ([1-9][0-9]*)$/u.exec(
    label,
  );
  if (numbered)
    return `\u2068${numbered[1]}\u2069 · ${locale === "ar" ? "السطر" : "line"} ${number(BigInt(numbered[2]!))}`;
  const started =
    /^Count session started (\d{4}-\d{2}-\d{2}[T ][0-9:.]+(?:Z|\+00(?::?00)?)) · line ([1-9][0-9]*)$/u.exec(
      label,
    );
  if (started)
    return `${locale === "ar" ? "بدأت جلسة الجرد" : "Count session started"} ${timestamp(started[1]!)} · ${locale === "ar" ? "السطر" : "line"} ${number(BigInt(started[2]!))}`;
  const fallback =
    /^Count session ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) · line ([1-9][0-9]*)$/iu.exec(
      label,
    );
  if (fallback)
    return `${locale === "ar" ? "جلسة جرد" : "Count session"} \u2068${fallback[1]}\u2069 · ${locale === "ar" ? "السطر" : "line"} ${number(BigInt(fallback[2]!))}`;
  if (label === "Count session") return locale === "ar" ? "جلسة جرد" : label;
  return label;
}
