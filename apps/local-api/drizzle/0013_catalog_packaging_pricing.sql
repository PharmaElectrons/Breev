create type catalog_unit_kind as enum ('inventory', 'package');
--> statement-breakpoint
create type catalog_pricing_method as enum ('by-percentage', 'by-price');
--> statement-breakpoint
create type catalog_price_rounding as enum (
  'nearest-1000-iqd',
  'nearest-250-iqd',
  'nearest-500-iqd',
  'off'
);
--> statement-breakpoint
-- Snapshot creation locks its snapshot row before its preparation trigger
-- reads the Product. Match that order for the whole migration so an older API
-- process can finish cleanly instead of deadlocking with this upgrade.
lock table catalog_product_snapshots in access exclusive mode;
--> statement-breakpoint
lock table catalog_products in access exclusive mode;
--> statement-breakpoint
create table catalog_product_units (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  kind catalog_unit_kind not null,
  name text not null,
  ordinal smallint not null,
  base_units_per_package bigint,
  unique (id, product_id),
  unique (product_id, name),
  unique (product_id, ordinal),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  constraint catalog_product_units_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint catalog_product_units_name_length check (
    char_length(name) between 1 and 40
  ),
  -- The Inventory Unit is always ordinal zero and the packages follow it in
  -- the order the pharmacy listed them, so reading a Product back returns the
  -- same package list that was written instead of a re-sorted one.
  constraint catalog_product_units_ordinal_state check (
    (kind = 'inventory' and ordinal = 0)
    or (kind = 'package' and ordinal > 0)
  ),
  constraint catalog_product_units_ratio_state check (
    (kind = 'inventory' and base_units_per_package is null)
    or (kind = 'package' and base_units_per_package is not null)
  ),
  -- The Inventory Unit itself has no ratio; a package must carry an explicit
  -- positive integer. PostgreSQL bigint makes a non-integer ratio impossible
  -- independently of REST.
  constraint catalog_product_units_ratio_range check (
    base_units_per_package is null
    or base_units_per_package > 0
  )
);
--> statement-breakpoint
-- Exactly one Inventory Unit per Product: the unique index below rejects a
-- second one, and every Catalog create/edit command inserts one in the same
-- transaction that inserts the Product row, so a live Product is never
-- observed without it.
create unique index catalog_product_units_one_inventory_unique
  on catalog_product_units (product_id)
  where kind = 'inventory';
--> statement-breakpoint
create table catalog_product_third_units (
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid primary key,
  name text not null,
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  constraint catalog_product_third_units_name_length check (
    char_length(name) between 1 and 40
  )
);
--> statement-breakpoint
alter table catalog_products
  -- Added nullable only for the forward backfill below. The migration makes
  -- all three columns NOT NULL before it exposes the new schema.
  add column count_default_unit_id uuid,
  add column purchase_default_unit_id uuid,
  add column sale_default_unit_id uuid,
  add column pricing_method catalog_pricing_method not null default 'by-price',
  add column retail_price_fils bigint,
  add column wholesale_price_fils bigint,
  add column margin_percentage numeric,
  add column price_rounding catalog_price_rounding;
--> statement-breakpoint
-- Backfill every existing Product, including immutable terminal records, with
-- one named Inventory Unit and a valid By Price state. The locks above prevent
-- an older API process from writing while the change guard is suspended for
-- this bounded migration-only update.
insert into catalog_product_units (
  pharmacy_id, product_id, kind, name, ordinal
)
select product_row.pharmacy_id, product_row.id, 'inventory', 'Unit', 0
from catalog_products product_row;
--> statement-breakpoint
alter table catalog_products disable trigger catalog_products_change_guard;
--> statement-breakpoint
update catalog_products product_row
set count_default_unit_id = unit_row.id,
    purchase_default_unit_id = unit_row.id,
    sale_default_unit_id = unit_row.id,
    pricing_method = 'by-price',
    retail_price_fils = 0
from catalog_product_units unit_row
where unit_row.product_id = product_row.id
  and unit_row.kind = 'inventory';
--> statement-breakpoint
alter table catalog_products enable trigger catalog_products_change_guard;
--> statement-breakpoint
alter table catalog_products
  alter column count_default_unit_id set not null,
  alter column purchase_default_unit_id set not null,
  alter column sale_default_unit_id set not null,
  alter column retail_price_fils set not null;
--> statement-breakpoint
alter table catalog_products
  add constraint catalog_products_count_default_unit_fk
    foreign key (count_default_unit_id, id)
    references catalog_product_units(id, product_id)
    deferrable initially deferred,
  add constraint catalog_products_purchase_default_unit_fk
    foreign key (purchase_default_unit_id, id)
    references catalog_product_units(id, product_id)
    deferrable initially deferred,
  add constraint catalog_products_sale_default_unit_fk
    foreign key (sale_default_unit_id, id)
    references catalog_product_units(id, product_id)
    deferrable initially deferred,
  add constraint catalog_products_pricing_state check (
    retail_price_fils >= 0
    and (wholesale_price_fils is null or wholesale_price_fils >= 0)
    and (margin_percentage is null or scale(margin_percentage) <= 6)
    and (
      (
        pricing_method = 'by-percentage'
        and margin_percentage is not null
        and margin_percentage >= 0 and margin_percentage < 100
        and price_rounding is not null
      )
      or
      (
        pricing_method = 'by-price'
        and margin_percentage is null
        and price_rounding is null
      )
    )
  );
--> statement-breakpoint
alter table catalog_product_snapshots
  add column inventory_unit_name text,
  add column third_unit_name text,
  add column pricing_method catalog_pricing_method,
  add column retail_price_fils bigint,
  add column wholesale_price_fils bigint,
  add column margin_percentage numeric,
  add column price_rounding catalog_price_rounding;
--> statement-breakpoint
-- Existing snapshots are immutable application facts. Use the bounded locked
-- migration path above to add neutral packaging and pricing facts without
-- weakening their guard after this transaction commits.
alter table catalog_product_snapshots
  disable trigger catalog_product_snapshots_immutable;
--> statement-breakpoint
update catalog_product_snapshots
set inventory_unit_name = 'Unit',
    pricing_method = 'by-price',
    retail_price_fils = 0;
--> statement-breakpoint
alter table catalog_product_snapshots
  enable trigger catalog_product_snapshots_immutable;
--> statement-breakpoint
alter table catalog_product_snapshots
  alter column inventory_unit_name set not null,
  alter column pricing_method set not null,
  alter column retail_price_fils set not null,
  add constraint catalog_product_snapshots_inventory_unit_name_length check (
    char_length(inventory_unit_name) between 1 and 40
  ),
  add constraint catalog_product_snapshots_third_unit_name_length check (
    third_unit_name is null or char_length(third_unit_name) between 1 and 40
  ),
  add constraint catalog_product_snapshots_pricing_state check (
    retail_price_fils >= 0
    and (wholesale_price_fils is null or wholesale_price_fils >= 0)
    and (margin_percentage is null or scale(margin_percentage) <= 6)
    and (
      (
        pricing_method = 'by-percentage'
        and margin_percentage is not null
        and margin_percentage >= 0 and margin_percentage < 100
        and price_rounding is not null
      )
      or
      (
        pricing_method = 'by-price'
        and margin_percentage is null
        and price_rounding is null
      )
    )
  );
--> statement-breakpoint
create table catalog_product_snapshot_package_units (
  pharmacy_id uuid not null references pharmacies(id),
  snapshot_id uuid not null,
  name text not null,
  base_units_per_package bigint not null,
  primary key (snapshot_id, name),
  foreign key (snapshot_id, pharmacy_id)
    references catalog_product_snapshots(id, pharmacy_id),
  constraint catalog_product_snapshot_package_units_name_length check (
    char_length(name) between 1 and 40
  ),
  constraint catalog_product_snapshot_package_units_ratio_range check (
    base_units_per_package > 0
  )
);
--> statement-breakpoint
create or replace function prepare_catalog_product_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_product public.catalog_products%rowtype;
  current_inventory_unit_name text;
  current_third_unit_name text;
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

  select unit_row.name into current_inventory_unit_name
  from public.catalog_product_units unit_row
  where unit_row.product_id = current_product.id
    and unit_row.pharmacy_id = new.pharmacy_id
    and unit_row.kind = 'inventory';
  select third_row.name into current_third_unit_name
  from public.catalog_product_third_units third_row
  where third_row.product_id = current_product.id
    and third_row.pharmacy_id = new.pharmacy_id;

  new.product_id := current_product.id;
  new.display_name := current_product.display_name;
  new.name_template_version := current_product.name_template_version;
  new.inventory_unit_name := current_inventory_unit_name;
  new.third_unit_name := current_third_unit_name;
  new.pricing_method := current_product.pricing_method;
  new.retail_price_fils := current_product.retail_price_fils;
  new.wholesale_price_fils := current_product.wholesale_price_fils;
  new.margin_percentage := current_product.margin_percentage;
  new.price_rounding := current_product.price_rounding;
  return new;
end;
$$;
--> statement-breakpoint
create function copy_catalog_product_snapshot_package_units()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.catalog_product_snapshot_package_units (
    pharmacy_id, snapshot_id, name, base_units_per_package
  )
  select new.pharmacy_id, new.id, unit_row.name, unit_row.base_units_per_package
  from public.catalog_product_units unit_row
  where unit_row.product_id = new.product_id
    and unit_row.pharmacy_id = new.pharmacy_id
    and unit_row.kind = 'package';
  return new;
end;
$$;
--> statement-breakpoint
create trigger catalog_product_snapshots_copy_package_units
after insert on catalog_product_snapshots
for each row execute function copy_catalog_product_snapshot_package_units();
--> statement-breakpoint
create trigger catalog_product_snapshot_package_units_immutable
before update or delete on catalog_product_snapshot_package_units
for each row execute function reject_catalog_snapshot_mutation();
--> statement-breakpoint
revoke all on table
  catalog_product_units,
  catalog_product_third_units,
  catalog_product_snapshot_package_units
from public;
--> statement-breakpoint
revoke all on function copy_catalog_product_snapshot_package_units() from public;
--> statement-breakpoint
grant select, insert, update, delete on table
  catalog_product_units,
  catalog_product_third_units
to breev_app;
--> statement-breakpoint
grant select on table catalog_product_snapshot_package_units to breev_app;
