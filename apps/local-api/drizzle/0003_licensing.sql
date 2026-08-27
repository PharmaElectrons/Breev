insert into permission_definitions (name)
values ('licensing.manage')
on conflict (name) do nothing;
--> statement-breakpoint
insert into step_up_action_definitions (name, required_permission)
values ('licensing.licence.install', 'licensing.manage'),
       ('licensing.licence.deactivate', 'licensing.manage')
on conflict (name) do update
set required_permission = excluded.required_permission;
--> statement-breakpoint
with inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select owner_role.pharmacy_id,
         owner_role.id,
         'licensing.manage',
         owner_user.id
  from pharmacy_roles owner_role
  join lateral (
    select identity_user.id
    from identity_users identity_user
    where identity_user.pharmacy_id = owner_role.pharmacy_id
      and identity_user.role_id = owner_role.id
      and identity_user.status = 'active'
    order by identity_user.created_at, identity_user.id
    limit 1
  ) owner_user on true
  where owner_role.role_key = 'owner'
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
where pharmacy_row.id in (select pharmacy_id from advanced_roles);
--> statement-breakpoint
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
  unique (licence_id, pharmacy_id, main_device_id),
  foreign key (installed_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
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
create table licence_state_events (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  main_device_id uuid not null references main_devices(id),
  event_kind text not null,
  licence_id uuid,
  actor_user_id uuid not null,
  identity_session_id uuid,
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (licence_id, pharmacy_id, main_device_id)
    references licence_installations(licence_id, pharmacy_id, main_device_id),
  foreign key (actor_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (identity_session_id) references identity_sessions(id),
  constraint licence_state_events_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint licence_state_events_kind check (
    event_kind in ('installed', 'deactivated')
  ),
  constraint licence_state_events_licence check (
    (event_kind = 'installed' and licence_id is not null)
    or (event_kind = 'deactivated' and licence_id is null)
  )
);
--> statement-breakpoint
create table licensing_command_results (
  pharmacy_id uuid not null references pharmacies(id),
  command_name text not null,
  idempotency_key uuid not null,
  actor_user_id uuid not null,
  identity_session_id uuid,
  main_device_id uuid not null references main_devices(id),
  request_fingerprint bytea not null,
  response_body jsonb not null,
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (pharmacy_id, command_name, idempotency_key),
  foreign key (actor_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (identity_session_id) references identity_sessions(id),
  constraint licensing_command_results_name check (
    command_name in ('licence.install', 'licence.deactivate')
  ),
  constraint licensing_command_results_fingerprint check (
    octet_length(request_fingerprint) = 32
  )
);
--> statement-breakpoint
create table trusted_breev_time_marks (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  main_device_id uuid not null references main_devices(id),
  lower_bound timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (pharmacy_id, main_device_id, lower_bound),
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
  perform pg_advisory_xact_lock(
    hashtextextended(new.pharmacy_id::text || ':' || new.main_device_id::text, 0)
  );
  select max(mark.lower_bound)
    into current_lower_bound
    from public.trusted_breev_time_marks mark
   where mark.pharmacy_id = new.pharmacy_id
     and mark.main_device_id = new.main_device_id;
  if current_lower_bound is not null
     and new.lower_bound < current_lower_bound + interval '1 hour' then
    raise exception 'Trusted Breev Time marks must advance by the persistence cadence'
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
  pharmacy_id uuid not null references pharmacies(id),
  actor_user_id uuid,
  identity_session_id uuid,
  main_device_id uuid not null references main_devices(id),
  action text not null,
  outcome text not null,
  capability text,
  observed_at timestamptz not null,
  details jsonb,
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (actor_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (identity_session_id) references identity_sessions(id),
  constraint licensing_audit_records_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint licensing_audit_records_action check (
    action in (
      'capability.authorization',
      'licence.deactivate',
      'licence.install',
      'trusted-time.rollback'
    )
  ),
  constraint licensing_audit_records_outcome check (
    outcome in ('allowed', 'deactivated', 'denied', 'detected', 'installed')
  )
);
--> statement-breakpoint
create unique index licensing_audit_rollback_incident
  on licensing_audit_records (
    pharmacy_id,
    main_device_id,
    (details ->> 'trustedLowerBound')
  )
  where action = 'trusted-time.rollback';
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
create trigger licence_state_events_immutable
before update or delete on licence_state_events
for each row execute function reject_licensing_fact_mutation();
--> statement-breakpoint
create trigger licensing_command_results_immutable
before update or delete on licensing_command_results
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
  licence_state_events,
  licensing_command_results,
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
  licence_state_events,
  licensing_command_results,
  trusted_breev_time_marks,
  licensing_audit_records
to breev_app;
