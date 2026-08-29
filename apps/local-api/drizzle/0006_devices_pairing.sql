-- This file is the authoritative definition of the pairing schema. Breev has no
-- schema generator: the migrations are hand-written SQL, and the Drizzle
-- declarations under src/**/**-schema.ts are typed documentation of tables a
-- module reads through Drizzle, never a source the migrations are derived from.
-- pairing_sessions, seat_release_requests, devices_audit_records, and
-- terminal_auth_rate_windows are read through hand-written SQL only and
-- therefore have no Drizzle declaration; terminal_devices keeps one because the
-- pharmacy CA module already declared it, and it is updated here to match.
insert into permission_definitions (name)
values ('devices.pair')
on conflict (name) do nothing;
--> statement-breakpoint
insert into step_up_action_definitions (name, required_permission)
values ('devices.pairing.start', 'devices.pair'),
       ('devices.revoke', 'devices.pair'),
       ('devices.seat.release.request', 'devices.pair')
on conflict (name) do update
set required_permission = excluded.required_permission;
--> statement-breakpoint
with inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select owner_role.pharmacy_id,
         owner_role.id,
         'devices.pair',
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
create type pairing_session_state as enum (
  'open',
  'awaiting-confirmation',
  'confirmed',
  'cancelled',
  'expired',
  'failed'
);
--> statement-breakpoint
create type seat_release_request_status as enum (
  'pending',
  'approved',
  'expired',
  'superseded'
);
--> statement-breakpoint
-- Terminal device rows that predate pairing carry no pharmacy, licence, seat,
-- operator-chosen name, or pairing evidence, and the certificate path that
-- created them is removed by this change. They are deleted rather than
-- back-filled with invented identity: a terminal device record is evidence
-- that a pairing ceremony happened, and nothing else may create one.
delete from main_device_recent_denials where terminal_device_id is not null;
--> statement-breakpoint
delete from terminal_devices;
--> statement-breakpoint
alter table terminal_devices
  add column pharmacy_id uuid not null references pharmacies(id),
  add column display_name text not null,
  add column licence_id uuid not null references licence_installations(licence_id),
  add column cert_pem text not null,
  add column paired_by uuid not null,
  add column revoked_by uuid,
  add column seat_allocated_at timestamptz not null
    default statement_timestamp(),
  add column seat_released_at timestamptz,
  add column seat_released_by uuid,
  alter column cert_fingerprint set not null,
  alter column cert_serial set not null,
  alter column cert_not_before set not null,
  alter column cert_not_after set not null,
  add constraint terminal_devices_paired_by_fk
    foreign key (paired_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  add constraint terminal_devices_revoked_by_fk
    foreign key (revoked_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  add constraint terminal_devices_seat_released_by_fk
    foreign key (seat_released_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  add constraint terminal_devices_display_name_length check (
    char_length(display_name) between 1 and 64
  ),
  add constraint terminal_devices_reason_length check (
    revocation_reason is null
    or char_length(revocation_reason) between 1 and 128
  ),
  add constraint terminal_devices_cert_pem_nonempty check (
    char_length(cert_pem) between 1 and 16384
  ),
  add constraint terminal_devices_validity_window check (
    cert_not_before < cert_not_after
  ),
  add constraint terminal_devices_revoked_by_consistent check (
    (revoked_at is null) = (revoked_by is null)
  ),
  add constraint terminal_devices_seat_release_consistent check (
    (seat_released_at is null) = (seat_released_by is null)
  ),
  -- A seat is released only after the device it belongs to is revoked, so a
  -- live terminal can never lose the seat it is operating on.
  add constraint terminal_devices_seat_release_after_revocation check (
    seat_released_at is null or revoked_at is not null
  );
--> statement-breakpoint
create unique index terminal_devices_cert_fingerprint_unique
  on terminal_devices (cert_fingerprint);
--> statement-breakpoint
create index terminal_devices_seat_usage
  on terminal_devices (pharmacy_id)
  where seat_released_at is null;
--> statement-breakpoint
create table pairing_sessions (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  installation_id uuid not null,
  started_by_user_id uuid not null,
  started_device_id uuid not null references main_devices(id),
  identity_session_id uuid not null references identity_sessions(id),
  state pairing_session_state not null default 'open',
  join_secret_hash bytea not null,
  join_attempt_count integer not null default 0,
  max_join_attempts integer not null,
  bound_spki_der bytea,
  bound_device_name text,
  bound_at timestamptz,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  cancelled_reason text,
  failure_reason text,
  terminal_device_id uuid references terminal_devices(id),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  unique (id, pharmacy_id),
  foreign key (started_by_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint pairing_sessions_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint pairing_sessions_installation_id_uuidv7 check (
    installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  -- Only the SHA-256 of the join secret is ever stored: the secret itself
  -- lives in the QR the operator carries and nowhere else.
  constraint pairing_sessions_join_secret_hash_length check (
    octet_length(join_secret_hash) = 32
  ),
  constraint pairing_sessions_attempts check (
    join_attempt_count >= 0
    and max_join_attempts between 1 and 20
    and join_attempt_count <= max_join_attempts
  ),
  constraint pairing_sessions_time_order check (created_at < expires_at),
  constraint pairing_sessions_binding_consistent check (
    num_nonnulls(bound_spki_der, bound_device_name, bound_at) in (0, 3)
  ),
  constraint pairing_sessions_binding_required check (
    state in ('open', 'cancelled', 'expired', 'failed')
    or bound_at is not null
  ),
  -- The device row and this row reference each other, and both are written by
  -- the same confirmation transaction, so the link is checked in one direction
  -- only: a session may name a device solely once it is confirmed. The reverse
  -- direction is guaranteed by terminal_devices.pairing_session_id, which is
  -- NOT NULL and unique.
  constraint pairing_sessions_confirmation_consistent check (
    (state = 'confirmed') = (confirmed_at is not null)
    and (confirmed_at is null) = (consumed_at is null)
    and (terminal_device_id is null or state = 'confirmed')
  ),
  constraint pairing_sessions_cancelled_reason check (
    (state = 'cancelled') = (cancelled_reason is not null)
    and (
      cancelled_reason is null
      or cancelled_reason in ('fingerprint-mismatch', 'user-cancelled')
    )
  ),
  constraint pairing_sessions_failure_reason check (
    (state = 'failed') = (failure_reason is not null)
    and (failure_reason is null or failure_reason in ('excess-attempts'))
  ),
  constraint pairing_sessions_device_name_length check (
    bound_device_name is null
    or char_length(bound_device_name) between 1 and 64
  ),
  constraint pairing_sessions_spki_length check (
    bound_spki_der is null
    or octet_length(bound_spki_der) between 32 and 2048
  )
);
--> statement-breakpoint
-- One pairing ceremony at a time per installation. A second start attempt
-- fails on this index rather than racing the first through the same seat.
create unique index pairing_sessions_one_active
  on pairing_sessions (installation_id)
  where state in ('open', 'awaiting-confirmation');
--> statement-breakpoint
create table seat_release_requests (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  terminal_device_id uuid not null references terminal_devices(id),
  requested_by uuid not null,
  requested_device_id uuid not null references main_devices(id),
  requested_session_id uuid not null references identity_sessions(id),
  status seat_release_request_status not null default 'pending',
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  approved_by uuid,
  resolved_at timestamptz,
  unique (id, terminal_device_id),
  foreign key (requested_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  foreign key (approved_by, pharmacy_id)
    references identity_users(id, pharmacy_id),
  constraint seat_release_requests_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  -- Dual Control: the approver is always a different user, and there is no
  -- emergency bypass to write around this row.
  constraint seat_release_requests_two_users check (
    approved_by is null or approved_by <> requested_by
  ),
  constraint seat_release_requests_time_order check (created_at < expires_at),
  constraint seat_release_requests_resolution check (
    (status = 'pending' and resolved_at is null and approved_by is null)
    or (
      status = 'approved'
      and resolved_at is not null
      and approved_by is not null
    )
    or (
      status in ('expired', 'superseded')
      and resolved_at is not null
      and approved_by is null
    )
  )
);
--> statement-breakpoint
create unique index seat_release_requests_one_pending
  on seat_release_requests (terminal_device_id)
  where status = 'pending';
--> statement-breakpoint
alter table terminal_devices
  add column pairing_session_id uuid not null references pairing_sessions(id),
  add column seat_release_request_id uuid references seat_release_requests(id),
  add constraint terminal_devices_seat_release_request_consistent check (
    (seat_released_at is null) = (seat_release_request_id is null)
  );
--> statement-breakpoint
create unique index terminal_devices_pairing_session_unique
  on terminal_devices (pairing_session_id);
--> statement-breakpoint
create table devices_audit_records (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid references pharmacies(id),
  installation_id uuid not null,
  actor_user_id uuid references identity_users(id),
  identity_session_id uuid references identity_sessions(id),
  main_device_id uuid references main_devices(id),
  terminal_device_id uuid references terminal_devices(id),
  pairing_session_id uuid references pairing_sessions(id),
  seat_release_request_id uuid references seat_release_requests(id),
  action text not null,
  outcome text not null,
  details jsonb,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint devices_audit_records_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint devices_audit_records_installation_id_uuidv7 check (
    installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint devices_audit_records_action check (
    action ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'
    and char_length(action) <= 96
  ),
  constraint devices_audit_records_outcome check (
    char_length(outcome) between 1 and 64
  ),
  -- A pairing audit fact must never be able to reconstruct the ceremony it
  -- describes. Key material, the join secret, the CSR, and the QR payload are
  -- refused by the database itself, not only by the writer.
  constraint devices_audit_records_details_privacy check (
    details is null
    or not (
      details ?| array[
        'caCertificatePem',
        'certificatePem',
        'csrPem',
        'joinSecret',
        'privateKey',
        'privateKeyPem',
        'qrUri',
        'qrV2Uri',
        'signature',
        'spki',
        'spkiDer',
        'transcriptSignature'
      ]
    )
  )
);
--> statement-breakpoint
create table terminal_auth_rate_windows (
  terminal_device_id uuid not null references terminal_devices(id),
  action identity_auth_action not null,
  subject_key bytea not null,
  window_number bigint not null,
  request_count integer not null,
  primary key (terminal_device_id, action, subject_key, window_number),
  constraint terminal_auth_rate_subject_key_length check (
    octet_length(subject_key) = 32
  ),
  constraint terminal_auth_rate_window_nonnegative check (window_number >= 0),
  constraint terminal_auth_rate_count_positive check (request_count > 0)
);
--> statement-breakpoint
-- A user session now belongs either to the Main device binding or to one
-- terminal device certificate, never to both and never to neither.
alter table identity_sessions
  alter column device_id drop not null,
  alter column device_session_hash drop not null,
  add column terminal_device_id uuid references terminal_devices(id),
  add column terminal_cert_fingerprint bytea,
  add constraint identity_sessions_one_device_kind check (
    num_nonnulls(device_id, terminal_device_id) = 1
  ),
  add constraint identity_sessions_main_binding check (
    (device_id is null) = (device_session_hash is null)
  ),
  add constraint identity_sessions_terminal_binding check (
    (terminal_device_id is null) = (terminal_cert_fingerprint is null)
  ),
  add constraint identity_sessions_terminal_fingerprint_length check (
    terminal_cert_fingerprint is null
    or octet_length(terminal_cert_fingerprint) = 32
  );
--> statement-breakpoint
create unique index identity_sessions_one_active_terminal_session
  on identity_sessions (terminal_device_id)
  where revoked_at is null and terminal_device_id is not null;
--> statement-breakpoint
alter table step_up_challenges
  alter column device_id drop not null,
  alter column device_session_hash drop not null,
  add column terminal_device_id uuid references terminal_devices(id),
  add constraint step_up_challenges_one_device_kind check (
    num_nonnulls(device_id, terminal_device_id) = 1
  ),
  add constraint step_up_challenges_main_binding check (
    (device_id is null) = (device_session_hash is null)
  );
--> statement-breakpoint
alter table identity_audit_records
  alter column device_id drop not null,
  add column terminal_device_id uuid references terminal_devices(id),
  add constraint identity_audit_records_one_device_kind check (
    num_nonnulls(device_id, terminal_device_id) = 1
  );
--> statement-breakpoint
alter table identity_command_results
  alter column device_id drop not null,
  add column terminal_device_id uuid references terminal_devices(id),
  add constraint identity_command_results_one_device_kind check (
    num_nonnulls(device_id, terminal_device_id) = 1
  );
--> statement-breakpoint
alter table attendance_events
  alter column device_id drop not null,
  add column terminal_device_id uuid references terminal_devices(id),
  add constraint attendance_events_one_device_kind check (
    num_nonnulls(device_id, terminal_device_id) = 1
  );
--> statement-breakpoint
alter table posting_audit_records
  alter column device_id drop not null,
  add column terminal_device_id uuid references terminal_devices(id),
  add constraint posting_audit_records_one_device_kind check (
    num_nonnulls(device_id, terminal_device_id) = 1
  );
--> statement-breakpoint
alter table posting_command_results
  alter column main_device_id drop not null,
  add column terminal_device_id uuid references terminal_devices(id),
  add constraint posting_command_results_one_device_kind check (
    num_nonnulls(main_device_id, terminal_device_id) = 1
  );
--> statement-breakpoint
-- A licensing decision is always about the Main device's licence, whichever
-- device asked: main_device_id stays the licensing device and is still
-- required. A terminal that is refused permission to operate adds which
-- terminal the refusal was about, so the fact is attributable without reading
-- it out of a JSON detail.
alter table licensing_audit_records
  add column terminal_device_id uuid references terminal_devices(id);
--> statement-breakpoint
create function reject_devices_fact_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'device facts are immutable' using errcode = '55000';
end;
$$;
--> statement-breakpoint
create trigger devices_audit_records_immutable
before update or delete on devices_audit_records
for each row execute function reject_devices_fact_mutation();
--> statement-breakpoint
revoke all on table
  pairing_sessions,
  seat_release_requests,
  devices_audit_records,
  terminal_auth_rate_windows
from public;
--> statement-breakpoint
revoke all on function reject_devices_fact_mutation() from public;
--> statement-breakpoint
grant select, insert, update on table
  pairing_sessions,
  seat_release_requests
to breev_app;
--> statement-breakpoint
grant select, insert on table devices_audit_records to breev_app;
--> statement-breakpoint
grant select, insert, update, delete on table
  terminal_auth_rate_windows
to breev_app;
