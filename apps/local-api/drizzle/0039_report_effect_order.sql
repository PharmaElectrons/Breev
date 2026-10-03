-- Complete historical aggregation and bounded source-effect pages use the same
-- immutable source key. Cover the aggregate and its per-posting ID order even
-- before statistics catch up after a large import. No data or grants change.
drop index inventory_movements_report_source;
--> statement-breakpoint
create index inventory_movements_report_source on inventory_movements
  (pharmacy_id, source_document_type, source_document_id, source_row_ordinal, product_id, reason, id)
  include (batch_id, quantity, carrying_amount_fils);
