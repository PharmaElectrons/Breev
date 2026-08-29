import { fingerprintGroups } from "./pairing-format";

/**
 * The twelve comparison digits, in four groups of three. Both sides of the
 * ceremony render this component, so the artefact the user compares is
 * identical on the Main Pharmacy Computer and on the terminal, in Arabic and in
 * English. The digits are isolated LTR: an RTL paragraph must never reorder
 * them.
 */
export function FingerprintDigits({
  digits,
}: {
  readonly digits: string;
}): React.JSX.Element {
  const groups = fingerprintGroups(digits);
  if (groups === null) {
    return (
      <p className="fingerprint-digits fingerprint-invalid" role="alert">
        ?
      </p>
    );
  }
  return (
    <p
      className="fingerprint-digits"
      data-testid="pairing-fingerprint"
      dir="ltr"
    >
      {groups.map((group, index) => (
        <span key={`${index}-${group}`}>{group}</span>
      ))}
    </p>
  );
}
