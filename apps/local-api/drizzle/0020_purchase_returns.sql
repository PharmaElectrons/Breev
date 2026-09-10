alter table posting_command_results
  drop constraint posting_command_results_name,
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add', 'catalog.barcode.print', 'catalog.barcode.suggest',
      'catalog.matching.approve', 'catalog.matching.open',
      'catalog.product.archive', 'catalog.product.create',
      'catalog.product.edit', 'catalog.product.merge',
      'pharmacy.settings.update',
      'purchase.adjustment-draft.create',
      'purchase.adjustment-draft.discard',
      'purchase.adjustment-draft.update', 'purchase.adjustment.post',
      'purchase.draft.create', 'purchase.draft.discard',
      'purchase.draft.row.commit', 'purchase.draft.update',
      'purchase.entry-preferences.update', 'purchase.post',
      'purchase.return-draft.create', 'purchase.return-draft.discard',
      'purchase.return-draft.update', 'purchase.return.post',
      'supplier.archive', 'supplier.create', 'supplier.edit', 'supplier.merge'
    )
  );
--> statement-breakpoint
alter table posting_outbox_entries
  drop constraint posting_outbox_entries_event_type,
  add constraint posting_outbox_entries_event_type check (
    event_type in (
      'pharmacy.settings.changed', 'purchase.invoice.adjusted',
      'purchase.invoice.posted', 'purchase.return.posted'
    )
  );
--> statement-breakpoint
alter table accounting_journal_entries
  drop constraint accounting_journal_entries_template_id,
  add constraint accounting_journal_entries_template_id check (
    template_id in ('purchase.adjustment', 'purchase.invoice', 'purchase.return')
  );
--> statement-breakpoint
alter table inventory_movements
  add column supplier_reduction_fils bigint,
  drop constraint inventory_movements_reason,
  drop constraint inventory_movements_source_document_type,
  drop constraint inventory_movements_receipt_positive,
  drop constraint inventory_movements_carrying_amount_valid,
  add constraint inventory_movements_reason check (
    reason in ('purchase-adjustment', 'purchase-receipt', 'purchase-return')
  ),
  add constraint inventory_movements_source_document_type check (
    source_document_type in (
      'purchase-adjustment', 'purchase-invoice', 'purchase-return'
    )
  ),
  add constraint inventory_movements_receipt_positive check (
    reason <> 'purchase-receipt' or quantity > 0
  ),
  add constraint inventory_movements_carrying_amount_valid check (
    reason <> 'purchase-receipt' or carrying_amount_fils >= 0
  ),
  add constraint inventory_movements_return_negative check (
    reason <> 'purchase-return'
    or (quantity < 0 and carrying_amount_fils <= 0
        and supplier_reduction_fils <= 0)
  ),
  add constraint inventory_movements_supplier_value_scope check (
    (reason = 'purchase-return' and supplier_reduction_fils is not null)
    or (reason <> 'purchase-return' and supplier_reduction_fils is null)
  );
--> statement-breakpoint
insert into permission_definitions (name)
values ('purchases.returns.manage') on conflict (name) do nothing;
--> statement-breakpoint
insert into step_up_action_definitions (name, required_permission)
values ('purchase.return.post', 'purchases.returns.manage')
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
      and identity_user.status = 'active' and owner_role.role_key = 'owner'
    order by identity_user.created_at, identity_user.id limit 1
  ) owner_user on true
  where pharmacy_role.role_key = 'owner'
     or (
       pharmacy_role.role_key = 'purchasing_employee'
       and exists (
         select 1 from role_permission_grants current_grant
         where current_grant.role_id = pharmacy_role.id
           and current_grant.permission_name = 'purchases.adjustments.manage'
       )
       and exists (
         select 1 from role_permission_grants current_grant
         where current_grant.role_id = pharmacy_role.id
           and current_grant.permission_name = 'purchases.costs.view'
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
       and not exists (
         select 1 from role_permission_grants other_grant
         where other_grant.role_id = pharmacy_role.id
           and other_grant.permission_name not in (
             'catalog.item.search', 'purchases.adjustments.manage',
             'purchases.costs.view', 'purchases.drafts.manage',
             'purchases.posted.view', 'purchases.returns.manage'
           )
       )
     )
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select pharmacy_id, role_id, 'purchases.returns.manage', granted_by
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
create type purchase_return_draft_status as enum ('active', 'discarded', 'posted');
--> statement-breakpoint
create table purchase_return_drafts (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  original_purchase_id uuid not null,
  reason text not null,
  evidence text not null,
  status purchase_return_draft_status not null default 'active',
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
  foreign key (created_by, pharmacy_id) references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint purchase_return_drafts_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint purchase_return_drafts_reason_length check (
    char_length(reason) between 1 and 500
  ),
  constraint purchase_return_drafts_evidence_length check (
    char_length(evidence) between 1 and 1000
  ),
  constraint purchase_return_drafts_version_positive check (version > 0),
  constraint purchase_return_drafts_discard_consistent check (
    (status = 'discarded' and discarded_at is not null and discarded_by is not null)
    or (status <> 'discarded' and discarded_at is null and discarded_by is null)
  )
);
--> statement-breakpoint
create table purchase_return_draft_rows (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  draft_id uuid not null,
  original_purchase_row_id uuid not null,
  return_quantity bigint not null default 0,
  unique (id, pharmacy_id),
  unique (draft_id, original_purchase_row_id),
  foreign key (draft_id, pharmacy_id)
    references purchase_return_drafts(id, pharmacy_id),
  foreign key (original_purchase_row_id, pharmacy_id)
    references posted_purchase_rows(id, pharmacy_id),
  constraint purchase_return_draft_rows_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint purchase_return_draft_rows_quantity_nonnegative check (
    return_quantity >= 0
  )
);
--> statement-breakpoint
create table posted_purchase_returns (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  draft_id uuid not null,
  original_purchase_id uuid not null,
  original_number_value bigint not null,
  original_number_year integer not null,
  original_invoice_date date not null,
  supplier_id uuid not null,
  supplier_name_snapshot text not null,
  number_value bigint not null,
  number_year integer not null,
  reason text not null,
  evidence text not null,
  inventory_carrying_amount_fils bigint not null,
  supplier_reduction_fils bigint not null,
  difference_treatment text not null,
  journal_entry_id uuid not null,
  approval_challenge_id uuid not null references step_up_challenges(id),
  device_id text not null,
  posted_at timestamptz not null default statement_timestamp(),
  posted_by uuid not null,
  unique (id, pharmacy_id), unique (draft_id),
  unique (pharmacy_id, number_year, number_value),
  foreign key (draft_id, pharmacy_id)
    references purchase_return_drafts(id, pharmacy_id),
  foreign key (original_purchase_id, pharmacy_id)
    references posted_purchases(id, pharmacy_id),
  foreign key (supplier_id, pharmacy_id) references suppliers(id, pharmacy_id),
  foreign key (journal_entry_id, pharmacy_id)
    references accounting_journal_entries(id, pharmacy_id),
  foreign key (posted_by, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint posted_purchase_returns_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posted_purchase_returns_number_positive check (
    number_value > 0 and number_year between 1970 and 9999
  ),
  constraint posted_purchase_returns_values_nonnegative check (
    inventory_carrying_amount_fils >= 0 and supplier_reduction_fils >= 0
  ),
  constraint posted_purchase_returns_treatment check (
    difference_treatment = 'inventory-account-offset-pending-g01'
  )
);
--> statement-breakpoint
create table posted_purchase_return_rows (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  purchase_return_id uuid not null,
  original_purchase_row_id uuid not null,
  ordinal integer not null,
  product_id uuid not null,
  batch_id uuid not null,
  item_display_name text not null,
  inventory_unit_name text not null,
  quantity bigint not null,
  carrying_amount_per_unit_scaled numeric not null,
  carrying_amount_fils bigint not null,
  supplier_reduction_fils bigint not null,
  valuation_method text not null,
  movement_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (id, pharmacy_id),
  unique (purchase_return_id, original_purchase_row_id),
  foreign key (purchase_return_id, pharmacy_id)
    references posted_purchase_returns(id, pharmacy_id),
  foreign key (original_purchase_row_id, pharmacy_id)
    references posted_purchase_rows(id, pharmacy_id),
  foreign key (product_id, pharmacy_id) references catalog_products(id, pharmacy_id),
  foreign key (batch_id, pharmacy_id) references inventory_batches(id, pharmacy_id),
  foreign key (movement_id, pharmacy_id) references inventory_movements(id, pharmacy_id),
  constraint posted_purchase_return_rows_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posted_purchase_return_rows_values_positive check (
    ordinal > 0 and quantity > 0 and carrying_amount_per_unit_scaled >= 0
    and carrying_amount_fils >= 0 and supplier_reduction_fils >= 0
  ),
  constraint posted_purchase_return_rows_valuation_method check (
    valuation_method = 'weighted-average-cost'
  )
);
--> statement-breakpoint
create function enforce_purchase_return_draft_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Purchase Return Drafts are never deleted' using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Discarded or Posted Purchase Return Drafts are immutable'
      using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.original_purchase_id <> old.original_purchase_id
     or new.created_at <> old.created_at or new.created_by <> old.created_by
     or new.version <> old.version + 1 then
    raise exception 'Invalid Purchase Return Draft version' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function enforce_purchase_return_draft_row_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare parent_status purchase_return_draft_status;
begin
  select status into parent_status from public.purchase_return_drafts
  where id = coalesce(new.draft_id, old.draft_id)
    and pharmacy_id = coalesce(new.pharmacy_id, old.pharmacy_id);
  if parent_status <> 'active' then
    raise exception 'Only an active Purchase Return Draft may change rows'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger purchase_return_drafts_guard
before update or delete on purchase_return_drafts
for each row execute function enforce_purchase_return_draft_change();
--> statement-breakpoint
create trigger purchase_return_draft_rows_guard
before insert or update or delete on purchase_return_draft_rows
for each row execute function enforce_purchase_return_draft_row_change();
--> statement-breakpoint
create trigger posted_purchase_returns_immutable
before update or delete on posted_purchase_returns
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posted_purchase_return_rows_immutable
before update or delete on posted_purchase_return_rows
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
revoke all on table purchase_return_drafts, purchase_return_draft_rows,
  posted_purchase_returns, posted_purchase_return_rows from public;
--> statement-breakpoint
revoke all on function enforce_purchase_return_draft_change() from public;
--> statement-breakpoint
revoke all on function enforce_purchase_return_draft_row_change() from public;
--> statement-breakpoint
grant select, insert, update on table purchase_return_drafts to breev_app;
--> statement-breakpoint
grant select, insert, update on table purchase_return_draft_rows to breev_app;
--> statement-breakpoint
grant select, insert on table posted_purchase_returns,
  posted_purchase_return_rows to breev_app;
