import type {
  IdentityAuthenticatedState,
  IdentityRoleReference,
  IdentityUser,
  StepUpAction,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useState } from "react";

import {
  createIdentityUser,
  requestIdentityUsers,
  resetIdentityUserPassword,
  updateIdentityUser,
} from "./identity-api";
import { roleDisplayName, type IdentityCopy } from "./identity-messages";
import { LabeledInput } from "./step-up";

export interface UserManagementPanelProps {
  readonly baseUrl: string;
  readonly beginStepUp: (
    action: StepUpAction,
    targetId: string | undefined,
    afterApproval: (challengeId: string) => Promise<void>,
    focusElementId?: string,
  ) => Promise<void>;
  readonly busy: boolean;
  readonly copy: IdentityCopy;
  readonly refreshState?: () => Promise<void>;
  readonly run: <T>(
    work: () => Promise<T>,
    options?: { readonly preserveDenial?: boolean },
  ) => Promise<T | undefined>;
  readonly state: IdentityAuthenticatedState;
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

export function UserManagementPanel({
  baseUrl,
  beginStepUp,
  busy,
  copy,
  refreshState,
  run,
  state,
}: UserManagementPanelProps): React.JSX.Element {
  const [users, setUsers] = useState<IdentityUser[]>([]);
  // The roles a user manager may assign: references only, from the users
  // list, so assigning needs identity.users.manage and nothing more.
  const [assignableRoles, setAssignableRoles] = useState<
    IdentityRoleReference[]
  >([]);
  const [userChallenge, setUserChallenge] = useState<string | null>(null);

  const loadAdministration = useCallback(async (): Promise<void> => {
    const response = await run(() => requestIdentityUsers(baseUrl));
    if (response !== undefined) {
      setUsers(response.users);
      setAssignableRoles(response.roles);
    }
  }, [baseUrl, run]);

  useEffect(() => {
    void loadAdministration();
  }, [loadAdministration]);

  return (
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
            <button className="primary-button" disabled={busy} type="submit">
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
                {user.role.kind === "custom" ? (
                  <>
                    {" "}
                    <span className="role-badge">{copy.customRoleBadge}</span>
                  </>
                ) : null}
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
                        if (refreshState) {
                          await refreshState();
                        }
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
                  const roleId = requiredValue(new FormData(form), "roleId");
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
                        if (refreshState) {
                          await refreshState();
                        }
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
                  <select defaultValue={user.role.id} name="roleId" required>
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
                      const updated = await run(() =>
                        updateIdentityUser(baseUrl, user.id, {
                          challengeId,
                          expectedRevision: user.revision,
                          idempotencyKey: newIdempotencyKey(),
                          status:
                            user.status === "active" ? "locked" : "active",
                        }),
                      );
                      if (updated !== undefined) {
                        await loadAdministration();
                        if (refreshState) {
                          await refreshState();
                        }
                      }
                    },
                  )
                }
              >
                {user.status === "active" ? copy.lockUser : copy.unlockUser}
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
  );
}
