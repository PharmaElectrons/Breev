import type {
  IdentityDenial,
  LicensingDenial,
  StepUpAction,
} from "@breev/contracts/local-rest";
import { useCallback, useRef, useState } from "react";

import { approveStepUpChallenge, createStepUpChallenge } from "./identity-api";
import type { IdentityCopy } from "./identity-messages";
import type { LicensingCopy } from "./licensing-messages";

export type StepUpDenial = IdentityDenial | LicensingDenial;
export type StepUpRunner = <T>(
  work: () => Promise<T>,
) => Promise<T | undefined>;

interface PendingStepUp {
  readonly afterApproval: (challengeId: string) => Promise<void>;
  readonly challengeId: string;
}

export function useStepUp(
  baseUrl: string,
  run: StepUpRunner,
): {
  readonly approve: (password: string) => Promise<boolean>;
  readonly begin: (
    action: StepUpAction,
    subjectId: string | undefined,
    afterApproval: (challengeId: string) => Promise<void>,
  ) => Promise<void>;
  readonly cancel: () => void;
  readonly close: () => void;
  readonly pending: PendingStepUp | null;
  readonly pendingFocusId: string | null;
  readonly previousFocusId: React.MutableRefObject<string | null>;
  readonly setPendingFocusId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
} {
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const previousFocusId = useRef<string | null>(null);

  const begin = useCallback(
    async (
      action: StepUpAction,
      subjectId: string | undefined,
      afterApproval: (challengeId: string) => Promise<void>,
    ): Promise<void> => {
      previousFocusId.current =
        (document.activeElement as HTMLElement | null)?.id ?? null;
      const challenge = await run(() =>
        createStepUpChallenge(baseUrl, {
          action,
          idempotencyKey: crypto.randomUUID(),
          ...(subjectId === undefined ? {} : { subjectId }),
        }),
      );
      if (challenge !== undefined) {
        setPending({ afterApproval, challengeId: challenge.id });
      }
    },
    [baseUrl, run],
  );

  const close = useCallback((): void => {
    setPending(null);
  }, []);

  const cancel = useCallback((): void => {
    const returnFocusId = previousFocusId.current;
    setPending(null);
    if (returnFocusId !== null) {
      queueMicrotask(() => document.getElementById(returnFocusId)?.focus());
    }
  }, []);

  const approve = useCallback(
    async (password: string): Promise<boolean> => {
      if (pending === null) return false;
      const approval = await run(() =>
        approveStepUpChallenge(baseUrl, pending.challengeId, {
          idempotencyKey: crypto.randomUUID(),
          password,
        }),
      );
      if (approval === undefined) return false;
      const completed = pending;
      setPending(null);
      await completed.afterApproval(completed.challengeId);
      setPendingFocusId(previousFocusId.current);
      return true;
    },
    [baseUrl, pending, run],
  );

  return {
    approve,
    begin,
    cancel,
    close,
    pending,
    pendingFocusId,
    previousFocusId,
    setPendingFocusId,
  };
}

export function StepUpDialog({
  busy,
  copy,
  denial,
  licensingCopy,
  onCancel,
  onDismissDenial,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly copy: IdentityCopy;
  readonly denial: StepUpDenial | null;
  readonly licensingCopy: LicensingCopy;
  readonly onCancel: () => void;
  readonly onDismissDenial: () => void;
  readonly onSubmit: (password: string) => Promise<boolean>;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  return (
    <div
      aria-labelledby="step-up-title"
      aria-describedby="step-up-description"
      aria-modal="true"
      className="dialog-backdrop"
      ref={dialog}
      role="dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
          return;
        }
        if (event.key === "Tab") {
          const focusable = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable === undefined || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
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
      <div className="identity-card step-up-dialog">
        <h2 id="step-up-title">{copy.reauthenticate}</h2>
        <p id="step-up-description">{copy.reauthenticationDescription}</p>
        {denial === null ? null : (
          <DenialAlert
            copy={copy}
            denial={denial}
            licensingCopy={licensingCopy}
            onDismiss={onDismissDenial}
          />
        )}
        <form
          className="identity-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const password = requiredValue(
              new FormData(form),
              "password",
              false,
            );
            void onSubmit(password).then((succeeded) => {
              if (!succeeded) {
                const passwordInput = form.elements.namedItem("password");
                if (passwordInput instanceof HTMLInputElement) {
                  passwordInput.focus();
                }
              }
            });
          }}
        >
          <LabeledInput
            autoFocus
            autoComplete="current-password"
            label={copy.password}
            name="password"
            type="password"
            maxLength={128}
          />
          <div className="form-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {copy.reauthenticate}
            </button>
            <button className="quiet-button" type="button" onClick={onCancel}>
              {copy.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DenialAlert({
  copy,
  denial,
  licensingCopy,
  onDismiss,
}: {
  readonly copy: IdentityCopy;
  readonly denial: StepUpDenial;
  readonly licensingCopy: LicensingCopy;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="denial-alert" role="alert">
      <span className="denial-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{copy.denial}</strong>
        <p>
          {denial.code in licensingCopy.denials
            ? licensingCopy.denials[
                denial.code as keyof LicensingCopy["denials"]
              ]
            : copy.denials[denial.code as IdentityDenial["code"]]}
        </p>
        <small>
          {copy.requestReference}: {denial.requestId}
        </small>
      </div>
      <button
        aria-label={copy.cancel}
        className="dismiss-button"
        type="button"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

export function LabeledInput({
  label,
  ...input
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "className"> & {
  readonly label: string;
}): React.JSX.Element {
  return (
    <label className="field-label">
      <span>{label}</span>
      <input {...input} required />
    </label>
  );
}

function requiredValue(data: FormData, key: string, trim = true): string {
  const value = data.get(key);
  if (typeof value !== "string") {
    throw new Error(`Missing form field: ${key}`);
  }
  return trim ? value.trim() : value;
}
