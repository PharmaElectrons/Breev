create table posting_command_results (
  pharmacy_id uuid not null references pharmacies(id),
  command_name text not null,
  idempotency_key uuid not null,
  actor_user_id uuid not null,
  identity_session_id uuid,
  main_device_id uuid not null references main_devices(id),
  request_hash bytea not null,
  response_status integer not null,
  response_body jsonb not null,
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (pharmacy_id, command_name, idempotency_key),
  foreign key (actor_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (identity_session_id) references identity_sessions(id),
  constraint posting_command_results_name check (
    command_name in ('pharmacy.settings.update')
  ),
  constraint posting_command_results_request_hash check (
    octet_length(request_hash) = 32
  ),
  constraint posting_command_results_response_status check (
    response_status between 200 and 599
  )
);
--> statement-breakpoint
create table posting_audit_records (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  actor_user_id uuid not null,
  identity_session_id uuid,
  device_id uuid not null references main_devices(id),
  correlation_id uuid,
  action text not null,
  outcome text not null,
  target_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz not null default statement_timestamp(),
  foreign key (actor_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (identity_session_id) references identity_sessions(id),
  constraint posting_audit_records_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posting_audit_records_action check (
    action ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'
    and char_length(action) <= 96
  ),
  constraint posting_audit_records_outcome check (
    char_length(outcome) between 1 and 64
  ),
  constraint posting_audit_records_reason check (
    reason is null or char_length(reason) between 1 and 256
  )
);
--> statement-breakpoint
create table posting_number_sequences (
  pharmacy_id uuid not null references pharmacies(id),
  document_type text not null,
  year integer not null,
  next_value bigint not null default 1,
  primary key (pharmacy_id, document_type, year),
  constraint posting_number_sequences_document_type check (
    document_type ~ '^[a-z][a-z0-9-]{0,47}$'
  ),
  constraint posting_number_sequences_year check (year between 1970 and 9999),
  constraint posting_number_sequences_next_value_positive check (next_value > 0)
);
--> statement-breakpoint
create table posting_number_allocations (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  document_type text not null,
  year integer not null,
  value bigint not null,
  status text not null default 'allocated',
  correlation_id uuid not null,
  document_id uuid,
  allocated_at timestamptz not null default statement_timestamp(),
  issued_at timestamptz,
  constraint posting_number_allocations_value_unique
    unique (pharmacy_id, document_type, year, value),
  constraint posting_number_allocations_correlation_unique
    unique (pharmacy_id, document_type, year, correlation_id),
  foreign key (pharmacy_id, document_type, year)
    references posting_number_sequences(pharmacy_id, document_type, year),
  constraint posting_number_allocations_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posting_number_allocations_status check (
    status in ('allocated', 'issued')
  ),
  constraint posting_number_allocations_value_positive check (value > 0),
  constraint posting_number_allocations_issue_consistent check (
    (status = 'allocated' and issued_at is null and document_id is null)
    or (
      status = 'issued'
      and document_id is not null
      and issued_at is not null
      and issued_at >= allocated_at
    )
  )
);
--> statement-breakpoint
create table posting_outbox_entries (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  event_type text not null,
  envelope_version integer not null,
  occurred_at timestamptz not null,
  correlation_id uuid not null,
  payload jsonb not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint posting_outbox_entries_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint posting_outbox_entries_event_type check (
    event_type in ('pharmacy.settings.changed')
  ),
  constraint posting_outbox_entries_envelope_version check (
    envelope_version > 0
  )
);
--> statement-breakpoint
create table posting_post_commit_outcomes (
  outbox_entry_id uuid primary key references posting_outbox_entries(id),
  outcome text not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint posting_post_commit_outcomes_outcome check (
    char_length(outcome) between 1 and 64
  )
);
--> statement-breakpoint
create function reject_posting_fact_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'posting facts are immutable' using errcode = '55000';
end;
$$;
--> statement-breakpoint
create function enforce_posting_number_allocation_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'posting number allocations are never deleted'
      using errcode = '55000';
  end if;
  if old.status <> 'allocated' or new.status <> 'issued' then
    raise exception
      'posting number allocations only advance from allocated to issued'
      using errcode = '55000';
  end if;
  if new.id <> old.id
     or new.pharmacy_id <> old.pharmacy_id
     or new.document_type <> old.document_type
     or new.year <> old.year
     or new.value <> old.value
     or new.correlation_id <> old.correlation_id
     or new.allocated_at <> old.allocated_at then
    raise exception 'a posting number allocation identity is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function protect_posting_number_sequence()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'posting number sequences are never deleted'
      using errcode = '55000';
  end if;
  if new.pharmacy_id <> old.pharmacy_id
     or new.document_type <> old.document_type
     or new.year <> old.year then
    raise exception 'a posting number sequence identity is immutable'
      using errcode = '55000';
  end if;
  if new.next_value <= old.next_value then
    raise exception 'a posting number sequence only advances'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger posting_command_results_immutable
before update or delete on posting_command_results
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posting_audit_records_immutable
before update or delete on posting_audit_records
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posting_outbox_entries_immutable
before update or delete on posting_outbox_entries
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posting_post_commit_outcomes_immutable
before update or delete on posting_post_commit_outcomes
for each row execute function reject_posting_fact_mutation();
--> statement-breakpoint
create trigger posting_number_allocations_transition
before update or delete on posting_number_allocations
for each row execute function enforce_posting_number_allocation_transition();
--> statement-breakpoint
create trigger posting_number_sequences_guard
before update or delete on posting_number_sequences
for each row execute function protect_posting_number_sequence();
--> statement-breakpoint
revoke all on table
  posting_command_results,
  posting_audit_records,
  posting_number_sequences,
  posting_number_allocations,
  posting_outbox_entries,
  posting_post_commit_outcomes
from public;
--> statement-breakpoint
revoke all on function reject_posting_fact_mutation() from public;
--> statement-breakpoint
revoke all on function enforce_posting_number_allocation_transition() from public;
--> statement-breakpoint
revoke all on function protect_posting_number_sequence() from public;
--> statement-breakpoint
grant select, insert on table
  posting_command_results,
  posting_audit_records,
  posting_outbox_entries,
  posting_post_commit_outcomes
to breev_app;
--> statement-breakpoint
grant select, insert, update on table
  posting_number_sequences,
  posting_number_allocations
to breev_app;
