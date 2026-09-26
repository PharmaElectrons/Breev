import type {
  IdentityDenial,
  LicensingDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useRef, useState } from "react";

import {
  bootstrapIdentity,
  IdentityApiDenied,
  loginIdentity,
  LicensingApiDenied,
} from "./identity-api";
import { identityMessages, type IdentityCopy } from "./identity-messages";
import { useIdentityState } from "./identity-state-provider";
import { licensingMessages } from "./licensing-messages";
import { usePreferences } from "./preferences-provider";
import { DenialAlert, LabeledInput } from "./step-up";

type AccessDenial = IdentityDenial | LicensingDenial;
interface RunOptions {
  readonly preserveDenial?: boolean;
}

export function IdentityShell({
  baseUrl,
}: {
  readonly baseUrl: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = identityMessages[locale];
  const licensingCopy = licensingMessages[locale];
  // The shell owns the poll so the module navigation and this workspace read
  // one authenticated context (permissions, entitlements, session).
  const { refresh, setState, state } = useIdentityState();
  const [denial, setDenial] = useState<AccessDenial | null>(null);
  const lastDenial = useRef<AccessDenial | null>(null);
  const [busy, setBusy] = useState(false);

  const clearDenial = useCallback((): void => {
    lastDenial.current = null;
    setDenial(null);
  }, []);

  const run = useCallback(
    async <T,>(
      work: () => Promise<T>,
      options: RunOptions = {},
    ): Promise<T | undefined> => {
      setBusy(true);
      if (options.preserveDenial !== true) {
        clearDenial();
      }
      try {
        return await work();
      } catch (error) {
        if (
          error instanceof IdentityApiDenied ||
          error instanceof LicensingApiDenied
        ) {
          lastDenial.current = error.denial;
          setDenial(error.denial);
          if (
            error.denial.code === "session-expired" ||
            error.denial.code === "session-missing" ||
            error.denial.code === "session-revoked"
          ) {
            await refresh();
          }
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [clearDenial, refresh],
  );

  if (state === null) {
    return (
      <section className="identity-region" aria-live="polite">
        <div className="identity-card identity-loading" role="status">
          <span className="status-spinner" aria-hidden="true" />
          <p>{copy.loading}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="identity-region" aria-label={copy.loginTitle}>
      {denial === null || state.state === "authenticated" ? null : (
        <DenialAlert
          copy={copy}
          denial={denial}
          licensingCopy={licensingCopy}
          onDismiss={clearDenial}
        />
      )}
      {state.state === "bootstrap-required" ? (
        <BootstrapForm
          busy={busy}
          copy={copy}
          onSubmit={async (input) => {
            const next = await run(() => bootstrapIdentity(baseUrl, input));
            if (next !== undefined) {
              setState(next);
              return true;
            }
            return false;
          }}
        />
      ) : state.state === "authenticated" ? null : (
        <LoginForm
          busy={busy}
          copy={copy}
          state={state.state}
          onSubmit={async (input) => {
            const next = await run(() => loginIdentity(baseUrl, input));
            if (next !== undefined) {
              setState(next);
              return true;
            }
            return false;
          }}
        />
      )}
    </section>
  );
}

function BootstrapForm({
  busy,
  copy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly copy: IdentityCopy;
  readonly onSubmit: (input: {
    owner: { displayName: string; password: string; username: string };
    pharmacyName: string;
  }) => Promise<boolean>;
}): React.JSX.Element {
  return (
    <article className="identity-card auth-card">
      <div className="identity-heading">
        <span className="identity-symbol" aria-hidden="true">
          1
        </span>
        <div>
          <h2>{copy.bootstrapTitle}</h2>
          <p>{copy.bootstrapDescription}</p>
        </div>
      </div>
      <form
        className="identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void onSubmit({
            owner: {
              displayName: requiredValue(data, "displayName"),
              password: requiredValue(data, "password", false),
              username: requiredValue(data, "username"),
            },
            pharmacyName: requiredValue(data, "pharmacyName"),
          }).then((succeeded) => {
            if (succeeded) {
              form.reset();
              return;
            }
            const pharmacyName = form.elements.namedItem("pharmacyName");
            if (pharmacyName instanceof HTMLElement) {
              pharmacyName.focus();
            }
          });
        }}
      >
        <LabeledInput
          autoFocus
          label={copy.pharmacyName}
          name="pharmacyName"
          maxLength={160}
        />
        <LabeledInput
          label={copy.displayName}
          name="displayName"
          maxLength={96}
        />
        <LabeledInput
          autoComplete="username"
          label={copy.username}
          name="username"
          minLength={3}
          maxLength={64}
        />
        <LabeledInput
          autoComplete="new-password"
          label={copy.password}
          name="password"
          type="password"
          minLength={15}
          maxLength={128}
        />
        <button className="primary-button" disabled={busy} type="submit">
          {copy.bootstrapSubmit}
        </button>
      </form>
    </article>
  );
}

function LoginForm({
  busy,
  copy,
  onSubmit,
  state,
}: {
  readonly busy: boolean;
  readonly copy: IdentityCopy;
  readonly onSubmit: (input: {
    password: string;
    username: string;
  }) => Promise<boolean>;
  readonly state: "session-expired" | "session-revoked" | "unauthenticated";
}): React.JSX.Element {
  const ended = state !== "unauthenticated";
  return (
    <article className="identity-card auth-card">
      {ended ? (
        <div className="session-banner" role="status">
          <h2>
            {state === "session-expired"
              ? copy.sessionExpiredTitle
              : copy.sessionRevokedTitle}
          </h2>
          <span>
            {state === "session-expired"
              ? copy.sessionExpiredDescription
              : copy.sessionRevokedDescription}
          </span>
        </div>
      ) : null}
      <div className="identity-heading">
        <span className="identity-symbol" aria-hidden="true">
          ↳
        </span>
        <div>
          <h2>{copy.loginTitle}</h2>
          <p>{copy.loginDescription}</p>
        </div>
      </div>
      <form
        className="identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void onSubmit({
            password: requiredValue(data, "password", false),
            username: requiredValue(data, "username"),
          }).then((succeeded) => {
            if (succeeded) {
              form.reset();
              return;
            }
            const password = form.elements.namedItem("password");
            if (password instanceof HTMLElement) {
              password.focus();
            }
          });
        }}
      >
        <LabeledInput
          autoFocus
          autoComplete="username"
          label={copy.username}
          name="username"
          minLength={3}
          maxLength={64}
        />
        <LabeledInput
          autoComplete="current-password"
          label={copy.password}
          name="password"
          type="password"
          maxLength={128}
        />
        <button className="primary-button" disabled={busy} type="submit">
          {copy.loginSubmit}
        </button>
      </form>
    </article>
  );
}

function requiredValue(data: FormData, key: string, trim = true): string {
  const value = data.get(key);
  if (typeof value !== "string") {
    throw new Error(`Missing form field: ${key}`);
  }
  return trim ? value.trim() : value;
}
