alter table posting_command_results
  drop constraint posting_command_results_name,
  add constraint posting_command_results_name check (
    command_name in (
      'catalog.barcode.add', 'catalog.barcode.print', 'catalog.barcode.suggest',
      'catalog.matching.approve', 'catalog.matching.open',
      'catalog.product.archive', 'catalog.product.create',
      'catalog.product.edit', 'catalog.product.merge',
      'inventory.batch_status.change', 'inventory.batch_expiry.correct',
      'inventory.count.session.start', 'inventory.count.line.record',
      'inventory.count.variance.apply', 'inventory.count.session.complete',
      'inventory.reorder.item.add', 'inventory.reorder.item.update',
      'inventory.reorder.item.remove', 'inventory.reorder.item.confirm',
      'inventory.reorder.item.return',
      'inventory.review-preferences.update', 'inventory.sensitive-export',
      'pharmacy.settings.update',
      'purchase.adjustment-draft.create', 'purchase.adjustment-draft.discard',
      'purchase.adjustment-draft.update', 'purchase.adjustment.post',
      'purchase.draft.create', 'purchase.draft.discard',
      'purchase.draft.row.commit', 'purchase.draft.row.delete',
      'purchase.draft.row.discard', 'purchase.draft.row.update', 'purchase.draft.update',
      'purchase.entry-preferences.update', 'purchase.post',
      'purchase.return-draft.create', 'purchase.return-draft.discard',
      'purchase.return-draft.update', 'purchase.return.post',
      'sale.draft.create', 'sale.draft.resume',
      'supplier.archive', 'supplier.create', 'supplier.edit', 'supplier.merge'
    )
  );
--> statement-breakpoint
create or replace function reject_purchase_draft_row_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  draft_status text;
begin
  select status into draft_status
  from purchase_drafts
  where pharmacy_id = old.pharmacy_id and id = old.draft_id;

  if draft_status is distinct from 'active' then
    raise exception 'Purchase draft rows cannot be mutated once the draft is posted or discarded'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
grant update, delete on table purchase_draft_rows to breev_app;
