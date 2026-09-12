create type inventory_reorder_item_status as enum ('basket', 'ordered', 'removed');
--> statement-breakpoint
create table inventory_reorder_items (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  status inventory_reorder_item_status not null default 'basket',
  version bigint not null default 1,
  quantity bigint not null,
  proposed_quantity bigint not null,
  proposal_basis text not null,
  balance_at_proposal bigint not null,
  maximum_level_at_proposal bigint,
  proposed_at timestamptz not null default statement_timestamp(),
  quantity_edited_at timestamptz,
  added_at timestamptz not null default statement_timestamp(),
  added_by uuid not null,
  ordered_at timestamptz,
  ordered_by uuid,
  removed_at timestamptz,
  removed_by uuid,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  device_id uuid not null,
  unique (id, pharmacy_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (added_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (ordered_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (removed_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint inventory_reorder_items_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_reorder_items_version_positive check (version > 0),
  constraint inventory_reorder_items_quantity_nonnegative check (quantity >= 0),
  constraint inventory_reorder_items_proposed_quantity_nonnegative check (
    proposed_quantity >= 0
  ),
  constraint inventory_reorder_items_proposal_basis check (
    proposal_basis in (
      'maximum-minus-balance', 'no-maximum-level',
      'balance-at-or-above-maximum'
    )
  ),
  constraint inventory_reorder_items_maximum_level_nonnegative check (
    maximum_level_at_proposal is null or maximum_level_at_proposal >= 0
  ),
  constraint inventory_reorder_items_ordered_status check (
    (status = 'ordered') = (ordered_at is not null)
  ),
  constraint inventory_reorder_items_removed_status check (
    (status = 'removed') = (removed_at is not null)
  ),
  constraint inventory_reorder_items_ordered_by_pair check (
    (ordered_at is null) = (ordered_by is null)
  ),
  constraint inventory_reorder_items_removed_by_pair check (
    (removed_at is null) = (removed_by is null)
  )
);
--> statement-breakpoint
create unique index inventory_reorder_items_live_product
  on inventory_reorder_items (pharmacy_id, product_id)
  where status <> 'removed';
--> statement-breakpoint
create index inventory_reorder_items_pharmacy_status_added
  on inventory_reorder_items (pharmacy_id, status, added_at, id);
--> statement-breakpoint
comment on table inventory_reorder_items is
  'Reorder basket and Ordered Items. Future supplier-price integrations may reference id; no supplier data is modelled here (Phase Two).';
--> statement-breakpoint
create function enforce_inventory_reorder_item_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Inventory Reorder Items are never deleted'
      using errcode = '55000';
  end if;
  if old.status = 'removed' then
    raise exception 'Removed Inventory Reorder Items are immutable'
      using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.product_id <> old.product_id
     or new.added_at <> old.added_at or new.added_by <> old.added_by
     or new.version <> old.version + 1 then
    raise exception 'Invalid Inventory Reorder Item version'
      using errcode = '55000';
  end if;
  if old.status = 'basket' and new.status = 'ordered'
     and (new.ordered_at is null or new.ordered_by is null) then
    raise exception 'Ordering an Inventory Reorder Item requires an actor and time'
      using errcode = '55000';
  end if;
  if old.status = 'ordered' and new.status = 'basket'
     and (new.ordered_at is not null or new.ordered_by is not null) then
    raise exception 'Returning an Inventory Reorder Item clears its order facts'
      using errcode = '55000';
  end if;
  if new.status = 'removed' and old.status <> 'basket' then
    raise exception 'Only a basket Inventory Reorder Item may be removed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger inventory_reorder_items_change_guard
before update or delete on inventory_reorder_items
for each row execute function enforce_inventory_reorder_item_change();
--> statement-breakpoint
revoke all on table inventory_reorder_items from public;
--> statement-breakpoint
grant select, insert, update on table inventory_reorder_items to breev_app;
--> statement-breakpoint
revoke all on function enforce_inventory_reorder_item_change() from public;
--> statement-breakpoint
insert into permission_definitions (name)
values ('inventory.reorder.confirm'), ('inventory.reorder.manage')
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
    'owner', 'manager', 'pharmacist', 'inventory_employee', 'sales_employee'
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
  cross join (values ('inventory.reorder.manage'::text),
                     ('inventory.reorder.confirm'::text)) permission_name(name)
  where (permission_name.name = 'inventory.reorder.manage'
         and eligible_role.role_id in (
           select id from pharmacy_roles
           where pharmacy_id = eligible_role.pharmacy_id
             and role_key in (
               'owner', 'manager', 'pharmacist', 'inventory_employee',
               'purchasing_employee', 'sales_employee'
             )
         ))
     or (permission_name.name = 'inventory.reorder.confirm'
         and eligible_role.role_id in (
           select id from pharmacy_roles
           where pharmacy_id = eligible_role.pharmacy_id
             and role_key in ('owner', 'manager', 'purchasing_employee')
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
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add', 'catalog.barcode.print', 'catalog.barcode.suggest',
      'catalog.matching.approve', 'catalog.matching.open',
      'catalog.product.archive', 'catalog.product.create',
      'catalog.product.edit', 'catalog.product.merge',
      'inventory.batch_status.change', 'inventory.batch_expiry.correct',
      'inventory.count.session.start', 'inventory.count.line.record',
      'inventory.count.variance.apply', 'inventory.count.session.complete',
      'inventory.reorder.item.add', 'inventory.reorder.item.update',
      'inventory.reorder.item.remove', 'inventory.reorder.item.confirm',
      'inventory.reorder.item.return',
      'inventory.review-preferences.update', 'inventory.sensitive-export',
      'pharmacy.settings.update',
      'purchase.adjustment-draft.create', 'purchase.adjustment-draft.discard',
      'purchase.adjustment-draft.update', 'purchase.adjustment.post',
      'purchase.draft.create', 'purchase.draft.discard',
      'purchase.draft.row.commit', 'purchase.draft.update',
      'purchase.entry-preferences.update', 'purchase.post',
      'purchase.return-draft.create', 'purchase.return-draft.discard',
      'purchase.return-draft.update', 'purchase.return.post',
      'supplier.archive', 'supplier.create', 'supplier.edit', 'supplier.merge'
    )
  );
