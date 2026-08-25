create type main_device_denial_code as enum (
  'binding-invalid',
  'binding-missing',
  'body-invalid',
  'content-type-not-allowed',
  'cors-preflight-not-allowed',
  'csrf-header-missing',
  'host-not-allowed',
  'origin-not-allowed',
  'rate-limit-exceeded',
  'request-too-large',
  'session-binding-invalid'
);
--> statement-breakpoint
create type main_device_request_class as enum (
  'cors-preflight',
  'other-state-change',
  'proof-mutation'
);
--> statement-breakpoint
create type main_device_context as enum ('missing', 'present', 'verified');
--> statement-breakpoint
create type main_device_rate_action as enum ('proof-mutation');
--> statement-breakpoint
create table main_devices (
  id uuid primary key,
  credential_hash bytea not null unique,
  created_at timestamptz not null default now(),
  constraint main_devices_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint main_devices_credential_hash_length check (
    octet_length(credential_hash) = 32
  )
);
--> statement-breakpoint
create table main_device_sessions (
  token_hash bytea primary key,
  device_id uuid not null references main_devices(id),
  created_at timestamptz not null default now(),
  constraint main_device_sessions_token_hash_length check (
    octet_length(token_hash) = 32
  )
);
--> statement-breakpoint
create table main_device_proof_state (
  singleton boolean primary key default true,
  mutation_count bigint not null default 0,
  constraint main_device_proof_state_singleton check (singleton = true),
  constraint main_device_proof_state_non_negative check (mutation_count >= 0)
);
--> statement-breakpoint
insert into main_device_proof_state (singleton, mutation_count) values (true, 0);
--> statement-breakpoint
create table main_device_denial_totals (
  code main_device_denial_code primary key,
  denial_count bigint not null default 0,
  last_denied_at timestamptz not null,
  constraint main_device_denial_totals_non_negative check (denial_count >= 0)
);
--> statement-breakpoint
create table main_device_recent_denials (
  id uuid primary key default uuidv7(),
  denied_at timestamptz not null default now(),
  code main_device_denial_code not null,
  request_class main_device_request_class not null,
  device_context main_device_context not null,
  device_id uuid references main_devices(id),
  constraint main_device_recent_denials_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);
--> statement-breakpoint
create table main_device_rate_windows (
  device_id uuid not null references main_devices(id),
  action main_device_rate_action not null,
  window_number bigint not null,
  request_count integer not null,
  primary key (device_id, action, window_number),
  constraint main_device_rate_windows_positive_count check (request_count > 0)
);
--> statement-breakpoint
revoke all on table
  main_devices,
  main_device_sessions,
  main_device_proof_state,
  main_device_denial_totals,
  main_device_recent_denials,
  main_device_rate_windows
from public;
--> statement-breakpoint
grant select, insert on table main_devices, main_device_sessions to breev_app;
--> statement-breakpoint
grant select, update on table main_device_proof_state to breev_app;
--> statement-breakpoint
grant select, insert, update on table main_device_denial_totals to breev_app;
--> statement-breakpoint
grant select, insert, delete on table main_device_recent_denials to breev_app;
--> statement-breakpoint
grant select, insert, update, delete on table main_device_rate_windows to breev_app;
