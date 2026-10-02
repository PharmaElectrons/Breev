alter table sale_quick_access_settings add column panel_settings jsonb not null
  default '{"visibleFields":["scientificName","balance","packaging","levels","batches","expiry","consumption","surplus","thumbnail","wholesalePrice"],"consumptionMonths":3,"showDrawerBalance":true}'::jsonb
  check (jsonb_typeof(panel_settings) = 'object');
--> statement-breakpoint
alter table accounting_journal_lines add column drawer_user_id uuid,
  add foreign key (drawer_user_id, pharmacy_id) references identity_users(id, pharmacy_id),
  add constraint accounting_journal_lines_drawer_account check
    (drawer_user_id is null or account_code = 'cash');
--> statement-breakpoint
create index accounting_journal_lines_employee_drawer_index
  on accounting_journal_lines (pharmacy_id, drawer_user_id)
  where drawer_user_id is not null;
--> statement-breakpoint
insert into permission_definitions (name) values
  ('sales.drawer_balance.view'), ('sales.wholesale_price.view')
on conflict (name) do nothing;
--> statement-breakpoint
with eligible_roles as (
  select role_row.pharmacy_id, role_row.id as role_id, owner_user.id as granted_by
  from pharmacy_roles role_row
  join lateral (
    select identity_user.id from identity_users identity_user
    join pharmacy_roles owner_role on owner_role.id = identity_user.role_id
    where identity_user.pharmacy_id = role_row.pharmacy_id
      and identity_user.status = 'active' and owner_role.role_key = 'owner'
    order by identity_user.created_at, identity_user.id limit 1
  ) owner_user on true
  where role_row.role_key in ('owner', 'manager')
), inserted_grants as (
  insert into role_permission_grants (pharmacy_id, role_id, permission_name, granted_by)
  select pharmacy_id, role_id, permission_name, granted_by from eligible_roles
  cross join (values ('sales.drawer_balance.view'), ('sales.wholesale_price.view')) permissions(permission_name)
  on conflict (role_id, permission_name) do nothing returning pharmacy_id, role_id
), advanced_roles as (
  update pharmacy_roles role_row set revision = role_row.revision + 1
  from (select distinct role_id from inserted_grants) grant_row
  where role_row.id = grant_row.role_id returning role_row.pharmacy_id
)
update pharmacies pharmacy_row set identity_revision = pharmacy_row.identity_revision + 1
where pharmacy_row.id in (select distinct pharmacy_id from advanced_roles);
