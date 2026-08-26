alter type main_device_denial_code add value if not exists 'cert-chain-invalid';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'cert-expired';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'cert-installation-mismatch';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'cert-not-yet-valid';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'cert-role-mismatch';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'device-revoked';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'mtls-cert-invalid';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'mtls-cert-missing';
--> statement-breakpoint
alter type main_device_denial_code add value if not exists 'tls-version-rejected';
--> statement-breakpoint
create type pharmacy_ca_assurance_level as enum ('platform-tpm', 'software-cng-fallback');
--> statement-breakpoint
create table pharmacy_ca (
  singleton boolean primary key default true,
  installation_id uuid not null,
  ca_fingerprint text not null,
  ca_certificate text not null,
  provider_name text not null,
  assurance_level pharmacy_ca_assurance_level not null,
  created_at timestamptz not null default now(),
  constraint pharmacy_ca_singleton check (singleton = true),
  constraint pharmacy_ca_installation_id_uuidv7 check (
    installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint pharmacy_ca_fingerprint_nonempty check (
    char_length(ca_fingerprint) > 0
  ),
  constraint pharmacy_ca_certificate_nonempty check (
    char_length(ca_certificate) > 0
  )
);
--> statement-breakpoint
create table server_certificates (
  id uuid primary key default uuidv7(),
  installation_id uuid not null,
  cert_fingerprint text not null,
  cert_not_before timestamptz not null,
  cert_not_after timestamptz not null,
  issued_at timestamptz not null default now(),
  constraint server_certificates_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint server_certificates_installation_id_uuidv7 check (
    installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint server_certificates_validity_window check (
    cert_not_before < cert_not_after
  )
);
--> statement-breakpoint
create table terminal_devices (
  id uuid primary key,
  installation_id uuid not null,
  cert_fingerprint text,
  cert_serial text,
  cert_not_before timestamptz,
  cert_not_after timestamptz,
  paired_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  constraint terminal_devices_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint terminal_devices_installation_id_uuidv7 check (
    installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint terminal_devices_revocation_consistent check (
    (revoked_at is null) = (revocation_reason is null)
  )
);
--> statement-breakpoint
alter table main_device_recent_denials
  add column terminal_device_id uuid references terminal_devices(id),
  add constraint main_device_recent_denials_one_device_kind check (
    num_nonnulls(device_id, terminal_device_id) <= 1
  );
--> statement-breakpoint
revoke all on table
  pharmacy_ca,
  server_certificates,
  terminal_devices
from public;
--> statement-breakpoint
grant select, insert on table pharmacy_ca, server_certificates to breev_app;
--> statement-breakpoint
grant select, insert, update on table terminal_devices to breev_app;
