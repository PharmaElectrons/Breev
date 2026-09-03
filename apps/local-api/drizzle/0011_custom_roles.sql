-- Custom roles (stakeholder clarification of 3 September 2026).
--
-- A pharmacy_roles row is now either one of the eight built-in roles,
-- identified by its stable role_key, or a custom role the pharmacy created,
-- identified by its id and carrying a pharmacy-entered display name. Exactly
-- one identity form is present. Identity is never the display name: the owner
-- floor trigger from 0008 keeps reading role_key = 'owner', and a custom role
-- named "Owner" is still a custom role.
--
-- Every existing role id, user assignment, grant, and revision is preserved.
-- The one deliberate data change is below: the built-in manager role of each
-- pharmacy receives identity.roles.manage so a manager can administer roles
-- through the ordinary permission check.
alter table pharmacy_roles alter column role_key drop not null;
--> statement-breakpoint
alter table pharmacy_roles add column custom_name text;
--> statement-breakpoint
alter table pharmacy_roles add column custom_name_key text;
--> statement-breakpoint
alter table pharmacy_roles add constraint pharmacy_roles_one_identity check (
  (role_key is not null and custom_name is null and custom_name_key is null)
  or (role_key is null and custom_name is not null and custom_name_key is not null)
);
--> statement-breakpoint
alter table pharmacy_roles add constraint pharmacy_roles_custom_name_length check (
  custom_name is null
  or (char_length(custom_name) between 1 and 64 and custom_name = btrim(custom_name))
);
--> statement-breakpoint
alter table pharmacy_roles add constraint pharmacy_roles_custom_name_key_length check (
  custom_name_key is null or char_length(custom_name_key) between 1 and 128
);
--> statement-breakpoint
-- Pharmacy-scoped name uniqueness on the normalized key, so "Senior cashier"
-- and "senior  CASHIER" are the same role. The existing unique (pharmacy_id,
-- role_key) keeps the eight built-ins unique; nulls do not collide there.
create unique index pharmacy_roles_custom_name_unique
  on pharmacy_roles (pharmacy_id, custom_name_key)
  where custom_name_key is not null;
--> statement-breakpoint
-- Seed the two new Step-Up actions for an installation that has already
-- bootstrapped, in the 0008 style: nothing is inserted on a fresh database
-- (bootstrap seeds them from STEP_UP_ACTIONS), and the foreign key to
-- permission_definitions is never violated.
insert into step_up_action_definitions (name, required_permission)
select action.name, permission.name
from (values ('identity.role.create'), ('identity.role.rename')) as action(name)
cross join permission_definitions permission
where permission.name = 'identity.roles.manage'
on conflict (name) do nothing;
--> statement-breakpoint
-- Grant identity.roles.manage to every pharmacy's built-in manager role. The
-- grant names a real pharmacy user as its actor — an owner-role user first,
-- active first, oldest first (the 0008 precedent) — so attribution never
-- invents an identity. A manager role that already holds the grant is left
-- alone. Where the grant is added, the role revision and the pharmacy
-- identity revision advance, so an open Step-Up challenge that was created
-- against the old authority is honestly stale instead of silently approved.
with granted as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select role.pharmacy_id, role.id, 'identity.roles.manage', actor.id
  from pharmacy_roles role
  cross join lateral (
    select identity_user.id
    from identity_users identity_user
    left join pharmacy_roles user_role on user_role.id = identity_user.role_id
    where identity_user.pharmacy_id = role.pharmacy_id
    order by
      (user_role.role_key = 'owner') desc,
      (identity_user.status = 'active') desc,
      identity_user.created_at,
      identity_user.id
    limit 1
  ) actor
  where role.role_key = 'manager'
    and exists (
      select 1 from permission_definitions
      where name = 'identity.roles.manage'
    )
  on conflict (role_id, permission_name) do nothing
  returning role_id, pharmacy_id
), bumped as (
  update pharmacy_roles
  set revision = revision + 1
  where id in (select role_id from granted)
  returning pharmacy_id
)
update pharmacies
set identity_revision = identity_revision + 1
where id in (select pharmacy_id from bumped);
