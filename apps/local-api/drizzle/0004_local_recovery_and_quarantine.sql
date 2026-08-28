create type recovery_point_status as enum (
  'in_progress',
  'verified',
  'failed',
  'corrupted'
);
--> statement-breakpoint
create type recovery_backup_type as enum (
  'hourly_recovery_point',
  'daily_snapshot'
);
--> statement-breakpoint
create table recovery_points (
  id uuid primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status recovery_point_status not null default 'in_progress',
  backup_type recovery_backup_type not null default 'hourly_recovery_point',
  encrypted_size_bytes bigint,
  manifest_checksum text,
  manifest_verified_at timestamptz,
  wal_start_lsn text,
  wal_end_lsn text,
  archive_format text not null default 'breev_encrypted_archive',
  encryption_metadata jsonb,
  quarantine_required boolean not null default true,
  failure_reason text,
  created_at timestamptz not null default now(),
  constraint recovery_points_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint recovery_points_completion_consistent check (
    (status in ('verified', 'failed', 'corrupted')) = (completed_at is not null)
  ),
  constraint recovery_points_verified_manifest check (
    status != 'verified' or (
      manifest_checksum is not null and
      manifest_verified_at is not null and
      encrypted_size_bytes is not null and
      wal_start_lsn is not null and
      wal_end_lsn is not null and
      encryption_metadata is not null
    )
  ),
  constraint recovery_points_failure_reason check (
    status != 'failed' or failure_reason is not null
  )
);
--> statement-breakpoint
create function reject_terminal_recovery_point_mutation() returns trigger
language plpgsql as $$
begin
  if old.status in ('verified', 'failed', 'corrupted') then
    raise exception 'terminal recovery point outcomes are immutable' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger recovery_points_terminal_outcome_immutable
  before update or delete on recovery_points
  for each row execute function reject_terminal_recovery_point_mutation();
--> statement-breakpoint
create table system_quarantine_state (
  singleton boolean primary key default true,
  is_quarantined boolean not null default false,
  quarantine_reason text,
  quarantined_at timestamptz,
  cleared_at timestamptz,
  cleared_by text,
  verification_report jsonb,
  constraint system_quarantine_state_singleton check (singleton = true),
  constraint system_quarantine_state_consistent check (
    is_quarantined = false or (quarantine_reason is not null and quarantined_at is not null)
  )
);
--> statement-breakpoint
insert into system_quarantine_state (singleton, is_quarantined)
values (true, false)
on conflict (singleton) do nothing;
--> statement-breakpoint
revoke all on table
  recovery_points,
  system_quarantine_state
from public;
--> statement-breakpoint
grant select, insert, update on table recovery_points to breev_app;
--> statement-breakpoint
grant select, insert, update on table system_quarantine_state to breev_app;
--> statement-breakpoint
create index recovery_points_verified_completed_at
  on recovery_points (completed_at desc)
  where status = 'verified';
