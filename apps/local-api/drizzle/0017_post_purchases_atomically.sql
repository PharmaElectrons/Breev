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
      'purchase.post',
      'supplier.archive',
      'supplier.create',
      'supplier.edit',
      'supplier.merge'
    )
  );
--> statement-breakpoint
alter table posting_outbox_entries
  drop constraint posting_outbox_entries_event_type,
  add constraint posting_outbox_entries_event_type check (
    event_type in ('pharmacy.settings.changed', 'purchase.invoice.posted')
  );
--> statement-breakpoint
alter type purchase_draft_status add value if not exists 'posted';
--> statement-breakpoint
create or replace function enforce_purchase_draft_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Purchase Drafts are never deleted' using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Discarded or Posted Purchase Drafts are immutable' using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.created_at <> old.created_at or new.created_by <> old.created_by
     or new.version <> old.version + 1 then
    raise exception 'Invalid Purchase Draft version' using errcode = '55000';
  end if;
  if new.status in ('discarded', 'posted') and (
    new.supplier_invoice_number <> old.supplier_invoice_number
    or new.supplier_id <> old.supplier_id
    or new.supplier_name_snapshot <> old.supplier_name_snapshot
    or new.settlement_context <> old.settlement_context
    or new.invoice_date <> old.invoice_date
    or new.allowance_percentage_snapshot <> old.allowance_percentage_snapshot
    or new.allowance_basis_fils <> old.allowance_basis_fils
  ) then
    raise exception 'Discard or posting may not rewrite a Purchase Draft' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create type inventory_receipt_class as enum (
  'general-item',
  'general-item-cold-chain',
  'medication',
  'medication-cold-chain'
);
--> statement-breakpoint
create table inventory_receipt_class_rules (
  pharmacy_id uuid not null references pharmacies(id),
  class inventory_receipt_class not null,
  expiry_required boolean not null,
  lot_required boolean not null,
  primary key (pharmacy_id, class)
);
--> statement-breakpoint
create table inventory_batches (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  lot_number text,
  expiry_date date,
  quantity bigint not null,
  status text not null default 'active',
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  unique (id, pharmacy_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  foreign key (created_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint inventory_batches_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_batches_quantity_positive check (quantity > 0),
  constraint inventory_batches_lot_length check (
    lot_number is null or char_length(lot_number) between 1 and 120
  ),
  constraint inventory_batches_status check (status = 'active')
);
--> statement-breakpoint
create index inventory_batches_product_index
  on inventory_batches (pharmacy_id, product_id, created_at);
--> statement-breakpoint
create table inventory_movements (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  batch_id uuid not null,
  reason text not null,
  quantity bigint not null,
  carrying_amount_fils bigint not null,
  source_document_type text not null,
  source_document_id uuid not null,
  source_row_ordinal integer not null,
  occurred_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  unique (id, pharmacy_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  foreign key (batch_id, pharmacy_id) references inventory_batches(id, pharmacy_id),
  foreign key (created_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint inventory_movements_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_movements_reason check (reason in ('purchase-receipt')),
  constraint inventory_movements_source_document_type check (
    source_document_type in ('purchase-invoice')
  ),
  constraint inventory_movements_quantity_nonzero check (quantity <> 0),
  constraint inventory_movements_receipt_positive check (
    reason <> 'purchase-receipt' or quantity > 0
  ),
  constraint inventory_movements_carrying_amount_nonnegative check (
    carrying_amount_fils >= 0
  ),
  constraint inventory_movements_ordinal_positive check (source_row_ordinal > 0)
);
--> statement-breakpoint
create index inventory_movements_batch_index
  on inventory_movements (pharmacy_id, batch_id, occurred_at);
--> statement-breakpoint
create index inventory_movements_product_index
  on inventory_movements (pharmacy_id, product_id, occurred_at);
--> statement-breakpoint
create table inventory_valuation_state (
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  total_quantity bigint not null default 0,
  total_value_scaled numeric not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (pharmacy_id, product_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  constraint inventory_valuation_state_quantity_nonnegative check (total_quantity >= 0),
  constraint inventory_valuation_state_value_nonnegative check (total_value_scaled >= 0)
);
--> statement-breakpoint
create table accounting_journal_entries (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  template_id text not null,
  template_version integer not null,
  posted_at timestamptz not null default statement_timestamp(),
  posted_by uuid not null,
  unique (id, pharmacy_id),
  foreign key (posted_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint accounting_journal_entries_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint accounting_journal_entries_template_id check (
    template_id in ('purchase.invoice')
  ),
  constraint accounting_journal_entries_template_version check (template_version > 0)
);
--> statement-breakpoint
create table accounting_journal_lines (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  entry_id uuid not null,
  ordinal integer not null,
  account_code text not null,
  supplier_id uuid,
  debit_fils bigint not null default 0,
  credit_fils bigint not null default 0,
  unique (id, pharmacy_id),
  unique (entry_id, ordinal),
  foreign key (entry_id, pharmacy_id) references accounting_journal_entries(id, pharmacy_id),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id),
  constraint accounting_journal_lines_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint accounting_journal_lines_account_code check (
    account_code in ('cash', 'inventory', 'supplier-payable')
  ),
  constraint accounting_journal_lines_ordinal_positive check (ordinal > 0),
  constraint accounting_journal_lines_amounts_nonnegative check (
    debit_fils >= 0 and credit_fils >= 0
  ),
  constraint accounting_journal_lines_one_side check (
    debit_fils = 0 or credit_fils = 0
  ),
  constraint accounting_journal_lines_supplier_scope check (
    (account_code = 'supplier-payable') = (supplier_id is not null)
  )
);
--> statement-breakpoint
create function enforce_accounting_journal_balance()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  total_debit bigint;
  total_credit bigint;
begin
  select coalesce(sum(debit_fils), 0), coalesce(sum(credit_fils), 0)
    into total_debit, total_credit
  from public.accounting_journal_lines
  where entry_id = new.entry_id;
  if total_debit <> total_credit then
    raise exception 'An accounting journal entry must balance debits and credits'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create constraint trigger accounting_journal_lines_balanced
after insert on accounting_journal_lines
deferrable initially deferred
for each row execute function enforce_accounting_journal_balance();
--> statement-breakpoint
create table accounting_supplier_balances (
  pharmacy_id uuid not null references pharmacies(id),
  supplier_id uuid not null,
  balance_fils bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (pharmacy_id, supplier_id),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id)
);
--> statement-breakpoint
create table accounting_cash_box_balances (
  pharmacy_id uuid primary key references pharmacies(id),
  balance_fils bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp()
);
--> statement-breakpoint
create table posted_purchases (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  draft_id uuid not null,
  supplier_id uuid not null,
  supplier_name_snapshot text not null,
  supplier_invoice_number text not null,
  invoice_date date not null,
  settlement_context purchase_settlement_context not null,
  allowance_percentage_snapshot numeric(9,6) not null,
  allowance_basis_fils bigint not null,
  allowance_fils bigint not null,
  cost_after_discount_fils bigint not null,
  primary_supplier_cost_fils bigint not null,
  number_value bigint not null,
  number_year integer not null,
  journal_entry_id uuid not null,
  posted_at timestamptz not null default statement_timestamp(),
  posted_by uuid not null,
  unique (id, pharmacy_id),
  unique (draft_id),
  unique (pharmacy_id, number_year, number_value),
  foreign key (draft_id, pharmacy_id) references purchase_drafts(id, pharmacy_id),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id),
  foreign key (journal_entry_id, pharmacy_id) references accounting_journal_entries(id, pharmacy_id),
  foreign key (posted_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint posted_purchases_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posted_purchases_invoice_number_length check (
    char_length(supplier_invoice_number) between 1 and 120
  ),
  constraint posted_purchases_supplier_name_length check (
    char_length(supplier_name_snapshot) between 1 and 160
  ),
  constraint posted_purchases_allowance_range check (
    allowance_percentage_snapshot between 0 and 100
  ),
  constraint posted_purchases_money_nonnegative check (
    allowance_basis_fils >= 0 and allowance_fils >= 0
    and cost_after_discount_fils >= 0 and primary_supplier_cost_fils >= 0
  ),
  constraint posted_purchases_money_consistent check (
    cost_after_discount_fils + allowance_fils = primary_supplier_cost_fils
    and allowance_basis_fils = primary_supplier_cost_fils
  ),
  constraint posted_purchases_number_value_positive check (number_value > 0),
  constraint posted_purchases_number_year_range check (number_year between 1970 and 9999)
);
--> statement-breakpoint
create table posted_purchase_rows (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  posted_purchase_id uuid not null,
  draft_row_id uuid not null,
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
  line_primary_supplier_cost_fils bigint not null,
  cost_after_discount_fils bigint not null,
  pricing_method catalog_pricing_method not null,
  retail_price_fils bigint not null,
  margin_percentage numeric(9,6),
  price_capture text not null,
  expiry_date date,
  lot_number text,
  notes text,
  batch_id uuid not null,
  movement_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (id, pharmacy_id),
  unique (posted_purchase_id, ordinal),
  foreign key (posted_purchase_id, pharmacy_id) references posted_purchases(id, pharmacy_id),
  foreign key (draft_row_id, pharmacy_id) references purchase_draft_rows(id, pharmacy_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  foreign key (batch_id, pharmacy_id) references inventory_batches(id, pharmacy_id),
  foreign key (movement_id, pharmacy_id) references inventory_movements(id, pharmacy_id),
  constraint posted_purchase_rows_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posted_purchase_rows_ordinal_positive check (ordinal > 0),
  constraint posted_purchase_rows_item_name_length check (
    char_length(item_display_name) between 1 and 726
  ),
  constraint posted_purchase_rows_inventory_unit_name_length check (
    char_length(inventory_unit_name) between 1 and 40
  ),
  constraint posted_purchase_rows_entered_unit_state check (
    (entered_unit_kind = 'inventory-unit' and entered_package_unit_name is null)
    or
    (entered_unit_kind = 'package-unit'
      and char_length(entered_package_unit_name) between 1 and 40)
  ),
  constraint posted_purchase_rows_quantity_positive check (
    base_units_per_entered_unit > 0
    and entered_quantity > 0
    and inventory_unit_quantity > 0
    and inventory_unit_quantity = base_units_per_entered_unit * entered_quantity
  ),
  constraint posted_purchase_rows_money_nonnegative check (
    primary_supplier_cost_fils >= 0 and retail_price_fils >= 0
    and line_primary_supplier_cost_fils >= 0 and cost_after_discount_fils >= 0
  ),
  constraint posted_purchase_rows_money_consistent check (
    line_primary_supplier_cost_fils = primary_supplier_cost_fils * entered_quantity
  ),
  constraint posted_purchase_rows_pricing_state check (
    (pricing_method = 'by-price' and margin_percentage is null)
    or
    (pricing_method = 'by-percentage'
      and margin_percentage is not null
      and margin_percentage >= 0 and margin_percentage < 100)
  ),
  constraint posted_purchase_rows_price_capture check (
    price_capture in ('by-percentage-calculated', 'by-price-propagated')
  ),
  constraint posted_purchase_rows_price_capture_method check (
    (price_capture = 'by-percentage-calculated' and pricing_method = 'by-percentage')
    or
    (price_capture = 'by-price-propagated' and pricing_method = 'by-price')
  ),
  constraint posted_purchase_rows_lot_length check (
    lot_number is null or char_length(lot_number) between 1 and 120
  ),
  constraint posted_purchase_rows_notes_length check (
    notes is null or char_length(notes) between 1 and 1000
  )
);
--> statement-breakpoint
create index posted_purchase_rows_product_index
  on posted_purchase_rows (pharmacy_id, product_id, created_at);
--> statement-breakpoint
create trigger inventory_batches_immutable
before update or delete on inventory_batches
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger inventory_movements_immutable
before update or delete on inventory_movements
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger accounting_journal_entries_immutable
before update or delete on accounting_journal_entries
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger accounting_journal_lines_immutable
before update or delete on accounting_journal_lines
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posted_purchases_immutable
before update or delete on posted_purchases
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posted_purchase_rows_immutable
before update or delete on posted_purchase_rows
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
revoke all on table
  inventory_receipt_class_rules,
  inventory_batches,
  inventory_movements,
  inventory_valuation_state,
  accounting_journal_entries,
  accounting_journal_lines,
  accounting_supplier_balances,
  accounting_cash_box_balances,
  posted_purchases,
  posted_purchase_rows
from public;
--> statement-breakpoint
revoke all on function enforce_accounting_journal_balance() from public;
--> statement-breakpoint
grant select, insert on table
  inventory_receipt_class_rules,
  inventory_batches,
  inventory_movements,
  accounting_journal_entries,
  accounting_journal_lines,
  posted_purchases,
  posted_purchase_rows
to breev_app;
--> statement-breakpoint
grant select, insert, update on table
  inventory_valuation_state,
  accounting_supplier_balances,
  accounting_cash_box_balances
to breev_app;
