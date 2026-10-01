create type patient_gender as enum ('male', 'female');
--> statement-breakpoint
alter table posting_command_results
  drop constraint posting_command_results_name,
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add', 'catalog.barcode.print', 'catalog.barcode.suggest',
      'catalog.matching.approve', 'catalog.matching.open',
      'catalog.product.archive', 'catalog.product.create', 'catalog.product.edit',
      'catalog.product.merge',
      'inventory.batch_status.change', 'inventory.batch_expiry.correct',
      'inventory.count.session.start', 'inventory.count.line.record',
      'inventory.count.variance.apply', 'inventory.count.session.complete',
      'inventory.reorder.item.add', 'inventory.reorder.item.update',
      'inventory.reorder.item.remove', 'inventory.reorder.item.confirm',
      'inventory.reorder.item.return', 'inventory.review-preferences.update',
      'inventory.sensitive-export',
      'patients.create', 'patients.save',
      'pharmacy.settings.update',
      'purchase.adjustment-draft.create', 'purchase.adjustment-draft.discard',
      'purchase.adjustment-draft.update', 'purchase.adjustment.post',
      'purchase.draft.create', 'purchase.draft.discard',
      'purchase.draft.row.commit', 'purchase.draft.row.delete',
      'purchase.draft.row.discard', 'purchase.draft.row.update',
      'purchase.draft.update', 'purchase.entry-preferences.update',
      'purchase.post', 'purchase.return-draft.create',
      'purchase.return-draft.discard', 'purchase.return-draft.update',
      'purchase.return.post',
      'sale.draft.create', 'sale.draft.resume', 'sale.draft.line.add',
      'sale.draft.misc-line.add', 'sale.draft.line.change',
      'sale.draft.line.remove', 'sale.draft.discount', 'sale.draft.clear',
      'sale.draft.suspend', 'sale.draft.discard',
      'sale.draft.line.price-override', 'sale.quick-access.replace',
      'supplier.archive', 'supplier.create', 'supplier.edit', 'supplier.merge'
    )
  );
--> statement-breakpoint
create table patients (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
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
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, pharmacy_id),
  constraint patients_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint patients_first_name_length check (char_length(trim(first_name)) > 0),
  constraint patients_last_name_length check (char_length(trim(last_name)) > 0),
  constraint patients_height_check check (
    height_cm is null or (height_cm >= 0.1 and height_cm <= 300)
  ),
  constraint patients_discount_check check (
    discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)
  ),
  constraint patients_revision_positive check (revision > 0),
  constraint patients_time_order check (created_at <= updated_at)
);
--> statement-breakpoint
create function preserve_patient_creation_and_revision() returns trigger
language plpgsql
as $$
begin
  new.created_at := old.created_at;
  new.revision := old.revision + 1;
  new.updated_at := greatest(statement_timestamp(), old.updated_at);
  return new;
end;
$$;
--> statement-breakpoint
create trigger patients_immutable_created_at_and_revision
before update on patients
for each row execute function preserve_patient_creation_and_revision();
--> statement-breakpoint
create table patient_weight_measurements (
  id uuid primary key default uuidv7(),
  pharmacy_id uuid not null references pharmacies(id),
  patient_id uuid not null,
  weight_kg numeric(5,1) not null,
  measured_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  created_by_user_id uuid not null,
  constraint patient_weight_measurements_id_uuidv7 check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint patient_weight_measurements_weight_check check (
    weight_kg >= 0.1 and weight_kg <= 700
  ),
  constraint patient_weight_measurements_patient_pharmacy_fk
    foreign key (patient_id, pharmacy_id) references patients(id, pharmacy_id),
  foreign key (created_by_user_id, pharmacy_id)
    references identity_users(id, pharmacy_id)
);
--> statement-breakpoint
create index patients_search_idx
  on patients (pharmacy_id, lower(last_name), lower(first_name));
--> statement-breakpoint
create index patient_weight_measurements_patient_idx
  on patient_weight_measurements (pharmacy_id, patient_id, measured_at desc, id desc);
--> statement-breakpoint
revoke all on table patients, patient_weight_measurements from public;
--> statement-breakpoint
grant select, insert, update on table patients to breev_app;
--> statement-breakpoint
grant select, insert on table patient_weight_measurements to breev_app;
