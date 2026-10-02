import { useLayoutEffect, type ReactNode, type RefObject } from "react";

/** Purchasing's small confirmation surfaces; full registers stay inline. */
export function PurchasingModal({
  children,
  className,
  dialogRef,
  labelledBy,
  label,
  alert = false,
  blocked = false,
  initialFocus,
  onDismiss,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  readonly labelledBy?: string;
  readonly label?: string;
  readonly alert?: boolean;
  readonly blocked?: boolean;
  readonly initialFocus: string;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => dialog.close();
  }, [dialogRef, initialFocus]);

  return (
    <dialog
      ref={dialogRef}
      className={`purchasing-modal ${className}`}
      role={alert ? "alertdialog" : "dialog"}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) onDismiss();
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          // An IME Escape cancels composition, never its containing workflow.
          event.stopPropagation();
          event.preventDefault();
          if (event.nativeEvent.isComposing) return;
          if (!blocked) onDismiss();
        } else if (event.key === "Tab" && !event.nativeEvent.isComposing) {
          const targets = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
            ),
          ].filter(
            (target) =>
              target.getClientRects().length > 0 && !target.closest("[inert]"),
          );
          const first = targets[0];
          const last = targets.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      {children}
    </dialog>
  );
}
