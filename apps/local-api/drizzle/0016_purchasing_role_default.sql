with eligible_roles as (
  select pharmacy_role.pharmacy_id,
         pharmacy_role.id as role_id,
         current_grant.granted_by
  from pharmacy_roles pharmacy_role
  join role_permission_grants current_grant
    on current_grant.role_id = pharmacy_role.id
   and current_grant.permission_name = 'catalog.item.search'
  where pharmacy_role.role_key = 'purchasing_employee'
    and not exists (
      select 1
      from role_permission_grants other_grant
      where other_grant.role_id = pharmacy_role.id
        and other_grant.permission_name <> 'catalog.item.search'
    )
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select pharmacy_id, role_id, 'purchases.drafts.manage', granted_by
  from eligible_roles
  on conflict (role_id, permission_name) do nothing
  returning pharmacy_id, role_id
), advanced_roles as (
  update pharmacy_roles pharmacy_role
  set revision = pharmacy_role.revision + 1
  from inserted_grants grant_row
  where pharmacy_role.id = grant_row.role_id
  returning pharmacy_role.pharmacy_id
)
update pharmacies pharmacy_row
set identity_revision = pharmacy_row.identity_revision + 1
where pharmacy_row.id in (select distinct pharmacy_id from advanced_roles);
