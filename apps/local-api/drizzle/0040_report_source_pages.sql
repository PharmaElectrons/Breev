-- Count a product's complete posting effects without scanning unrelated sources.
-- Keep effect ID immediately after the immutable posting key for bounded pages.
-- This adds a read index only; facts, money, grants and revisions do not change.
create index inventory_movements_report_source_order on inventory_movements
  (pharmacy_id, product_id, source_document_type, source_document_id, source_row_ordinal, id);
