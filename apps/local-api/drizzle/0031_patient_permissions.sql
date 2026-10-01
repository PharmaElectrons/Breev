insert into permission_definitions (name)
values 
  ('patients.discounts.manage'),
  ('patients.manage'),
  ('patients.notes.manage'),
  ('patients.view')
on conflict (name) do nothing;
--> statement-breakpoint
with eligible_roles as (
  select pharmacy_role.pharmacy_id,
         pharmacy_role.id as role_id,
         owner_user.id as granted_by
  from pharmacy_roles pharmacy_role
  join lateral (
    select identity_user.id
    from identity_users identity_user
    join pharmacy_roles owner_role on owner_role.id = identity_user.role_id
    where identity_user.pharmacy_id = pharmacy_role.pharmacy_id
      and identity_user.status = 'active'
      and owner_role.role_key = 'owner'
    order by identity_user.created_at, identity_user.id
    limit 1
  ) owner_user on true
  where pharmacy_role.role_key in (
    'owner', 'manager', 'pharmacist'
  )
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select eligible_role.pharmacy_id, eligible_role.role_id,
         permission.name, eligible_role.granted_by
  from eligible_roles eligible_role
  cross join (
    values 
      ('patients.discounts.manage'),
      ('patients.manage'),
      ('patients.notes.manage'),
      ('patients.view')
  ) as permission(name)
  on conflict (role_id, permission_name) do nothing
  returning pharmacy_id, role_id
), advanced_roles as (
  update pharmacy_roles pharmacy_role
  set revision = pharmacy_role.revision + 1
  from (select distinct pharmacy_id, role_id from inserted_grants) grant_row
  where pharmacy_role.id = grant_row.role_id
  returning pharmacy_role.pharmacy_id
)
update pharmacies pharmacy_row
set identity_revision = pharmacy_row.identity_revision + 1
where pharmacy_row.id in (select distinct pharmacy_id from advanced_roles);
