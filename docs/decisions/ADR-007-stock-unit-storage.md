# ADR-007: Stock Units, Packaging Conversions, and Batches

- Status: **Proposed — Phase 0 review**
- Date: 2026-08-05
- Decision owners: Inventory / purchasing / sales
- Related: REQ-CAT-003, REQ-INV-001–005

## Context

Pharmaceutical products may be purchased and sold as boxes, strips, or smaller units. The prototype stores a mutable product quantity and sometimes overloads “third unit” with reminder days. Fractional stock and changing package ratios can corrupt historical quantities unless canonical units and snapshots are explicit.

## Proposed decision

- Each product selects one smallest **Inventory Unit** that can be transacted/count-verified; authoritative quantities are signed integers in that unit.
- Main, sub-, and optional tertiary units are definitions with positive integer conversion ratios to the Inventory Unit.
- Invoice lines retain entered unit, entered quantity, conversion ratio snapshot, and resulting inventory-unit quantity.
- Stock is the sum of append-only movements by product/batch/location scope; a cached on-hand projection may be rebuilt from movements.
- Batch records own expiry, lot and acquisition facts. Product master does not own the authoritative expiry or on-hand total.
- Packaging conversion changes are versioned and do not reinterpret historical movement/line quantities.
- FEFO is an allocation policy; it is distinct from WAC/FIFO/last-purchase valuation.
- Expired, recalled, and quarantined batches are immediately unavailable to allocation. A daily local evaluation changes expiry state even if the monthly review is never opened.
- Full/partial supplier return, write-off, and destruction are dedicated batch-referenced stock movements; postponed remainder stays blocked. They are never represented as zero-price sales.
- Every posted disposition permanently snapshots physical batch, inventory-unit quantity, valuation method, posting-time unit carrying cost, and total. WAC uses current exact WAC; FIFO uses applicable layer(s). Later purchases or recalculation cannot rewrite the snapshot.
- Batch expiry correction requires authorized pharmacist/manager re-authentication, reason, evidence, and preservation of the original value.

## Alternatives considered

- Store fractional boxes: intuitive display but creates precision/conversion ambiguity.
- Store all unit columns independently: can drift because the same physical stock has several mutable totals.
- Use product-level quantity/expiry: cannot represent batches or reliable history.

## Consequences

- Positive: exact counts and deterministic conversion/posting.
- Negative: catalog setup must validate divisibility/ratios; conversion changes and imported stock need controlled workflows.
- UI consequence: users work in familiar units while audit/history retains both entered and canonical quantities.
- Operational consequence: a monthly queue exposes all expired and unresolved blocked batches, while daily-job failure is observable and recovers on restart.

## Open detail

Product-specific allowance of partial smallest units and conversion-change procedure require examples during Phase 3, but they may not weaken integer authoritative stock.
