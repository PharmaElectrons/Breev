-- Additive facts: pre-offer documents retain their original costs and zero offer.
-- Retained command receipts are immutable. Mark their stored generation without
-- rewriting payloads. The new stored projection is the sole replay seam.
alter table posting_command_results
  add column purchase_offer_receipt_version integer not null default 0,
  add constraint posting_purchase_offer_receipt_version check (purchase_offer_receipt_version in (0, 1));
--> statement-breakpoint
alter table posting_command_results alter column purchase_offer_receipt_version set default 1;
--> statement-breakpoint
create function purchase_offer_receipt_projection(command_name text, generation integer, response_status integer, body jsonb)
returns jsonb language plpgsql immutable strict set search_path = pg_catalog, public as $$
declare
  snapshot jsonb := '{"input":{"mode":"none","value":"0"},"ruleVersion":1,"basisFils":"0","offerFils":"0"}';
  draft_additions jsonb := '{"invoiceOffer":{"mode":"none","value":"0"},"offerRuleVersion":1}';
  draft jsonb;
begin
  if generation not in (0, 1) then
    raise exception 'Unsupported Purchase receipt generation' using errcode = '23514';
  end if;
  if generation = 1 or response_status >= 400 then return body; end if;
  if command_name = 'purchase.post' then
    return jsonb_set(body, '{posted,invoiceOffer}', snapshot);
  elsif command_name = 'purchase.adjustment.post' then
    return jsonb_set(body, '{posted}', (body->'posted') || jsonb_build_object(
      'offerDeltaFils', '0', 'offerComparison', jsonb_build_object('before', snapshot, 'after', snapshot)));
  elsif command_name in ('purchase.draft.create', 'purchase.draft.update', 'purchase.draft.row.commit', 'purchase.draft.row.update') then
    draft := body->'draft';
    if draft ? 'review' then
      draft := jsonb_set(draft, '{review}', (draft->'review') || jsonb_build_object('invoiceOffer', snapshot));
    end if;
    return jsonb_set(body, '{draft}', draft || draft_additions);
  elsif command_name in ('purchase.draft.discard', 'purchase.draft.row.discard', 'purchase.adjustment-draft.create', 'purchase.adjustment-draft.update', 'purchase.adjustment-draft.discard') then
    if body ? 'review' then
      body := jsonb_set(body, '{review}', (body->'review') || jsonb_build_object('invoiceOffer', snapshot));
    end if;
    return body || draft_additions;
  end if;
  return body;
end;
$$;
--> statement-breakpoint
alter table posting_command_results add column response_projection jsonb
generated always as (purchase_offer_receipt_projection(command_name, purchase_offer_receipt_version, response_status, response_body)) stored not null;
--> statement-breakpoint
create function valid_purchase_offer_input(value jsonb) returns boolean
language sql immutable strict as $$
  select coalesce(case
    when jsonb_typeof(value) <> 'object'
      or not (value ?& array['mode', 'value'])
      or (value - 'mode' - 'value') <> '{}'::jsonb
      or jsonb_typeof(value->'mode') <> 'string'
      or jsonb_typeof(value->'value') <> 'string' then false
    when value->>'mode' = 'none' then value->>'value' = '0'
    when value->>'mode' = 'fixed' then case
      when value->>'value' ~ '^(0|[1-9][0-9]*)$'
      then (value->>'value')::numeric <= 9223372036854775807 else false end
    when value->>'mode' = 'percentage' then case
      when value->>'value' ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'
      then (value->>'value')::numeric <= 100 else false end
    else false end, false)
$$;
--> statement-breakpoint
create function valid_purchase_offer_snapshot(value jsonb) returns boolean
language sql immutable strict as $$
  select coalesce(case
    when jsonb_typeof(value) <> 'object'
      or not (value ?& array['input', 'ruleVersion', 'basisFils', 'offerFils'])
      or (value - 'input' - 'ruleVersion' - 'basisFils' - 'offerFils') <> '{}'::jsonb
      or not valid_purchase_offer_input(value->'input')
      or value->'ruleVersion' <> '1'::jsonb
      or jsonb_typeof(value->'basisFils') <> 'string'
      or jsonb_typeof(value->'offerFils') <> 'string' then false
    when value->>'basisFils' ~ '^(0|[1-9][0-9]*)$'
      and value->>'offerFils' ~ '^(0|[1-9][0-9]*)$' then
      (value->>'basisFils')::numeric <= 9223372036854775807
      and (value->>'offerFils')::numeric <= (value->>'basisFils')::numeric
      and case when value->'input'->>'mode' = 'none'
        then value->>'basisFils' = '0' and value->>'offerFils' = '0'
        when value->'input'->>'mode' = 'fixed'
        then value->>'offerFils' = value->'input'->>'value'
        else (value->>'offerFils')::numeric = round((value->>'basisFils')::numeric * (value->'input'->>'value')::numeric / 100) end
    else false end, false)
$$;
--> statement-breakpoint
alter table purchase_drafts
  add column invoice_offer jsonb not null default '{"mode":"none","value":"0"}',
  add column offer_rule_version integer not null default 1,
  add constraint purchase_draft_offer_input check (valid_purchase_offer_input(invoice_offer)),
  add constraint purchase_draft_offer_version check (offer_rule_version = 1);
--> statement-breakpoint
alter table posted_purchases
  add column invoice_offer jsonb not null default '{"input":{"mode":"none","value":"0"},"ruleVersion":1,"basisFils":"0","offerFils":"0"}',
  add constraint posted_purchase_offer_snapshot check (valid_purchase_offer_snapshot(invoice_offer)),
  drop constraint posted_purchases_money_consistent,
  add constraint posted_purchases_money_consistent check (
    cost_after_discount_fils::numeric + allowance_fils + (invoice_offer->>'offerFils')::numeric = primary_supplier_cost_fils
    and allowance_basis_fils = primary_supplier_cost_fils
    and (invoice_offer->'input'->>'mode' = 'none' or (invoice_offer->>'basisFils')::bigint = primary_supplier_cost_fils)
  );
--> statement-breakpoint
alter table posted_purchase_rows
  add column offer_fils bigint not null default 0,
  add constraint posted_purchase_row_offer_nonnegative check (offer_fils >= 0 and offer_fils <= line_primary_supplier_cost_fils);
--> statement-breakpoint
alter table purchase_adjustment_drafts
  add column invoice_offer jsonb not null default '{"mode":"none","value":"0"}',
  add column offer_rule_version integer not null default 1,
  add constraint purchase_adjustment_draft_offer_input check (valid_purchase_offer_input(invoice_offer)),
  add constraint purchase_adjustment_draft_offer_version check (offer_rule_version = 1);
--> statement-breakpoint
alter table posted_purchase_adjustments
  add column offer_before_snapshot jsonb not null default '{"input":{"mode":"none","value":"0"},"ruleVersion":1,"basisFils":"0","offerFils":"0"}',
  add column offer_after_snapshot jsonb not null default '{"input":{"mode":"none","value":"0"},"ruleVersion":1,"basisFils":"0","offerFils":"0"}',
  add column offer_delta_fils bigint not null default 0,
  add constraint purchase_adjustment_offer_before check (valid_purchase_offer_snapshot(offer_before_snapshot)),
  add constraint purchase_adjustment_offer_after check (valid_purchase_offer_snapshot(offer_after_snapshot)),
  add constraint purchase_adjustment_offer_delta check (
    offer_delta_fils = (offer_after_snapshot->>'offerFils')::bigint - (offer_before_snapshot->>'offerFils')::bigint
  );
--> statement-breakpoint
create function enforce_purchase_offer_draft_change() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.offer_rule_version <> old.offer_rule_version
    or (new.status <> 'active' and new.invoice_offer is distinct from old.invoice_offer) then
    raise exception 'A Purchase offer rule is immutable and closing a draft cannot change its offer'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger purchase_draft_offer_change before update on purchase_drafts
for each row execute function enforce_purchase_offer_draft_change();
--> statement-breakpoint
create trigger purchase_adjustment_draft_offer_change before update on purchase_adjustment_drafts
for each row execute function enforce_purchase_offer_draft_change();
