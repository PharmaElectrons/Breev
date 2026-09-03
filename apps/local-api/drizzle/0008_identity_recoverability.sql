-- Seed the new Step-Up action for an installation that has already
-- bootstrapped. `required_permission` carries a foreign key to
-- `permission_definitions`, and that table is populated by bootstrap, not by a
-- migration — so on a fresh database this must insert nothing rather than
-- violate the key. Bootstrap seeds the action itself from `STEP_UP_ACTIONS`,
-- so a fresh installation still gets it.
insert into step_up_action_definitions (name, required_permission)
select 'identity.user.password.reset', permission.name
from permission_definitions permission
where permission.name = 'identity.users.manage'
on conflict (name) do nothing;
--> statement-breakpoint
-- Repair an installation that crossed the floor before this constraint
-- existed. The grant still names a real pharmacy user as its actor; a normal
-- installation always has an owner user, while the fallback lets a damaged
-- role assignment recover without inventing an identity.
insert into role_permission_grants (
  pharmacy_id, role_id, permission_name, granted_by
)
select role.pharmacy_id, role.id, floor.permission_name, actor.id
from pharmacy_roles role
cross join (
  values ('identity.roles.manage'), ('identity.users.manage')
) as floor(permission_name)
cross join lateral (
  select identity_user.id
  from identity_users identity_user
  where identity_user.pharmacy_id = role.pharmacy_id
  order by
    (identity_user.role_id = role.id) desc,
    (identity_user.status = 'active') desc,
    identity_user.created_at,
    identity_user.id
  limit 1
) actor
where role.role_key = 'owner'
on conflict (role_id, permission_name) do nothing;
--> statement-breakpoint
do $$
begin
  if exists (
    select 1
    from pharmacy_roles role
    where role.role_key = 'owner'
      and exists (select 1 from pharmacies)
      and not exists (
        select 1
        from role_permission_grants grant_row
        where grant_row.role_id = role.id
          and grant_row.permission_name = 'identity.roles.manage'
      )
  ) or exists (
    select 1
    from pharmacy_roles role
    where role.role_key = 'owner'
      and exists (select 1 from pharmacies)
      and not exists (
        select 1
        from role_permission_grants grant_row
        where grant_row.role_id = role.id
          and grant_row.permission_name = 'identity.users.manage'
      )
  ) then
    raise exception 'The owner role permission floor could not be repaired'
      using errcode = '23514';
  end if;
end;
$$;
--> statement-breakpoint
create function enforce_owner_role_permission_floor()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.pharmacy_roles role
    where role.role_key = 'owner'
      and (
        not exists (
          select 1
          from public.role_permission_grants grant_row
          where grant_row.role_id = role.id
            and grant_row.permission_name = 'identity.roles.manage'
        )
        or not exists (
          select 1
          from public.role_permission_grants grant_row
          where grant_row.role_id = role.id
            and grant_row.permission_name = 'identity.users.manage'
        )
      )
  ) then
    raise exception 'The owner role must retain identity role and user management'
      using errcode = '23514',
            constraint = 'owner_role_permission_floor';
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create constraint trigger owner_permission_floor_on_grants
after insert or update or delete on role_permission_grants
deferrable initially deferred
for each row execute function enforce_owner_role_permission_floor();
--> statement-breakpoint
create constraint trigger owner_permission_floor_on_roles
after insert or update on pharmacy_roles
deferrable initially deferred
for each row execute function enforce_owner_role_permission_floor();
--> statement-breakpoint
revoke all on function enforce_owner_role_permission_floor() from public;
