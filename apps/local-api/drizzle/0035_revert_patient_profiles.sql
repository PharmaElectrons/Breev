DROP TABLE IF EXISTS "patient_weight_measurements" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "patients" CASCADE;
--> statement-breakpoint
DELETE FROM "role_permission_grants" WHERE "permission_name" LIKE 'patients.%';
--> statement-breakpoint
UPDATE "pharmacy_roles" SET "revision" = "revision" + 1 WHERE "role_key" IN ('owner', 'manager');
--> statement-breakpoint
UPDATE "pharmacies" SET "identity_revision" = "identity_revision" + 1;
