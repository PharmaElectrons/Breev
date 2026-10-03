DROP TABLE IF EXISTS "patient_weight_measurements" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "patients" CASCADE;
--> statement-breakpoint
with deleted_grants as (
  delete from "role_permission_grants"
  where "permission_name" like 'patients.%'
  returning pharmacy_id, role_id
), advanced_roles as (
  update "pharmacy_roles" pharmacy_role
  set "revision" = pharmacy_role.revision + 1
  from (select distinct pharmacy_id, role_id from deleted_grants) grant_row
  where pharmacy_role.id = grant_row.role_id
    and pharmacy_role.role_key in ('owner', 'manager')
  returning pharmacy_role.pharmacy_id
)
update "pharmacies" pharmacy_row
set "identity_revision" = pharmacy_row.identity_revision + 1
where pharmacy_row.id in (select distinct pharmacy_id from advanced_roles);
