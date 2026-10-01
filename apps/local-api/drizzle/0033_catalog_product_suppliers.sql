create table catalog_product_suppliers (
  pharmacy_id uuid not null references pharmacies(id),
  product_id uuid not null,
  supplier_id uuid not null,
  recorded_at timestamptz not null default statement_timestamp(),
  recorded_by uuid not null,
  primary key (product_id, supplier_id),
  foreign key (product_id, pharmacy_id)
    references catalog_products(id, pharmacy_id),
  foreign key (supplier_id, pharmacy_id)
    references suppliers(id, pharmacy_id),
  foreign key (recorded_by, pharmacy_id)
    references identity_users(id, pharmacy_id)
);
--> statement-breakpoint
create index catalog_product_suppliers_supplier_product_idx
  on catalog_product_suppliers (pharmacy_id, supplier_id, product_id);
--> statement-breakpoint
revoke all on table catalog_product_suppliers from public;
--> statement-breakpoint
grant select, insert, update, delete on table catalog_product_suppliers
to breev_app;
