# T05 snapshot ownership and source review

Read #49, #50, #51 (including their comments), the initiated Phase 1 prompt,
scope §§4.3–4.4 and 6.1–6.3, and the domain/workflow/quality boundaries. Closed
issues are historical evidence, not proof of this candidate. Source snapshots
of those issue reads are retained in `.scratch/runtime/t05-issue-{49,50,51}.json`.

| Fact | Authoritative retained source | Candidate read/display |
| --- | --- | --- |
| Product identity and saved display name | Draft/posted row `product_id`, `item_display_name` | Existing historical name; identity in saved-facts disclosure |
| Supplier identity, name, invoice/date, number | Posted header | Existing historical header, independent of current Supplier |
| Entered unit, package name, integer ratio, entered/base quantity | Posted row | Existing base quantity plus exact entered facts in disclosure |
| Lot and expiry | Posted row | Existing historical table |
| Pricing method, margin and price-capture rule | Posted row | Localized disclosure; saved margin redacted with costs |
| Unit primary cost, line gross and discounted cost | Posted row | Existing line costs plus saved unit cost in disclosure |
| Supplier allowance and invoice offer shares | Stored gross/net/offer; exact server SQL difference for allowance | Disclosure; no live rates or renderer allocation |
| Retail price | Posted row | Existing historical table |
| Wholesale price | Current Product, subject to existing panel preferences | Live Purchasing panel only; #49/scope §4.4 explicitly exclude re-entry on each invoice. No fabricated historical wholesale value |
| Captured notes | Draft/posted row `notes` | Full multiline notes in historical item cell; optional draft editor retains them |
| Batch/movement/row/document references | Posted row/header | Secondary saved-facts disclosure |
| Posting audit identity and time | Posted header `posted_by`, `posted_at` | Existing time plus saved user identity in disclosure |

No new snapshot column or migration is needed: these row facts were already
persisted. The API previously omitted notes, pricing metadata and references.
Historical projections continue to read snapshots only; no master join, backfill
from current data, compatibility adapter or recalculation was introduced.
Names not historically captured (such as a separate Arabic search alias) are not
invented. Current item/Supplier drill-down remains explicitly labeled current.

The existing typed draft-row PUT already validates Product availability, pricing
mode, units, exact conversion, draft version and idempotency atomically. T05
exposes intentional Product/unit correction in the existing optional editor;
Cancel leaves the saved row, and Save retains the same row identity. Quantity
and cost refer to the selected entered unit, with explanatory text and server
validation. The uncommitted conversion is labeled pending until saved. The
accepted entry progression and Quick Product UI are unchanged.
Locked percentage retail in the optional editor is marked calculated on Save
after pricing or Product/unit changes, instead of displaying a client rounding
approximation. The authoritative saved response supplies the result.

Precedents inspected: [ERPNext Purchase Invoice](https://docs.frappe.io/erpnext/purchase-invoice)
stores transaction quantities/rates and submission facts, and its
[immutable ledger](https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext)
keeps original ledger facts with linked reversals. [Odoo vendor bills](https://www.odoo.com/documentation/saas-17.4/applications/finance/accounting/vendor_bills.html)
separates Draft and Posted and generates the posting number/journal at
confirmation. These support separating editable working data from retained
posting facts. Breev's offline local authority, atomic PostgreSQL transaction,
integer money and linked corrections are stricter governing requirements;
vendor cancellation/accounting policies were not imported or professionally
approved.

Presentation reuses the established prototype Purchasing toolbar, item table,
optional-controls popup and existing posted audit-disclosure/totals geometry.
Required saved notes, references and filter controls are explicit additions
because the prototype does not expose all funded immutable facts. New CSS is
scoped to Purchasing and its review dialog; global styles, shell, prototype
source, new-row keyboard handlers and Quick Product are untouched.

