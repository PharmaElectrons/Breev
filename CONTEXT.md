# Breev domain context

This is the canonical glossary. Definitions describe the business language, not code structure. The reviewed bilingual Arabic term register is retained at the fixed commit (`git show 6ddc043:docs/domain/GLOSSARY.md`) and seeds the Arabic UI vocabulary.

| Term | Canonical meaning |
|---|---|
| Breev | The company and public product name. The product is an offline-first commercial pharmacy operating system. |
| Tenant | One subscribing Pharmacy organization and the immutable cloud security and billing boundary for its data. |
| Pharmacy | The subscribing and operating business. Initial scope is one operating location; do not use *Branch* as a synonym. |
| Main Pharmacy Computer | The pharmacy's Windows computer. It is the sole local authority and serves additional terminals over the LAN. |
| Additional POS Terminal | A paid LAN client with no independent authoritative database. It needs the Main Pharmacy Computer and LAN, but not the internet. |
| Free Core | Local pharmacy operation on the Main Pharmacy Computer and full access to pharmacy-owned data without a paid plan or cloud. |
| Permission | An authenticated user's authority to perform an action. It is independent of a plan Entitlement. |
| Entitlement | A signed plan capability grant, such as an added terminal, OCR, messaging, or cloud sync. It never grants user authority. |
| Step-Up Authorization | Immediate reauthentication by the same authorized user for a named sensitive action. |
| Dual Control | Two distinct authorized users prepare and approve a sensitive action. A user cannot approve their own action. |
| Cash Box | A continuous cash ledger, including per-employee cash drawers. Reconciliation never locks the sales screen; there is no forced open/close shift cycle. |
| Draft | Editable, durable work with no final stock or accounting effect. |
| Posted Document | An immutable sale, purchase, return, reversal, or other completed transaction. |
| Snapshot | A record of product, party, quantity, price, cost, rule, actor, device, and other facts at transaction time. It does not change when master data changes later. |
| Return | A new linked transaction for goods actually returned by a customer or to a supplier, with its own stock, money, and accounting effects. |
| Reversal | A new linked transaction that offsets a wrongly posted transaction without deleting it. Any needed replacement is a separate posted transaction. |
| Inventory Unit | The smallest exact unit the inventory ledger uses to record a product's stock. Also called the base unit; larger package units convert to it by integer ratios. |
| Frozen Snapshot | The client's roadmap concept of freezing every item detail inside a saved invoice. Phase One stores only the data saved with the document; the expanded concept is Phase Two. |
| Packaging Conversion | A product-specific positive integer ratio between a selling, purchasing, or counting package and its Inventory Unit. |
| Third Unit | An optional per-product unit stored only for number-of-days or dosage follow-up (for example, treatment days). It is never an inventory-balance, purchasing, or sales unit and has no stock effect. |
| Batch | Stock of one product with shared acquisition, lot, expiry, and status facts. Expiry is not a Product field. |
| Stock Movement | An append-only, reasoned quantity change. Movements determine on-hand stock. |
| FEFO | Physical allocation from the batch that expires first. It is separate from accounting valuation. |
| WAC | Weighted-average inventory valuation on the Primary Supplier Cost. It is Phase One's single costing method. |
| Primary Supplier Cost | The full nominal purchase cost before supplier allowance or discount. It is the basis for inventory valuation, average cost, and COGS. |
| Cost After Discount | The informational purchase cost after the invoice's snapshot allowance percentage. Shown on invoices and supplier statements; never a valuation basis. |
| Allowance | A supplier discount (*samah*). The supplier's default percentage on the invoice date is copied into each invoice as a snapshot. |
| Allowance Difference | The separate transaction recording the gap between the allowance calculated from invoices and the actual allowance granted at settlement. |
| Purchase Invoice Adjustment | A delta-only correction document (A01, A02, …) linked to a posted purchase invoice. Only the difference moves stock and the supplier account. |
| Carrying Amount | The exact inventory ledger value under the approved valuation method. Posting a movement freezes that value. |
| IQD Money | An exact signed integer count of fils, where 1 IQD equals 1,000 fils. Authoritative values never use binary floating point. |
| Anonymous Sale | A core sale without an optional Patient Profile. Required transaction identity remains separate when legally or commercially necessary. |
| Patient Profile | Optional longitudinal identity, contact details, and approved health context. It is separate from immutable transaction identity. |
| Consent Event | An append-only grant, denial, or withdrawal for one explicit purpose, notice version, and destination/provider context. It never replaces staff authorization. |
| Pseudonymization | Replacing direct identifiers while linkage remains possible. Pseudonymized or linkable data is never labeled anonymous. |
| Deletion Ledger | The protected, minimal record of deletion and anonymization outcomes that survives provider delay/failure, sync, outage, and backup restoration. |
| Regulatory Hard Block | A non-overridable prohibition caused by expiry, recall, quarantine, or another validated regulatory rule. |
| Clinical Alert | A traceable advisory result from approved structured inputs, mappings, rules, and licensed content; it is not diagnosis, prescribing, or dosing advice. |
| Not Evaluated | The explicit result when clinical prerequisites are incomplete or stale. It never means safe. |
| OCR Draft | Provider-extracted purchase data with provenance. It has no business effect until an authorized human reviews and posts it through the normal process. |
| Supplier Invoice Evidence | The pharmacy's encrypted local supplier-invoice original linked to a posted purchase. It is retained commercial evidence, distinct from provider-held data that is deleted promptly. |
| Licensed Clinical Knowledge Source | The current, signed, licensed drug-knowledge content that clinical evaluation requires. It is distinct from the regulatory source that drives Regulatory Hard Blocks. |
| One-Way Sync | Paid local-to-cloud replication for read-only remote views. The cloud cannot write local operational facts. |
| Cloud Command | A future, explicit, version-checked request for an allowlisted cloud-owned or editable field. The local system alone validates, applies, and acknowledges it. |
| Sync Conflict | A mismatch that retains Base, Current Local, and Requested Cloud values for explicit human resolution. Resolution cannot select a winner by timestamp or blindly overwrite a value. |
| Trusted Breev Time | Signed or high-water time evidence that detects rollback for licences and trust windows. It does not treat a fully offline, administrator-controlled clock as perfect. |
| Restore Quarantine | Restored data remains unavailable for normal use until the system replays and verifies later deletions, holds, device revocations, and security changes. |
