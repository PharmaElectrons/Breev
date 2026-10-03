alter table sale_draft_lines
  drop constraint sale_draft_line_kind_fields;
--> statement-breakpoint
alter table sale_draft_lines
  add constraint sale_draft_line_kind_fields check (
    (line_kind = 'catalog' and product_id is not null and unit_id is not null and price_version is not null)
    or (line_kind = 'misc' and product_id is null and unit_id is null and price_version is null)
  );
