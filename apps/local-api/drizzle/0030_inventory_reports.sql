insert into permission_definitions (name)
values ('reports.inventory.view'), ('reports.inventory.export')
on conflict (name) do nothing;
--> statement-breakpoint
-- One grant statement advances each affected role and pharmacy once.
-- Existing non-owner grants and customized roles remain intact.
with eligible_roles as (
  select role.pharmacy_id, role.id as role_id, owner_user.id as granted_by
  from pharmacy_roles role
  join lateral (
    select identity_user.id from identity_users identity_user
    where identity_user.pharmacy_id = role.pharmacy_id
      and identity_user.role_id = role.id and identity_user.status = 'active'
    order by identity_user.created_at, identity_user.id limit 1
  ) owner_user on true
  where role.role_key = 'owner'
), inserted_grants as (
  insert into role_permission_grants (pharmacy_id, role_id, permission_name, granted_by)
  select role.pharmacy_id, role.role_id, permission.name, role.granted_by
  from eligible_roles role
  cross join (values ('reports.inventory.view'), ('reports.inventory.export')) permission(name)
  on conflict (role_id, permission_name) do nothing
  returning pharmacy_id, role_id
), advanced_roles as (
  update pharmacy_roles role set revision = role.revision + 1
  from (select distinct pharmacy_id, role_id from inserted_grants) grant_row
  where role.id = grant_row.role_id returning role.pharmacy_id
)
update pharmacies pharmacy set identity_revision = pharmacy.identity_revision + 1
where pharmacy.id in (select distinct pharmacy_id from advanced_roles);
--> statement-breakpoint
create index inventory_movements_report_period on inventory_movements (pharmacy_id, occurred_at, id);
--> statement-breakpoint
create index inventory_value_effects_report_period on inventory_value_effects (pharmacy_id, occurred_at, id);
