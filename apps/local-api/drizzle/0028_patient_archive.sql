alter type patient_audit_action add value if not exists 'archive';
--> statement-breakpoint
alter type patient_audit_action add value if not exists 'restore';
--> statement-breakpoint
alter table patients add column archived_at timestamptz;
