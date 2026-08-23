# Client and developer conversation

This record preserves the requirements, commercial terms, open questions, and later corrections discussed by the client and developer. Statements remain in chronological order so later clarifications stay distinct from earlier proposals.

## Initial discussion

### Prototype and brief

Mahmoud shared a prototype at <https://pixel-perfect-capture-094.lovable.app/> and a 257 KB interface brief. He said the prototype was close to the required standard and asked the developer to review both sources carefully before submitting a final proposal.

Mohamed Mostafa reviewed the material and asked eight questions before fixing the scope, timeline, and cost:

1. Should accounting cover only sales, purchases, suppliers, and profit, or should Breev provide a complete accounting system with journal entries, a chart of accounts, and a trial balance?
2. Is Phase One a single-pharmacy pilot, or should it be a SaaS product that can be sold to multiple pharmacies through subscriptions and a Super Admin panel from the start?
3. Does Phase One one-way synchronization run from the pharmacy to the server or from the server to the pharmacy?
4. Will the client provide a medicine database containing generic names, brand names, dosages, and interactions, or must the project provide and integrate one?
5. Must the project migrate data from an existing system?
6. Which Phase One messaging channels are required: WhatsApp, SMS, Telegram, or all three?
7. Which inventory costing method should Breev use: weighted average, FIFO, or last purchase cost?
8. Does support end after a defined warranty period, or continue under an ongoing support and maintenance contract?

### Client answers

Saifaldeen M. answered as follows:

1. Breev needs a complete sales and accounting system, including journal entries, receivables, payables, profit and loss, and a balance or trial balance.
2. Breev must be ready to sell copies or licences from the beginning. The team expects to test and develop it for about one year before verifying all features. The product is offline-first and subscription-based.
3. Phase One synchronization runs from the local system to the server.
4. The client will enter items based on products available in the country.
5. The client has an existing system, but it cannot export its data.
6. Phase One requires WhatsApp only.
7. Settings should allow selection among all three proposed costing methods. Breev's proposed default is average cost.
8. Support should continue under a permanent contract agreed before work begins and binding on both parties. The original developer should get the first opportunity to implement additions if the parties agree. If they do not agree, another developer may receive the work.

At project completion, the company must immediately receive all specifications, source code, and system details. The developer must train the support team on the complete system, including how to sell and deploy a new copy.

Saifaldeen stressed that the product is expected to evolve. Subscriptions will lead to continuing requests because pharmacies have different needs, and subscribed packages will determine feature customization. He also expressed a preference to award the project to Mohamed based on the quality of his previous work.

### Initial commercial proposal

Mohamed asked for the approximate Phase One budget before preparing the final proposal and implementation phases. He wanted to avoid proposing a figure outside the client's range.

Saifaldeen said the Phase One proposals received so far ranged from USD 2,000 to USD 3,000. Selection would also consider estimates for Phase Two and the post-warranty period, not Phase One alone.

Mohamed offered to implement Phase One for USD 1,900. The offer covered the core operational system, including POS, inventory, purchases, accounting, patient records, offline-first operation, subscriptions, basic WhatsApp and OCR integration, delivery, documentation, and training. He said he would provide a detailed Phase One scope after preliminary price approval.

### Phase Two and ongoing support

Saifaldeen asked for the Phase Two price and the cost of maintenance after Phase Two. The requested maintenance scope included operational issues, synchronization failures, integration failures, performance issues, and cloud-service stability monitoring. It also required an SLA with response and resolution times based on incident severity and impact.

The developer would remain responsible for problems that affect stability or arise from their implementation, including server or runtime-environment problems caused by the chosen implementation.

Mahmoud added these conditions for later work:

- Treat every future feature as a separate task.
- The developer must analyze its requirements and state the time and cost before work starts.
- Implementation begins only after approval and must not destabilize the existing system.
- Regular framework and library updates, including upgrades to newer versions, belong either in the post-warranty maintenance contract or in a separate agreement.
- If the parties cannot agree on a disputed development item, another developer may implement it while the original maintenance contract continues under its agreed terms.

After these points were confirmed, Mahmoud wanted to schedule a conversation to establish the project's fundamentals and brief the partners.

Mohamed agreed that post-warranty maintenance should cover system stability, synchronization, integrations, and the runtime environment. He gave a preliminary Phase Two estimate of USD 1,500 to USD 2,500. The final Phase Two price and schedule would follow Phase One and approval of a detailed Phase Two scope because some requirements would depend on trial-period results and pharmacy feedback.

He initially proposed USD 150 per month for post-warranty maintenance, covering:

1. Bugs caused by his implementation.
2. Local-to-server synchronization problems.
3. Failures in integrations delivered by the project.
4. Problems affecting sales, inventory, accounting, subscriptions, or permissions.
5. Monitoring performance, error logs, cloud services, and backups.
6. Server or runtime-environment problems caused by the project's architecture, configuration, or deployment.
7. Security updates and routine fixes compatible with the versions in use.
8. Root-cause fixes for recurring failures instead of repeated temporary workarounds.

His initial proposed SLA was:

| Severity | Examples | Response | Target resolution |
|---|---|---|---|
| Critical | Sales stop completely, every user is unable to sign in, data becomes inaccessible, or synchronization threatens data integrity | Start within 1 hour and immediately restore service or provide a workaround | 4 to 6 hours when the issue is in scope and required access is available |
| High | A major function such as synchronization, WhatsApp, inventory, or accounting is unavailable while the rest of the system still works | Start within 4 hours | 24 hours |
| Medium | A limited function is affected without blocking normal core use | Start within 1 business day | 3 business days |
| Low | Cosmetic or low-impact problem that does not interrupt work | Start within 2 business days | Nearest suitable update |

Resolution time would start only after the client supplied the issue details, required access, and diagnostic data. For an outage caused by hosting, WhatsApp, or another external API, Mohamed would diagnose the problem, follow up technically, and explore alternatives, but the provider's response would determine final restoration time.

New features and pharmacy-specific or package-specific customizations would remain separate tasks. Each would require analysis of its system impact, a stated schedule and cost, agreed acceptance criteria, separate testing, and approval before merging.

The proposed maintenance treatment of dependencies was:

- Security updates, bug fixes, and routine compatible framework or library updates are included.
- A major upgrade that needs extensive changes, data migration, or broad retesting must be evaluated in advance. Its workload determines whether it is covered or needs a separate agreement.

If another developer builds a feature, the maintenance contract continues only with a clear responsibility boundary. Their changes must be documented and made available for review and testing before they enter the main version.

Mohamed also confirmed delivery of the source code, runtime configuration, databases, technical documentation, and the process for installing and activating copies or licences. He would train support staff to manage pharmacies, subscriptions, updates, and basic operational issues.

Saifaldeen said the partners would discuss the proposal and respond within a week.

## 31 July 2026

### Revised maintenance pricing

After discussing the proposal with the partners, Saifaldeen said that a carefully built, robust system should support lower maintenance pricing. The client proposed these monthly tiers:

| Active subscriptions | Monthly maintenance fee |
|---:|---:|
| Main version with 1 subscription | USD 10 |
| 2 to 10 | USD 30 |
| 11 or more | USD 50 |

The client also required every change or addition to be offered to Mohamed first, giving him the first opportunity to implement it.

Mohamed accepted these tiers for basic maintenance of the main version. He defined that maintenance as:

1. Fixing bugs caused by his implementation.
2. Resolving simple synchronization or integration problems.
3. Investigating performance problems and identifying their causes.
4. Basic monitoring of error logs, backups, and cloud services.
5. Security updates and minor corrective updates that do not require major system changes.

He revised the SLA to apply during agreed working hours:

| Incident | Response |
|---|---|
| Critical incident that stops sales or threatens data integrity | Start within 4 hours |
| Core function unavailable while the rest of the system still works | Start within 1 business day |
| Limited-impact or cosmetic issue | Start within 2 business days, with the fix included in the nearest suitable update |

The revised fee excludes server charges, WhatsApp and other provider charges, continuous 24/7 monitoring, major upgrades, data migration, and problems caused by another developer's unreviewed or unapproved changes. Work outside basic maintenance must be explained and priced before implementation, and may proceed only after client approval.

Mohamed accepted the client's first-offer condition for new features and modifications. He would analyze each request, estimate its time and cost, and implement it only after approval while protecting the current system's stability.

### Phase One payment milestones

When Saifaldeen asked how the USD 1,900 Phase One fee would be divided, Mohamed proposed four funded milestones on Mostaql. Each milestone would deliver a runnable version for review before work moved forward.

#### Milestone 1, USD 400

Set up the architecture and database and prepare an installable local desktop application. Include sign-in, pharmacy information, users and permissions, the foundation of packages and subscriptions, and offline-first operation.

Deliverable: an installable version with user, permission, and subscription management, plus the core system infrastructure.

#### Milestone 2, USD 450

Implement medicine and general-item definitions, packaging units, suppliers, purchases, inventory, batches and expiry dates, stocktaking, alerts, and the reorder basket.

Deliverable: a complete operational cycle from entering a purchase invoice through updated inventory balances, batches, expiry dates, and supplier accounts.

#### Milestone 3, USD 600

Implement POS, invoices, returns, discounts, cash and credit sales, permission-controlled invoice editing, patient records, and integration with accounting. Accounting includes journal entries, receivables, payables, profit and loss, and the trial balance.

Deliverable: a testable sales and accounting workflow from adding an invoice item through updates to inventory, the cashbox, accounts, and reports.

#### Milestone 4, USD 450

Implement local-to-server synchronization, WhatsApp integration, OCR for supplier invoices, final reports, backups, stability testing, agreed feedback, documentation, and support-team training.

Deliverable: the complete Phase One version, including source code, installation files, the database, technical documentation, and instructions for deploying, selling, and activating a new copy.

Each milestone would be funded on Mostaql before it began. On completion, Mohamed would deliver a working version and the completed code for approval before starting the next milestone. He described this as an initial breakdown and left the milestone order and contents open to revision by the client and partners before work began.

## 1 August 2026

### Call and updated references

Saifaldeen said the client wanted a call to settle the system fundamentals and then record them in a draft. He also said the partners intended Mohamed to build the project.

Mohamed noted that Mostaql normally prohibits meetings outside the platform. He first proposed voice and video messages followed by written documentation, then contacted platform support. Support allowed a phone call on the condition that every detail be documented on Mostaql.

Saifaldeen resent a 271 KB project brief containing technical specifications and requirements, welcomed the developer's suggestions, and noted that Phase Two interfaces had been added. He shared the editable prototype at <https://lovable.dev/projects/e4fa92f7-ec37-4915-a77a-54cd9bf81edc?magic_link=mc_fd26a5a6-005d-43b1-8193-65264c36c578>. Mohamed needed to request access before the client unpublished it.

The client clarified that:

- The new "Clinics" tab is outside the project scope.
- The Lovable screens represent about 95% of the intended final appearance.
- The specifications file contains the refinements.
- Matching the prototype means matching its appearance and button locations. The specifications, not the prototype, describe the behavior.
- Breev will use Electron.js and remain offline-first.

Mohamed confirmed that he had reviewed the full prototype after receiving access, the updated specifications, and the new changes. He recorded this interpretation:

- The prototype is the main reference for layout, button placement, tables, sidebar, and navigation.
- The latest specification refinements win if they conflict with the prototype.
- Clinics is out of scope.
- Delivery, external integration, the store, supplier comparison, requirement requests, and marketing are Phase Two interfaces, not Phase One work.
- Breev is an Electron.js desktop application. Core pharmacy functions work locally without the internet.
- Phase One uploads local data to the server.
- The architecture should anticipate Phase Two two-way synchronization and cloud-side editing.
- Each subscription package can enable or hide features and tabs.
- The subscription determines the permitted number of POS devices.
- The interface supports Arabic and English, light mode, and dark mode.
- Item details are important in the Sales and Purchase interfaces.
- The interface should minimize clicks and preserve entered data when a user leaves and returns.
- OCR-based purchase entry is a core feature that can be enabled only for selected pharmacies or packages.
- Permissions, reports, and audit or activity history should support later expansion without being rebuilt.

Mohamed recommended including the subscription system, synchronization log, and pharmacy-level data isolation in the first milestone so later packages and Phase Two features could be added without destabilizing the core system. He considered the requirements, interfaces, and milestone structure ready to finalize.

### Estimated provider costs

Saifaldeen asked for expected monthly costs for the server, WhatsApp, AI, and automated payments or subscriptions.

Mohamed estimated that server, backups, WhatsApp, and AI would initially cost about USD 20 to USD 45 per month with few pharmacies. He said electronic payment providers usually charge no fixed monthly fee, but commonly take about 1% of each payment. He would review likely usage and candidate services before finalizing the architecture and provide a closer estimate.

These figures were estimates, not accepted provider prices.

### Call and Sales-screen additions

The parties scheduled an online call for 7:30 PM Saudi time, 1 hour and 50 minutes after Saifaldeen's message. Saifaldeen's partner wanted to explain the project verbally again in case the written discussion had missed anything. Saifaldeen then sent a Google Meet invitation at <https://meet.google.com/zbt-eqag-pdx>.

After the call, Saifaldeen added these Sales-screen requirements:

- A `+` button beside the patient name or number search opens a popup to create a patient without leaving Sales or opening Patient Records. An attached image, `IMG_8589.jpeg`, illustrated it.
- Entering a barcode that is not in the pharmacy catalog opens a popup to define a medicine or item without leaving the invoice.
- For an item without a barcode, the user opens "Pick Item" and searches by name. If no definition exists, pressing Enter or clicking Add should open the definition popup. `IMG_8590.png` illustrated this flow.
- Item definition has two switchable modes, medicine and general item. Their field order and name-composition rules differ. `IMG_8593.jpeg` showed an example.
- The displayed medicine name combines brand name, strength or concentration, dosage form, and company or manufacturer.
- A general item's displayed name combines fields in the order shown by the provided example.
- An Arabic-name field appears below the combined name.
- Search reacts as soon as the user types a character and shows all items containing that character or entered character sequence.

### Mohamed's post-call summary

Mohamed recorded the following understanding after the meeting. A later client message corrected the side-panel location stated in item 9.

1. **System model.** Breev is an integrated, offline-first pharmacy management system. It has a free version and paid packages, with package entitlements controlling which features appear.
2. **Free version.** One pharmacy device acts as POS, purchase and inventory workstation, administration workstation, and local database server. The free version works entirely locally, has no cloud connection, and does not permit remote access to pharmacy data.
3. **Additional POS devices.** A pharmacy may subscribe for one or more POS terminals. They connect to the main device over local Wi-Fi and use the same inventory and invoices in real time without internet access. The data-entry device remains the main database host. The subscription controls activation of additional terminals.
4. **Cloud synchronization.** Paid one-way sync uploads pharmacy data to the cloud for remote, read-only inventory, sales, and report views. Paid two-way sync allows permitted remote changes to return to the local system with permissions, audit history, and conflict handling. Two-way sync and full cloud editing belong to Phase Two and higher packages.
5. **OCR and AI.** These are optional paid entitlements. They read printed supplier invoices and match extracted data with registered items. The result is a draft that a user must review and approve before it changes inventory or accounts. OCR and AI may be standalone add-ons or included in packages.
6. **WhatsApp and providers.** WhatsApp is a paid package feature for invoices, alerts, and follow-up messages. Breev owns and manages the server, WhatsApp, and AI accounts. The company sets package prices and margins. Provider charges are separate from software-development fees.
7. **Local operation and power.** The main data-entry device hosts the database and services. Internet loss does not stop local work. Synchronization resumes automatically when connectivity returns if the package includes it. A battery-powered laptop or another backup supply should power the main device and router to reduce disruption during outages.
8. **Accounting.** Accounting is integrated with sales, purchases, and inventory. Breev must approve accounting entries and rules before the developer finalizes them. Settings expose the supported costing methods, with average cost as the default.
9. **Interface and user experience.** The Lovable prototype governs appearance and button placement, subject to later specification refinements. Clinics is excluded. Mohamed's summary said the item-details panel appeared in Sales and Items, with configurable fields. The client corrected this the next day to Sales and Purchase only. The design should minimize clicks, support keyboard navigation, and retain invoice data across navigation.
10. **Fast Sales entry.** Users create patients and unknown items through popups without leaving Sales. Unknown barcodes open item definition. "Pick Item" search supports Enter or Add to create an unknown non-barcoded item.
11. **Naming and search.** Users switch between medicine and general-item definition modes. A medicine name combines the approved medicine fields. A general-item name follows the specified field sequence. The Arabic name appears below the English name and participates in search. Sequential search matches the typed character or character sequence in either language.
12. **Packages.** Features may be sold separately or in packages. Candidate entitlements include additional POS terminals, one-way sync, two-way sync, OCR, AI, WhatsApp, CRM and messaging, and advanced reports and analytics. Disabled package features are completely hidden from the interface.
13. **Ownership and delivery.** Breev owns the source code, databases, server configuration, and service accounts. Delivery includes technical documentation, new-copy installation and activation instructions, subscription and package administration, and support-team guidance for system operation and basic service monitoring.

Mohamed invited corrections before finalizing the scope for each phase.

## 2 August 2026

### Accounting and interface corrections

At 1:23 AM, Saifaldeen corrected and expanded the post-call summary:

He first praised the detail and quality of Mohamed's notes, then made these corrections:

- Breev uses cashboxes and accounts rather than a shift model with opening and closing cycles.
- The parties will select and approve the final accounting-entry model after reviewing proposed models. Mohamed may use AnyDesk to inspect the client's current pharmacy program and study its accounting entries.
- The item-details panel appears only in Purchase and Sales. It must be removed from Items. Settings control which item fields the panel shows.
- A visible arrow switches the sale unit between pack and strip.
- Visible plus and minus controls change quantity.
- Clicking the price opens a calculator-style numeric popup. The user enters the new value and presses Done.
- The right-side calculator provides a second method. After selecting an item, entering `2` and choosing "Change Quantity" sets quantity to 2. Entering `2000` and choosing "Change Price" sets the price to 2000.
- "Change Unit" in the calculator can be replaced by "Discount." Entering `500` and pressing Discount deducts 500 from the invoice.
- The interface also has a dedicated discount field.
- Phase Two packages will add delivery, promotion and marketing, and the other newly supplied interfaces.
- The external-integration data screen resembles a spreadsheet. The screen itself belongs in the free plan. Its API connection through Zapier to Telegram is paid.
- The product and company name is Breev.
- Visual finish and color coordination need close attention because the client estimates that they provide about 65% of the product's appeal in marketing campaigns.

Mohamed accepted these corrections and said he would add them to the documentation and final implementation scope.

### Employee cashboxes

At 12:29 PM, Saifaldeen described the cashbox process. A promised video would demonstrate it.

- Cashboxes and accounts record receipts, payments, and transfers with date and time.
- Each employee account has a separate cashbox that the employee can open from any of four devices, subject to permissions.
- Settings can assign an existing cashbox to an employee or create one in the employee's name.
- At the start of the workday or shift, the employee cashbox is reconciled to zero.
- At the end, the system balance is reconciled with actual cash, then transferred to the treasury or main cashbox.
- Any difference remains visible in the employee cashbox and may be transferred to a separate "Differences" cashbox.
- The daily transfer table tracks shortages. Every end-of-day transfer records its date and time.

Mohamed restated that each employee's cashbox follows the employee across devices under permission control. He understood that shortages and surpluses remain recorded, can move to Differences, and that receipt, payment, and transfer records identify the employee, date, and time. He deferred final workflow approval until he could review the video.

## 3 August 2026

### Saved records, vouchers, and statements

Saifaldeen supplied more accounting workflow evidence.

The "Search for Invoice" button opens the corresponding list from any transaction interface:

- Sales opens Sales lists.
- Purchases opens Purchase lists.
- Vouchers opens Voucher lists.
- The same pattern applies to every other saved transaction.

Users can open an invoice or record from that list. The attachment `IMG_8615.mov`, 29.54 MB, demonstrated the interaction.

A cashbox or account has a name and a type selected from the account tree, such as an expense account or cash on hand. `IMG_8616.jpeg` and `IMG_8617.jpeg` illustrated these fields.

The fund-transfer voucher flow, demonstrated in `IMG_8618.mov`, 163.80 MB, includes:

- Previous Voucher and Next Voucher controls.
- Transaction type.
- From account.
- To account.
- Amount.
- Notes.
- An editable accounting or statement date at the top.
- A fixed, immutable creation date.

The editable date determines where the voucher appears in account statements. For example, a voucher searched through a pharmaceutical wholesaler's statement appears under the entered accounting date. The creation date never changes.

Every saved sale, purchase, or voucher records the username of the person who performed it, so the responsible user can always be identified.

Pharmaceutical wholesalers may grant a settlement discount. Breev needs a "Wholesaler Discount" field that deducts this amount from total debt.

The account-statement process, shown in `IMG_8619.mov`, 54.33 MB, supports:

- Statements for patients who owe money, suppliers, cashboxes, and accounts.
- Every accounting movement from opening capital through the present.
- Sorting account debts from highest to lowest, lowest to highest, or alphabetically. The examples named Ahmed, Al-Shaghaf Pharmaceutical Wholesaler, and Al-Manara Pharmaceutical Wholesaler.
- Opening any displayed transaction or movement by double-clicking it.

Managers control access to all these operations because employee duties differ. A purchases employee may need access that a sales employee does not. A sales employee, for example, should not automatically see account statements.

Mohamed confirmed that these details would be incorporated into the implementation documentation.

## 5 August 2026

Mohamed sent the 61 KB `Breev_Phase1_Scope_v1.0.docx`, which consolidated the Phase One requirements, notes, and images. He asked Saifaldeen and his partner to review it and return final comments. After approval, Phase One could start on Mostaql under the documented milestone breakdown.

## 9 August 2026

### Terminal capacity, units, and pricing

Saifaldeen raised three points:

1. The current design supported four POS terminals in one pharmacy. He asked whether it could expand beyond four if a pharmacy requested more. No answer appears later in this conversation, so this remained an open question.
2. Packaging and unit quantities must be whole numbers to avoid synchronization problems.
3. A user reviews each item and enters its retail selling price. The wholesale price is defined only when the item is first created, although some items may define it as a percentage instead. Users should not repeatedly enter it by hand because purchase invoices provide future updates. If defined as a fixed price, a purchase invoice may change it, and the value should follow the latest order or purchase.

At 10:32 AM, Saifaldeen sent a draft of the interfaces and system specifications. He said he had used AI to help explain the accounting-entry rules and asked Mohamed to identify anything unclear. At 10:35 AM, he attached a 3.30 MB project brief.

### Supplier allowance and average cost

At 9:29 PM, Saifaldeen confirmed three accounting rules:

1. Cost after discount does not enter the average-cost calculation. It appears only as a reference in the account statement.
2. An exceptional allowance or discount granted at final settlement does not change item cost or historical average cost. Breev records it separately as an allowance difference.
3. The actual settlement allowance is independent of the allowance calculated from invoices. If they differ, Breev calculates the allowance difference automatically.

His example used a main cost of 5,000 and a calculated post-discount cost of 4,650, producing a calculated allowance of 350. If the user instead enters an actual allowance of 500 and pays 4,500, Breev records a 150 allowance difference and reduces the supplier balance to zero. It does not alter the original invoices or historical post-discount cost.

Saifaldeen asked whether the accounting entries were now clear or needed more explanation.

Mohamed confirmed this understanding:

- Average cost uses only the main cost before discount.
- Post-discount cost remains a historical reference for the supplier statement and does not affect average cost.
- A final-settlement allowance or discount is a separate financial transaction. It never changes item cost, historical average cost, or earlier invoices retroactively.
- Breev preserves invoice-calculated allowances and records the actual allowance separately. It posts any difference as an allowance difference so that the supplier balance matches the settlement.
- The system uses a transaction ledger. Purchases, adjustments, returns, settlements, and allowances are separate transactions. Approved historical transactions are not edited directly afterward.

Mohamed did not need further accounting clarification at that point. He committed to ask the client before finalizing any implementation case not explicitly covered by the documentation.

At 10:55 PM, Mohamed sent the 73 KB `Breev_Phase1_MVP_Scope_v1.2.docx`.

## 11 August 2026

At 9:22 PM, Saifaldeen sent a revised 3.78 MB project brief. At 9:40 PM, Mohamed said Phase One could begin and asked the client to open a new Mostaql project for the amount stated in the documentation.

## 12 August 2026

The source conversation records this date but contains no further messages.
