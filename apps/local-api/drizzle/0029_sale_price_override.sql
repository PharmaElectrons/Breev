alter table sale_draft_lines add column price_source text not null default 'retail';
--> statement-breakpoint
alter table sale_draft_lines add column price_override_reason text;
--> statement-breakpoint
update sale_draft_lines set price_source = 'misc' where line_kind = 'misc';
--> statement-breakpoint
alter table sale_draft_lines add constraint sale_draft_line_price_source check (
  (line_kind = 'catalog' and price_source in ('retail', 'manual'))
  or (line_kind = 'misc' and price_source = 'misc')
);
--> statement-breakpoint
alter table sale_draft_lines add constraint sale_draft_line_override_reason check (
  (price_source = 'manual' and price_override_reason is not null
    and char_length(price_override_reason) between 1 and 250)
  or (price_source <> 'manual' and price_override_reason is null)
);
--> statement-breakpoint
insert into permission_definitions (name) values ('draft.price.override')
on conflict (name) do nothing;
--> statement-breakpoint
with eligible_roles as (
  select pharmacy_role.pharmacy_id, pharmacy_role.id as role_id,
         owner_user.id as granted_by
  from pharmacy_roles pharmacy_role
  join lateral (
    select identity_user.id
    from identity_users identity_user
    join pharmacy_roles owner_role on owner_role.id = identity_user.role_id
    where identity_user.pharmacy_id = pharmacy_role.pharmacy_id
      and identity_user.status = 'active'
      and owner_role.role_key = 'owner'
    order by identity_user.created_at, identity_user.id
    limit 1
  ) owner_user on true
  where pharmacy_role.role_key in ('owner', 'manager')
), inserted_grants as (
  insert into role_permission_grants (
    pharmacy_id, role_id, permission_name, granted_by
  )
  select pharmacy_id, role_id, 'draft.price.override', granted_by
  from eligible_roles
  on conflict (role_id, permission_name) do nothing
  returning pharmacy_id, role_id
), advanced_roles as (
  update pharmacy_roles pharmacy_role
  set revision = pharmacy_role.revision + 1
  from (select distinct pharmacy_id, role_id from inserted_grants) grant_row
  where pharmacy_role.id = grant_row.role_id
  returning pharmacy_role.pharmacy_id
)
update pharmacies pharmacy_row
set identity_revision = pharmacy_row.identity_revision + 1
where pharmacy_row.id in (select distinct pharmacy_id from advanced_roles);
--> statement-breakpoint
alter table posting_command_results drop constraint posting_command_results_name,
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add', 'catalog.barcode.print', 'catalog.barcode.suggest',
      'catalog.matching.approve', 'catalog.matching.open',
      'catalog.product.archive', 'catalog.product.create', 'catalog.product.edit',
      'catalog.product.merge',
      'inventory.batch_status.change', 'inventory.batch_expiry.correct',
      'inventory.count.session.start', 'inventory.count.line.record',
      'inventory.count.variance.apply', 'inventory.count.session.complete',
      'inventory.reorder.item.add', 'inventory.reorder.item.update',
      'inventory.reorder.item.remove', 'inventory.reorder.item.confirm',
      'inventory.reorder.item.return', 'inventory.review-preferences.update',
      'inventory.sensitive-export', 'pharmacy.settings.update',
      'purchase.adjustment-draft.create', 'purchase.adjustment-draft.discard',
      'purchase.adjustment-draft.update', 'purchase.adjustment.post',
      'purchase.draft.create', 'purchase.draft.discard',
      'purchase.draft.row.commit', 'purchase.draft.update',
      'purchase.entry-preferences.update', 'purchase.post',
      'purchase.return-draft.create', 'purchase.return-draft.discard',
      'purchase.return-draft.update', 'purchase.return.post',
      'sale.draft.create', 'sale.draft.resume', 'sale.draft.line.add',
      'sale.draft.misc-line.add', 'sale.draft.line.change',
      'sale.draft.line.remove', 'sale.draft.discount', 'sale.draft.clear',
      'sale.draft.suspend', 'sale.draft.discard',
      'sale.draft.line.price-override', 'sale.quick-access.replace',
      'supplier.archive', 'supplier.create', 'supplier.edit', 'supplier.merge'
    )
  );
