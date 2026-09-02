alter table licence_installations
  drop constraint licence_installations_device_count;
--> statement-breakpoint
-- The permitted device count is licensing data set by the Super Admin,
-- never a hard-coded software limit. This bound is a transport-safety
-- guard against a malformed or forged value, not a product ceiling.
alter table licence_installations
  add constraint licence_installations_device_count check (
    permitted_device_count between 1 and 1000000
  );
