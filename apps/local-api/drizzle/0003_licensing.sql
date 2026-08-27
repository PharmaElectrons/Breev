create table licence_installations (
  licence_id uuid primary key,
  pharmacy_id uuid not null references pharmacies(id),
  main_device_id uuid not null references main_devices(id),
  key_id text not null,
  format_version integer not null,
  plan text not null,
  features text[] not null,
  founder_override_grants text[] not null,
  permitted_device_count integer not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  grace_ends_at timestamptz not null,
  encoded_licence text not null,
  installed_at timestamptz not null default statement_timestamp(),
  installed_by uuid not null,
  constraint licence_installations_key_id check (
    key_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  constraint licence_installations_format check (format_version = 1),
  constraint licence_installations_plan check (
    plan ~ '^[a-z][a-z0-9-]{0,63}$'
  ),
  constraint licence_installations_device_count check (
    permitted_device_count between 1 and 10000
  ),
  constraint licence_installations_dates check (
    issued_at < expires_at and expires_at <= grace_ends_at
  ),
  constraint licence_installations_encoded_size check (
    octet_length(encoded_licence) between 1 and 65536
  )
);
--> statement-breakpoint
create table trusted_breev_time_marks (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  main_device_id uuid not null references main_devices(id),
  lower_bound timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (pharmacy_id, lower_bound),
  constraint trusted_breev_time_marks_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);
--> statement-breakpoint
create function enforce_trusted_breev_time_monotonic()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_lower_bound timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.pharmacy_id::text, 0));
  select max(mark.lower_bound)
    into current_lower_bound
    from public.trusted_breev_time_marks mark
   where mark.pharmacy_id = new.pharmacy_id;
  if current_lower_bound is not null and new.lower_bound <= current_lower_bound then
    raise exception 'Trusted Breev Time marks must only advance'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trusted_breev_time_marks_monotonic
before insert on trusted_breev_time_marks
for each row execute function enforce_trusted_breev_time_monotonic();
--> statement-breakpoint
create table licensing_audit_records (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid references pharmacies(id),
  actor_user_id uuid,
  identity_session_id uuid,
  main_device_id uuid not null references main_devices(id),
  action text not null,
  outcome text not null,
  capability text,
  observed_at timestamptz not null,
  details jsonb,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint licensing_audit_records_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint licensing_audit_records_action check (
    action in ('capability.authorization', 'licence.install', 'trusted-time.rollback')
  ),
  constraint licensing_audit_records_outcome check (
    outcome in ('allowed', 'denied', 'detected', 'installed')
  )
);
--> statement-breakpoint
create function reject_licensing_fact_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'licensing facts are immutable' using errcode = '55000';
end;
$$;
--> statement-breakpoint
create trigger licence_installations_immutable
before update or delete on licence_installations
for each row execute function reject_licensing_fact_mutation();
--> statement-breakpoint
create trigger trusted_breev_time_marks_immutable
before update or delete on trusted_breev_time_marks
for each row execute function reject_licensing_fact_mutation();
--> statement-breakpoint
create trigger licensing_audit_records_immutable
before update or delete on licensing_audit_records
for each row execute function reject_licensing_fact_mutation();
--> statement-breakpoint
revoke all on table
  licence_installations,
  trusted_breev_time_marks,
  licensing_audit_records
from public;
--> statement-breakpoint
revoke all on function enforce_trusted_breev_time_monotonic() from public;
--> statement-breakpoint
revoke all on function reject_licensing_fact_mutation() from public;
--> statement-breakpoint
grant select, insert on table
  licence_installations,
  trusted_breev_time_marks,
  licensing_audit_records
to breev_app;
