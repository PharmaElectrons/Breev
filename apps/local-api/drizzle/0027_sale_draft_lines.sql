alter type sale_draft_status add value 'suspended';
--> statement-breakpoint
alter type sale_draft_status add value 'discarded';
--> statement-breakpoint
alter table sale_drafts add column invoice_discount_fils bigint not null default 0
  check (invoice_discount_fils >= 0);
--> statement-breakpoint
create table sale_draft_lines (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  draft_id uuid not null,
  line_kind text not null default 'catalog' check (line_kind in ('catalog', 'misc')),
  product_id uuid,
  display_name text not null check (length(display_name) > 0),
  unit_id uuid,
  unit_name text not null check (length(unit_name) > 0),
  base_units_per_unit bigint not null check (base_units_per_unit > 0),
  eligible_units jsonb not null,
  quantity bigint not null check (quantity > 0),
  captured_retail_price_fils bigint not null check (captured_retail_price_fils >= 0),
  captured_unit_ratio bigint not null check (captured_unit_ratio > 0),
  unit_price_fils bigint not null check (unit_price_fils >= 0),
  price_version bigint check (price_version > 0),
  cost_fils bigint not null default 0 check (cost_fils >= 0),
  price_captured_at timestamptz not null default statement_timestamp(),
  line_discount_percentage smallint not null default 0
    check (line_discount_percentage between 0 and 100),
  ordinal bigint not null,
  constraint sale_draft_line_kind_fields check (
    (line_kind = 'catalog' and product_id is not null and unit_id is not null and price_version is not null)
    or (line_kind = 'misc' and product_id is null and unit_id is null and price_version is null and cost_fils = 0)
  ),
  foreign key (draft_id, pharmacy_id) references sale_drafts(id, pharmacy_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  unique (draft_id, ordinal),
  constraint sale_draft_lines_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);
--> statement-breakpoint
create index sale_draft_lines_draft_index
  on sale_draft_lines (pharmacy_id, draft_id, ordinal);
--> statement-breakpoint
revoke all on table sale_draft_lines from public;
--> statement-breakpoint
grant select, insert, update, delete on table sale_draft_lines to breev_app;
--> statement-breakpoint
insert into permission_definitions (name) values ('sales.misc.manage')
on conflict (name) do nothing;
--> statement-breakpoint
with eligible_roles as (
  select pharmacy_role.pharmacy_id, pharmacy_role.id as role_id,
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
  where pharmacy_role.role_key in ('owner', 'manager')
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select pharmacy_id, role_id, 'sales.misc.manage', granted_by
  from eligible_roles
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
create or replace function enforce_sale_draft_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Sale Drafts are never deleted' using errcode = '55000';
  end if;
  if old.status = 'discarded' or
     (old.status = 'suspended' and new.status <> 'active') then
    raise exception 'Inactive Sale Drafts are immutable' using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.created_at <> old.created_at or new.created_by <> old.created_by
     or new.version <> old.version + 1 then
    raise exception 'Invalid Sale Draft version' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
alter table posting_command_results drop constraint posting_command_results_name,
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add', 'catalog.barcode.print', 'catalog.barcode.suggest',
      'catalog.matching.approve', 'catalog.matching.open',
      'catalog.product.archive', 'catalog.product.create', 'catalog.product.edit',
      'catalog.product.merge',
      'inventory.batch_status.change', 'inventory.batch_expiry.correct',
      'inventory.count.session.start', 'inventory.count.line.record',
      'inventory.count.variance.apply', 'inventory.count.session.complete',
      'inventory.reorder.item.add', 'inventory.reorder.item.update',
      'inventory.reorder.item.remove', 'inventory.reorder.item.confirm',
      'inventory.reorder.item.return', 'inventory.review-preferences.update',
      'inventory.sensitive-export', 'pharmacy.settings.update',
      'purchase.adjustment-draft.create', 'purchase.adjustment-draft.discard',
      'purchase.adjustment-draft.update', 'purchase.adjustment.post',
      'purchase.draft.create', 'purchase.draft.discard',
      'purchase.draft.row.commit', 'purchase.draft.update',
      'purchase.entry-preferences.update', 'purchase.post',
      'purchase.return-draft.create', 'purchase.return-draft.discard',
      'purchase.return-draft.update', 'purchase.return.post',
      'sale.draft.create', 'sale.draft.resume', 'sale.draft.line.add',
      'sale.draft.misc-line.add',
      'sale.draft.line.change', 'sale.draft.line.remove',
      'sale.draft.discount', 'sale.draft.clear', 'sale.draft.suspend',
      'sale.draft.discard',
      'supplier.archive', 'supplier.create', 'supplier.edit', 'supplier.merge'
    )
  );
