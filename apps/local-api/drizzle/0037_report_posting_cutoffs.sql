-- Purchasing's published read projection. Parent time/actor and row labels are
-- immutable. Consumers must not infer posting time from child insertion order.
create view purchasing_report_sources with (security_invoker = true) as
select document.pharmacy_id, document.id, 'purchase-invoice'::text as type,
       row.ordinal, document.posted_at, document.posted_by as actor_id,
       row.item_display_name as item, row.inventory_unit_name as unit,
       document.invoice_date as business_date, null::uuid as original_document_id,
       'P' || document.number_value || '/' || document.number_year as label
from posted_purchases document
join posted_purchase_rows row on row.pharmacy_id = document.pharmacy_id and row.posted_purchase_id = document.id
union all
select document.pharmacy_id, document.id, 'purchase-adjustment', row.ordinal,
       document.posted_at, document.posted_by,
       coalesce(row.after_snapshot ->> 'itemDisplayName', row.before_snapshot ->> 'itemDisplayName'),
       coalesce(row.after_snapshot ->> 'inventoryUnitName', row.before_snapshot ->> 'inventoryUnitName'),
       null::date, document.original_purchase_id,
       'P' || original.number_value || '/' || original.number_year || '-A' || lpad(document.suffix_value::text, 2, '0')
from posted_purchase_adjustments document
join posted_purchases original on original.pharmacy_id = document.pharmacy_id and original.id = document.original_purchase_id
join posted_purchase_adjustment_rows row on row.pharmacy_id = document.pharmacy_id and row.adjustment_id = document.id
union all
select document.pharmacy_id, document.id, 'purchase-return', row.ordinal,
       document.posted_at, document.posted_by, row.item_display_name, row.inventory_unit_name,
       null::date, document.original_purchase_id,
       'PR' || document.number_value || '/' || document.number_year
from posted_purchase_returns document
join posted_purchase_return_rows row on row.pharmacy_id = document.pharmacy_id and row.purchase_return_id = document.id;
--> statement-breakpoint
revoke all on purchasing_report_sources from public;
--> statement-breakpoint
grant select on purchasing_report_sources to breev_app;
--> statement-breakpoint
-- Inventory publishes complete posting effects without rewriting ledger history.
create view inventory_report_facts with (security_invoker = true) as
select movement.pharmacy_id, movement.id, movement.product_id, movement.batch_id,
       movement.quantity,
       case when movement.reason = 'purchase-adjustment' then 0 else movement.carrying_amount_fils end as value_fils,
       source.posted_at, source.actor_id, movement.reason,
       movement.source_document_id, movement.source_document_type, movement.source_row_ordinal,
       movement.id as movement_id, null::uuid as application_id,
       source.item, source.unit, source.business_date, source.original_document_id, source.label
from inventory_movements movement
join purchasing_report_sources source on source.pharmacy_id = movement.pharmacy_id
 and source.id = movement.source_document_id and source.type = movement.source_document_type
 and source.ordinal = movement.source_row_ordinal
union all
select effect.pharmacy_id, effect.id, effect.product_id, effect.batch_id,
       0, effect.carrying_amount_delta_fils, source.posted_at, source.actor_id,
       'purchase-adjustment', effect.source_document_id, effect.source_document_type, effect.source_row_ordinal,
       null::uuid, null::uuid, source.item, source.unit, source.business_date, source.original_document_id, source.label
from inventory_value_effects effect
join purchasing_report_sources source on source.pharmacy_id = effect.pharmacy_id
 and source.id = effect.source_document_id and source.type = effect.source_document_type
 and source.ordinal = effect.source_row_ordinal
union all
select movement.pharmacy_id, movement.id, movement.product_id, movement.batch_id,
       movement.quantity, movement.carrying_amount_fils, application.applied_at, application.applied_by,
       movement.reason, movement.source_document_id, movement.source_document_type, movement.source_row_ordinal,
       movement.id, application.id, line.item_display_name, line.inventory_unit_name, null::date, null::uuid,
       'Count session ' || application.session_id || ' · ' || line.ordinal
from inventory_movements movement
join inventory_count_lines line on line.pharmacy_id = movement.pharmacy_id
 and line.session_id = movement.source_document_id and line.ordinal = movement.source_row_ordinal
join inventory_count_variance_applications application on application.pharmacy_id = line.pharmacy_id and application.line_id = line.id
where movement.source_document_type = 'count-session';
--> statement-breakpoint
revoke all on inventory_report_facts from public;
--> statement-breakpoint
grant select on inventory_report_facts to breev_app;
--> statement-breakpoint
create index inventory_movements_report_source on inventory_movements
 (pharmacy_id, source_document_type, source_document_id, source_row_ordinal, batch_id);
