-- Identity's published display-only projection for read-model composition.
create view identity_report_actors with (security_invoker = true) as
select pharmacy_id, id, display_name from identity_users;
--> statement-breakpoint
revoke all on identity_report_actors from public;
--> statement-breakpoint
grant select on identity_report_actors to breev_app;
--> statement-breakpoint
create index posted_purchases_report_time on posted_purchases (pharmacy_id, posted_at, id);
--> statement-breakpoint
create index posted_purchase_adjustments_report_time on posted_purchase_adjustments (pharmacy_id, posted_at, id);
--> statement-breakpoint
create index posted_purchase_returns_report_time on posted_purchase_returns (pharmacy_id, posted_at, id);
--> statement-breakpoint
create index inventory_count_applications_report_time on inventory_count_variance_applications (pharmacy_id, applied_at, id);
