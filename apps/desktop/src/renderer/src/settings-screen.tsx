import type {
  CapabilityName,
  IdentityDenial,
  IdentityRole,
  LicensingDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useRef, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { DevicesPanel } from "./devices-panel";
import { requiredCapabilityFor } from "./feature-surfaces";
import {
  changeIdentityPassword,
  createAttendanceEvent,
  deactivateOfflineLicence,
  IdentityApiDenied,
  installOfflineLicence,
  LicensingApiDenied,
  requestIdentityRoles,
  requestIdentityState,
  updatePharmacySettings,
} from "./identity-api";
import { identityMessages } from "./identity-messages";
import { useIdentityState } from "./identity-state-provider";
import { daysUntil } from "./licence-dates";
import { licensingMessages } from "./licensing-messages";
import { navigationMessages } from "./navigation-messages";
import { formatNumber } from "./preferences";
import { usePreferences } from "./preferences-provider";
import { RoleEditor } from "./role-editor";
import { DenialAlert, LabeledInput, StepUpDialog, useStepUp } from "./step-up";
import { UserManagementPanel } from "./user-management-panel";

const EXPIRY_WARNING_DAYS = 14;

type AccessDenial = IdentityDenial | LicensingDenial;
type SettingsTab = "password" | "pharmacy" | "users" | "roles" | "licence";

interface RunOptions {
  readonly preserveDenial?: boolean;
}

function formatLicenceDate(instant: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-IQ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}

function requiredValue(data: FormData, key: string, trim = true): string {
  const value = data.get(key);
  if (typeof value !== "string" || (trim && value.trim().length === 0)) {
    throw new Error(`Missing required field: ${key}`);
  }
  return trim ? value.trim() : value;
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function parseTabFromHash(
  hash?: string,
  canManageSettings = false,
): SettingsTab {
  if (!hash) return canManageSettings ? "pharmacy" : "password";
  if (hash.includes("/pharmacy")) return "pharmacy";
  if (hash.includes("/users")) return "users";
  if (hash.includes("/roles")) return "roles";
  if (hash.includes("/licence")) return "licence";
  if (hash.includes("/password")) return "password";
  return canManageSettings ? "pharmacy" : "password";
}

export function SettingsRouteView({
  baseUrl,
  hash,
}: {
  readonly baseUrl: string;
  readonly hash?: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = identityMessages[locale];
  const licensingCopy = licensingMessages[locale];
  const navigationCopy = navigationMessages[locale];
  const { refresh, setState, state } = useIdentityState();

  const canManageSettings =
    state !== null &&
    state.state === "authenticated" &&
    state.allowedPermissions.includes("pharmacy.settings.manage");

  const [denial, setDenial] = useState<AccessDenial | null>(null);
  const lastDenial = useRef<AccessDenial | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    parseTabFromHash(hash, canManageSettings),
  );

  const clearDenial = useCallback((): void => {
    lastDenial.current = null;
    setDenial(null);
  }, []);

  const getLastDenial = useCallback(
    (): AccessDenial | null => lastDenial.current,
    [],
  );

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

  const {
    approve: approveStepUp,
    begin: beginStepUp,
    cancel: cancelStepUp,
    pending: pendingStepUp,
    pendingFocusId,
    setPendingFocusId,
  } = useStepUp(baseUrl, run);

  // Sync hash changes to activeTab
  useEffect(() => {
    const nextTab = parseTabFromHash(hash, canManageSettings);
    setActiveTab((prev) => (prev !== nextTab ? nextTab : prev));
    const scrollContainer = document.querySelector(
      ".shell-page[data-settings-workspace]",
    );
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }, [hash, canManageSettings]);

  const handleTabChange = (val: string): void => {
    const tab = val as SettingsTab;
    setActiveTab(tab);
    window.location.hash = `#/settings/${tab}`;
    const scrollContainer = document.querySelector(
      ".shell-page[data-settings-workspace]",
    );
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  // Focus management after step-up
  useEffect(() => {
    if (pendingFocusId === null) {
      return;
    }
    const element = document.getElementById(pendingFocusId);
    if (element instanceof HTMLElement) {
      element.focus();
      setPendingFocusId(null);
    }
  }, [pendingFocusId, setPendingFocusId]);

  // Roles state
  const [roles, setRoles] = useState<IdentityRole[]>([]);
  const [permissionNames, setPermissionNames] = useState<string[]>([]);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const canManageUsers =
    state !== null &&
    state.state === "authenticated" &&
    state.allowedPermissions.includes("identity.users.manage");

  const canManageRoles =
    state !== null &&
    state.state === "authenticated" &&
    state.allowedPermissions.includes("identity.roles.manage");

  const canManageLicensing =
    state !== null &&
    state.state === "authenticated" &&
    state.allowedPermissions.includes("licensing.manage");

  const devicesCapability = requiredCapabilityFor("devices-panel");
  const canPairDevices =
    state !== null &&
    state.state === "authenticated" &&
    state.allowedPermissions.includes("devices.pair") &&
    devicesCapability !== null &&
    state.entitlement.capabilities.includes(devicesCapability);

  const reloadRoles = useCallback(
    async (options: RunOptions = {}): Promise<void> => {
      if (!canManageRoles) {
        return;
      }
      const response = await run(() => requestIdentityRoles(baseUrl), options);
      if (response !== undefined) {
        setRoles(response.roles);
        setPermissionNames(response.permissions);
      }
    },
    [baseUrl, canManageRoles, run],
  );

  useEffect(() => {
    if (canManageRoles) {
      void reloadRoles();
    }
  }, [canManageRoles, reloadRoles]);

  const requestFocus = useCallback((elementId: string): void => {
    const element = document.getElementById(elementId);
    if (element instanceof HTMLElement) {
      element.focus();
    }
  }, []);

  const refreshState = useCallback(
    async (options: RunOptions = {}): Promise<void> => {
      const next = await run(() => requestIdentityState(baseUrl), options);
      if (next !== undefined) {
        setState(next);
      }
    },
    [baseUrl, run, setState],
  );

  // Selected capability state for licence section
  const [selectedCapability, setSelectedCapability] = useState<CapabilityName>(
    state !== null && state.state === "authenticated"
      ? (state.entitlement.capabilities[0] ?? "renewal")
      : "renewal",
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

  if (state.state !== "authenticated") {
    return (
      <section className="identity-region">
        <p>{copy.loginDescription}</p>
      </section>
    );
  }

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

  const visibleSelectedCapability = state.entitlement.capabilities.includes(
    selectedCapability,
  )
    ? selectedCapability
    : (state.entitlement.capabilities[0] ?? "renewal");

  return (
    <section className="settings-workspace">
      <h2 className="visually-hidden">
        {navigationCopy.modules.settings.label}
      </h2>
      {denial === null || pendingStepUp !== null ? null : (
        <DenialAlert
          copy={copy}
          denial={denial}
          licensingCopy={licensingCopy}
          onDismiss={clearDenial}
        />
      )}

      <div
        className="settings-container"
        inert={pendingStepUp === null ? undefined : true}
      >
        <Tabs
          className="settings-tabs"
          orientation="horizontal"
          value={activeTab}
          onValueChange={handleTabChange}
        >
          <TabsList className="settings-tab-list">
            {canManageSettings ? (
              <TabsTrigger value="pharmacy">{copy.settings}</TabsTrigger>
            ) : null}
            {canManageUsers ? (
              <TabsTrigger value="users">{copy.userManagement}</TabsTrigger>
            ) : null}
            {canManageRoles ? (
              <TabsTrigger value="roles">
                {locale === "ar" ? "الأدوار والصلاحيات" : "Roles & permissions"}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="licence">
              {locale === "ar" ? "الترخيص والأجهزة" : "Licence & devices"}
            </TabsTrigger>
            <TabsTrigger value="password">{copy.changeMyPassword}</TabsTrigger>
          </TabsList>

          <TabsContent value="password">
            <div className="tab-pane-content">
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
            </div>
          </TabsContent>

          {canManageSettings ? (
            <TabsContent value="pharmacy">
              <div className="tab-pane-content">
                <article className="identity-card admin-card">
                  <h3>{copy.settings}</h3>
                  <form
                    className="inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const enabled =
                        new FormData(event.currentTarget).get(
                          "attendanceEnabled",
                        ) === "on";
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
                    <button
                      className="quiet-button"
                      disabled={busy}
                      type="submit"
                    >
                      {copy.save}
                    </button>
                  </form>
                </article>

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
              </div>
            </TabsContent>
          ) : null}

          {canManageUsers ? (
            <TabsContent value="users">
              <div className="tab-pane-content">
                <UserManagementPanel
                  baseUrl={baseUrl}
                  beginStepUp={beginStepUp}
                  busy={busy}
                  copy={copy}
                  refreshState={refreshState}
                  run={run}
                  state={state}
                />
              </div>
            </TabsContent>
          ) : null}

          {canManageRoles ? (
            <TabsContent value="roles">
              <div className="tab-pane-content">
                <RoleEditor
                  baseUrl={baseUrl}
                  beginStepUp={beginStepUp}
                  busy={busy}
                  copy={copy}
                  currentUserRoleId={state.user.role.id}
                  getLastDenial={getLastDenial}
                  permissions={permissionNames}
                  requestFocus={requestFocus}
                  roles={roles}
                  run={run}
                  onChanged={reloadRoles}
                />
              </div>
            </TabsContent>
          ) : null}

          <TabsContent value="licence">
            <div className="tab-pane-content">
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
                          <dd>
                            {formatLicenceDate(licence.expiresAt, locale)}
                          </dd>
                        </div>
                        <div>
                          <dt>{licensingCopy.graceUntil}</dt>
                          <dd>
                            {formatLicenceDate(licence.graceEndsAt, locale)}
                          </dd>
                        </div>
                        <div>
                          <dt>{licensingCopy.daysRemaining}</dt>
                          <dd>
                            {formatNumber(
                              Math.max(0, daysUntilExpiry ?? 0),
                              locale,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{licensingCopy.deviceAllowance}</dt>
                          <dd>
                            {formatNumber(licence.permittedDeviceCount, locale)}
                          </dd>
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
                              setState({ ...state, entitlement });
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
                                setState({ ...state, entitlement });
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
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {pendingStepUp === null ? null : (
        <StepUpDialog
          busy={busy}
          copy={copy}
          denial={denial}
          licensingCopy={licensingCopy}
          onCancel={cancelStepUp}
          onDismissDenial={clearDenial}
          onSubmit={approveStepUp}
        />
      )}
    </section>
  );
}
