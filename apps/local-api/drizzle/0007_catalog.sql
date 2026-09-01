insert into permission_definitions (name)
values ('catalog.item.manage')
on conflict (name) do nothing;
--> statement-breakpoint
with inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select owner_role.pharmacy_id,
         owner_role.id,
         'catalog.item.manage',
         owner_user.id
  from pharmacy_roles owner_role
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
  from inserted_grants grant_row
  where pharmacy_role.id = grant_row.role_id
  returning pharmacy_role.pharmacy_id
)
update pharmacies pharmacy_row
set identity_revision = pharmacy_row.identity_revision + 1
where pharmacy_row.id in (select pharmacy_id from advanced_roles);
--> statement-breakpoint
alter table posting_command_results
  drop constraint posting_command_results_name,
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.product.archive',
      'catalog.product.create',
      'catalog.product.edit',
      'catalog.product.merge',
      'pharmacy.settings.update'
    )
  );
--> statement-breakpoint
create type catalog_product_definition_mode as enum (
  'general-item',
  'medication'
);
--> statement-breakpoint
create type catalog_product_status as enum (
  'active',
  'archived',
  'merged'
);
--> statement-breakpoint
create type catalog_product_food_timing as enum (
  'after-food',
  'before-food',
  'regardless-of-food'
);
--> statement-breakpoint
create type catalog_product_state_colour as enum (
  'blue',
  'green',
  'grey',
  'orange',
  'purple',
  'red',
  'yellow'
);
--> statement-breakpoint
create table catalog_products (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  definition_mode catalog_product_definition_mode not null,
  medication_trade_name text,
  medication_strength text,
  medication_dosage_form text,
  medication_manufacturer text,
  general_company text,
  general_sub_brand text,
  general_type_of_use text,
  general_property text,
  general_target_audience text,
  general_size text,
  display_name text not null,
  name_template_version smallint not null,
  arabic_search_name text,
  scientific_name text,
  category text,
  uses_per_day smallint,
  uses_per_week smallint,
  uses_per_month smallint,
  food_timing catalog_product_food_timing,
  externally_visible boolean not null,
  ai_sharing_allowed boolean not null,
  manual_state_colour catalog_product_state_colour,
  cold_storage_required boolean not null,
  status catalog_product_status not null default 'active',
  merged_into_product_id uuid,
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  unique (id, pharmacy_id),
  foreign key (created_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (merged_into_product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  constraint catalog_products_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint catalog_products_display_name_length check (
    char_length(display_name) between 1 and 726
  ),
  constraint catalog_products_template_version check (
    name_template_version = 1
  ),
  constraint catalog_products_optional_text_lengths check (
    (arabic_search_name is null or char_length(arabic_search_name) between 1 and 160)
    and (scientific_name is null or char_length(scientific_name) between 1 and 160)
    and (category is null or char_length(category) between 1 and 96)
  ),
  constraint catalog_products_name_part_lengths check (
    (medication_trade_name is null or char_length(medication_trade_name) between 1 and 120)
    and (medication_strength is null or char_length(medication_strength) between 1 and 120)
    and (medication_dosage_form is null or char_length(medication_dosage_form) between 1 and 120)
    and (medication_manufacturer is null or char_length(medication_manufacturer) between 1 and 120)
    and (general_company is null or char_length(general_company) between 1 and 120)
    and (general_sub_brand is null or char_length(general_sub_brand) between 1 and 120)
    and (general_type_of_use is null or char_length(general_type_of_use) between 1 and 120)
    and (general_property is null or char_length(general_property) between 1 and 120)
    and (general_target_audience is null or char_length(general_target_audience) between 1 and 120)
    and (general_size is null or char_length(general_size) between 1 and 120)
  ),
  constraint catalog_products_mode_fields check (
    (
      definition_mode = 'medication'
      and medication_trade_name is not null
      and general_company is null
      and general_sub_brand is null
      and general_type_of_use is null
      and general_property is null
      and general_target_audience is null
      and general_size is null
    )
    or
    (
      definition_mode = 'general-item'
      and general_company is not null
      and medication_trade_name is null
      and medication_strength is null
      and medication_dosage_form is null
      and medication_manufacturer is null
    )
  ),
  constraint catalog_products_instruction_ranges check (
    (uses_per_day is null or uses_per_day between 1 and 99)
    and (uses_per_week is null or uses_per_week between 1 and 99)
    and (uses_per_month is null or uses_per_month between 1 and 99)
  ),
  constraint catalog_products_merge_state check (
    (status = 'merged') = (merged_into_product_id is not null)
    and (merged_into_product_id is null or merged_into_product_id <> id)
  ),
  constraint catalog_products_revision_positive check (revision > 0),
  constraint catalog_products_time_order check (created_at <= updated_at)
);
--> statement-breakpoint
create table catalog_product_barcodes (
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  barcode text not null,
  ordinal smallint not null,
  recorded_at timestamptz not null default statement_timestamp(),
  recorded_by uuid not null,
  removed_at timestamptz,
  removed_by uuid,
  primary key (product_id, barcode),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (recorded_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (removed_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint catalog_product_barcodes_length check (
    char_length(barcode) between 1 and 64
  ),
  constraint catalog_product_barcodes_ordinal check (
    ordinal between 0 and 31
  ),
  constraint catalog_product_barcodes_removal_consistent check (
    (removed_at is null) = (removed_by is null)
  )
);
--> statement-breakpoint
create unique index catalog_product_barcodes_active_value_unique
  on catalog_product_barcodes (pharmacy_id, barcode)
  where removed_at is null;
--> statement-breakpoint
create unique index catalog_product_barcodes_active_ordinal_unique
  on catalog_product_barcodes (product_id, ordinal)
  where removed_at is null;
--> statement-breakpoint
create table catalog_product_snapshots (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  display_name text not null,
  name_template_version smallint not null,
  posted_at timestamptz not null default statement_timestamp(),
  unique (id, pharmacy_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  constraint catalog_product_snapshots_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint catalog_product_snapshots_display_name_length check (
    char_length(display_name) between 1 and 726
  ),
  constraint catalog_product_snapshots_template_version check (
    name_template_version = 1
  )
);
--> statement-breakpoint
create function enforce_catalog_product_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Catalog Products are never deleted' using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Archived and merged Catalog Products are immutable'
      using errcode = '55000';
  end if;
  if new.id <> old.id
     or new.pharmacy_id <> old.pharmacy_id
     or new.created_at <> old.created_at
     or new.created_by <> old.created_by
     or new.revision <> old.revision + 1 then
    raise exception 'Invalid Catalog Product revision' using errcode = '55000';
  end if;
  if new.status <> old.status
     and not (old.status = 'active' and new.status in ('archived', 'merged')) then
    raise exception 'Invalid Catalog Product status transition'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function enforce_catalog_product_merge_survivor()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'merged' then
    perform 1
    from public.catalog_products survivor
    where survivor.id = new.merged_into_product_id
      and survivor.pharmacy_id = new.pharmacy_id
      and survivor.status = 'active'
    for share;
    if not found then
      raise exception 'The Catalog merge survivor must be active in the same pharmacy'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function reject_catalog_barcode_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Catalog Product barcodes are never deleted'
    using errcode = '55000';
end;
$$;
--> statement-breakpoint
create function prepare_catalog_product_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_product public.catalog_products%rowtype;
begin
  select * into current_product
  from public.catalog_products product_row
  where product_row.id = new.product_id
    and product_row.pharmacy_id = new.pharmacy_id
  for share;
  if not found then
    raise exception 'The Catalog Product does not exist in this pharmacy'
      using errcode = '23503';
  end if;
  if current_product.status = 'archived' then
    raise exception 'An archived Catalog Product cannot receive a future reference'
      using errcode = '23514';
  end if;
  if current_product.status = 'merged' then
    select * into current_product
    from public.catalog_products survivor
    where survivor.id = current_product.merged_into_product_id
      and survivor.pharmacy_id = new.pharmacy_id
      and survivor.status = 'active'
    for share;
    if not found then
      raise exception 'The Catalog merge survivor is unavailable'
        using errcode = '23514';
    end if;
  end if;
  new.product_id := current_product.id;
  new.display_name := current_product.display_name;
  new.name_template_version := current_product.name_template_version;
  return new;
end;
$$;
--> statement-breakpoint
create function reject_catalog_snapshot_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Posted Catalog Product snapshots are immutable'
    using errcode = '55000';
end;
$$;
--> statement-breakpoint
create trigger catalog_products_change_guard
before update or delete on catalog_products
for each row execute function enforce_catalog_product_change();
--> statement-breakpoint
create trigger catalog_products_merge_survivor_guard
before insert or update on catalog_products
for each row execute function enforce_catalog_product_merge_survivor();
--> statement-breakpoint
create trigger catalog_product_barcodes_delete_guard
before delete on catalog_product_barcodes
for each row execute function reject_catalog_barcode_delete();
--> statement-breakpoint
create trigger catalog_product_snapshots_prepare
before insert on catalog_product_snapshots
for each row execute function prepare_catalog_product_snapshot();
--> statement-breakpoint
create trigger catalog_product_snapshots_immutable
before update or delete on catalog_product_snapshots
for each row execute function reject_catalog_snapshot_mutation();
--> statement-breakpoint
revoke all on table
  catalog_products,
  catalog_product_barcodes,
  catalog_product_snapshots
from public;
--> statement-breakpoint
revoke all on function enforce_catalog_product_change() from public;
--> statement-breakpoint
revoke all on function enforce_catalog_product_merge_survivor() from public;
--> statement-breakpoint
revoke all on function reject_catalog_barcode_delete() from public;
--> statement-breakpoint
revoke all on function prepare_catalog_product_snapshot() from public;
--> statement-breakpoint
revoke all on function reject_catalog_snapshot_mutation() from public;
--> statement-breakpoint
grant select, insert, update on table
  catalog_products,
  catalog_product_barcodes
to breev_app;
--> statement-breakpoint
grant select, insert on table catalog_product_snapshots to breev_app;
