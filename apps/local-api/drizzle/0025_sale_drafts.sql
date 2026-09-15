create type sale_draft_status as enum ('active');
--> statement-breakpoint
create table sale_drafts (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  status sale_draft_status not null default 'active',
  version bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  device_id uuid not null,
  unique (id, pharmacy_id),
  foreign key (created_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint sale_drafts_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint sale_drafts_version_positive check (version > 0),
  constraint sale_drafts_time_order check (created_at <= updated_at)
);
--> statement-breakpoint
create index sale_drafts_open_index
  on sale_drafts (pharmacy_id, updated_at desc, id)
  where status = 'active';
--> statement-breakpoint
comment on table sale_drafts is
  'Minimal durable Sale Draft from #27. #31 extends this table rather than replacing it.';
--> statement-breakpoint
create function enforce_sale_draft_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Sale Drafts are never deleted'
      using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Inactive Sale Drafts are immutable'
      using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.created_at <> old.created_at or new.created_by <> old.created_by
     or new.version <> old.version + 1 then
    raise exception 'Invalid Sale Draft version'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger sale_drafts_change_guard
before update or delete on sale_drafts
for each row execute function enforce_sale_draft_change();
--> statement-breakpoint
revoke all on table sale_drafts from public;
--> statement-breakpoint
revoke all on function enforce_sale_draft_change() from public;
--> statement-breakpoint
grant select, insert, update on table sale_drafts to breev_app;
--> statement-breakpoint
insert into permission_definitions (name)
values ('sales.drafts.manage')
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
    'owner', 'manager', 'pharmacist', 'sales_employee'
  )
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select eligible_role.pharmacy_id, eligible_role.role_id,
         'sales.drafts.manage', eligible_role.granted_by
  from eligible_roles eligible_role
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
      'sale.draft.create', 'sale.draft.resume',
      'supplier.archive', 'supplier.create', 'supplier.edit', 'supplier.merge'
    )
  );
