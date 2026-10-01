# T06 field ownership and bounded design

Base: accepted T05 local commit `73620cd1c1d79591fc96d7f716750dd4a2a310a7`.
T06 received explicit stakeholder manual PASS on 1 October 2026. It remains
uncommitted. The later-initiated [full automated gate](full-gate/report.md) ran on
that date with classified open findings. The stakeholder subsequently gave
explicit [Phase 1 PASS](../phase-1-checkpoint.md); those findings remain open.

Sources: scope §§4.3–4.6, 5.6, 6.1–6.3 and 7.1–7.3; docs product/domain/
workflows/architecture/quality; #49–#53/#190/#198; Phase 1 T06 prompt.
Prototype visual source: `design/prototype/src/components/app-shell.tsx`
`ProductInfoSidebar`, including its fraction cards and fact rows. Prototype
mock numbers, inferred dosage units and client arithmetic are not authority.

| Field | Current owner and meaning | Treatment |
| --- | --- | --- |
| Identity, scientific name, category, barcode, package ratios | Catalog current product | Narrow Catalog projection; existing scientific/category/packaging/wholesale preferences govern display |
| Live balance and package breakdown | Inventory movement sums, Catalog integer ratios | Inventory server BigInt decomposition; clinical third unit excluded; never draft quantity |
| Min/max/reorder | Catalog stored Inventory Unit levels | Exact strings, correct base unit label; null differs from zero |
| Batches, original/effective expiry, days remaining | Inventory immutable receipt + append-only safety facts, pharmacy business date and configured receipt-class threshold | Inventory server evaluation; on-hand batches retain expired/blocked quantities; no hardcoded React 90-day rule |
| Pricing mode and retail/wholesale | Catalog current pricing | Current labels; nullable wholesale is unavailable, zero is real zero; no mutable price projected into historical documents |
| Current average cost | Inventory valuation state on primary cost | Existing exact reported WAC per Inventory Unit; requires inventory valuation permission and Purchasing cost permission/setting |
| Frozen cost reference | Purchasing latest posted Purchase row snapshot | Explicit last posted Purchase reference, entered unit/quantity and both row cost totals; requires posted-view and cost visibility; not a selected draft's editable cost or an average |
| M2 alerts | Inventory established risk/eligibility rules | Text labels accompany status; no clinical or AI recommendation invented |
| Consumption averages, days-of-supply, estimated surplus | Later Reporting projection / incomplete sales history | Localized unavailable; no zero or extrapolation from purchases, returns or stocktakes; no #63/#75 implementation |
| Thumbnail | Catalog would own an available image, but current schema/contract has no image | Omit rather than invent an image provider or asset; ownership gap remains explicit |

Permission boundaries: the panel requires `purchases.drafts.manage`, existing
device/session/trust and tenant context. Stock/batch/risk require
`inventory.review`; valuation additionally requires `inventory.valuation.view`.
Purchasing cost setting and `purchases.costs.view` redact costs on the server;
the frozen reference also requires `purchases.posted.view`. No new grant or
entitlement is invented; this remains offline Free Core.

The new Purchasing component uses the same established panel geometry and
scoped additions. The existing Inventory component and shared/global styles
are preserved. Item-detail requests are independent from search, barcode and
row-save requests, abort on supersession/hidden state, time out, and immediately
clear superseded facts. No business calculation runs in React.

## Established-product comparison

[ERPNext Item](https://docs.frappe.io/erpnext/item) distinguishes stock UOM,
alternate conversion factors, stock thresholds and last Purchase rate. Its
[different-UOM guide](https://docs.frappe.io/erpnext/Selling-in-different-UOM)
keeps transaction units separate from stock units. These patterns fit Breev's
offline exact-unit facts and explicitly labeled last-posted reference. Its
warehouse automation, general fractional quantities, rate semantics and
reorder forecasting are not adopted: Breev's written integer units, cost basis,
permissions and regulated safety rules remain governing. The Odoo forecast
documentation was found in search but its page fetch timed out; it is not used
as implementation evidence.

G-01/G-02, professional gates, certified performance/Narrator and the older
unconfirmed evidence-note follow-up stay open. This matrix does not promote
later Reporting facts or authorize policy approval.
