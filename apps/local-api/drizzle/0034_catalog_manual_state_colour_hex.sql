alter table catalog_products
  alter column manual_state_colour type text
  using case manual_state_colour
    when 'blue' then '#0000ff'
    when 'green' then '#008000'
    when 'grey' then '#808080'
    when 'orange' then '#ffa500'
    when 'purple' then '#a855f7'
    when 'red' then '#ff0000'
    when 'yellow' then '#ffff00'
  end;
--> statement-breakpoint
alter table catalog_products
  add constraint catalog_products_manual_state_colour_hex
  check (
    manual_state_colour is null
    or manual_state_colour ~ '^#[0-9a-fA-F]{6}$'
  );
--> statement-breakpoint
drop type catalog_product_state_colour;
