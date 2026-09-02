import type { Pool } from "pg";

/**
 * Seeds a pharmacy_roles 'owner' row that satisfies the permission floor
 * enforced at commit by the deferred constraint trigger
 * `enforce_owner_role_permission_floor`
 * (apps/local-api/drizzle/0008_identity_recoverability.sql): an owner role
 * must hold grants for both `identity.roles.manage` and
 * `identity.users.manage`, or the trigger raises 23514.
 *
 * `IdentityAccessService.bootstrap` satisfies this naturally because it
 * inserts the role, the owner user, the permission definitions, and the
 * grants inside one transaction, so the deferred trigger only ever sees a
 * complete owner at commit. A fixture that seeds an owner role directly in
 * PostgreSQL, bypassing bootstrap, has to do the same: the role, the actor
 * user, the two permission definitions, and the two grants all inside one
 * `begin` … `commit` on a single client. `permission_definitions` may be
 * empty when bootstrap is bypassed, so the floor permissions are inserted
 * with `on conflict (name) do nothing` rather than assumed to exist.
 */
export async function seedOwnerRoleWithFloor(
  pool: Pool,
  input: {
    readonly actorId: string;
    readonly displayName?: string;
    readonly passwordHash?: Buffer;
    readonly pharmacyId: string;
    readonly roleId: string;
    readonly username: string;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // The grant's role_id foreign key needs the role first.
    await client.query(
      `insert into pharmacy_roles (id, pharmacy_id, role_key)
       values ($1, $2, 'owner')`,
      [input.roleId, input.pharmacyId],
    );
    // The grant's granted_by foreign key needs the actor user, and the user
    // needs the role it belongs to.
    await client.query(
      `insert into identity_users (
         id, pharmacy_id, username, username_key, display_name, role_id,
         password_hash, password_algorithm, password_version,
         password_memory_kib, password_iterations, password_parallelism
       ) values ($1, $2, $3, $3, $4, $5, $6, 'argon2id', 19, 19456, 2, 1)`,
      [
        input.actorId,
        input.pharmacyId,
        input.username,
        input.displayName ?? input.username,
        input.roleId,
        input.passwordHash ?? Buffer.alloc(64),
      ],
    );
    // The grant's permission_name foreign key needs the permission
    // definitions, which bootstrap normally seeds but this fixture bypasses.
    await client.query(
      `insert into permission_definitions (name)
       values ('identity.roles.manage'), ('identity.users.manage')
       on conflict (name) do nothing`,
    );
    await client.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) values
         ($1, $2, 'identity.roles.manage', $3),
         ($1, $2, 'identity.users.manage', $3)`,
      [input.pharmacyId, input.roleId, input.actorId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
