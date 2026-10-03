/** Exact display-unit conversion only; invoice calculation belongs to the API. */
export function invoiceOfferIqdToFils(value: string): string | null {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const fils = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return fils <= 9223372036854775807n ? fils.toString() : null;
}

export function invoiceOfferFilsToIqd(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) return "";
  const fils = BigInt(value);
  const fraction = String(fils % 1000n)
    .padStart(3, "0")
    .replace(/0+$/u, "");
  return `${fils / 1000n}${fraction === "" ? "" : `.${fraction}`}`;
}
