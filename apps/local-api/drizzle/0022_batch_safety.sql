alter table inventory_receipt_class_rules
  add column near_expiry_days integer not null default 90,
  add constraint inventory_receipt_class_rules_near_expiry_days
    check (near_expiry_days between 1 and 730);
--> statement-breakpoint
comment on column inventory_batches.status is
  'Receipt status remains immutable active; current safety status is the latest inventory_batch_status_events row';
--> statement-breakpoint
create table inventory_batch_status_events (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  batch_id uuid not null,
  product_id uuid not null,
  sequence integer not null,
  kind text not null check (kind in ('expired', 'recalled', 'quarantined')),
  source text not null check (source in ('user', 'daily-evaluator')),
  reason text,
  evidence text,
  business_date date not null,
  occurred_at timestamptz not null default statement_timestamp(),
  created_by uuid,
  device_id uuid,
  unique (pharmacy_id, batch_id, sequence),
  foreign key (batch_id, pharmacy_id)
    references inventory_batches(id, pharmacy_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (created_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint inventory_batch_status_events_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_batch_status_events_sequence_positive check (sequence > 0),
  constraint inventory_batch_status_events_reason_length check (
    reason is null or char_length(reason) between 1 and 500
  ),
  constraint inventory_batch_status_events_evidence_length check (
    evidence is null or char_length(evidence) between 1 and 1000
  ),
  constraint inventory_batch_status_events_source_shape check (
    (
      source = 'daily-evaluator'
      and kind = 'expired'
      and created_by is null
      and device_id is null
      and reason is null
      and evidence is null
    )
    or (
      source = 'user'
      and created_by is not null
      and device_id is not null
      and reason is not null
      and evidence is not null
      and kind <> 'expired'
    )
  )
);
--> statement-breakpoint
create index inventory_batch_status_events_batch_index
  on inventory_batch_status_events (pharmacy_id, batch_id, sequence desc);
--> statement-breakpoint
create trigger inventory_batch_status_events_immutable
before update or delete on inventory_batch_status_events
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
revoke all on table inventory_batch_status_events from public;
--> statement-breakpoint
grant select, insert on table inventory_batch_status_events to breev_app;
--> statement-breakpoint
create table inventory_batch_expiry_amendments (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  batch_id uuid not null,
  product_id uuid not null,
  sequence integer not null,
  original_expiry_date date,
  corrected_expiry_date date not null,
  reason text not null,
  evidence text not null,
  business_date date not null,
  occurred_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  device_id uuid not null,
  approval_challenge_id uuid not null unique references step_up_challenges(id),
  unique (pharmacy_id, batch_id, sequence),
  foreign key (batch_id, pharmacy_id)
    references inventory_batches(id, pharmacy_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (created_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint inventory_batch_expiry_amendments_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint inventory_batch_expiry_amendments_sequence_positive check (sequence > 0),
  constraint inventory_batch_expiry_amendments_reason_length check (
    char_length(reason) between 1 and 500
  ),
  constraint inventory_batch_expiry_amendments_evidence_length check (
    char_length(evidence) between 1 and 1000
  ),
  constraint inventory_batch_expiry_amendments_date_changed check (
    corrected_expiry_date is distinct from original_expiry_date
  )
);
--> statement-breakpoint
create index inventory_batch_expiry_amendments_batch_index
  on inventory_batch_expiry_amendments (pharmacy_id, batch_id, sequence desc);
--> statement-breakpoint
create trigger inventory_batch_expiry_amendments_immutable
before update or delete on inventory_batch_expiry_amendments
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
revoke all on table inventory_batch_expiry_amendments from public;
--> statement-breakpoint
grant select, insert on table inventory_batch_expiry_amendments to breev_app;
--> statement-breakpoint
create table inventory_batch_safety_runs (
  pharmacy_id uuid not null references pharmacies(id),
  business_date date not null,
  trigger text not null check (trigger in ('scheduled', 'catch-up', 'manual', 'startup')),
  evaluated_batch_count integer not null default 0,
  newly_expired_count integer not null default 0,
  near_expiry_count integer not null default 0,
  job_id text,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz not null default statement_timestamp(),
  primary key (pharmacy_id, business_date),
  constraint inventory_batch_safety_runs_counts_nonnegative check (
    evaluated_batch_count >= 0 and newly_expired_count >= 0 and near_expiry_count >= 0
  )
);
--> statement-breakpoint
create trigger inventory_batch_safety_runs_immutable
before update or delete on inventory_batch_safety_runs
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
revoke all on table inventory_batch_safety_runs from public;
--> statement-breakpoint
grant select, insert on table inventory_batch_safety_runs to breev_app;
--> statement-breakpoint
create index inventory_batches_fefo_index
  on inventory_batches (pharmacy_id, product_id, expiry_date, created_at, id);
--> statement-breakpoint
insert into permission_definitions (name)
values ('inventory.batch_safety.manage')
on conflict (name) do nothing;
--> statement-breakpoint
insert into step_up_action_definitions (name, required_permission)
select action.name, permission.name
from (values ('inventory.batch_expiry.correct')) action(name)
cross join permission_definitions permission
where permission.name = 'inventory.batch_safety.manage'
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
  where pharmacy_role.role_key in ('owner', 'manager', 'pharmacist')
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select pharmacy_id, role_id, 'inventory.batch_safety.manage', granted_by
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
alter table posting_command_results
  drop constraint posting_command_results_name,
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add', 'catalog.barcode.print', 'catalog.barcode.suggest',
      'catalog.matching.approve', 'catalog.matching.open',
      'catalog.product.archive', 'catalog.product.create',
      'catalog.product.edit', 'catalog.product.merge',
      'inventory.batch_status.change', 'inventory.batch_expiry.correct',
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
      'inventory.batch.status-changed', 'inventory.batch.expiry-corrected'
    )
  );
