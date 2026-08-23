# Breev pharmacy management system

## Phase One scope of work (MVP)

Milestones, acceptance criteria, and change control

| **Client** | Breev Company / Dr. Saif Al-Din |
| --- | --- |
| **Developer** | Mohamed Mostafa |
| **Version** | 1.2, updated draft for approval after review of the client's latest feedback |
| **Date** | August 9, 2026 |
| **Target delivery period** | Up to 56 calendar days, excluding delays caused by client approvals and external services |

> This document is the proposed final scope for Phase One. Once approved in writing on Mostaql, any feature, screen, flow, report, integration, or business rule not explicitly stated here will be treated as a separate change request with its own price and timeline.

*Confidential. Ownership of the design, application logic, data, and source code transfers to Breev Company after all amounts due have been paid in full.*

# Document control

## Purpose

This document defines Breev's complete Phase One delivery boundaries and incorporates the latest clarifications on device expansion, smart search, pricing, purchase invoices, stocktaking, patients, cash accounts, and accounting entries. It governs the Phase One price and timeline. Details, images, or ideas in the client's longer draft are not commitments unless explicitly included here. These boundaries prevent ambiguity and uncontrolled scope expansion during the target implementation period.

## Order of precedence

| Priority | Reference | Use |
| --- | --- | --- |
| 1 | This document after approval, together with subsequent change orders | Governing contractual reference for the Phase One scope and acceptance criteria. |
| 2 | The latest written clarifications approved by both parties and incorporated into an updated version | Modify only the items explicitly documented and approved. |
| 3 | Breev's latest detailed draft and the final interface-images file | Requirements and visual references. Their functions are included in the price and timeline only when this document explicitly incorporates them. |
| 4 | Lovable and images or videos of the current system | References for flow, design, and accounting where applicable. They do not add scope automatically. |

## Conflict rule

> Once approved, this version governs. A later clarification changes the scope only when both parties approve it in writing and add it to an updated version or change order. If the client's draft conflicts with itself, the latest approved, specific written clarification takes precedence.

# 1. Product overview and Phase One objective

Breev is a commercial pharmacy-management product for multiple pharmacies, offered through a free base plan, paid plans, and add-ons. It is not a single-pharmacy system. Breev must operate locally without internet access, support subscriptions, control feature visibility and availability, and accommodate future cloud expansion and multi-branch operation.

> Phase One is the first commercial version suitable for a real pharmacy. Users can install it, enter purchases, manage inventory, complete sales, manage patients, record cash and account movements, and view essential reports. Work continues during an internet outage.

## 1.1 Phase One includes more than the free plan

Phase One includes the free plan, the foundation for subscriptions and feature control, and selected paid add-ons that Breev can sell to pharmacies. A Phase One feature may remain hidden unless enabled for a specific pharmacy.

## 1.2 Phase One plan model

| Plan or add-on | Meaning in Phase One |
| --- | --- |
| **Free Base Plan** | One device only, local operation, sales, purchases, inventory, and the approved basic accounting functionality, with no cloud connection. |
| **Additional Device/POS** | A paid add-on allowing another device to operate on the same local network. |
| **One-Way Cloud Sync** | A paid add-on that uploads data to the cloud for external viewing only. |
| **Purchase-Invoice OCR** | A paid add-on for reading printed supplier invoices. |
| **AI Services** | A paid add-on or part of a plan, limited to the Phase One boundaries stated in this document. |
| **WhatsApp and Messaging** | A paid add-on or part of a plan; provider costs are outside the development price. |
| **CRM and Advanced Reports** | May be enabled according to the final plan and feature matrix. |

# 2. Technical and operational model

## 2.1 Offline-first local operation

- The pharmacy can continue sales, purchases, inventory review, and accounting transactions without internet access.

- The main device inside the pharmacy hosts the local database and runs the local application service.

- Secondary devices communicate with the main device through the local service. They do not open or share the raw database file directly.

- When internet connectivity returns, any cloud services enabled for the pharmacy's plan resume operation.

## 2.2 Free plan installation on one device

Under the free plan, one desktop or laptop acts as the point of sale, data-entry device, local server, and database host. The plan does not include cloud login, remote monitoring, or access from outside the pharmacy.

## 2.3 Additional local devices

- Initial setup and Phase One testing cover four devices in the pharmacy: one main device running the local service and database, plus up to three additional work or POS devices.

- The number 4 is not a fixed software limit. The architecture must not hard-code the device count. The Super Admin must be able to increase a pharmacy's permitted device count in the future according to its plan or subscription.

- While the main device and local service are running, any authorized employee can sign in from any licensed device in the pharmacy. Account permissions, not device type, determine what the employee can do.

- Devices connect over the local network through Wi-Fi or Ethernet. Local operation does not require internet access. If no wireless router is available, the pharmacy can use a suitable switch or router and local network cabling.

- The pharmacy or client supplies the computers, printers, barcode scanners, cables, switch or router, battery or UPS, and on-site installation.

- Architectural and licensing support for more than four devices is included, but Phase One performance and acceptance testing uses four simultaneous devices. Higher loads may require an upgrade to the main device or network. Phase One does not guarantee unlimited devices on the same hardware.

## 2.4 Proposed technologies

| Layer | Planned technology |
| --- | --- |
| **Desktop Application** | React.js or Vue.js inside Electron.js |
| **Local Data** | SQLite behind the local application service |
| **Cloud Backend** | Laravel 12 / PHP |
| **Cloud Database** | PostgreSQL or MySQL |
| **Integration** | REST API |
| **Authentication and Permissions** | JWT/Sanctum with RBAC |
| **Hosting** | Infrastructure owned by Breev, such as AWS or DigitalOcean |

## 2.5 Inventory units and synchronization model

- The smallest approved sales or movement unit for an item is its authoritative inventory quantity. Operational and synchronized quantities use integers, not fractional package quantities.

- For example, if 1 pack equals 4 strips, purchasing 1 pack records 4 strips in the base unit. Showing 1 pack or 4 strips is a UI conversion only.

- The item record defines packaging ratios between large and small units as integer conversion factors. Sales, purchases, and stocktaking use those factors without losing precision.

- Synchronization transfers eligible transactions with unique identifiers and prevents duplicate transactions as far as reasonably possible. It does not transmit raw decimal balances that could accumulate rounding differences.

- During Phase One, the local system remains the source of truth and cloud synchronization is one-way for external viewing only. Two-way merge and conflict-resolution rules belong to Phase Two.

# 3. Platform foundation, licensing, and administration

## 3.1 Login, users, and permissions

- Login by username and password is mandatory, with no direct bypass.

- The system supports detailed users, roles, and permissions for approved owner, manager, pharmacist, sales employee, purchasing employee, inventory employee, accountant, and support roles.

- Each role can have configurable permissions for screens, actions, cost prices, exports, edits, reports, and sensitive transactions.

- Every sale, purchase, purchase adjustment, return, voucher, cash-account movement, stocktake or adjustment, and other sensitive change records the user, date, time, and reference document.

- If enabled, the system supports simple manual employee attendance with check-in and check-out. Fingerprint-device integration and automated payroll are deferred to Phase Two.

## 3.2 Pharmacies, plans, and feature control

- Each pharmacy has its own independent license, settings, users, and permitted device count.

- Menus and functions not enabled for a pharmacy are hidden completely, not shown as disabled buttons.

- Licensing supports monthly or annual plans and paid add-ons.

- When a subscription expires, paid functions become unavailable or read-only according to the approved rule, without deleting data.

- Basic offline license protection is included to deter circumvention through changes to the device date or clock.

## 3.3 Minimum Phase One Super Admin functionality

- Create and register a new pharmacy installation.

- Assign or change the pharmacy's plan and enabled add-ons.

- The Breev founder or Super Admin can grant any paid feature to a specific pharmacy or group of pharmacies at no charge without changing the global plan definition.

- Set the permitted number of devices and POS terminals.

- Enable or disable OCR, AI, messaging, cloud viewing, and other prepared features.

- View basic license and synchronization status.

*A complete external web dashboard for editing operational pharmacy data over the internet belongs to Phase Two and is not part of Phase One.*

## 3.4 Dashboard and operational alerts

- A main dashboard shows essential operational summaries such as sales, low-stock alerts, expiry alerts, and patient follow-ups according to the user's permissions.

- A sortable item-summary table or grid shows approved fields such as item name, quantity sold, profit, profit percentage, expiry, stock level, monthly consumption rate, and estimated surplus.

- A unified notification center can combine item, patient, invoice, and due-date alerts under one icon with separate tabs.

- Predictive analytics or advanced AI recommendations are outside the basic Phase One functionality and are not acceptance requirements unless explicitly stated in the approved AI section.

# 4. Item definition, naming, packaging, and pricing

## 4.1 Two item-definition modes

| Mode | Naming rule |
| --- | --- |
| **Medication Mode** | The displayed name is generated from the approved fields: trade name + concentration or strength + dosage form + company, with supporting fields such as scientific or generic name, category, and barcode. |
| **General/Medical/Cosmetic Item Mode** | The displayed English name is generated from the approved field order, such as company or manufacturer, series, type or use, property or grade, target category, and size or capacity. |

- A clear control switches between medication and general-item naming.

- A separate Arabic search name appears below the generated English name.

- The final name is generated from the fields and is not entered as an unrelated free-text name.

## 4.2 Smart search

- Instant search in sales, purchases, and item records accepts Arabic names, English names, and barcodes. It normalizes letter case, spaces, and simple punctuation.

- Search words need not be adjacent. The system splits a query into parts, which must appear in the same order within the name even when other words occur between them.

- Acceptance example: a search for "panadol gs" must return "Panadol Extra GSK," and a search for "extra" must return every item whose name contains "Extra."

- Within each part, search matches characters in sequence and is not limited to prefixes. Semantic spelling correction and semantic AI search are not included unless later added as separate features.

## 4.3 Packaging and units

- Each item supports a base unit and sub-unit with a defined integer conversion ratio, such as pack, strip, or tablet.

- Each interface can have a default unit, such as the larger unit for purchasing and smaller unit for selling. Users can change it during a transaction where permitted.

- Changing the sales or purchase unit recalculates quantity and price according to the packaging ratio without using fractional quantities in the base-unit inventory balance.

- A third unit may be stored only for number-of-days or dosage follow-up. It is not an inventory-balance, purchasing, or sales unit.

- Item instructions may specify uses per day, week, or month and whether the item is taken before food, after food, or regardless of food. The approved interface shows these instructions in the sales and patient context.

- Subject to permissions, users can edit all item-record data, including names, barcodes, packaging, and prices. The inventory balance remains read-only and can be corrected only through quick stocktaking or standard system transactions.

## 4.4 Cost, retail price, wholesale or special price, and margin

- When defining an item, the user sets its primary retail price, wholesale or special price, and pricing method. Each item defaults to "sell by price."

- Every purchase invoice shows the retail price. The pricing method configured in the item record determines which field is editable.

- **"By Price" mode.** The percentage field is unavailable, and the retail price can be edited in the purchase invoice. Once the invoice is saved, the latest approved retail price becomes the item's current price until the item record or a later purchase invoice changes it.

- **"By Percentage" mode.** The retail-price field cannot be edited manually in the purchase invoice, but the percentage field is editable. The system calculates the retail price from the approved cost and stored percentage.

- The intended profit percentage is margin on the selling price, not markup on the purchase cost. Example: a cost of 80 with a 20% margin produces a selling price of 100 before rounding is applied.

- Settings can round the calculated price to the nearest 250, 500, or 1,000 Iraqi dinars. Rounding can also be disabled.

- The wholesale or special price remains in the item record and appears in the item information or side panel. Users do not enter it manually on every purchase invoice unless the final approved design specifies otherwise.

- When a sale is below average cost or the approved cost, the price or item text appears in red as a warning. A setting can require manager permission or approval to continue. This setting is disabled by default, so manager approval is not normally required.

## 4.5 Item colors and data availability

- Manual and automatic colors indicate conditions such as a missing barcode, low stock, expiry, sale below cost, FEFO or cold storage, and other approved states.

- Controls determine whether an item may appear in external or web views and whether its data may be shared with AI or external responses.

- Sensitive or restricted items can be excluded from external availability responses.

## 4.6 Item movement history

- "Item Movement Details" is a list or popup of the item's historical transactions, including purchases, purchase adjustments, purchase returns, sales, sales returns, stocktakes or adjustments, and expired or damaged stock write-offs.

- Subject to permissions, each movement shows its reference document, date, time, user, quantity, and value. The user can open the original document when available.

- Damage or expiry-related removal remains in the movement history so it can later be analyzed to understand actual consumption and reduce recurring surplus and wastage. Advanced AI analysis for this purpose is future development unless separately approved.

- Approved barcode actions include functions such as suggesting a barcode for an item without one, printing a barcode, and adding multiple barcodes to the same item.

- The system may provide sequential or bulk item definition to speed up initial data entry. Importing an external database and cleaning or matching old-system data are separate services and are not included.

## 4.7 Daily item-matching list

- The matching icon opens up to 10 suggested items in the daily review and matching batch. An item disappears once its match is approved. Incomplete items remain until handled, after which the approved flow may suggest another batch.

# 5. Sales and POS scope

## 5.1 Core sales flow

- Users can search and add items by barcode or name, suspend invoices, and return to them without losing data.

- Approved payment methods are cash, card or credit, and deferred or on-account sales for a limited set of patients or known customers.

- Cash sales post to the employee or cash-sales drawer. Card or credit sales post to the card or payment-company account and do not increase physical drawer cash. This separation lets the drawer reconcile against actual cash and card slips or transactions.

- When permitted, deferred sales post as patient receivables. The system does not offer general on-account sales to all customers.

- The flow supports quantity, unit, price, discount, returns or refunds, and invoice saving and printing. It links each transaction to the user, inventory, patient, and accounts.

- Unsaved invoice data remains when the user navigates away and returns. If the user clicks **New** or tries to delete or clear an invoice that contains items, a confirmation warning appears before any data is lost.

## 5.2 Quick patient creation and patient context during a sale

- A `+` button beside patient search opens a patient-creation dialog without leaving the sales screen.

- When a patient is selected, the approved summary is shown, including chronic conditions, chronic medications, and recorded interests.

- If the patient has important notes, such as allergies, smoking, or other warnings, a popup asks the pharmacist to review them. The pharmacist can then dismiss it and continue.

- Chronic medications can be added directly to the invoice. Medications already in the invoice can also be converted into a chronic-treatment list in the patient's profile using the approved action before the sale is completed or cancelled.

- When defined for the item or treatment, fields for frequency of use, food instructions, and number of days appear and are used for patient follow-up and reminder scheduling according to the plan.

- A dosage-calculation field based on age and weight may be provided. Before enabling any medical result, the client must supply or approve the dosage rules and medical source or formulas. Phase One AI does not automatically include advanced clinical consultation.

## 5.3 Quick item creation from the sales screen

- When an unregistered barcode is scanned, the item-definition dialog opens automatically without leaving the sales screen.

- For an item without a barcode, **Pick Item** opens name search. If there is no result, **Enter** or **Add** opens the same item-definition dialog.

- Users can open the item record from a displayed invoice by double-clicking or using the approved action icon. Current unsaved invoice data remains intact.

- Subject to permissions, the quick **Add** button can create a miscellaneous item or service. If the user enters no cost, the cost defaults to zero and profit reflects the recorded data. If the service or item has an actual cost, the system uses it instead.

## 5.4 Changing quantity, unit, price, and discount

- Change the unit with the selector in the item row.

- Change quantity with the `+` and `-` buttons or the side calculator.

- Clicking the price opens a numeric dialog for direct editing.

- The side calculator can apply a number as a quantity, price, or discount to the selected item or invoice.

- Because the row already supports unit changes, a discount action may replace the calculator's change-unit action.

- A separate invoice-level discount field remains available.

## 5.5 Navigation and saved invoices

- The search button opens a popup list of completed or saved sales invoices. Subject to permissions, users can open them for viewing.

- An approved or finalized sales invoice cannot be edited directly. Subject to permissions, users correct an earlier sale with a sales-return or refund invoice linked to the original.

- Previous- and next-invoice arrows speed up review.

- Later item-record changes do not alter an earlier sales invoice. The development roadmap's full Frozen Snapshot concept is not included in Phase One beyond the data stored with the saved invoice.

## 5.6 Item details panel and cash-drawer balance

- The left item-details panel appears only in sales and purchases, not in the items or inventory interfaces. Settings control which fields it displays.

- The item name appears at the top. The panel may show the scientific or generic name, balance, packaging, minimum and maximum levels, batch data, expiry date, and days remaining.

- According to settings, the panel shows monthly consumption as a 1-, 2-, or 3-month average and the current item's estimated surplus.

- The sales table shows only the primary retail price. Subject to permissions, the side panel may show the wholesale or special price.

- The design includes a collapsible "AI Recommendations" section. In Phase One, it contains only recommendations or data within the agreed basic AI scope. Drug-interaction analysis, dosage analysis, and advanced clinical decisions are not acceptance requirements unless the parties approve a medical source and separate scope.

- The final design places the barcode-print button beside the item row or within its actions. It also shows an item thumbnail when available.

- The employee's current cash-drawer balance replaces the duplicate total below the calculator. A setting or permission controls whether the balance is visible.

## 5.7 Expired and damaged items

- The system does not remove expired or damaged stock automatically. It presents eligible items for review. A manager or authorized user approves removal of some or all of the quantity or postpones processing.

- An approved write-off reduces inventory and records a separate "Expired/Damaged Medication Loss" transaction. It is neither a sale nor a supplier return and does not increase any cash account.

- The loss cost reduces net profit for the period through a separate loss account without distorting the profit margin of the sales themselves.

- Item Movement Details records each destruction or expiry write-off with its user, date, quantity, value, and reason. This history supports later analysis of true need and recurring waste.

## 5.8 Customizable quick-access list

- The quick-access icon opens a window of tabs or categories and items configured by the pharmacy manager in settings. It is for frequently sold items and cases where scanning a barcode each time is impractical.

- Each option displays the item name and image when available. Clicking it adds the item directly to the invoice using the approved default unit and price.

- Items can be grouped into folders or categories. Settings control their order and availability.

## 5.9 Reorder basket from the sales interface

- An "Add to Order Basket" action is available for items in both the sales and inventory interfaces. It respects user permissions and does not disrupt the current invoice.

# 6. Purchases, suppliers, and OCR

## 6.1 Purchase-invoice flow

- The user enters the supplier invoice number, supplier, items, and remaining invoice data in that order. Item entry supports barcodes and smart name search.

- The flow supports full keyboard navigation. **Enter** moves through active fields. From the last field, it either opens a new row or returns focus to the barcode or item field, according to the user's setting.

- The approved interface allows columns to be shown, hidden, and reordered. Each item's retail price appears in the purchase invoice, and its "By Price" or "By Percentage" mode determines field locking.

- The left item-details panel appears during purchasing according to the same principle approved for sales.

## 6.2 Suppliers and cost

- Each supplier has a profile, default allowance or discount percentage, and basic terms. The system copies the rate that applies on the invoice date into the invoice as a Snapshot. Later changes to the supplier's rate do not alter earlier invoices.

- A purchase invoice stores two values: "Primary Supplier Cost" before allowance or discount, and the calculated "Cost After Discount" for display, review, and supplier statements.

- Under the latest accounting clarification, the primary supplier cost before discount is the approved Phase One basis for inventory valuation, average item cost, and cost of goods sold. Cost after discount does not replace that basis or recalculate historical average cost.

- The system may support an additional invoice-specific discount or offer while storing the primary cost, allowance percentage, allowance amount, and cost after discount in the same invoice.

- Purchase invoices and supplier statements show both values explicitly. Permissions or settings may hide unnecessary columns.

- The settings rule for duplicate invoice numbers from the same supplier requires final approval. The operational recommendation is to warn or block users to prevent unintended duplication.

## 6.3 Saved purchase invoices

- The search button opens a list of previous purchase invoices. Subject to permissions, users can view and track an invoice or open its item or supplier.

- Once a purchase invoice is approved or finalized, users cannot edit the original or delete its historical data. The "Edit Invoice" button creates an adjustment draft linked to it.

- The user receives a copy of the invoice and can correct permitted fields. On save, the system compares the copy with the original and extracts only the differences as a Delta. Unchanged lines create no movements.

- The system records the difference in a separate "Purchase Invoice Adjustment" linked to the original. Only that difference affects inventory, the supplier account, and related values. For example, changing a quantity from 4 to 8 adds only 4 to the current balance, without recalculating the entire invoice as a new purchase.

- An invoice can have multiple adjustments with sequential identifiers such as A01 and A02. Each adjustment shows its date, time, user, reason, and difference in value or quantity. Users can navigate between the original and its adjustments.

- Starting an adjustment creates a Draft. If the user leaves before saving, the system warns that the draft is unfinished. Before final approval, it shows a before-and-after summary, the difference and its impact, and asks for confirmation.

- Supported reasons include quantity error, price error, invoice-number error, supplier error, and other. The system retains a complete audit trail.

- An adjustment is allowed after later movements only if its Delta leaves a valid balance and Batch state. If it would create an impossible balance or Batch, the system blocks saving. An authorized user must resolve the conflict through the appropriate stock adjustment, return, or correction.

- A "Purchase Return" is distinct from a "Purchase Invoice Adjustment" because returned goods physically leave the pharmacy for the supplier. Full and partial returns reduce inventory and the supplier balance. Each is a separate document linked to the original invoice. The return shows the original invoice number and date, and users can navigate between them.

- Deletion of an approved or finalized invoice is unavailable by default. Any exceptional deletion option requires elevated permission and a clear warning. It must never silently erase an approved historical financial transaction.

## 6.4 Purchase-invoice entry using OCR and AI

- Phase One implements OCR as a paid feature or plan add-on.

- Phase One targets computer-printed supplier invoices, not handwriting.

- The system uploads an invoice image, extracts line-item data, and attempts to match it with Breev items.

- The system always presents the result as a draft for human review. It does not update inventory or accounts until the user confirms the draft.

- OCR accuracy depends on image quality, supplier-invoice format, and the selected OCR or AI service. Perfect accuracy across all formats is not an acceptance requirement.

# 7. Inventory, stocktaking, and reorder basket

## 7.1 Inventory interface

- The operational inventory table is read-only. The inventory interface has no item-delete icon and does not allow direct balance edits.

- The approved columns show current balance, value, average cost, batches, expiry, minimum and maximum levels, reorder point, consumption rate, and risk indicators.

- All suitable columns are sortable. Settings and permissions control which columns are visible. Phase One does not enable the branch column or branch aggregation as multi-branch functionality.

- The left details panel does not appear in inventory so the table can use the full screen width.

- Only the owner can export sensitive inventory and supplier data through protected export functionality.

## 7.2 Quick stocktaking

- Quick stocktaking starts with the barcode. **Enter** moves to the new balance and, after saving, returns focus for the next item.

- Users can enter the balance in the base unit or as a combination of large and small units. The system converts the result to an integer base-unit quantity.

- Every correction records the employee, date, time, balances before and after the correction, and resulting inventory movement. The main item record cannot change the balance directly.

- The approved design may include an input calculator. The client will provide the final visual reference for quick stocktaking. That reference adds no functionality beyond this flow unless the parties handle it through a change request.

## 7.3 Reorder basket

- An item can be added to the reorder basket from both the inventory and sales interfaces.

- When adding an item, the system proposes an order quantity equal to the approved maximum level minus the current balance. The user can edit the suggestion.

- The basket shows balance, consumption, and appropriate risk or expiry indicators. Color may warn that the projected stock level could create surplus or waste.

- After an order is confirmed, the item can be moved to an "Ordered Items" list with status and order date, and may be returned to the basket according to the approved flow.

- The system may provide a list of unavailable or out-of-stock items that users can link to the basket manually. Automatic supplier-availability discovery, live comparison, and API ordering are deferred to Phase Two.

- The data model is prepared for future supplier-price integrations, but live comparison, automatic ordering, and inter-pharmacy linking are not part of Phase One.

# 8. Patients, CRM, and messaging

## 8.1 Patient profile

- The profile contains contact and profile information, chronic conditions, chronic medications, interests, and important notes.

- Sales invoices recorded under the patient's name automatically populate the patient's medication-purchase history. The history shows treatment-continuation or interruption indicators according to the approved rules.

- Weight history is cumulative. Each new weight records the date and time and appears with earlier measurements. The system also shows BMI when the required height data is available.

- Users can define a special patient discount. The system applies it automatically to sales invoices recorded under the patient's name, according to the approved percentage or rule.

- A "Do Not Disturb" control stops marketing messages and nonessential reminders according to the approved rule, except for essential messages approved by the client.

- AI recommendations based on weight history and AI-generated encouraging messages are future subscription or development functions unless the Phase One AI package explicitly includes them.

## 8.2 Patient follow-up

- A paid messaging interface lets users select a patient and message template, then send the message immediately or schedule it for an approved time.

- A new template can be added from the interface if it does not already exist, with availability controlled by permissions.

- Depending on the plan and final Phase One list, enabled message types may include invoice delivery, medication-depletion reminders, birthday greetings, reserved-item availability, and price-change notices.

- Follow-up lists are ordered by due time, including treatment dates, birthdays, and reservations. An item leaves the waiting list once its action is completed under the approved flow.

- An unavailable item can be reserved for a patient. When stock returns, the item appears in the follow-up contact list. The reservation can be canceled after sending or delivery.

- WhatsApp, SMS, and Meta functions depend on the provider, accounts, and approved templates. They do not include a complete unified conversation inbox, advanced chatbot, or unrestricted access to every Meta function.

## 8.3 Phase One AI boundaries

Phase One AI is limited to approved uses, mainly OCR, purchase-invoice matching, and selected simple queries or recommendations based on system data. AI sections in the design do not commit Phase One to a complete clinical engine.

- Advanced drug-interaction analysis, contraindications, medical dosage recommendations, clinical weight analysis, advanced prediction, intelligent supplier comparison, automated marketing, and broad automated external responses are future extensions. A function enters scope only when approved in writing with its data source and acceptance criterion.

- Any AI function must respect permissions and allowed data-sharing fields. Sensitive items or data can be prevented from being shared with AI or external responses.

- Medical data and recommendations require a source and rules approved by the client. The developer is not responsible for independently creating medical knowledge.

# 9. Cash accounts, accounting, and statements

## 9.1 Cash-account model without mandatory shift locking

- The system uses employee cash drawers or accounts instead of a rigid shift system that locks the sales screen.

- A cash drawer can be assigned to an employee account or created in the employee's name.

- Subject to permissions, an employee can open their cash drawer from any licensed device in the pharmacy while the main local service is running.

- Receipt, payment, and transfer transactions record the username, date, and time.

## 9.2 Start- and end-of-work reconciliation

- The employee's cash drawer is reconciled to zero at the start of work.

- At the end of work, the system compares the expected balance with actual cash.

- The matched amount is transferred to the safe or treasury cash account.

- Any shortage or overage remains visible and can be left in the employee's drawer or transferred to a separate discrepancies account.

- Daily transfers provide the audit trail for shortages and overages.

## 9.3 Chart of accounts and vouchers

- Users can create and classify accounts and cash drawers from the chart of accounts. Types include cash, expense, capital, supplier, patient receivable, and discrepancies.

- A transfer voucher includes **From Account**, **To Account**, amount, notes, and voucher date.

- The interface supports voucher search and navigation to the previous or next voucher.

- Users can change the voucher or report date. This date determines where the transaction appears in account statements.

- The system records the actual creation date and time and keeps them fixed. The editable voucher date does not replace them.

## 9.4 Account statements

- Statements cover debtor patients, suppliers, employee cash drawers, the safe or treasury, capital, and all remaining chart-of-accounts accounts.

- Accounts can be sorted alphabetically or by balance in ascending or descending order.

- Transactions are shown chronologically with document references.

- Double-clicking a transaction opens the original saved sales invoice, purchase invoice, voucher, or operation according to permissions.

## 9.5 Accounting entries

The Ledger or Transactions record, not editable ending balances, is the accounting source of truth. Every approved transaction creates an independent, traceable movement. Approved historical movements cannot be deleted or edited directly; corrections use a new transaction or document linked to the original.

## 9.6 Main accounts

- Assets include the main cash account, sales cash account, a cash drawer or account for each employee, card or electronic-payment company accounts, patient receivables, medication inventory, and enabled fixed assets.

- Liabilities include supplier accounts and other approved liabilities. Equity includes capital, owner withdrawals, and accumulated or retained earnings.

- Revenue includes medication sales and approved services. Cost of sales includes cost of goods sold. Expenses include approved operating expense types and losses from expired medication.

## 9.7 Suppliers and historical allowance

- Most purchases may be on credit, and cash purchases are also supported. Each supplier shows totals for invoices, adjustments, returns, payments, allowances, balance, and debt aging.

- Each invoice captures the supplier's default allowance percentage for its date as a Snapshot. Later rate changes do not recalculate earlier invoices.

- The "Primary Supplier Cost" before discount is the inventory cost and average cost used in Phase One. "Cost After Discount" is an additional value for display, supplier statements, and settlements; it does not replace the primary cost.

- An exceptional offer or allowance used to settle an account to zero does not change the item cost or historical average cost. The system records it as a separate allowance-difference transaction.

## 9.8 Supplier payment voucher

- A payment voucher need not link to one invoice. It may settle several invoices or clear the supplier account to zero. It identifies the source cash account or drawer and the beneficiary supplier.

- The voucher records the amount paid, actual allowance percentage, actual allowance amount, allowance difference or adjustment, notes, document date, and user. When the user enters the percentage or amount, the system calculates the other value according to the rule.

- Allowance at settlement is a separate transaction and is not a purchase return. If the balance is 1,000,000, the actual allowance is 10,000, and the amount paid is 990,000, the supplier liability must be cleared to zero while the allowance details remain separately recorded.

## 9.9 Cash, card, and deferred sales

- A cash sale increases the approved cash account or drawer. A card or credit sale records the full sales value as revenue and the amount receivable or received in the card or payment-company account, not the physical cash drawer.

- If a card commission applies, the system stores the sale value, commission, and net amount received separately. The commission is a payment-service cost or expense, not a patient discount.

- An exceptional deferred sale is recorded as a patient receivable, with later collection recorded as a separate transaction.

## 9.10 Inventory, cost, and expiry

- The system calculates inventory quantity, inventory value, average cost, cost of goods sold, and profit using the primary supplier cost before discount.

- Expired or damaged stock is recorded as a separate loss that reduces inventory and appears in the expired-medication-loss account. It is not a supplier return.

- An adjustment resulting from quick stocktaking is recorded as an independent movement and does not rewrite prior history.

## 9.11 Capital, withdrawals, and expenses

- Capital and owner withdrawals are recorded separately from pharmacy expenses.

- Settings configure operating expense types such as rent, salaries, internet, water, electricity, taxes or fees, maintenance, cleaning, and refrigeration. An "Other Expenses" type keeps the list extensible.

## 9.12 Supplier statement and debt aging

- The supplier statement lists each movement separately: purchase invoice, purchase adjustment, return, payment, allowance, and allowance difference. Each entry shows the date, document number, values, and running balance. The approved interface may mark a reconciled movement or date with a color or symbol.

- The statement header shows totals for invoices, adjustments, returns, payments, allowances, allowance differences, and the current balance. Users can select a time period. A setting may hide an invoice and its full return from the ledger statement once their net effect is zero, but both remain stored in the Ledger and audit trail.

- The debt-aging report shows totals for 0 to 30, 31 to 60, 61 to 90, and more than 90 days. Payment-reminder days may be configured in the supplier profile according to settings.

## 9.13 Transactions that must be traceable

Traceable transactions include purchases, purchase adjustments, purchase returns, supplier payments, supplier allowances, allowance differences, cash sales, card sales, deferred sales, debt collections, expenses, expiry or damage, inventory adjustments, capital, and withdrawals. Every transaction records a number, date and time, user, reason where needed, reference document, value, and accounting impact.

# 10. Search lists, reports, audit, and export

## 10.1 Unified search-list pattern

Each operational interface's search button opens a popup for the same document type: sales, purchases, or vouchers. Each type keeps its correction rules. Saved sales invoices allow only viewing and returns. Purchase invoices use Delta adjustments or returns. Permissions and approved rules govern vouchers.

## 10.2 Essential Phase One reports

- Sales reports cover totals, cash, card or credit, card commissions, deferred sales, returns, and sales profitability under the approved rules.

- Purchase and supplier reports cover purchases, adjustments, returns, allowances, allowance differences, payments, supplier balances, and debt aging.

- Item and inventory reports cover quantity, value, average cost, cost of goods sold, batches and expiry, consumption, alerts, and stocktake or expiry movements.

- Subject to permissions and plan, patient reports cover purchase history, debt and collection, follow-ups, reservations, and messages.

- Cash-account and account reports cover cash drawers, employee balances, transfers, shortages and overages, capital, withdrawals, expenses, liabilities, and profits.

- User activity and audit trail.

- Advanced AI analytics are not part of the mandatory Phase One reports except within the limits explicitly defined under the basic AI scope.

## 10.3 Filters and audit

- Reports, stocktake reports, and account statements support From and To date-and-time filters.

- User or employee filter.

- Column-level search and sorting, and multi-criteria filtering as agreed.

- Results show the user who performed each operation, its timestamps, and document references.

- Sensitive exports are permission-restricted and may require the owner's password.

- The operational inventory interface need not duplicate the time-period selector when inventory and stocktake reports already provide From and To filters.

## 10.4 External spreadsheet interface

The free plan includes an Excel-like table for approved data and columns from sales invoices linked to a specifically named patient. Phase One also includes a documented read or export API for those columns and practical guidance for connecting it to Google Sheets. It does not include writing Google Sheets changes back to Breev or building Zapier, Telegram, or other external automation unless separately quoted and approved.

# 11. Cloud services included in Phase One

## 11.1 One-way synchronization, paid add-on

- The main device uploads eligible data to the Breev cloud when internet connectivity is available.

- The pharmacy owner can sign in remotely and view approved pages and reports.

- Cloud access in Phase One is read-only and does not allow local pharmacy data to be modified remotely.

- When connectivity returns, the system uploads queued records without processing duplicates.

## 11.2 Cloud-viewing interface boundaries

The parties must approve the pages available remotely during Phase One before milestone four begins. The baseline proposal includes a summary dashboard and selected inventory, sales, accounts, and reports screens. A complete editable web version belongs to Phase Two.

## 11.3 Service ownership and costs

- Breev owns and manages the server, WhatsApp, and AI-provider accounts.

- Breev may resell service access to pharmacies and set its own commercial margin.

- The development price excludes hosting, messaging, AI or OCR usage, Meta fees, and all other external-service costs.

## 11.4 External integration in Phase One

- One-way synchronization from the local system to the Breev cloud for approved read-only interfaces.

- Phase One-approved WhatsApp or messaging functions, such as sending an invoice and selected reminders or predefined templates.

- A documented API for the Excel-like data interface, plus guidance for synchronization with Google Sheets.

- Meta, Facebook, and WhatsApp functions are included only when clearly listed in the final Phase One messaging and integration matrix. This section does not include a complete unified inbox, chatbot, campaign engine, broad webhook catalog, or unlimited future integrations.

# 12. Interface, branding, and user experience

- Product and company name: Breev.

- Lovable and the client's final PDF, which contains an approved image for each interface, are visual references for design, screen arrangement, and interaction style.

- The latest written requirements override Lovable where a flow was changed after the prototype.

- The final interface-images file is a visual reference only. It adds no screen, function, rule, report, or integration unless this scope explicitly states that item. Change control applies if the approved file is replaced later.

- The current general-market system is a reference for flow and accounting only. Breev is a pharmacy-specific product with additional capabilities.

- Support Arabic and English.

- Support light and dark modes.

- Use professional colors and a visual design suitable for marketing Breev.

- Core requirements include fewer clicks, keyboard support, and preservation of unsaved screen data.

- The clinics tab is outside the project scope.

# 13. Delivery plan: four milestones on Mostaql

Phase One remains one contract, with implementation and payment divided into four funded Mostaql milestones. Each milestone begins after funding and ends with a testable build and defined acceptance outcome.

| Milestone | Title | Duration | Payment |
| --- | --- | --- | --- |
| 1 | Foundation and Local Core | 12 days | $400 |
| 2 | Items, Purchases, and Inventory | 14 days | $450 |
| 3 | Sales, Patients, Cash Accounts, and Accounting | 16 days | $600 |
| 4 | Paid Services, Synchronization, and Delivery | 14 days | $450 |

## 13.1 Milestone one: foundation and local core

*12 days, $400*

- Approved data design and the foundation of an installable desktop application.

- Authentication, users, RBAC, and pharmacy settings.

- Offline local service and the foundation for Wi-Fi or Ethernet networking.

- User accounts work on licensed devices. Phase One testing covers four simultaneous devices, and licensing supports later increases without a hard-coded limit.

- Licensing and plan foundation, founder override, and feature-visibility behavior.

- Local backup and the foundation for both supported languages and themes.

> **Acceptance criterion.** The application installs and runs on the main device without internet access, and four devices work simultaneously over LAN, Wi-Fi, or Ethernet. An authorized user can sign in from any licensed device according to their role. Disabled features are hidden, and licensing can increase the permitted device count without a fixed software limit.

## 13.2 Milestone two: items, purchases, and inventory

*14 days, $450*

- Medication and general-item definition, generated naming, and Arabic name.

- Sequential smart search across words, barcode support, and the correct quantity model using an integer base unit without fractions.

- Units and packaging, "By Price" and "By Percentage" modes, field locking, rounding to 250, 500, or 1,000, and retail and wholesale pricing.

- Suppliers, historical allowance, purchase invoices, Delta invoice adjustments, purchase returns, batches, and expiry.

- Inventory, quick stocktaking, colors, alerts, the reorder basket, and ordered items, including adding items to the basket from inventory and sales.

- Purchase-invoice search and the item-details panel during purchasing.

> **Acceptance criterion.** A user can define an item and find it with the approved smart-search behavior. The user can then enter and save a supplier invoice, with cost and price updated according to the item's pricing mode. A purchase adjustment records only the difference, or the user can create a separate purchase return. Quantities, batches, and expiry appear correctly in inventory, stocktaking, and the reorder basket.

## 13.3 Milestone three: sales, patients, cash accounts, and accounting

*16 days, $600*

- POS flow and quick patient and item creation.

- Patient interests, popup alerts, and the quick-access list.

- Quantity, unit, price, and discount changes; cash, card, and deferred payment methods; wholesale rules; the below-cost warning; and the manager-approval setting.

- Sales returns instead of edits to saved invoices, plus search and navigation, quick access, barcode printing, and multiple barcodes.

- Patient profile, weight history, purchases, special discount, follow-up, reservations, and approval of expired or damaged stock write-offs.

- Employee cash drawers; cash, card, and deferred transactions; vouchers; transfers; reconciliation; discrepancies; and card commissions.

- A complete Ledger for approved transactions, plus supplier statements, allowances, payments, debt aging, essential reports, and the audit trail.

> **Acceptance criterion.** A complete operating cycle works from purchase through sale and accounting. A sale reduces inventory, links the selected patient, records cash, card, or deferred payment in the correct account, and appears in the Ledger, statements, and reports. Users cannot edit a saved sales invoice directly; correction uses a sales return. Expired or damaged stock is recorded as a separate loss.

## 13.4 Milestone four: paid services, synchronization, and final delivery

*14 days, $450*

- Enable additional local devices and test multi-device operation.

- One-way synchronization and the external read-only viewing interface.

- Minimum Breev Super Admin functionality.

- OCR as a review draft, plus AI, WhatsApp, and Meta within the approved functions.

- Spreadsheet API and Google Sheets guidance.

- Final reports, backup and restore, and stability testing.

- Installation files, code, database, documentation, and support-team training.

> **Acceptance criterion.** The pilot pharmacy operates on the approved devices, eligible data synchronizes one-way, the agreed paid add-ons work, a tested backup can be restored, and the developer hands over the complete delivery package.

## 13.5 Schedule protection

- The 56-day period assumes that the client promptly provides approvals, permissions and access, samples, and service accounts.

- Days spent waiting for client approval, accounting decisions, current-system access, OCR samples, service accounts, or provider responses do not count as developer implementation delay.

- A change request may extend the affected milestone and the overall timeline.

- The final ten days are reserved for integration, testing, and fixes. They must not be used for uncontrolled feature additions.

# 14. Acceptance process

- Each milestone is funded before work on it begins.

- The developer provides a testable build and short delivery note tied to the milestone scope.

- The client reviews each milestone within three business days and sends one consolidated list of deviations from the approved scope.

- Corrections needed to bring a function into compliance with the approved scope are included.

- A preference or flow change, or a request for another screen, report, or integration, is a change request rather than a defect fix.

- Approval of a milestone closes its scope, except for proven defects that appear during final integration testing.

## 14.1 Definition of a software defect

A defect is an implemented function that does not meet the approved written requirement or agreed acceptance outcome. A new idea, business-rule change, design preference, additional filter or report, integration, or broader automation is not a defect.

# 15. Change control and scope protection

> After this document is approved, no verbal request, chat message, image comment, or prototype change automatically enters the $1,900 Phase One scope.

| Step | Required Action |
| --- | --- |
| **1. Request** | The client submits the requested change in writing. |
| **2. Analysis** | The developer assesses its effect on screens, logic, database, integrations, price, and timeline. |
| **3. Proposal** | The developer provides a separate price, duration, and impact assessment. |
| **4. Approval** | Work begins only after written approval and funding. |
| **5. Documentation** | The approved change is added to a scope revision or separate change order. |

# 16. Explicitly deferred to Phase Two

## 16.1 Future AI capability roadmap, non-binding direction

The following capabilities describe the intended product direction and inform future architecture. They are not Phase One commitments or fixed-price Phase Two deliverables. Before implementation, each requires separate analysis, safety rules, acceptance criteria, pricing, and a timeline.

- An advanced natural-language assistant that queries inventory, sales, accounts, and patient history while respecting permissions and data-sharing limits.

- Prediction of stockouts, surplus, and expiry risk, with suggested order quantities and analysis of historical damage or expiry losses.

- Comparison of supplier prices after discount, recommendations for the most suitable supplier, and approval-based smart or automatic ordering.

- Analysis of patient adherence, weight history, and treatment; prioritized follow-ups; and draft messages that follow approved medical and privacy rules.

- Advanced clinical support such as drug interactions, contraindications, and dosage guidance, after an approved medical data source and clear responsibilities are established.

- Explanation of profit and unusual cases, such as the impact of expiry losses, allowance differences, or commissions on net profit.

- Patient or customer segmentation and suggested campaigns or external responses through approved channels, with precise controls over the information AI may share.

- Improved OCR that learns supplier-invoice formats while retaining human review before any invoice is posted.

## 16.2 Deferred Phase Two functions and platform capabilities

- Two-way synchronization and cloud editing with conflict-resolution rules.

- A complete external pharmacy administration web dashboard, multi-branch operation, and multiple currencies.

- Live supplier integrations, automated comparisons, automatic ordering, and the exchange or request of needed items between pharmacies.

- Fingerprint attendance integration and automated payroll.

- Delivery interface and e-commerce store integration.

- Promotions, marketing, advanced external automation, and broad webhooks.

- Laboratory integration, e-prescriptions, and external medical-integration interfaces.

- Consumption aggregation by scientific or generic name across brands, plus expanded Frozen Snapshot behavior where Phase One did not store that data with the saved document.

# 17. Excluded from the $1,900 development price

- Computers, POS hardware, barcode scanners, printers, router, switch, cables, battery or UPS, and on-site installation.

- Hosting, domain, cloud database, provider backups, AI or OCR, WhatsApp, Meta, SMS, Zapier, Telegram, and any provider subscription or usage fees. API and Google Sheets guidance does not include building third-party automation scenarios.

- Old-system data extraction or migration, manual data entry, catalog cleaning, or entry of item prices one by one by the developer. Migration is priced separately after review of database or export access, data volume and quality, and required matching.

- Any guarantee of perfect OCR accuracy for every supplier-invoice format, or provision of a medical database or content source by the developer.

- Professional tax, legal, or accounting certification or approval.

- 24/7 monitoring, emergency response, or unlimited lifetime support.

- Any feature, screen, report, or integration not explicitly stated here.

- Fixes required because another developer modified the code without prior coordination.

- The Phase Two functions listed above.

# 18. Client responsibilities and required approvals

- Approve this scope and the four milestones in writing before implementation begins. Approve any later modification through a new version or change order.

- Provide AnyDesk access to the current system and videos when needed to review flows and accounting.

- Provide a database copy or export if Breev requests a separate quotation for old-data extraction and migration.

- Approve final account names, permissions, and any accounting details not explicitly settled here. Once implementation begins, changes to the fundamental Ledger rules require a change request.

- Provide representative samples of computer-printed supplier invoices for OCR testing.

- Provide the applicable approved rules, medical source, or both for each dosage calculation, interaction, or clinical recommendation intended for activation.

- Provide the brand identity, colors, and one final unified visual PDF for all interfaces, including the quick-stocktake design. Images are visual references within the written scope and do not add functions by themselves.

- Provide test devices, a Wi-Fi or Ethernet network, cables, a switch or router, a battery or UPS, and accessories.

- Create and control the server, WhatsApp, Meta, and AI or OCR provider accounts, and pay their operating costs.

- Approve the list of cloud-viewing pages, Phase One reports, and final message templates and functions.

- Send feedback in one consolidated submission within the agreed review period.

# 19. Open decisions requiring approval before final implementation

| Decision | Required Approval |
| --- | --- |
| Final account names | Finalize account names and classifications within the chart of accounts and their viewing permissions. The Ledger, cost, and allowance rules in this document remain the foundation. |
| Duplicate supplier invoice number | Approve whether duplicate numbers for the same supplier are blocked or allowed after a permission-controlled warning. |
| Wholesale or special price | Approve how the price is selected during a sale and whether it depends on a quantity threshold or user permission. |
| Dosage calculation and clinical content | Provide and approve the medical source and rules for any dosage or interaction calculation. Without them, the advanced portion remains disabled. |
| Cloud interface | Approve the pages, columns, and reports included in Phase One external viewing. |
| WhatsApp and Meta | Approve the provider, templates, included message types, and inbound and outbound message boundaries. Any advanced chatbot or inbox requires separate scope. |
| Visual reports | Approve the final report images and columns within the stated report categories. Any new report outside the approved categories or fields is a change request. |
| OCR | Approve the provider, usage budget, and accepted test-invoice set. |
| Old-data extraction | Requires a separate quotation after review of the database or export, volume, quality, and required matching. |
| Final interface file | Receive and approve the final images file, especially the quick-stocktake design, as a visual reference that does not expand scope. |

# 20. Ownership, confidentiality, and handover

- After full payment, Breev Company owns the source code, database design, installation files, and delivered documentation.

- Breev controls the hosting, AI or OCR, WhatsApp, and other service accounts.

- Project details, images, logic, code, and pharmacy data may be shared with other parties only as needed for implementation and with the client's approval.

- Handover includes the code, database, build and installation instructions, environment setup, backup and restore instructions, and basic guidance for the support team.

- The architecture should avoid unnecessary vendor lock-in and support future server migration with reasonable technical cooperation.

# 21. Post-delivery maintenance: commercial understanding

The following table records the current commercial understanding. The parties will confirm a maintenance agreement separately from the development scope.

| Usage Level | Base Maintenance Fee |
| --- | --- |
| **Main version + one subscribed pharmacy** | $10 per month |
| **2 to 10 subscribed pharmacies** | $30 per month total |
| **11 or more subscribed pharmacies** | $50 per month total |

*Basic maintenance follows the agreed subscription-count tiers. It covers reasonable correction of proven defects in the developer's delivered code during agreed working hours. Each future feature or functional expansion is priced separately. Maintenance excludes major upgrades, 24/7 monitoring, infrastructure or service fees, third-party modifications, and work outside the approved scope.*

# 22. Final approval

By approving this document in writing on Mostaql, both parties confirm that it defines the complete Phase One delivery boundaries, four-milestone structure, and operating and accounting rules. This version incorporates the latest clarifications through August 9, 2026, and supersedes version 1.1 once approved. The client's detailed draft and interface-images file are references only to the extent incorporated here. Any unstated function, report, integration, or change requires a written change request with a separate price and timeline.

| Client Representatives: Dr. Saif Al-Din and Dr. Osama | Developer: Mohamed Mostafa |
| --- | --- |
| Name / Approval: | Name / Approval: |
| Date: | Date: |
| Mostaql Confirmation / Signature: | Mostaql Confirmation / Signature: |
