insert into permission_definitions (name)
values ('catalog.item.search')
on conflict (name) do nothing;
--> statement-breakpoint
with inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select pharmacy_role.pharmacy_id,
         pharmacy_role.id,
         'catalog.item.search',
         owner_user.id
  from pharmacy_roles pharmacy_role
  join lateral (
    select identity_user.id
    from pharmacy_roles owner_role
    join identity_users identity_user
      on identity_user.role_id = owner_role.id
     and identity_user.pharmacy_id = owner_role.pharmacy_id
    where owner_role.pharmacy_id = pharmacy_role.pharmacy_id
      and owner_role.role_key = 'owner'
      and identity_user.status = 'active'
    order by identity_user.created_at, identity_user.id
    limit 1
  ) owner_user on true
  where pharmacy_role.role_key in (
    'owner', 'manager', 'pharmacist', 'sales_employee',
    'purchasing_employee', 'inventory_employee'
  )
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
      'catalog.barcode.add',
      'catalog.barcode.print',
      'catalog.barcode.suggest',
      'catalog.matching.approve',
      'catalog.matching.open',
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
create type catalog_barcode_kind as enum ('package', 'product');
--> statement-breakpoint
create type catalog_barcode_source as enum ('breev-internal', 'provided');
--> statement-breakpoint
alter table catalog_product_barcodes
  add column kind catalog_barcode_kind not null default 'product',
  add column source catalog_barcode_source not null default 'provided';
--> statement-breakpoint
alter table catalog_product_barcodes
  alter column kind drop default,
  alter column source drop default;
--> statement-breakpoint
alter table pharmacies
  add column business_time_zone text not null default 'Asia/Baghdad',
  add constraint pharmacies_business_time_zone_length check (
    char_length(business_time_zone) between 1 and 64
  );
--> statement-breakpoint
create table catalog_internal_barcode_sequences (
  pharmacy_id uuid primary key references pharmacies(id),
  next_value bigint not null default 1,
  constraint catalog_internal_barcode_sequences_next_positive check (
    next_value > 0
  )
);
--> statement-breakpoint
create table catalog_matching_batches (
  pharmacy_id uuid not null references pharmacies(id),
  business_date date not null,
  opened_at timestamptz not null default statement_timestamp(),
  opened_by uuid not null,
  primary key (pharmacy_id, business_date),
  foreign key (opened_by, pharmacy_id)
    references identity_users(id, pharmacy_id)
);
--> statement-breakpoint
create table catalog_matching_suggestions (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  product_id uuid not null,
  proposed_barcode text not null,
  first_offered_business_date date not null,
  approved_at timestamptz,
  approved_by uuid,
  unique (id, pharmacy_id),
  unique (pharmacy_id, product_id),
  unique (pharmacy_id, proposed_barcode),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (pharmacy_id, first_offered_business_date)
    references catalog_matching_batches(pharmacy_id, business_date),
  foreign key (approved_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint catalog_matching_suggestions_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint catalog_matching_suggestions_barcode check (
    proposed_barcode ~ '^BRV-[0-9]{12}$'
  ),
  constraint catalog_matching_suggestions_approval_consistent check (
    (approved_at is null) = (approved_by is null)
  )
);
--> statement-breakpoint
revoke all on table
  catalog_internal_barcode_sequences,
  catalog_matching_batches,
  catalog_matching_suggestions
from public;
--> statement-breakpoint
grant select, insert, update on table
  catalog_internal_barcode_sequences,
  catalog_matching_batches,
  catalog_matching_suggestions
to breev_app;
