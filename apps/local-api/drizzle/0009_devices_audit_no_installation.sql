-- Two device-audit outcomes can only occur before a pharmacy CA exists at
-- all — `ca-not-found` and `ca-key-store-failure` — so they genuinely have no
-- installation to name. `installation_id` was `not null`, which forced those
-- writes to fabricate a fixed all-zero sentinel UUID rather than say so. The
-- honest model is that these records have no installation: make the column
-- nullable (the existing uuidv7 CHECK already passes null, since a `check`
-- constraint treats a null value as satisfied) and migrate any sentinel rows
-- already on disk to null.
update devices_audit_records
set installation_id = null
where installation_id = '00000000-0000-7000-8000-000000000000';
--> statement-breakpoint
alter table devices_audit_records
  alter column installation_id drop not null;
