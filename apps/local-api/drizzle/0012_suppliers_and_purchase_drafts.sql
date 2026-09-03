insert into permission_definitions (name)
values ('suppliers.manage'), ('purchases.drafts.manage')
on conflict (name) do nothing;
--> statement-breakpoint
with inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select owner_role.pharmacy_id,
         owner_role.id,
         permission_name.name,
         owner_user.id
  from pharmacy_roles owner_role
  cross join (values ('suppliers.manage'), ('purchases.drafts.manage'))
    as permission_name(name)
  join lateral (
    select identity_user.id
    from identity_users identity_user
    where identity_user.pharmacy_id = owner_role.pharmacy_id
      and identity_user.role_id = owner_role.id
      and identity_user.status = 'active'
    order by identity_user.created_at, identity_user.id
    limit 1
  ) owner_user on true
  where owner_role.role_key = 'owner'
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
      'catalog.product.archive',
      'catalog.product.create',
      'catalog.product.edit',
      'catalog.product.merge',
      'pharmacy.settings.update',
      'purchase.draft.create',
      'purchase.draft.discard',
      'purchase.draft.update',
      'supplier.archive',
      'supplier.create',
      'supplier.edit',
      'supplier.merge'
    )
  );
--> statement-breakpoint
create type supplier_status as enum ('active', 'archived', 'merged');
--> statement-breakpoint
create type purchase_settlement_context as enum ('cash', 'debt');
--> statement-breakpoint
create type purchase_draft_status as enum ('active', 'discarded');
--> statement-breakpoint
create table suppliers (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  name text not null,
  terms text,
  status supplier_status not null default 'active',
  merged_into_supplier_id uuid,
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  unique (id, pharmacy_id),
  foreign key (created_by, pharmacy_id) references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id) references identity_users(id, pharmacy_id),
  foreign key (merged_into_supplier_id, pharmacy_id)
    references suppliers(id, pharmacy_id),
  constraint suppliers_name_length check (char_length(name) between 1 and 160),
  constraint suppliers_terms_length check (
    terms is null or char_length(terms) between 1 and 1000
  ),
  constraint suppliers_merge_state check (
    (status = 'merged') = (merged_into_supplier_id is not null)
    and (merged_into_supplier_id is null or merged_into_supplier_id <> id)
  ),
  constraint suppliers_revision_positive check (revision > 0),
  constraint suppliers_time_order check (created_at <= updated_at)
);
--> statement-breakpoint
create table supplier_allowance_rates (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  supplier_id uuid not null,
  effective_from date not null,
  allowance_percentage numeric(9,6) not null,
  recorded_at timestamptz not null default statement_timestamp(),
  recorded_by uuid not null,
  unique (supplier_id, effective_from),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id),
  foreign key (recorded_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint supplier_allowance_percentage_range check (
    allowance_percentage between 0 and 100
  )
);
--> statement-breakpoint
create table purchase_drafts (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  supplier_invoice_number text not null,
  supplier_id uuid not null,
  supplier_name_snapshot text not null,
  settlement_context purchase_settlement_context not null,
  invoice_date date not null,
  allowance_percentage_snapshot numeric(9,6) not null,
  allowance_basis_fils bigint not null default 0,
  status purchase_draft_status not null default 'active',
  version bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  discarded_at timestamptz,
  discarded_by uuid,
  unique (id, pharmacy_id),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id),
  foreign key (created_by, pharmacy_id) references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id) references identity_users(id, pharmacy_id),
  foreign key (discarded_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint purchase_drafts_invoice_number_length check (
    char_length(supplier_invoice_number) between 1 and 120
  ),
  constraint purchase_drafts_supplier_name_length check (
    char_length(supplier_name_snapshot) between 1 and 160
  ),
  constraint purchase_drafts_allowance_range check (
    allowance_percentage_snapshot between 0 and 100
  ),
  constraint purchase_drafts_allowance_basis_nonnegative check (
    allowance_basis_fils >= 0
  ),
  constraint purchase_drafts_version_positive check (version > 0),
  constraint purchase_drafts_discard_state check (
    (status = 'discarded') = (discarded_at is not null)
    and (discarded_at is null) = (discarded_by is null)
  ),
  constraint purchase_drafts_time_order check (created_at <= updated_at)
);
--> statement-breakpoint
create index purchase_drafts_resume_index
  on purchase_drafts (pharmacy_id, updated_at desc, id)
  where status = 'active';
--> statement-breakpoint
create index purchase_drafts_duplicate_warning_index
  on purchase_drafts (pharmacy_id, supplier_id, supplier_invoice_number)
  where status = 'active';
--> statement-breakpoint
create function enforce_supplier_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Suppliers are never deleted' using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Archived and merged Suppliers are immutable' using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.created_at <> old.created_at or new.created_by <> old.created_by
     or new.revision <> old.revision + 1 then
    raise exception 'Invalid Supplier revision' using errcode = '55000';
  end if;
  if new.status <> old.status
     and not (old.status = 'active' and new.status in ('archived', 'merged')) then
    raise exception 'Invalid Supplier status transition' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function enforce_supplier_merge_survivor()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status = 'merged' then
    perform 1 from public.suppliers survivor
    where survivor.id = new.merged_into_supplier_id
      and survivor.pharmacy_id = new.pharmacy_id
      and survivor.status = 'active'
    for share;
    if not found then
      raise exception 'The Supplier merge survivor must be active in the same pharmacy'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function reject_supplier_allowance_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Supplier allowance history is append-only' using errcode = '55000';
end;
$$;
--> statement-breakpoint
create function prepare_purchase_draft()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  selected_supplier public.suppliers%rowtype;
  selected_rate numeric(9,6);
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.supplier_id = old.supplier_id
       and new.invoice_date = old.invoice_date then
      new.supplier_name_snapshot := old.supplier_name_snapshot;
      new.allowance_percentage_snapshot := old.allowance_percentage_snapshot;
      return new;
    end if;
  end if;
  select * into selected_supplier from public.suppliers supplier_row
  where supplier_row.id = new.supplier_id
    and supplier_row.pharmacy_id = new.pharmacy_id
  for share;
  if not found or selected_supplier.status = 'archived' then
    raise exception 'The Supplier is unavailable' using errcode = '23514';
  end if;
  if selected_supplier.status = 'merged' then
    select * into selected_supplier from public.suppliers survivor
    where survivor.id = selected_supplier.merged_into_supplier_id
      and survivor.pharmacy_id = new.pharmacy_id
      and survivor.status = 'active'
    for share;
    if not found then
      raise exception 'The Supplier merge survivor is unavailable' using errcode = '23514';
    end if;
  end if;
  select rate.allowance_percentage into selected_rate
  from public.supplier_allowance_rates rate
  where rate.pharmacy_id = new.pharmacy_id
    and rate.supplier_id = selected_supplier.id
    and rate.effective_from <= new.invoice_date
  order by rate.effective_from desc, rate.recorded_at desc
  limit 1;
  if selected_rate is null then
    raise exception 'The Supplier has no allowance rate valid on the invoice date'
      using errcode = '23514';
  end if;
  new.supplier_id := selected_supplier.id;
  new.supplier_name_snapshot := selected_supplier.name;
  new.allowance_percentage_snapshot := selected_rate;
  return new;
end;
$$;
--> statement-breakpoint
create function enforce_purchase_draft_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Purchase Drafts are never deleted' using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Discarded Purchase Drafts are immutable' using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.created_at <> old.created_at or new.created_by <> old.created_by
     or new.version <> old.version + 1 then
    raise exception 'Invalid Purchase Draft version' using errcode = '55000';
  end if;
  if new.status = 'discarded' and (
    new.supplier_invoice_number <> old.supplier_invoice_number
    or new.supplier_id <> old.supplier_id
    or new.supplier_name_snapshot <> old.supplier_name_snapshot
    or new.settlement_context <> old.settlement_context
    or new.invoice_date <> old.invoice_date
    or new.allowance_percentage_snapshot <> old.allowance_percentage_snapshot
    or new.allowance_basis_fils <> old.allowance_basis_fils
  ) then
    raise exception 'Discard may not rewrite a Purchase Draft' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger suppliers_change_guard before update or delete on suppliers
for each row execute function enforce_supplier_change();
--> statement-breakpoint
create trigger suppliers_merge_survivor_guard before insert or update on suppliers
for each row execute function enforce_supplier_merge_survivor();
--> statement-breakpoint
create trigger supplier_allowance_rates_immutable before update or delete on supplier_allowance_rates
for each row execute function reject_supplier_allowance_mutation();
--> statement-breakpoint
create trigger purchase_drafts_change_guard before update or delete on purchase_drafts
for each row execute function enforce_purchase_draft_change();
--> statement-breakpoint
create trigger purchase_drafts_snapshot_prepare before insert or update on purchase_drafts
for each row execute function prepare_purchase_draft();
--> statement-breakpoint
revoke all on table suppliers, supplier_allowance_rates, purchase_drafts from public;
--> statement-breakpoint
revoke all on function enforce_supplier_change() from public;
--> statement-breakpoint
revoke all on function enforce_supplier_merge_survivor() from public;
--> statement-breakpoint
revoke all on function reject_supplier_allowance_mutation() from public;
--> statement-breakpoint
revoke all on function prepare_purchase_draft() from public;
--> statement-breakpoint
revoke all on function enforce_purchase_draft_change() from public;
--> statement-breakpoint
grant select, insert, update on table suppliers, purchase_drafts to breev_app;
--> statement-breakpoint
grant select, insert on table supplier_allowance_rates to breev_app;
