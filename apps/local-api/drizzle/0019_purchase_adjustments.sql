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
    event_type in (
      'pharmacy.settings.changed',
      'purchase.invoice.adjusted',
      'purchase.invoice.posted'
    )
  );
--> statement-breakpoint
alter table accounting_journal_entries
  drop constraint accounting_journal_entries_template_id,
  add constraint accounting_journal_entries_template_id check (
    template_id in ('purchase.adjustment', 'purchase.invoice')
  );
--> statement-breakpoint
alter table inventory_movements
  drop constraint inventory_movements_reason,
  drop constraint inventory_movements_source_document_type,
  drop constraint inventory_movements_receipt_positive,
  drop constraint inventory_movements_carrying_amount_nonnegative,
  add constraint inventory_movements_reason check (
    reason in ('purchase-adjustment', 'purchase-receipt')
  ),
  add constraint inventory_movements_source_document_type check (
    source_document_type in ('purchase-adjustment', 'purchase-invoice')
  ),
  add constraint inventory_movements_receipt_positive check (
    reason <> 'purchase-receipt' or quantity > 0
  ),
  add constraint inventory_movements_carrying_amount_valid check (
    reason <> 'purchase-receipt' or carrying_amount_fils >= 0
  );
--> statement-breakpoint
insert into permission_definitions (name)
values ('purchases.adjustments.manage')
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
  where pharmacy_role.role_key = 'owner'
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
           and other_grant.permission_name not in (
             'catalog.item.search', 'purchases.drafts.manage',
             'purchases.posted.view', 'purchases.costs.view',
             'purchases.adjustments.manage'
           )
       )
     )
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select pharmacy_id, role_id, 'purchases.adjustments.manage', granted_by
  from eligible_roles
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
where pharmacy_row.id in (select distinct pharmacy_id from advanced_roles);
--> statement-breakpoint
create type purchase_adjustment_reason as enum (
  'quantity error',
  'price error',
  'invoice-number error',
  'supplier error',
  'other'
);
--> statement-breakpoint
create type purchase_adjustment_draft_status as enum (
  'active',
  'discarded',
  'posted'
);
--> statement-breakpoint
create table purchase_adjustment_drafts (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  original_purchase_id uuid not null,
  supplier_id uuid not null,
  supplier_name_snapshot text not null,
  supplier_invoice_number text not null,
  invoice_date date not null,
  settlement_context purchase_settlement_context not null,
  allowance_percentage_snapshot numeric(9,6) not null,
  reason purchase_adjustment_reason not null,
  evidence text,
  status purchase_adjustment_draft_status not null default 'active',
  version bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  discarded_at timestamptz,
  discarded_by uuid,
  unique (id, pharmacy_id),
  foreign key (original_purchase_id, pharmacy_id)
    references posted_purchases(id, pharmacy_id),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id),
  foreign key (created_by, pharmacy_id) references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint purchase_adjustment_drafts_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint purchase_adjustment_drafts_supplier_number_length check (
    char_length(supplier_invoice_number) between 1 and 120
  ),
  constraint purchase_adjustment_drafts_supplier_name_length check (
    char_length(supplier_name_snapshot) between 1 and 160
  ),
  constraint purchase_adjustment_drafts_allowance_range check (
    allowance_percentage_snapshot between 0 and 100
  ),
  constraint purchase_adjustment_drafts_evidence_length check (
    evidence is null or char_length(evidence) between 1 and 1000
  ),
  constraint purchase_adjustment_drafts_version_positive check (version > 0),
  constraint purchase_adjustment_drafts_discard_consistent check (
    (status = 'discarded' and discarded_at is not null and discarded_by is not null)
    or (status <> 'discarded' and discarded_at is null and discarded_by is null)
  )
);
--> statement-breakpoint
create table purchase_adjustment_draft_rows (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  draft_id uuid not null,
  lineage_id uuid not null,
  original_row_id uuid,
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
  batch_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  unique (id, pharmacy_id),
  unique (draft_id, lineage_id),
  unique (draft_id, ordinal),
  foreign key (draft_id, pharmacy_id)
    references purchase_adjustment_drafts(id, pharmacy_id),
  foreign key (original_row_id, pharmacy_id)
    references posted_purchase_rows(id, pharmacy_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  foreign key (batch_id, pharmacy_id) references inventory_batches(id, pharmacy_id),
  constraint purchase_adjustment_draft_rows_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint purchase_adjustment_draft_rows_ordinal_positive check (ordinal > 0),
  constraint purchase_adjustment_draft_rows_quantity_positive check (
    base_units_per_entered_unit > 0 and entered_quantity > 0
    and inventory_unit_quantity = base_units_per_entered_unit * entered_quantity
  ),
  constraint purchase_adjustment_draft_rows_money_nonnegative check (
    primary_supplier_cost_fils >= 0 and retail_price_fils >= 0
  ),
  constraint purchase_adjustment_draft_rows_original_batch check (
    (original_row_id is null and batch_id is null)
    or (original_row_id is not null and batch_id is not null)
  )
);
--> statement-breakpoint
create table inventory_value_effects (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  batch_id uuid,
  quantity_delta bigint not null,
  carrying_amount_delta_fils bigint not null,
  source_document_type text not null,
  source_document_id uuid not null,
  source_row_ordinal integer not null,
  occurred_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  unique (id, pharmacy_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  foreign key (batch_id, pharmacy_id) references inventory_batches(id, pharmacy_id),
  foreign key (created_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint inventory_value_effects_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_value_effects_nonempty check (
    quantity_delta <> 0 or carrying_amount_delta_fils <> 0
  ),
  constraint inventory_value_effects_source check (
    source_document_type = 'purchase-adjustment'
  ),
  constraint inventory_value_effects_ordinal_positive check (source_row_ordinal > 0)
);
--> statement-breakpoint
create table posted_purchase_adjustments (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  draft_id uuid not null,
  original_purchase_id uuid not null,
  suffix_value bigint not null,
  supplier_id uuid not null,
  supplier_name_snapshot text not null,
  supplier_invoice_number text not null,
  reason purchase_adjustment_reason not null,
  evidence text,
  quantity_delta bigint not null,
  primary_supplier_cost_delta_fils bigint not null,
  allowance_delta_fils bigint not null,
  cost_after_discount_delta_fils bigint not null,
  header_changes jsonb not null,
  journal_entry_id uuid not null,
  posted_at timestamptz not null default statement_timestamp(),
  posted_by uuid not null,
  unique (id, pharmacy_id),
  unique (draft_id),
  unique (original_purchase_id, suffix_value),
  foreign key (draft_id, pharmacy_id)
    references purchase_adjustment_drafts(id, pharmacy_id),
  foreign key (original_purchase_id, pharmacy_id)
    references posted_purchases(id, pharmacy_id),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id),
  foreign key (journal_entry_id, pharmacy_id)
    references accounting_journal_entries(id, pharmacy_id),
  foreign key (posted_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint posted_purchase_adjustments_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posted_purchase_adjustments_suffix_positive check (suffix_value > 0),
  constraint posted_purchase_adjustments_header_changes_array check (
    jsonb_typeof(header_changes) = 'array'
  )
);
--> statement-breakpoint
create table posted_purchase_adjustment_rows (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  adjustment_id uuid not null,
  lineage_id uuid not null,
  original_row_id uuid,
  ordinal integer not null,
  effect_kind text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  changes jsonb not null,
  quantity_delta bigint not null,
  primary_supplier_cost_delta_fils bigint not null,
  batch_id uuid,
  movement_id uuid,
  value_effect_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  unique (id, pharmacy_id),
  unique (adjustment_id, lineage_id),
  foreign key (adjustment_id, pharmacy_id)
    references posted_purchase_adjustments(id, pharmacy_id),
  foreign key (original_row_id, pharmacy_id)
    references posted_purchase_rows(id, pharmacy_id),
  foreign key (batch_id, pharmacy_id) references inventory_batches(id, pharmacy_id),
  foreign key (movement_id, pharmacy_id) references inventory_movements(id, pharmacy_id),
  foreign key (value_effect_id, pharmacy_id) references inventory_value_effects(id, pharmacy_id),
  constraint posted_purchase_adjustment_rows_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posted_purchase_adjustment_rows_kind check (
    effect_kind in ('added', 'changed', 'removed')
  ),
  constraint posted_purchase_adjustment_rows_snapshots check (
    (effect_kind = 'added' and before_snapshot is null and after_snapshot is not null)
    or (effect_kind = 'removed' and before_snapshot is not null and after_snapshot is null)
    or (effect_kind = 'changed' and before_snapshot is not null and after_snapshot is not null)
  ),
  constraint posted_purchase_adjustment_rows_changes_array check (
    jsonb_typeof(changes) = 'array'
  ),
  constraint posted_purchase_adjustment_rows_effect_nonempty check (
    jsonb_array_length(changes) > 0
    or quantity_delta <> 0
    or primary_supplier_cost_delta_fils <> 0
  ),
  constraint posted_purchase_adjustment_rows_ordinal_positive check (ordinal > 0)
);
--> statement-breakpoint
create function enforce_purchase_adjustment_draft_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Purchase Adjustment Drafts are never deleted' using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Discarded or Posted Purchase Adjustment Drafts are immutable'
      using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.original_purchase_id <> old.original_purchase_id
     or new.created_at <> old.created_at or new.created_by <> old.created_by
     or new.version <> old.version + 1 then
    raise exception 'Invalid Purchase Adjustment Draft version' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function enforce_purchase_adjustment_draft_row_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  parent_status purchase_adjustment_draft_status;
begin
  select status into parent_status
  from public.purchase_adjustment_drafts
  where id = coalesce(new.draft_id, old.draft_id)
    and pharmacy_id = coalesce(new.pharmacy_id, old.pharmacy_id);
  if parent_status <> 'active' then
    raise exception 'Only an active Purchase Adjustment Draft may change rows'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger purchase_adjustment_drafts_guard
before update or delete on purchase_adjustment_drafts
for each row execute function enforce_purchase_adjustment_draft_change();
--> statement-breakpoint
create trigger purchase_adjustment_draft_rows_guard
before insert or update or delete on purchase_adjustment_draft_rows
for each row execute function enforce_purchase_adjustment_draft_row_change();
--> statement-breakpoint
create trigger inventory_value_effects_immutable
before update or delete on inventory_value_effects
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posted_purchase_adjustments_immutable
before update or delete on posted_purchase_adjustments
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posted_purchase_adjustment_rows_immutable
before update or delete on posted_purchase_adjustment_rows
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
revoke all on table
  purchase_adjustment_drafts,
  purchase_adjustment_draft_rows,
  inventory_value_effects,
  posted_purchase_adjustments,
  posted_purchase_adjustment_rows
from public;
--> statement-breakpoint
revoke all on function enforce_purchase_adjustment_draft_change() from public;
--> statement-breakpoint
revoke all on function enforce_purchase_adjustment_draft_row_change() from public;
--> statement-breakpoint
grant select, insert, update on table purchase_adjustment_drafts to breev_app;
--> statement-breakpoint
-- PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE. The
-- immutable trigger from 0017 still rejects every actual mutation.
grant update on table posted_purchases to breev_app;
--> statement-breakpoint
grant update on table inventory_batches to breev_app;
--> statement-breakpoint
grant select, insert, update, delete on table purchase_adjustment_draft_rows to breev_app;
--> statement-breakpoint
grant select, insert on table
  inventory_value_effects,
  posted_purchase_adjustments,
  posted_purchase_adjustment_rows
to breev_app;
