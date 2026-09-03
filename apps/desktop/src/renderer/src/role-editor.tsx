import type {
  IdentityDenial,
  IdentityRole,
  LicensingDenial,
  StepUpAction,
} from "@breev/contracts/local-rest";
import { useEffect, useMemo, useState } from "react";

import {
  createIdentityRole,
  renameIdentityRole,
  updateIdentityRolePermissions,
} from "./identity-api";
import { roleDisplayName, type IdentityCopy } from "./identity-messages";
import {
  isImplementedPermissionId,
  permissionGroupsFor,
  type PermissionGroup,
} from "./permission-catalogue";

/**
 * The permissions the owner role can never lose. Mirrors the PostgreSQL
 * trigger `enforce_owner_role_permission_floor` (migration 0008): the
 * checkboxes are locked here only so the screen explains the rule beside the
 * control, never as the enforcement of it.
 */
const OWNER_PERMISSION_FLOOR: ReadonlySet<string> = new Set([
  "identity.roles.manage",
  "identity.users.manage",
]);
const ROLE_MANAGEMENT_PERMISSION = "identity.roles.manage";

type RoleEditorDenial = IdentityDenial | LicensingDenial;

/**
 * Roles and their permissions, master and detail.
 *
 * One role is selected at a time; its grants are edited as a draft that is
 * reseeded from the server after every successful save and kept as it was
 * after a rejected one. Built-in roles carry Breev's localized names; custom
 * roles carry the pharmacy's own. Every mutation goes through the shell's
 * Step-Up dialog, and every internal permission id stays inside `value`
 * attributes and request bodies — the screen shows only localized names.
 */
export function RoleEditor({
  baseUrl,
  beginStepUp,
  busy,
  copy,
  currentUserRoleId,
  getLastDenial,
  onChanged,
  permissions,
  requestFocus,
  roles,
  run,
}: {
  readonly baseUrl: string;
  readonly beginStepUp: (
    action: StepUpAction,
    subjectId: string | undefined,
    afterApproval: (challengeId: string) => Promise<void>,
  ) => Promise<void>;
  readonly busy: boolean;
  readonly copy: IdentityCopy;
  readonly currentUserRoleId: string;
  readonly getLastDenial: () => RoleEditorDenial | null;
  /** Reloads roles from the server and refreshes the authenticated state. */
  readonly onChanged: (options?: {
    readonly preserveDenial?: boolean;
  }) => Promise<void>;
  /** The grantable permission ids the server offers. */
  readonly permissions: readonly string[];
  readonly requestFocus: (elementId: string) => void;
  readonly roles: readonly IdentityRole[];
  readonly run: <T>(
    work: () => Promise<T>,
    options?: { readonly preserveDenial?: boolean },
  ) => Promise<T | undefined>;
}): React.JSX.Element {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, readonly string[]>>({});
  const [newRoleGrants, setNewRoleGrants] = useState<readonly string[]>([]);

  // Server truth wins whenever the roles list arrives: after a successful
  // save, and after any other reload. A rejected save does not reload, so the
  // draft the user was editing survives it.
  useEffect(() => {
    setDrafts(Object.fromEntries(roles.map((role) => [role.id, role.grants])));
  }, [roles]);

  useEffect(() => {
    if (
      pendingSelection !== null &&
      roles.some((role) => role.id === pendingSelection)
    ) {
      setSelectedRoleId(pendingSelection);
      setPendingSelection(null);
      return;
    }
    if (
      selectedRoleId === null ||
      !roles.some((role) => role.id === selectedRoleId)
    ) {
      setSelectedRoleId(roles[0]?.id ?? null);
    }
  }, [pendingSelection, roles, selectedRoleId]);

  const groups = useMemo(() => permissionGroupsFor(permissions), [permissions]);
  const total = groups.reduce(
    (count, group) => count + group.permissions.length,
    0,
  );
  const selected = roles.find((role) => role.id === selectedRoleId);
  const draft =
    selected === undefined ? [] : (drafts[selected.id] ?? selected.grants);
  const changed = selected !== undefined && !sameSet(draft, selected.grants);
  const removesOwnRoleManagement =
    selected !== undefined &&
    selected.id === currentUserRoleId &&
    selected.grants.includes(ROLE_MANAGEMENT_PERMISSION) &&
    !draft.includes(ROLE_MANAGEMENT_PERMISSION);

  const reloadAfter = async (): Promise<void> => {
    await onChanged();
  };

  const savePermissions = (role: IdentityRole): void => {
    const permissionsToSave = [...draft];
    void beginStepUp(
      "identity.role.permissions.update",
      role.id,
      async (challengeId) => {
        const updated = await run(() =>
          updateIdentityRolePermissions(baseUrl, role.id, {
            challengeId,
            expectedRevision: role.revision,
            idempotencyKey: crypto.randomUUID(),
            permissions: permissionsToSave,
          }),
        );
        if (updated !== undefined) {
          await reloadAfter();
        } else if (getLastDenial()?.code === "version-conflict") {
          await onChanged({ preserveDenial: true });
        }
      },
    );
  };

  const renameRole = (role: IdentityRole, name: string): void => {
    void beginStepUp("identity.role.rename", role.id, async (challengeId) => {
      const renamed = await run(() =>
        renameIdentityRole(baseUrl, role.id, {
          challengeId,
          expectedRevision: role.revision,
          idempotencyKey: crypto.randomUUID(),
          name,
        }),
      );
      if (renamed !== undefined) {
        await reloadAfter();
      } else if (getLastDenial()?.code === "version-conflict") {
        await onChanged({ preserveDenial: true });
      }
    });
  };

  const createRole = (name: string): void => {
    const grants = [...newRoleGrants];
    void beginStepUp("identity.role.create", undefined, async (challengeId) => {
      const created = await run(() =>
        createIdentityRole(baseUrl, {
          challengeId,
          idempotencyKey: crypto.randomUUID(),
          name,
          permissions: grants,
        }),
      );
      if (created !== undefined) {
        setPendingSelection(created.id);
        setCreating(false);
        setNewRoleGrants([]);
        requestFocus(`role-${created.id}-select`);
        await reloadAfter();
      }
    });
  };

  return (
    <article
      aria-labelledby="role-editor-title"
      className="identity-card admin-card role-editor"
    >
      <div className="admin-heading">
        <div>
          <h3 id="role-editor-title">{copy.permissionConfiguration}</h3>
          <p>{copy.permissionsHelp}</p>
        </div>
        <button
          className="primary-button"
          disabled={busy || creating}
          id="add-role-button"
          type="button"
          onClick={() => setCreating(true)}
        >
          {copy.addRole}
        </button>
      </div>
      <div className="role-editor-layout">
        <nav aria-label={copy.roleList}>
          <ul className="role-list">
            {roles.map((role) => (
              <li key={role.id}>
                <button
                  aria-current={
                    !creating && role.id === selectedRoleId ? "page" : undefined
                  }
                  id={`role-${role.id}-select`}
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setSelectedRoleId(role.id);
                  }}
                >
                  <span className="role-name">
                    {roleDisplayName(role, copy)}
                    {role.kind === "custom" ? (
                      <span className="role-badge">{copy.customRoleBadge}</span>
                    ) : null}
                  </span>
                  <span className="role-count">
                    {copy.permissionCount(
                      role.grants.filter(isImplementedPermissionId).length,
                      total,
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {creating ? (
          <section aria-labelledby="new-role-title" className="role-details">
            <h4 id="new-role-title">{copy.newRoleTitle}</h4>
            <p className="role-kind">{copy.customRole}</p>
            <form
              className="identity-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(
                  new FormData(event.currentTarget).get("name") ?? "",
                ).trim();
                if (name.length > 0) {
                  createRole(name);
                }
              }}
            >
              <label className="field-label">
                <span>{copy.roleName}</span>
                <input autoFocus maxLength={64} name="name" required />
              </label>
              <PermissionGroups
                copy={copy}
                granted={newRoleGrants}
                groups={groups}
                idPrefix="new-role"
                locked={() => false}
                onToggle={(permission, checked) =>
                  setNewRoleGrants((current) =>
                    toggle(current, permission, checked),
                  )
                }
              />
              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  id="role-create-submit"
                  type="submit"
                >
                  {copy.createRole}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewRoleGrants([]);
                  }}
                >
                  {copy.cancel}
                </button>
              </div>
            </form>
          </section>
        ) : selected === undefined ? null : (
          <section
            aria-labelledby="role-details-title"
            className="role-details"
          >
            <h4 id="role-details-title">{roleDisplayName(selected, copy)}</h4>
            <p className="role-kind">
              {selected.kind === "built-in"
                ? copy.builtInRole
                : copy.customRole}
            </p>
            {selected.kind === "custom" ? (
              <form
                className="role-rename-form"
                key={`${selected.id}-${selected.revision}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = String(
                    new FormData(event.currentTarget).get("name") ?? "",
                  ).trim();
                  if (name.length > 0 && name !== selected.name) {
                    renameRole(selected, name);
                  }
                }}
              >
                <label className="field-label">
                  <span>{copy.roleName}</span>
                  <input
                    defaultValue={selected.name}
                    maxLength={64}
                    name="name"
                    required
                  />
                </label>
                <button
                  className="quiet-button"
                  disabled={busy}
                  id={`role-${selected.id}-rename`}
                  type="submit"
                >
                  {copy.renameRole}
                </button>
              </form>
            ) : null}
            <PermissionGroups
              copy={copy}
              granted={draft}
              groups={groups}
              idPrefix={`role-${selected.id}`}
              locked={(permission) =>
                selected.kind === "built-in" &&
                selected.key === "owner" &&
                OWNER_PERMISSION_FLOOR.has(permission)
              }
              onToggle={(permission, checked) =>
                setDrafts((current) => ({
                  ...current,
                  [selected.id]: toggle(
                    current[selected.id] ?? selected.grants,
                    permission,
                    checked,
                  ),
                }))
              }
            />
            {removesOwnRoleManagement ? (
              <p className="role-warning" role="alert">
                {copy.selfLockoutWarning}
              </p>
            ) : null}
            <div className="form-actions">
              <button
                className="primary-button"
                disabled={busy || !changed}
                id={`role-${selected.id}-save-permissions`}
                type="button"
                onClick={() => savePermissions(selected)}
              >
                {copy.savePermissions}
              </button>
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

function PermissionGroups({
  copy,
  granted,
  groups,
  idPrefix,
  locked,
  onToggle,
}: {
  readonly copy: IdentityCopy;
  readonly granted: readonly string[];
  readonly groups: readonly PermissionGroup[];
  readonly idPrefix: string;
  readonly locked: (permission: string) => boolean;
  readonly onToggle: (permission: string, checked: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="permission-groups">
      {groups.map((group) => (
        <fieldset className="permission-group" key={group.id}>
          <legend>{copy.permissionGroups[group.id]}</legend>
          {group.permissions.map((permission) => {
            const label = copy.permissionLabels[permission];
            const descriptionId = `${idPrefix}-${permission}-description`;
            const isLocked = locked(permission);
            return (
              <div className="permission-item" key={permission}>
                <label className="check-row">
                  <input
                    aria-describedby={descriptionId}
                    checked={granted.includes(permission)}
                    disabled={isLocked}
                    type="checkbox"
                    value={permission}
                    onChange={(event) =>
                      onToggle(permission, event.target.checked)
                    }
                  />
                  <span>{label.name}</span>
                </label>
                <p className="permission-description" id={descriptionId}>
                  {label.description}
                  {isLocked ? ` ${copy.ownerPermissionFloor}` : null}
                </p>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function toggle(
  current: readonly string[],
  permission: string,
  checked: boolean,
): readonly string[] {
  return checked
    ? [...new Set([...current, permission])].sort()
    : current.filter((item) => item !== permission);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((item) => rightSet.has(item))
  );
}
