import { helpMessages } from "./help-messages";
import type { Locale } from "./preferences";

function GuideIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Opens the guide for the screen the user is on.
 *
 * It sits immediately before the language control so the shell's documented
 * button order — language, theme, check — stays contiguous and in the order the
 * accessibility evidence in docs/quality.md records.
 */
export function HelpButton({
  locale,
  onOpen,
  reference,
}: {
  readonly locale: Locale;
  readonly onOpen: () => void;
  readonly reference: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const copy = helpMessages[locale];
  return (
    <button
      ref={reference}
      className="quiet-button"
      type="button"
      aria-label={copy.helpButton}
      onClick={onOpen}
    >
      <GuideIcon />
      <span>{copy.helpButton}</span>
    </button>
  );
}
