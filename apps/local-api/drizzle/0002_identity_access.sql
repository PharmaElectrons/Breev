create type pharmacy_role_key as enum (
  'owner',
  'manager',
  'pharmacist',
  'sales_employee',
  'purchasing_employee',
  'inventory_employee',
  'accountant',
  'support'
);
--> statement-breakpoint
create type identity_user_status as enum ('active', 'locked');
--> statement-breakpoint
create type identity_session_revocation_reason as enum (
  'logout',
  'replaced',
  'administrative',
  'user-locked'
);
--> statement-breakpoint
create type step_up_challenge_status as enum ('pending', 'approved', 'denied');
--> statement-breakpoint
create type attendance_presence_status as enum ('checked-in', 'checked-out');
--> statement-breakpoint
create type attendance_event_kind as enum ('check-in', 'check-out');
--> statement-breakpoint
create type identity_auth_action as enum ('login', 'step-up');
--> statement-breakpoint
create table pharmacies (
  singleton boolean primary key default true,
  id uuid not null unique,
  name text not null,
  identity_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  constraint pharmacies_singleton check (singleton = true),
  constraint pharmacies_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint pharmacies_name_length check (char_length(name) between 1 and 160),
  constraint pharmacies_identity_revision_positive check (identity_revision > 0)
);
--> statement-breakpoint
create table pharmacy_roles (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  role_key pharmacy_role_key not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  unique (id, pharmacy_id),
  unique (pharmacy_id, role_key),
  constraint pharmacy_roles_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint pharmacy_roles_revision_positive check (revision > 0)
);
--> statement-breakpoint
create table permission_definitions (
  name text primary key,
  constraint permission_definitions_name check (
    name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and char_length(name) <= 96
  )
);
--> statement-breakpoint
create table identity_users (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  username text not null,
  username_key text not null,
  display_name text not null,
  role_id uuid not null,
  status identity_user_status not null default 'active',
  password_hash bytea not null,
  password_algorithm text not null,
  password_version integer not null,
  password_memory_kib integer not null,
  password_iterations integer not null,
  password_parallelism integer not null,
  auth_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (id, pharmacy_id),
  unique (pharmacy_id, username_key),
  foreign key (role_id, pharmacy_id) references pharmacy_roles(id, pharmacy_id),
  foreign key (created_by) references identity_users(id),
  constraint identity_users_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint identity_users_username_length check (char_length(username) between 3 and 64),
  constraint identity_users_username_key_length check (char_length(username_key) between 3 and 128),
  constraint identity_users_display_name_length check (char_length(display_name) between 1 and 96),
  constraint identity_users_password_hash_length check (octet_length(password_hash) between 64 and 512),
  constraint identity_users_password_algorithm check (password_algorithm = 'argon2id'),
  constraint identity_users_password_version check (password_version = 19),
  constraint identity_users_password_memory check (password_memory_kib >= 19456),
  constraint identity_users_password_iterations check (password_iterations >= 1),
  constraint identity_users_password_parallelism check (password_parallelism >= 1),
  constraint identity_users_auth_revision_positive check (auth_revision > 0)
);
--> statement-breakpoint
create table role_permission_grants (
  pharmacy_id uuid not null references pharmacies(id),
  role_id uuid not null,
  permission_name text not null references permission_definitions(name),
  granted_at timestamptz not null default now(),
  granted_by uuid not null references identity_users(id),
  primary key (role_id, permission_name),
  foreign key (role_id, pharmacy_id) references pharmacy_roles(id, pharmacy_id)
);
--> statement-breakpoint
create table pharmacy_settings (
  pharmacy_id uuid primary key references pharmacies(id),
  attendance_enabled boolean not null default false,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references identity_users(id),
  constraint pharmacy_settings_revision_positive check (revision > 0)
);
--> statement-breakpoint
alter table main_device_sessions
  add constraint main_device_sessions_token_device_unique unique (token_hash, device_id);
--> statement-breakpoint
create table identity_sessions (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  user_id uuid not null,
  device_id uuid not null references main_devices(id),
  device_session_hash bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason identity_session_revocation_reason,
  foreign key (user_id, pharmacy_id) references identity_users(id, pharmacy_id),
  foreign key (device_session_hash, device_id)
    references main_device_sessions(token_hash, device_id),
  unique (id, pharmacy_id, user_id, device_id, device_session_hash),
  constraint identity_sessions_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint identity_sessions_device_session_hash_length check (
    octet_length(device_session_hash) = 32
  ),
  constraint identity_sessions_time_order check (created_at < expires_at),
  constraint identity_sessions_revocation_consistent check (
    (revoked_at is null) = (revocation_reason is null)
  )
);
--> statement-breakpoint
create unique index identity_sessions_one_active_device_session
  on identity_sessions (device_session_hash)
  where revoked_at is null;
--> statement-breakpoint
create table identity_auth_rate_windows (
  device_id uuid not null references main_devices(id),
  action identity_auth_action not null,
  subject_key bytea not null,
  window_number bigint not null,
  request_count integer not null,
  primary key (device_id, action, subject_key, window_number),
  constraint identity_auth_rate_subject_key_length check (octet_length(subject_key) = 32),
  constraint identity_auth_rate_window_nonnegative check (window_number >= 0),
  constraint identity_auth_rate_count_positive check (request_count > 0)
);
--> statement-breakpoint
create table identity_command_results (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  actor_user_id uuid not null,
  identity_session_id uuid not null references identity_sessions(id),
  device_id uuid not null references main_devices(id),
  idempotency_key uuid not null,
  command_name text not null,
  request_fingerprint bytea not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (actor_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id),
  unique (pharmacy_id, actor_user_id, idempotency_key),
  constraint identity_command_results_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint identity_command_results_name check (
    command_name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    and char_length(command_name) <= 96
  ),
  constraint identity_command_results_fingerprint_length check (
    octet_length(request_fingerprint) = 32
  )
);
--> statement-breakpoint
create table step_up_action_definitions (
  name text primary key,
  required_permission text not null references permission_definitions(name),
  unique (name, required_permission),
  constraint step_up_action_definitions_name check (
    name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and char_length(name) <= 96
  )
);
--> statement-breakpoint
create table step_up_challenges (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  actor_user_id uuid not null,
  identity_session_id uuid not null references identity_sessions(id),
  device_id uuid not null references main_devices(id),
  device_session_hash bytea not null,
  action_name text not null references step_up_action_definitions(name),
  required_permission text not null references permission_definitions(name),
  subject_id uuid not null,
  subject_revision bigint not null,
  pharmacy_identity_revision bigint not null,
  actor_auth_revision bigint not null,
  role_revision bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status step_up_challenge_status not null default 'pending',
  resolved_at timestamptz,
  denial_code text,
  consumed_at timestamptz,
  foreign key (
    identity_session_id, pharmacy_id, actor_user_id, device_id, device_session_hash
  ) references identity_sessions (
    id, pharmacy_id, user_id, device_id, device_session_hash
  ),
  foreign key (action_name, required_permission)
    references step_up_action_definitions(name, required_permission),
  foreign key (device_session_hash, device_id)
    references main_device_sessions(token_hash, device_id),
  constraint step_up_challenges_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint step_up_challenges_revisions_positive check (
    subject_revision > 0 and pharmacy_identity_revision > 0
    and actor_auth_revision > 0 and role_revision > 0
  ),
  constraint step_up_challenges_time_order check (created_at < expires_at),
  constraint step_up_challenges_resolution_consistent check (
    (status = 'pending' and resolved_at is null and denial_code is null)
    or (status = 'approved' and resolved_at is not null and denial_code is null)
    or (status = 'denied' and resolved_at is not null and denial_code is not null)
  )
);
--> statement-breakpoint
create table attendance_presence (
  pharmacy_id uuid not null references pharmacies(id),
  user_id uuid not null,
  status attendance_presence_status not null default 'checked-out',
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (pharmacy_id, user_id),
  foreign key (user_id, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint attendance_presence_version_positive check (version > 0)
);
--> statement-breakpoint
create table attendance_events (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  user_id uuid not null,
  identity_session_id uuid not null references identity_sessions(id),
  device_id uuid not null references main_devices(id),
  kind attendance_event_kind not null,
  occurred_at timestamptz not null default now(),
  presence_version bigint not null,
  foreign key (user_id, pharmacy_id) references identity_users(id, pharmacy_id),
  constraint attendance_events_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint attendance_events_presence_version_positive check (presence_version > 0)
);
--> statement-breakpoint
create table identity_audit_records (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid references pharmacies(id),
  actor_user_id uuid references identity_users(id),
  identity_session_id uuid references identity_sessions(id),
  device_id uuid not null references main_devices(id),
  action text not null,
  outcome text not null,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz not null default now(),
  constraint identity_audit_records_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint identity_audit_records_action_nonempty check (char_length(action) between 1 and 96),
  constraint identity_audit_records_outcome_nonempty check (char_length(outcome) between 1 and 64)
);
--> statement-breakpoint
create function reject_identity_fact_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'identity facts are immutable' using errcode = '55000';
end;
$$;
--> statement-breakpoint
create trigger identity_audit_records_immutable
  before update or delete on identity_audit_records
  for each row execute function reject_identity_fact_mutation();
--> statement-breakpoint
create trigger attendance_events_immutable
  before update or delete on attendance_events
  for each row execute function reject_identity_fact_mutation();
--> statement-breakpoint
create trigger identity_command_results_immutable
  before update or delete on identity_command_results
  for each row execute function reject_identity_fact_mutation();
--> statement-breakpoint
revoke all on table
  pharmacies,
  pharmacy_roles,
  permission_definitions,
  identity_users,
  role_permission_grants,
  pharmacy_settings,
  identity_sessions,
  identity_auth_rate_windows,
  identity_command_results,
  step_up_action_definitions,
  step_up_challenges,
  attendance_presence,
  attendance_events,
  identity_audit_records
from public;
--> statement-breakpoint
grant select, insert, update on table pharmacies, pharmacy_roles to breev_app;
--> statement-breakpoint
grant select, insert on table permission_definitions, step_up_action_definitions to breev_app;
--> statement-breakpoint
grant select, insert, update on table identity_users, pharmacy_settings, identity_sessions, step_up_challenges, attendance_presence to breev_app;
--> statement-breakpoint
grant select, insert, delete on table role_permission_grants to breev_app;
--> statement-breakpoint
grant select, insert, update, delete on table identity_auth_rate_windows to breev_app;
--> statement-breakpoint
grant select, insert on table attendance_events, identity_audit_records, identity_command_results to breev_app;
