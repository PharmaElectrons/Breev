insert into permission_definitions (name)
values ('inventory.review'), ('inventory.valuation.view')
on conflict (name) do nothing;
--> statement-breakpoint
insert into step_up_action_definitions (name, required_permission)
select action.name, permission.name
from (values ('inventory.sensitive.export')) action(name)
cross join permission_definitions permission
where permission.name = 'inventory.valuation.view'
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
    'owner', 'manager', 'pharmacist', 'inventory_employee', 'accountant'
  )
     or (
       pharmacy_role.role_key = 'purchasing_employee'
       and exists (
         select 1 from role_permission_grants current_grant
         where current_grant.role_id = pharmacy_role.id
           and current_grant.permission_name = 'catalog.item.search'
       )
       and exists (
         select 1 from role_permission_grants current_grant
         where current_grant.role_id = pharmacy_role.id
           and current_grant.permission_name = 'purchases.drafts.manage'
       )
       and exists (
         select 1 from role_permission_grants current_grant
         where current_grant.role_id = pharmacy_role.id
           and current_grant.permission_name = 'purchases.posted.view'
       )
       and exists (
         select 1 from role_permission_grants current_grant
         where current_grant.role_id = pharmacy_role.id
           and current_grant.permission_name = 'purchases.costs.view'
       )
       and not exists (
         select 1 from role_permission_grants other_grant
         where other_grant.role_id = pharmacy_role.id
           -- Every migration that adds a default grant to
           -- purchasing_employee must also add that permission here, or this
           -- migration will silently stop granting.
           and other_grant.permission_name not in (
             'catalog.item.search', 'inventory.reorder.confirm',
             'inventory.reorder.manage', 'inventory.review',
             'purchases.adjustments.manage', 'purchases.costs.view',
             'purchases.drafts.manage', 'purchases.posted.view',
             'purchases.returns.manage'
           )
       )
     )
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select eligible_role.pharmacy_id,
         eligible_role.role_id,
         permission_name.name,
         eligible_role.granted_by
  from eligible_roles eligible_role
  cross join (values ('inventory.review'::text),
                     ('inventory.valuation.view'::text)) permission_name(name)
  where (permission_name.name = 'inventory.review'
         and eligible_role.role_id in (
           select id from pharmacy_roles
           where pharmacy_id = eligible_role.pharmacy_id
             and role_key in (
               'owner', 'manager', 'pharmacist', 'inventory_employee',
               'purchasing_employee'
             )
         ))
     or (permission_name.name = 'inventory.valuation.view'
         and eligible_role.role_id in (
           select id from pharmacy_roles
           where pharmacy_id = eligible_role.pharmacy_id
             and role_key in ('owner', 'manager', 'accountant')
         ))
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
--> statement-breakpoint
alter table posting_command_results
  drop constraint posting_command_results_name,
  -- Keep this list a superset of the command names allowed by the previous migration.
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add',
      'catalog.barcode.print',
      'catalog.barcode.suggest',
      'catalog.matching.approve',
      'catalog.matching.open',
      'catalog.product.archive',
      'catalog.product.create',
      'catalog.product.edit',
      'catalog.product.merge',
      'inventory.review-preferences.update',
      'inventory.sensitive-export',
      'pharmacy.settings.update',
      'purchase.adjustment-draft.create',
      'purchase.adjustment-draft.discard',
      'purchase.adjustment-draft.update',
      'purchase.adjustment.post',
      'purchase.draft.create',
      'purchase.draft.discard',
      'purchase.draft.row.commit',
      'purchase.draft.update',
      'purchase.entry-preferences.update',
      'purchase.post',
      'purchase.return-draft.create',
      'purchase.return-draft.discard',
      'purchase.return-draft.update',
      'purchase.return.post',
      'supplier.archive',
      'supplier.create',
      'supplier.edit',
      'supplier.merge'
    )
  );
--> statement-breakpoint
alter table catalog_products
  add column minimum_level bigint,
  add column maximum_level bigint,
  add column reorder_point bigint,
  add constraint catalog_products_minimum_level_non_negative
    check (minimum_level is null or minimum_level >= 0),
  add constraint catalog_products_maximum_level_non_negative
    check (maximum_level is null or maximum_level >= 0),
  add constraint catalog_products_levels_ordered
    check (
      minimum_level is null or maximum_level is null
      or maximum_level >= minimum_level
    ),
  add constraint catalog_products_reorder_point_non_negative
    check (reorder_point is null or reorder_point >= 0);
--> statement-breakpoint
create table inventory_review_preferences (
  pharmacy_id uuid not null references pharmacies(id),
  user_id uuid not null,
  columns jsonb not null default
    '[{"field":"item","visible":true},{"field":"balance","visible":true},{"field":"value","visible":true},{"field":"averageCost","visible":true},{"field":"batches","visible":true},{"field":"expiry","visible":true},{"field":"levels","visible":true},{"field":"reorderPoint","visible":true},{"field":"consumptionRate","visible":true},{"field":"risk","visible":true}]'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  primary key (pharmacy_id, user_id),
  foreign key (user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint inventory_review_preferences_revision_positive check (revision > 0),
  constraint inventory_review_preferences_columns_array check (
    jsonb_typeof(columns) = 'array'
  )
);
--> statement-breakpoint
create function enforce_inventory_review_preferences_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Inventory review preferences are never deleted'
      using errcode = '55000';
  end if;
  if new.pharmacy_id <> old.pharmacy_id or new.user_id <> old.user_id
     or new.revision <> old.revision + 1 then
    raise exception 'Invalid Inventory review preference revision'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger inventory_review_preferences_change_guard
before update or delete on inventory_review_preferences
for each row execute function enforce_inventory_review_preferences_change();
--> statement-breakpoint
revoke all on table inventory_review_preferences from public;
--> statement-breakpoint
revoke all on function enforce_inventory_review_preferences_change() from public;
--> statement-breakpoint
grant select, insert, update on table inventory_review_preferences to breev_app;
