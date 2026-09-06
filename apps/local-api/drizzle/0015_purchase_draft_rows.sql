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
      'purchase.draft.row.commit',
      'purchase.draft.update',
      'purchase.entry-preferences.update',
      'supplier.archive',
      'supplier.create',
      'supplier.edit',
      'supplier.merge'
    )
  );
--> statement-breakpoint
create type purchase_entered_unit_kind as enum ('inventory-unit', 'package-unit');
--> statement-breakpoint
create type purchase_after_commit as enum ('new-row', 'return-to-item');
--> statement-breakpoint
create table purchase_draft_rows (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  draft_id uuid not null,
  ordinal integer not null,
  product_id uuid not null,
  item_display_name text not null,
  inventory_unit_name text not null,
  entered_unit_kind purchase_entered_unit_kind not null,
  entered_package_unit_name text,
  base_units_per_entered_unit bigint not null,
  entered_quantity bigint not null,
  inventory_unit_quantity bigint not null,
  primary_supplier_cost_fils bigint not null,
  pricing_method catalog_pricing_method not null,
  retail_price_fils bigint not null,
  margin_percentage numeric(9,6),
  expiry_date date,
  lot_number text,
  notes text,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  unique (id, pharmacy_id),
  unique (draft_id, ordinal),
  foreign key (draft_id, pharmacy_id)
    references purchase_drafts(id, pharmacy_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (created_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint purchase_draft_rows_ordinal_positive check (ordinal > 0),
  constraint purchase_draft_rows_item_name_length check (
    char_length(item_display_name) between 1 and 726
  ),
  constraint purchase_draft_rows_inventory_unit_name_length check (
    char_length(inventory_unit_name) between 1 and 40
  ),
  constraint purchase_draft_rows_entered_unit_state check (
    (entered_unit_kind = 'inventory-unit' and entered_package_unit_name is null)
    or
    (entered_unit_kind = 'package-unit'
      and char_length(entered_package_unit_name) between 1 and 40)
  ),
  constraint purchase_draft_rows_quantity_positive check (
    base_units_per_entered_unit > 0
    and entered_quantity > 0
    and inventory_unit_quantity > 0
    and inventory_unit_quantity = base_units_per_entered_unit * entered_quantity
  ),
  constraint purchase_draft_rows_money_nonnegative check (
    primary_supplier_cost_fils >= 0 and retail_price_fils >= 0
  ),
  constraint purchase_draft_rows_pricing_state check (
    (pricing_method = 'by-price' and margin_percentage is null)
    or
    (pricing_method = 'by-percentage'
      and margin_percentage is not null
      and margin_percentage >= 0 and margin_percentage < 100)
  ),
  constraint purchase_draft_rows_lot_length check (
    lot_number is null or char_length(lot_number) between 1 and 120
  ),
  constraint purchase_draft_rows_notes_length check (
    notes is null or char_length(notes) between 1 and 1000
  )
);
--> statement-breakpoint
create index purchase_draft_rows_draft_index
  on purchase_draft_rows (pharmacy_id, draft_id, ordinal);
--> statement-breakpoint
create table purchase_entry_preferences (
  pharmacy_id uuid not null references pharmacies(id),
  user_id uuid not null,
  columns jsonb not null default
    '[{"field":"item","visible":true},{"field":"quantity","visible":true},{"field":"cost","visible":true},{"field":"selling-price","visible":true},{"field":"expiry","visible":true}]'::jsonb,
  after_commit purchase_after_commit not null default 'new-row',
  details_panel_fields jsonb not null default
    '["scientific-name","category","packaging","wholesale-price"]'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  primary key (pharmacy_id, user_id),
  foreign key (user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint purchase_entry_preferences_revision_positive check (revision > 0),
  constraint purchase_entry_preferences_columns_array check (
    jsonb_typeof(columns) = 'array'
  ),
  constraint purchase_entry_preferences_panel_array check (
    jsonb_typeof(details_panel_fields) = 'array'
  )
);
--> statement-breakpoint
create function reject_purchase_draft_row_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Committed Purchase Draft rows are append-only'
    using errcode = '55000';
end;
$$;
--> statement-breakpoint
create function enforce_purchase_entry_preferences_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Purchase entry preferences are never deleted'
      using errcode = '55000';
  end if;
  if new.pharmacy_id <> old.pharmacy_id or new.user_id <> old.user_id
     or new.revision <> old.revision + 1 then
    raise exception 'Invalid Purchase entry preference revision'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger purchase_draft_rows_immutable
before update or delete on purchase_draft_rows
for each row execute function reject_purchase_draft_row_mutation();
--> statement-breakpoint
create trigger purchase_entry_preferences_change_guard
before update or delete on purchase_entry_preferences
for each row execute function enforce_purchase_entry_preferences_change();
--> statement-breakpoint
revoke all on table purchase_draft_rows, purchase_entry_preferences from public;
--> statement-breakpoint
revoke all on function reject_purchase_draft_row_mutation() from public;
--> statement-breakpoint
revoke all on function enforce_purchase_entry_preferences_change() from public;
--> statement-breakpoint
grant select, insert on table purchase_draft_rows to breev_app;
--> statement-breakpoint
grant select, insert, update on table purchase_entry_preferences to breev_app;
