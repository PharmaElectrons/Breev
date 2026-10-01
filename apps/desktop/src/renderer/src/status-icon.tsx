import type { StartupState } from "./startup-state";

export function StatusIcon({
  state,
}: {
  readonly state: StartupState;
}): React.JSX.Element {
  const icon =
    state === "ready" ? (
      <path d="m7 12 3 3 7-7" />
    ) : state === "repair-required" ? (
      <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z" />
    ) : state === "incompatible-version" ? (
      <>
        <path d="M8 7h9l-2-2" />
        <path d="m17 17-9 0 2 2" />
        <path d="m17 7-2 2" />
        <path d="m8 17 2-2" />
      </>
    ) : state === "main-unavailable" ? (
      <>
        <path d="M6 8h12v8H6z" />
        <path d="m4 4 16 16" />
      </>
    ) : state === "unpaired" ? (
      <>
        <path d="M9 4v5" />
        <path d="M15 4v5" />
        <path d="M7 9h10v3a5 5 0 0 1-10 0Z" />
        <path d="M12 17v3" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    );

  return (
    <span className="status-icon" data-icon-state={state} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        {icon}
      </svg>
    </span>
  );
}
