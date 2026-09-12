alter table inventory_movements
  drop constraint inventory_movements_reason,
  drop constraint inventory_movements_source_document_type,
  add constraint inventory_movements_reason check (
    reason in (
      'purchase-adjustment', 'purchase-receipt', 'purchase-return',
      'count-variance'
    )
  ),
  add constraint inventory_movements_source_document_type check (
    source_document_type in (
      'purchase-adjustment', 'purchase-invoice', 'purchase-return',
      'count-session'
    )
  ),
  add constraint inventory_movements_count_sign check (
    reason <> 'count-variance'
    or sign(quantity) = sign(carrying_amount_fils)
    or carrying_amount_fils = 0
  );
--> statement-breakpoint
create type inventory_count_session_status as enum ('active', 'completed');
--> statement-breakpoint
create table inventory_count_sessions (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  status inventory_count_session_status not null default 'active',
  version bigint not null default 1,
  number_value bigint,
  number_year integer,
  started_at timestamptz not null default statement_timestamp(),
  started_by uuid not null,
  device_id uuid not null,
  completed_at timestamptz,
  completed_by uuid,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null,
  unique (id, pharmacy_id),
  foreign key (started_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (completed_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (updated_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint inventory_count_sessions_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_count_sessions_version_positive check (version > 0),
  constraint inventory_count_sessions_status_completion check (
    status = 'active' or completed_at is not null
  ),
  constraint inventory_count_sessions_number_pair check (
    (number_value is null) = (number_year is null)
  )
);
--> statement-breakpoint
create index inventory_count_sessions_active_index
  on inventory_count_sessions (pharmacy_id, updated_at desc, id)
  where status = 'active';
--> statement-breakpoint
create function enforce_inventory_count_session_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Inventory Count Sessions are never deleted'
      using errcode = '55000';
  end if;
  if old.status <> 'active' then
    raise exception 'Completed Inventory Count Sessions are immutable'
      using errcode = '55000';
  end if;
  if new.id <> old.id or new.pharmacy_id <> old.pharmacy_id
     or new.started_at <> old.started_at or new.started_by <> old.started_by
     or new.device_id <> old.device_id
     or new.version <> old.version + 1 then
    raise exception 'Invalid Inventory Count Session version'
      using errcode = '55000';
  end if;
  if old.number_value is not null and (
    new.number_value is distinct from old.number_value
    or new.number_year is distinct from old.number_year
  ) then
    raise exception 'An Inventory Count Session number cannot change'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger inventory_count_sessions_change_guard
before update or delete on inventory_count_sessions
for each row execute function enforce_inventory_count_session_change();
--> statement-breakpoint
revoke all on table inventory_count_sessions from public;
--> statement-breakpoint
revoke all on function enforce_inventory_count_session_change() from public;
--> statement-breakpoint
grant select, insert, update on table inventory_count_sessions to breev_app;
--> statement-breakpoint
create table inventory_count_lines (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  session_id uuid not null,
  ordinal integer not null,
  product_id uuid not null,
  item_display_name text not null,
  inventory_unit_name text not null,
  entries jsonb not null,
  entered_label text not null,
  counted_quantity bigint not null,
  balance_at_observation bigint not null,
  variance_at_observation bigint not null,
  blocked_quantity_at_observation bigint not null,
  observed_at timestamptz not null default statement_timestamp(),
  observed_by uuid not null,
  device_id uuid not null,
  unique (id, pharmacy_id),
  unique (pharmacy_id, session_id, ordinal),
  foreign key (session_id, pharmacy_id)
    references inventory_count_sessions(id, pharmacy_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (observed_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint inventory_count_lines_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_count_lines_ordinal_positive check (ordinal > 0),
  constraint inventory_count_lines_item_name_length check (
    char_length(item_display_name) between 1 and 726
  ),
  constraint inventory_count_lines_inventory_unit_name_length check (
    char_length(inventory_unit_name) between 1 and 40
  ),
  constraint inventory_count_lines_count_nonnegative check (
    counted_quantity >= 0
  ),
  constraint inventory_count_lines_variance_consistent check (
    variance_at_observation = counted_quantity - balance_at_observation
  ),
  constraint inventory_count_lines_blocked_nonnegative check (
    blocked_quantity_at_observation >= 0
  )
);
--> statement-breakpoint
create function enforce_inventory_count_line_parent_active()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare parent_status inventory_count_session_status;
begin
  select status into parent_status
  from public.inventory_count_sessions
  where id = new.session_id and pharmacy_id = new.pharmacy_id;
  if parent_status is distinct from 'active' then
    raise exception 'Only an active Inventory Count Session may receive lines'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger inventory_count_lines_immutable
before update or delete on inventory_count_lines
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger inventory_count_lines_parent_guard
before insert on inventory_count_lines
for each row execute function enforce_inventory_count_line_parent_active();
--> statement-breakpoint
revoke all on table inventory_count_lines from public;
--> statement-breakpoint
revoke all on function enforce_inventory_count_line_parent_active() from public;
--> statement-breakpoint
grant select, insert on table inventory_count_lines to breev_app;
--> statement-breakpoint
create table inventory_count_variance_applications (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null,
  session_id uuid not null,
  line_id uuid not null unique,
  product_id uuid not null,
  balance_before bigint not null,
  counted_quantity bigint not null,
  variance bigint not null,
  carrying_amount_fils bigint not null,
  average_unit_cost_scaled numeric not null,
  valuation_method text not null,
  treatment text not null,
  reason text not null,
  evidence text not null,
  journal_entry_id uuid not null,
  applied_at timestamptz not null default statement_timestamp(),
  applied_by uuid not null,
  device_id uuid not null,
  unique (id, pharmacy_id),
  foreign key (session_id, pharmacy_id)
    references inventory_count_sessions(id, pharmacy_id),
  foreign key (line_id, pharmacy_id)
    references inventory_count_lines(id, pharmacy_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (journal_entry_id, pharmacy_id)
    references accounting_journal_entries(id, pharmacy_id),
  foreign key (applied_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint inventory_count_variance_applications_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_count_variance_applications_variance check (
    variance <> 0 and variance = counted_quantity - balance_before
  ),
  constraint inventory_count_variance_applications_value_sign check (
    carrying_amount_fils = 0 or sign(carrying_amount_fils) = sign(variance)
  ),
  constraint inventory_count_variance_applications_valuation_method check (
    valuation_method = 'weighted-average-cost'
  ),
  constraint inventory_count_variance_applications_treatment check (
    treatment = 'count-variance-account-pending-g01'
  ),
  constraint inventory_count_variance_applications_reason_length check (
    char_length(reason) between 1 and 500
  ),
  constraint inventory_count_variance_applications_evidence_length check (
    char_length(evidence) between 1 and 1000
  )
);
--> statement-breakpoint
create trigger inventory_count_variance_applications_immutable
before update or delete on inventory_count_variance_applications
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
revoke all on table inventory_count_variance_applications from public;
--> statement-breakpoint
grant select, insert on table inventory_count_variance_applications to breev_app;
--> statement-breakpoint
insert into permission_definitions (name)
values ('inventory.counts.approve'), ('inventory.counts.record')
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
    'owner', 'manager', 'pharmacist', 'inventory_employee'
  )
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select eligible_role.pharmacy_id,
         eligible_role.role_id,
         permission_name.name,
         eligible_role.granted_by
  from eligible_roles eligible_role
  cross join (values ('inventory.counts.approve'::text),
                     ('inventory.counts.record'::text)) permission_name(name)
  where (permission_name.name = 'inventory.counts.approve'
         and eligible_role.role_id in (
           select id from pharmacy_roles
           where pharmacy_id = eligible_role.pharmacy_id
             and role_key in ('owner', 'manager')
         ))
     or (permission_name.name = 'inventory.counts.record'
         and eligible_role.role_id in (
           select id from pharmacy_roles
           where pharmacy_id = eligible_role.pharmacy_id
             and role_key in (
               'owner', 'manager', 'pharmacist', 'inventory_employee'
             )
         ))
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
      'inventory.review-preferences.update', 'inventory.sensitive-export',
      'pharmacy.settings.update',
      'purchase.adjustment-draft.create', 'purchase.adjustment-draft.discard',
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
      'purchase.invoice.posted', 'purchase.return.posted',
      'inventory.batch.status-changed', 'inventory.batch.expiry-corrected',
      'inventory.count.variance-applied'
    )
  );
--> statement-breakpoint
alter table accounting_journal_entries
  drop constraint accounting_journal_entries_template_id,
  add constraint accounting_journal_entries_template_id check (
    template_id in (
      'purchase.adjustment', 'purchase.invoice', 'purchase.return',
      'inventory.count'
    )
  );
--> statement-breakpoint
alter table accounting_journal_lines
  drop constraint accounting_journal_lines_account_code,
  add constraint accounting_journal_lines_account_code check (
    account_code in (
      'cash', 'inventory', 'inventory-count-variance', 'supplier-payable'
    )
  );
