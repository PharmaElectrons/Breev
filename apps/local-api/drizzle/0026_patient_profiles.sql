create type patient_gender as enum (
  'male',
  'female'
);
--> statement-breakpoint
create type patient_audit_action as enum (
  'create',
  'edit-profile',
  'edit-notes',
  'edit-discount',
  'edit-dnd',
  'add-weight',
  'view-notes'
);
--> statement-breakpoint
create type patient_audit_outcome as enum (
  'allowed',
  'denied'
);
--> statement-breakpoint
create table patients (
  id uuid primary key default uuidv7(),
  first_name varchar(100) not null,
  last_name varchar(100) not null,
  phone varchar(20),
  date_of_birth date,
  gender patient_gender,
  height_cm numeric(5,1),
  discount_percent numeric(5,2),
  do_not_disturb boolean not null default false,
  address varchar(500),
  email varchar(254),
  chronic_conditions text[] not null default '{}',
  chronic_medications text[] not null default '{}',
  interests text[] not null default '{}',
  allergies text,
  smoking varchar(500),
  sensitivities text,
  other_notes text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patients_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint patients_first_name_length check (
    char_length(trim(first_name)) > 0
  ),
  constraint patients_last_name_length check (
    char_length(trim(last_name)) > 0
  ),
  constraint patients_height_check check (
    height_cm is null or (height_cm > 0 and height_cm <= 300)
  ),
  constraint patients_discount_check check (
    discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)
  ),
  constraint patients_time_order check (created_at <= updated_at)
);
--> statement-breakpoint
create table patient_weight_measurements (
  id uuid primary key default uuidv7(),
  patient_id uuid not null references patients(id),
  weight_kg numeric(5,1) not null,
  measured_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  created_by_user_id uuid not null references identity_users(id),
  constraint patient_weight_measurements_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint patient_weight_measurements_weight_check check (
    weight_kg > 0 and weight_kg <= 700
  )
);
--> statement-breakpoint
create table patient_audit_events (
  id uuid primary key default uuidv7(),
  patient_id uuid not null references patients(id),
  actor_user_id uuid not null references identity_users(id),
  action patient_audit_action not null,
  outcome patient_audit_outcome not null,
  changes jsonb,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint patient_audit_events_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);
--> statement-breakpoint
create index patients_search_idx
  on patients (lower(last_name), lower(first_name));
--> statement-breakpoint
create index patient_weight_measurements_patient_idx
  on patient_weight_measurements (patient_id, measured_at desc, id desc);
--> statement-breakpoint
revoke all on table
  patients,
  patient_weight_measurements,
  patient_audit_events
from public;
--> statement-breakpoint
grant select, insert, update on table patients to breev_app;
--> statement-breakpoint
grant select, insert on table patient_weight_measurements to breev_app;
--> statement-breakpoint
grant select, insert on table patient_audit_events to breev_app;
