import type {
  CapabilityName,
  IdentityAuthenticatedState,
  IdentityDenial,
  IdentityRole,
  IdentityRoleReference,
  IdentityState,
  IdentityUser,
  LicensingDenial,
  StepUpAction,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useRef, useState } from "react";

import { DevicesPanel } from "./devices-panel";
import { requiredCapabilityFor } from "./feature-surfaces";
import {
  approveStepUpChallenge,
  bootstrapIdentity,
  changeIdentityPassword,
  createAttendanceEvent,
  createIdentityUser,
  createStepUpChallenge,
  deactivateOfflineLicence,
  IdentityApiDenied,
  installOfflineLicence,
  loginIdentity,
  LicensingApiDenied,
  logoutIdentity,
  requestIdentityRoles,
  requestIdentityState,
  requestIdentityUsers,
  resetIdentityUserPassword,
  updateIdentityUser,
  updatePharmacySettings,
} from "./identity-api";
import {
  identityMessages,
  roleDisplayName,
  type IdentityCopy,
} from "./identity-messages";
import { useIdentityState } from "./identity-state-provider";
import { daysUntil } from "./licence-dates";
import { licensingMessages, type LicensingCopy } from "./licensing-messages";
import { cataloguedPermissions } from "./permission-catalogue";
import { formatNumber } from "./preferences";
import { usePreferences } from "./preferences-provider";
import { RoleEditor } from "./role-editor";

interface PendingStepUp {
  readonly afterApproval: (challengeId: string) => Promise<void>;
  readonly challengeId: string;
}

/**
 * How many days before expiry the owner panel starts warning. An engineering
 * default for display only (docs/workflows.md: the owner sees the expiry and
 * grace dates before disruption); the server enforces the boundary itself.
 */
const EXPIRY_WARNING_DAYS = 14;

type AccessDenial = IdentityDenial | LicensingDenial;

function formatLicenceDate(instant: string, locale: "ar" | "en"): string {
  return new Date(instant).toLocaleDateString(
    locale === "ar" ? "ar-IQ" : "en-IQ",
  );
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
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setDenial(null);
      try {
        return await work();
      } catch (error) {
        if (
          error instanceof IdentityApiDenied ||
          error instanceof LicensingApiDenied
        ) {
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
    [refresh],
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
          onDismiss={() => setDenial(null)}
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
      ) : state.state === "authenticated" ? (
        <AuthenticatedWorkspace
          baseUrl={baseUrl}
          busy={busy}
          copy={copy}
          denial={denial}
          licensingCopy={licensingCopy}
          onDismissDenial={() => setDenial(null)}
          onState={setState}
          run={run}
          state={state}
        />
      ) : (
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

function AuthenticatedWorkspace({
  baseUrl,
  busy,
  copy,
  denial,
  licensingCopy,
  onDismissDenial,
  onState,
  run,
  state,
}: {
  readonly baseUrl: string;
  readonly busy: boolean;
  readonly copy: IdentityCopy;
  readonly denial: AccessDenial | null;
  readonly licensingCopy: LicensingCopy;
  readonly onDismissDenial: () => void;
  readonly onState: (state: IdentityState) => void;
  readonly run: <T>(work: () => Promise<T>) => Promise<T | undefined>;
  readonly state: IdentityAuthenticatedState;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const [users, setUsers] = useState<IdentityUser[]>([]);
  // The roles a user manager may assign: references only, from the users
  // list, so assigning needs identity.users.manage and nothing more.
  const [assignableRoles, setAssignableRoles] = useState<
    IdentityRoleReference[]
  >([]);
  const [roles, setRoles] = useState<IdentityRole[]>([]);
  const [permissionNames, setPermissionNames] = useState<string[]>([]);
  const [userChallenge, setUserChallenge] = useState<string | null>(null);
  const [pendingStepUp, setPendingStepUp] = useState<PendingStepUp | null>(
    null,
  );
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [selectedCapability, setSelectedCapability] = useState<CapabilityName>(
    state.entitlement.capabilities[0] ?? "renewal",
  );
  // Async Step-Up completions (approval -> afterApproval -> list reload ->
  // state refresh) can outlast the render in which the button that opened the
  // dialog is disabled by `busy`. Focus is tracked by a stable element id
  // rather than a captured node so it survives both the disabled window and
  // any re-render of the row it belongs to, and is applied by an effect that
  // waits for `busy` to actually clear instead of guessing at timing.
  const previousFocusId = useRef<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (busy || pendingFocusId === null) {
      return;
    }
    document.getElementById(pendingFocusId)?.focus();
    setPendingFocusId(null);
  }, [busy, pendingFocusId]);
  const canManageUsers = state.allowedPermissions.includes(
    "identity.users.manage",
  );
  const canManageRoles = state.allowedPermissions.includes(
    "identity.roles.manage",
  );
  const canManageSettings = state.allowedPermissions.includes(
    "pharmacy.settings.manage",
  );
  const canManageLicensing =
    state.allowedPermissions.includes("licensing.manage");
  // Licence dates on the panel are display arithmetic on the renderer clock.
  // The local API decides every boundary against Trusted Breev Time; a
  // renderer clock that disagrees changes only what this card says.
  const licence = state.entitlement.licence;
  const daysUntilExpiry =
    licence === null
      ? null
      : daysUntil(new Date().toISOString(), licence.expiresAt);
  const licenceWarning =
    state.entitlement.status === "grace"
      ? licensingCopy.graceWarning
      : daysUntilExpiry !== null && daysUntilExpiry <= EXPIRY_WARNING_DAYS
        ? licensingCopy.expiryWarning(Math.max(0, daysUntilExpiry))
        : null;
  const devicesCapability = requiredCapabilityFor("devices-panel");
  const canPairDevices =
    state.allowedPermissions.includes("devices.pair") &&
    (devicesCapability === null ||
      state.entitlement.capabilities.includes(devicesCapability));
  const visibleSelectedCapability = state.entitlement.capabilities.includes(
    selectedCapability,
  )
    ? selectedCapability
    : (state.entitlement.capabilities[0] ?? "renewal");

  useEffect(() => {
    if (!state.entitlement.capabilities.includes(selectedCapability)) {
      setSelectedCapability(state.entitlement.capabilities[0] ?? "renewal");
    }
  }, [selectedCapability, state.entitlement.capabilities]);

  const loadAdministration = useCallback(async (): Promise<void> => {
    if (canManageUsers) {
      const response = await run(() => requestIdentityUsers(baseUrl));
      if (response !== undefined) {
        setUsers(response.users);
        setAssignableRoles(response.roles);
      }
    }
    if (canManageRoles) {
      const response = await run(() => requestIdentityRoles(baseUrl));
      if (response !== undefined) {
        setRoles(response.roles);
        setPermissionNames(response.permissions);
      }
    }
  }, [baseUrl, canManageRoles, canManageUsers, run]);

  useEffect(() => {
    void loadAdministration();
  }, [loadAdministration]);

  const refreshState = useCallback(async (): Promise<void> => {
    const next = await run(() => requestIdentityState(baseUrl));
    if (next !== undefined) {
      onState(next);
    }
  }, [baseUrl, onState, run]);

  const beginStepUp = useCallback(
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
          idempotencyKey: newIdempotencyKey(),
          ...(subjectId === undefined ? {} : { subjectId }),
        }),
      );
      if (challenge !== undefined) {
        setPendingStepUp({ afterApproval, challengeId: challenge.id });
      }
    },
    [baseUrl, run],
  );

  const closeStepUp = (): void => {
    setPendingStepUp(null);
  };

  const cancelStepUp = (): void => {
    const returnFocusId = previousFocusId.current;
    closeStepUp();
    if (returnFocusId !== null) {
      queueMicrotask(() => document.getElementById(returnFocusId)?.focus());
    }
  };

  return (
    <>
      <div
        className="workspace-stack"
        inert={pendingStepUp === null ? undefined : true}
      >
        {denial === null || pendingStepUp !== null ? null : (
          <DenialAlert
            copy={copy}
            denial={denial}
            licensingCopy={licensingCopy}
            onDismiss={onDismissDenial}
          />
        )}
        <article className="identity-card workspace-summary">
          <div>
            <p className="identity-eyebrow">{state.pharmacy.name}</p>
            <h2>
              {copy.welcome}, {state.user.displayName}
            </h2>
            <p>
              {roleDisplayName(state.user.role, copy)} · {state.user.username}
            </p>
          </div>
          <div className="workspace-actions">
            <span className="state-chip" data-status="active">
              <span aria-hidden="true">✓</span> {copy.ready}
            </span>
            <button
              className="quiet-button"
              disabled={busy}
              type="button"
              onClick={() =>
                void run(async () => {
                  await logoutIdentity(baseUrl);
                  return true;
                }).then((result) => {
                  if (result !== undefined) {
                    onState({ state: "unauthenticated" });
                  }
                })
              }
            >
              {copy.logout}
            </button>
          </div>
        </article>

        <article
          aria-labelledby="change-password-title"
          className="identity-card admin-card"
        >
          <div>
            <h3 id="change-password-title">{copy.changeMyPassword}</h3>
            <p>{copy.changePasswordDescription}</p>
          </div>
          {passwordChanged ? (
            <p aria-live="polite" className="state-line" role="status">
              <span aria-hidden="true">✓</span> {copy.passwordChanged}
            </p>
          ) : null}
          <form
            className="identity-form password-change-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              setPasswordChanged(false);
              void run(() =>
                changeIdentityPassword(baseUrl, {
                  currentPassword: requiredValue(
                    data,
                    "currentPassword",
                    false,
                  ),
                  expectedRevision: state.user.revision,
                  idempotencyKey: newIdempotencyKey(),
                  newPassword: requiredValue(data, "newPassword", false),
                }),
              ).then(async (updated) => {
                if (updated === undefined) {
                  const currentPassword =
                    form.elements.namedItem("currentPassword");
                  if (currentPassword instanceof HTMLInputElement) {
                    currentPassword.focus();
                  }
                  return;
                }
                form.reset();
                setPasswordChanged(true);
                await refreshState();
                setPendingFocusId("change-password-submit");
              });
            }}
          >
            <LabeledInput
              autoComplete="current-password"
              label={copy.currentPassword}
              maxLength={128}
              name="currentPassword"
              type="password"
            />
            <LabeledInput
              autoComplete="new-password"
              label={copy.newPassword}
              maxLength={128}
              minLength={15}
              name="newPassword"
              type="password"
            />
            <button
              className="primary-button"
              disabled={busy}
              id="change-password-submit"
              type="submit"
            >
              {copy.changeMyPassword}
            </button>
          </form>
        </article>

        <section
          className="licensing-grid"
          aria-label={licensingCopy.licenceStatus}
        >
          <article className="identity-card licensing-card">
            <div className="admin-heading">
              <div>
                <h3>{licensingCopy.licenceStatus}</h3>
                <p
                  className="state-line"
                  data-entitlement-status={state.entitlement.status}
                  aria-atomic="true"
                  aria-live="polite"
                  role="status"
                >
                  <span aria-hidden="true">●</span>{" "}
                  {licensingCopy.statuses[state.entitlement.status]}
                </p>
              </div>
              {licence === null ? null : (
                <dl className="licence-facts">
                  <div>
                    <dt>{licensingCopy.plan}</dt>
                    <dd>{licence.plan}</dd>
                  </div>
                  <div>
                    <dt>{licensingCopy.issued}</dt>
                    <dd>{formatLicenceDate(licence.issuedAt, locale)}</dd>
                  </div>
                  <div>
                    <dt>{licensingCopy.expires}</dt>
                    <dd>{formatLicenceDate(licence.expiresAt, locale)}</dd>
                  </div>
                  <div>
                    <dt>{licensingCopy.graceUntil}</dt>
                    <dd>{formatLicenceDate(licence.graceEndsAt, locale)}</dd>
                  </div>
                  <div>
                    <dt>{licensingCopy.daysRemaining}</dt>
                    <dd>
                      {formatNumber(Math.max(0, daysUntilExpiry ?? 0), locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>{licensingCopy.deviceAllowance}</dt>
                    <dd>{formatNumber(licence.permittedDeviceCount, locale)}</dd>
                  </div>
                </dl>
              )}
            </div>

            {licenceWarning === null ? null : (
              <p className="licence-warning" role="status">
                <span aria-hidden="true">⚠</span> {licenceWarning}
              </p>
            )}

            {licence === null ? null : (
              <div className="licence-grants">
                <div>
                  <h4>{licensingCopy.planFeatures}</h4>
                  {licence.features.length === 0 ? (
                    <p>{licensingCopy.planFeaturesNone}</p>
                  ) : (
                    <ul>
                      {licence.features.map((capability) => (
                        <li key={capability}>
                          {licensingCopy.capabilities[capability]}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4>{licensingCopy.founderGrants}</h4>
                  {licence.founderOverrideGrants.length === 0 ? (
                    <p>{licensingCopy.founderGrantsNone}</p>
                  ) : (
                    <ul>
                      {licence.founderOverrideGrants.map((capability) => (
                        <li key={capability}>
                          {licensingCopy.capabilities[capability]}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {canManageLicensing ? (
              <form
                className="identity-form licence-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const encodedLicence = requiredValue(
                    new FormData(form),
                    "encodedLicence",
                  );
                  void beginStepUp(
                    "licensing.licence.install",
                    state.pharmacy.id,
                    async (challengeId) => {
                      const entitlement = await run(() =>
                        installOfflineLicence(baseUrl, {
                          challengeId,
                          encodedLicence,
                          idempotencyKey: newIdempotencyKey(),
                        }),
                      );
                      if (entitlement !== undefined) {
                        form.reset();
                        onState({ ...state, entitlement });
                      }
                    },
                  );
                }}
              >
                <p>{licensingCopy.renewDescription}</p>
                <label className="field-label">
                  <span>{licensingCopy.licenceDocument}</span>
                  <textarea
                    maxLength={6_000}
                    name="encodedLicence"
                    required
                    rows={4}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy}
                  id="licence-install-submit"
                  type="submit"
                >
                  {licensingCopy.renew}
                </button>
              </form>
            ) : null}
            {canManageLicensing && state.entitlement.licence !== null ? (
              <div className="licence-deactivation">
                <p>{licensingCopy.deactivateDescription}</p>
                <button
                  className="quiet-button"
                  disabled={busy}
                  id="licence-deactivate-button"
                  type="button"
                  onClick={() =>
                    void beginStepUp(
                      "licensing.licence.deactivate",
                      state.pharmacy.id,
                      async (challengeId) => {
                        const entitlement = await run(() =>
                          deactivateOfflineLicence(baseUrl, {
                            challengeId,
                            idempotencyKey: newIdempotencyKey(),
                          }),
                        );
                        if (entitlement !== undefined) {
                          onState({ ...state, entitlement });
                        }
                      },
                    )
                  }
                >
                  {licensingCopy.deactivate}
                </button>
              </div>
            ) : null}
          </article>

          <nav
            className="identity-card capability-navigation"
            aria-label={licensingCopy.availableCapabilities}
          >
            <h3>{licensingCopy.availableCapabilities}</h3>
            <ul>
              {state.entitlement.capabilities.map((capability) => (
                <li key={capability}>
                  <button
                    aria-current={
                      visibleSelectedCapability === capability
                        ? "page"
                        : undefined
                    }
                    type="button"
                    onClick={() => setSelectedCapability(capability)}
                  >
                    {licensingCopy.capabilities[capability]}
                  </button>
                </li>
              ))}
            </ul>
            <p className="capability-selection" aria-live="polite">
              {licensingCopy.capabilities[visibleSelectedCapability]}
            </p>
          </nav>
        </section>

        {canPairDevices ? (
          <DevicesPanel
            baseUrl={baseUrl}
            beginStepUp={beginStepUp}
            identityCopy={copy}
            licensingCopy={licensingCopy}
            pairingAllowed={state.entitlement.status !== "grace"}
          />
        ) : null}

        {state.attendance === null ? null : (
          <article
            className="identity-card compact-card"
            aria-labelledby="attendance-title"
          >
            <div>
              <h3 id="attendance-title">{copy.attendance}</h3>
              <p className="state-line">
                <span aria-hidden="true">●</span>{" "}
                {state.attendance.status === "checked-in"
                  ? copy.checkIn
                  : copy.checkOut}
              </p>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              type="button"
              onClick={() =>
                void run(() =>
                  createAttendanceEvent(baseUrl, {
                    expectedVersion: state.attendance?.version ?? "1",
                    idempotencyKey: newIdempotencyKey(),
                    kind:
                      state.attendance?.status === "checked-in"
                        ? "check-out"
                        : "check-in",
                  }),
                ).then(() => void refreshState())
              }
            >
              {state.attendance.status === "checked-in"
                ? copy.checkOut
                : copy.checkIn}
            </button>
          </article>
        )}

        <article className="identity-card compact-card permission-summary">
          <div>
            <h3>{copy.permissions}</h3>
            <p>
              {state.allowedPermissions.length === 0
                ? copy.denials["permission-denied"]
                : cataloguedPermissions(state.allowedPermissions)
                    .map((permission) => copy.permissionLabels[permission].name)
                    .join(" · ")}
            </p>
          </div>
        </article>

        {canManageSettings ? (
          <article className="identity-card admin-card">
            <h3>{copy.settings}</h3>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const enabled =
                  new FormData(event.currentTarget).get("attendanceEnabled") ===
                  "on";
                void run(() =>
                  updatePharmacySettings(baseUrl, {
                    attendanceEnabled: enabled,
                    expectedRevision: state.settings.revision,
                    idempotencyKey: newIdempotencyKey(),
                  }),
                ).then(() => void refreshState());
              }}
            >
              <label className="check-row">
                <input
                  defaultChecked={state.settings.attendanceEnabled}
                  name="attendanceEnabled"
                  type="checkbox"
                />
                <span>{copy.enableAttendance}</span>
              </label>
              <button className="quiet-button" disabled={busy} type="submit">
                {copy.save}
              </button>
            </form>
          </article>
        ) : null}

        {canManageUsers ? (
          <article className="identity-card admin-card">
            <div className="admin-heading">
              <h3>{copy.userManagement}</h3>
              {userChallenge === null ? (
                <button
                  className="primary-button"
                  disabled={busy}
                  id="add-user-button"
                  type="button"
                  onClick={() =>
                    void beginStepUp(
                      "identity.user.create",
                      undefined,
                      async (challengeId) => {
                        setUserChallenge(challengeId);
                        await Promise.resolve();
                      },
                    )
                  }
                >
                  {copy.addUser}
                </button>
              ) : null}
            </div>
            {userChallenge === null ? null : (
              <form
                className="identity-form user-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  void run(() =>
                    createIdentityUser(baseUrl, {
                      challengeId: userChallenge,
                      displayName: requiredValue(data, "displayName"),
                      idempotencyKey: newIdempotencyKey(),
                      password: requiredValue(data, "password", false),
                      roleId: requiredValue(data, "roleId"),
                      username: requiredValue(data, "username"),
                    }),
                  ).then(async (created) => {
                    if (created !== undefined) {
                      form.reset();
                      setUserChallenge(null);
                      await loadAdministration();
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
                  label={copy.displayName}
                  name="displayName"
                  maxLength={96}
                />
                <LabeledInput
                  autoComplete="off"
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
                <label className="field-label">
                  <span>{copy.role}</span>
                  <select name="roleId" required>
                    {assignableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {roleDisplayName(role, copy)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={busy}
                    type="submit"
                  >
                    {copy.createUser}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setUserChallenge(null)}
                  >
                    {copy.cancel}
                  </button>
                </div>
              </form>
            )}
            <ul className="user-list">
              {users.map((user) => (
                <li key={user.id}>
                  <div className="user-details">
                    <strong>{user.displayName}</strong>
                    <span>
                      {user.username} · {roleDisplayName(user.role, copy)}
                    </span>
                    <form
                      key="display-name"
                      className="user-management-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const displayName = requiredValue(
                          new FormData(form),
                          "displayName",
                        );
                        void beginStepUp(
                          "identity.user.update",
                          user.id,
                          async (challengeId) => {
                            const updated = await run(() =>
                              updateIdentityUser(baseUrl, user.id, {
                                challengeId,
                                displayName,
                                expectedRevision: user.revision,
                                idempotencyKey: newIdempotencyKey(),
                              }),
                            );
                            if (updated !== undefined) {
                              await loadAdministration();
                              await refreshState();
                            }
                          },
                        );
                      }}
                    >
                      <label className="field-label compact-field">
                        <span>
                          {copy.displayName}: {user.username}
                        </span>
                        <input
                          defaultValue={user.displayName}
                          maxLength={96}
                          name="displayName"
                          required
                        />
                      </label>
                      <button
                        className="quiet-button"
                        disabled={busy}
                        id={`user-${user.id}-save-name`}
                        type="submit"
                      >
                        {copy.saveDisplayName}
                      </button>
                    </form>
                    <form
                      key="role"
                      className="user-management-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const roleId = requiredValue(
                          new FormData(form),
                          "roleId",
                        );
                        void beginStepUp(
                          "identity.user.update",
                          user.id,
                          async (challengeId) => {
                            const updated = await run(() =>
                              updateIdentityUser(baseUrl, user.id, {
                                challengeId,
                                expectedRevision: user.revision,
                                idempotencyKey: newIdempotencyKey(),
                                roleId,
                              }),
                            );
                            if (updated !== undefined) {
                              await loadAdministration();
                              await refreshState();
                            } else {
                              form.reset();
                            }
                          },
                        );
                      }}
                    >
                      <label className="field-label compact-field">
                        <span>
                          {copy.role}: {user.username}
                        </span>
                        <select
                          defaultValue={user.role.id}
                          name="roleId"
                          required
                        >
                          {assignableRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {roleDisplayName(role, copy)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="quiet-button"
                        disabled={busy}
                        id={`user-${user.id}-save-role`}
                        type="submit"
                      >
                        {copy.saveRole}
                      </button>
                    </form>
                  </div>
                  <div className="user-actions">
                    <span className="state-chip" data-status={user.status}>
                      <span aria-hidden="true">
                        {user.status === "active" ? "✓" : "!"}
                      </span>
                      {user.status === "active" ? copy.ready : copy.locked}
                    </span>
                    <button
                      className="quiet-button"
                      disabled={busy}
                      id={`user-${user.id}-lock-toggle`}
                      type="button"
                      onClick={() =>
                        void beginStepUp(
                          "identity.user.update",
                          user.id,
                          async (challengeId) => {
                            await run(() =>
                              updateIdentityUser(baseUrl, user.id, {
                                challengeId,
                                expectedRevision: user.revision,
                                idempotencyKey: newIdempotencyKey(),
                                status:
                                  user.status === "active"
                                    ? "locked"
                                    : "active",
                              }),
                            );
                            await loadAdministration();
                            await refreshState();
                          },
                        )
                      }
                    >
                      {user.status === "active"
                        ? copy.lockUser
                        : copy.unlockUser}
                    </button>
                    {user.id === state.user.id ? null : (
                      <form
                        className="user-management-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          const newPassword = requiredValue(
                            new FormData(form),
                            "newPassword",
                            false,
                          );
                          void beginStepUp(
                            "identity.user.password.reset",
                            user.id,
                            async (challengeId) => {
                              const updated = await run(() =>
                                resetIdentityUserPassword(baseUrl, user.id, {
                                  challengeId,
                                  expectedRevision: user.revision,
                                  idempotencyKey: newIdempotencyKey(),
                                  newPassword,
                                }),
                              );
                              if (updated !== undefined) {
                                form.reset();
                                await loadAdministration();
                              }
                            },
                          );
                        }}
                      >
                        <label className="field-label compact-field">
                          <span>
                            {copy.newPassword}: {user.username}
                          </span>
                          <input
                            autoComplete="new-password"
                            maxLength={128}
                            minLength={15}
                            name="newPassword"
                            required
                            type="password"
                          />
                        </label>
                        <button
                          className="quiet-button"
                          disabled={busy}
                          id={`user-${user.id}-reset-password`}
                          type="submit"
                        >
                          {copy.resetPassword}
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        {canManageRoles ? (
          <RoleEditor
            baseUrl={baseUrl}
            beginStepUp={beginStepUp}
            busy={busy}
            copy={copy}
            currentUserRoleId={state.user.role.id}
            denial={denial}
            permissions={permissionNames}
            roles={roles}
            run={run}
            onChanged={async () => {
              await loadAdministration();
              await refreshState();
            }}
          />
        ) : null}
      </div>
      {pendingStepUp === null ? null : (
        <StepUpDialog
          busy={busy}
          copy={copy}
          denial={denial}
          licensingCopy={licensingCopy}
          onCancel={cancelStepUp}
          onDismissDenial={onDismissDenial}
          onSubmit={async (password) => {
            const approval = await run(() =>
              approveStepUpChallenge(baseUrl, pendingStepUp.challengeId, {
                idempotencyKey: newIdempotencyKey(),
                password,
              }),
            );
            if (approval === undefined) {
              return false;
            }
            const completed = pendingStepUp;
            const returnFocusId = previousFocusId.current;
            closeStepUp();
            await completed.afterApproval(completed.challengeId);
            setPendingFocusId(returnFocusId);
            return true;
          }}
        />
      )}
    </>
  );
}

function StepUpDialog({
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
  readonly denial: AccessDenial | null;
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
          if (focusable === undefined || focusable.length === 0) {
            return;
          }
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

function DenialAlert({
  copy,
  denial,
  licensingCopy,
  onDismiss,
}: {
  readonly copy: IdentityCopy;
  readonly denial: AccessDenial;
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

function LabeledInput({
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

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
