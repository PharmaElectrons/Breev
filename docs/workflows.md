# Critical workflows

These workflows are user-visible contracts. The local API controls every business transition. The renderer controls only presentation, focus, and temporary interaction state.

## Common interaction rules

- A keyboard-wedge scanner that ends input with Enter works without a mouse. On validation failure, Breev keeps the relevant value and focus and announces the error. On success, focus moves to the documented next control.
- Escape closes only the top non-destructive popover or dialog, then returns focus to the control that opened it. Breev requires explicit confirmation before discarding a populated draft.
- Dialogs trap focus and return it to the control that opened them. Async completion always leaves a control focused. RTL may mirror the layout, but it never changes the logical entry order.
- Handling an unknown product or quickly creating a patient keeps the active draft intact. On success, Breev attaches the new record and returns to the unresolved line. Cancel changes nothing.
- Each command includes a draft version and idempotency key. After a timeout or restart, a retry returns the existing outcome or a clear rejection. The client never guesses whether posting succeeded.
- Breev will not finalize function keys or duplicate-scan behavior until the team observes them with pharmacists, Windows, browsers, and certified scanners.

## Install, repair, update, and remove on Windows

1. The operator runs the single `BreevSetup.exe`. Assisted installation presents the two native radio choices and defaults to Main; unattended installation passes exactly `/S /ROLE=main` or `/S /ROLE=terminal`. Invalid values fail before old application files or preserved state are touched.
2. Before any replacement or repair, the installer reads `%ProgramData%\Breev\config\device-role` and checks preserved Main and Terminal state. An explicit role that conflicts with installed state is refused. A silent update omits `/ROLE` and preserves the installed role automatically.
3. Main installation reaches Ready only after PostgreSQL, migrations, the local API, and any enabled LAN listener are healthy. Terminal installation reaches Ready after the complete payload and the terminal configuration boundary are valid; it creates no local database, Breev service, listener, or firewall rule.
4. Repair runs the same role-specific readiness sequence. A failed repair records failure while preserving Main data and CA state or Terminal pairing state. It never converts a machine between roles.
5. Uninstall removes the application and active Main-only services/rules but preserves `%ProgramData%\Breev`. Reinstall resolves the preserved role. Destructive data removal remains a separate, explicitly authorized administrator action and is never reachable from the installer UI, silent installer, updater, repair, or uninstaller.

## Start and connect

1. Electron loads only the packaged UI and shows `Starting`, `Connecting`, `Ready`, `Main unavailable`, `Incompatible version`, or `Repair required`. It never silently falls back to a second datastore.
2. On the Main Pharmacy Computer, Windows services keep PostgreSQL and the local API running, not the user's Electron window. On a terminal, discovery finds a candidate main service but does not establish trust.
3. The client establishes the approved TLS/device channel, checks health/schema/API version, then authenticates the individual user.
4. The API derives pharmacy, device, permission, and entitlement context. The renderer receives allowed navigation/actions and explicit denial/expiry states.
5. Internet loss changes only cloud/provider status. LAN loss blocks an Additional POS Terminal; the Main Pharmacy Computer continues local work. No terminal creates an independent offline database.

## Purchase and receive

1. Open or resume a server-durable Purchase Draft. Enter the supplier invoice number, supplier, and cash/debt context first, outside the repeated line path; the supplier's invoice-date allowance snapshot fills automatically. Columns can be shown, hidden, and reordered, and each item's retail price appears with By Price/By Percentage field locking. The item-details side panel appears as in Sales.
2. Repeat the row: Enter moves through the active fields in their configured column order — by default **Item/Barcode → Quantity → Cost → Selling Price → Expiry** — validates and commits the row, then either opens a new row or returns focus to the Item/Barcode field, according to the user's setting. Optional controls — unit, lot, margin, special pricing, or notes — may be reachable but must not interrupt the flow unless the pharmacist/legal product-class rule requires resolution before posting.
3. Unknown item opens quick Product creation without losing the row or draft. Product packaging converts the selected purchase unit to Inventory Units.
4. Review gross/discount/net, batches/expiry, tender/payable effect, warnings, and the accountant-approved preview. Posting requires a separate explicit action. Enter on Expiry never posts the document.
5. The API locks and revalidates the draft, allocates a number, and atomically posts the snapshots, batches, movements/value, cash/payable, balanced journal, audit, idempotency result, and outbox.
6. On success, Breev shows the immutable purchase and starts a new draft. On rejection, Breev keeps the draft and identifies the field/rule. No one edits or deletes a posted purchase.

### Adjust or return a posted purchase

The purchase search button opens the list of previous purchase invoices; subject to permissions, users view an invoice or open its items or supplier. "Edit Invoice" starts a Purchase Invoice Adjustment draft under the Delta rules in [`domain.md`](domain.md): correct the copy, review the before-and-after summary and impact, confirm, and post only the differences as a linked A-numbered adjustment. A Purchase Return — goods physically going back to the supplier — is a separate document linked to the original, full or partial, reducing stock and the supplier balance. Both paths keep the original invoice untouched and navigable from its corrections.

### OCR-assisted entry

An upload creates one source-hashed job. Provider output and highlighted locations fill only an OCR Draft. A human confirms or corrects every critical field and explicitly resolves unknown products, suppliers, packages, lots, and totals; keyboard navigation must visit every low-confidence or invalid cell before Post is enabled. Breev recalculates locally. The result then follows the ordinary Purchase Draft flow. If the pharmacy is offline, the quota is exhausted, the provider fails, the paid plan expires, or OCR rejects the document, manual entry remains available and Breev keeps the drafts.

## Sell and settle

1. Open or resume a server-durable Sale Draft with the scan/search field focused. Invoices can be suspended and resumed without losing data, and unsaved invoice data survives navigating away and back. Clicking **New**, or deleting or clearing an invoice that contains items, requires confirmation before any data is lost.
2. Scan or search to add or select a product/package. Change the unit with the row selector, quantity with the `+`/`-` controls or the side calculator, and price through the numeric dialog opened by clicking the price. The side calculator applies an entered number as quantity, price, or discount to the selected item or invoice; a separate invoice-level discount field remains available. Scanning an unregistered barcode — or pressing Enter/Add after an empty Pick Item name search — opens the item-definition dialog without leaving the sale. Subject to permissions, a quick Add button creates a miscellaneous item or service line; with no entered cost, cost defaults to zero. The quick-access icon opens the manager-configured grid of frequently sold items grouped in categories, each showing the item name and image when available; clicking one adds it with its default unit and price. An "Add to Order Basket" row action feeds the reorder basket without disrupting the invoice.
3. Optionally attach or create a Patient Profile through the `+` button beside patient search, without leaving the sale. Anonymous remains the default. Selecting a patient shows the approved summary (chronic conditions, chronic medications, interests); important notes such as allergies trigger a dismissable review popup. Chronic medications can be added to the invoice in one click, and invoice medications can be saved to the patient's chronic-treatment list before the sale completes or cancels. Where defined, frequency-of-use, food-instruction, and number-of-days fields appear and feed follow-up scheduling. Patient work never changes sale lines.
4. The item-details side panel (Sales and Purchasing only) shows the item name and, per settings, scientific name, balance, packaging, min/max levels, batch data, expiry with days remaining, 1/2/3-month average consumption, estimated surplus, and an item thumbnail when available; the sales table shows only the retail price, while the panel may show the wholesale/special price subject to permissions. The employee's current cash-drawer balance appears per setting/permission. Opening the item record from an invoice line (double-click or action icon) keeps unsaved invoice data intact.
5. Before checkout, compare every changed draft price with the current price/version and total impact. Refresh is the default. Keeping an old price requires permission and a reason. The server always revalidates current stock, FEFO batch eligibility, expiry/recall/quarantine, restriction, tax, cost, and posting rules, and shows the below-cost warning where it applies.
6. Review totals and cash, card, or deferred settlement per the rules in [`domain.md`](domain.md). Post is an explicit authorized action. Negative stock and Regulatory Hard Blocks stop posting without override; the durable draft remains.
7. One transaction posts the sale snapshots, physical and valuation movements, tender/receivable/Cash Box, balanced journal, audit, idempotency result, and outbox.
8. Printing and drawer pulse occur after commit. Breev links a normal drawer opening to its cash transaction. Manual opening requires named permission and audit. A printing or drawer failure shows a recoverable reprint/drawer state and never rolls back or reposts the sale. On success, focus returns to a new sale's scan field.

The sales search button opens the popup list of completed/saved invoices with previous/next navigation; subject to permissions, users open them for viewing only. A posted sales invoice is never edited — correction uses a linked sales Return (or a full Reversal for a wholly wrong posting). Later item-record changes never alter an earlier invoice; historical views use the data stored with the saved invoice, and the expanded Frozen Snapshot concept beyond that stored data is Phase Two.

## Count, block, and dispose stock

### Count

1. Start/resume a Count Session and focus Barcode/Item.
2. Repeat Barcode/Item → new balance → Enter. The balance may be entered in the base unit or as a combination of large and small units (at 1 pack = 4 strips, "2 packs + 1 strip" = 9 strips); the system converts to an integer base-unit quantity. An input calculator may assist entry.
3. Show recorded value, converted Inventory Unit count, variance, balances before and after, and required reason/evidence/approval. Applying a variance posts an independent movement that never rewrites prior history; it does not edit Product or Batch quantity.
4. Return focus to Barcode/Item. The session keeps both the observation and the applied movement for audit/reconciliation.

### Expiry, recall, quarantine

The daily idempotent job updates current eligibility and catches up on missed business dates. Checkout also revalidates synchronously, so a missed job cannot allow the sale of newly expired stock. The monthly review lists every expired batch and every unresolved recalled or quarantined batch.

For each affected quantity, the owner approves a supplier return, write-off, destruction, or postponement. Postponed stock remains blocked. The chosen action posts its own movement and, when applicable, a carrying-amount journal. Quarantine alone posts no loss. Expiry correction requires a separate Step-Up-authorized batch amendment that keeps the original value and evidence.

## Return, reversal, and replacement

1. Find the original Posted Document and show its correction chain.
2. Choose the correct operation:
   - **Return** for goods physically returned; select quantities, reason/evidence, disposition/restock decision, and refund/debt effect.
   - **Reversal** for a wrongly posted complete transaction; offset all required stock, money, and journal effects.
   - **Non-financial note** for clarification that changes no posted fact.
3. Recheck permission, Step-Up/Dual Control policy, current period, evidence, and current source version. A no-invoice return, if enabled, is a separate elevated route.
4. Post the new linked document atomically. If the original business should still exist, create and post a new replacement draft after the Reversal.
5. Keep and show the original and the full chain. Never edit, delete, or hide the source.

## Cash drawers, vouchers, and statements

1. At the start of work, the employee's cash drawer is reconciled to zero. During the day, cash sales, receipts, payments, and transfers post to it continuously; reconciliation never locks the sales screen.
2. At the end of work, the system compares the expected drawer balance with counted cash. The matched amount transfers to the safe/treasury account; any shortage or overage stays visible in the drawer or moves to the discrepancies account. The daily transfer records date, time, and user.
3. Vouchers (transfer, supplier payment, receipt, expense) follow the field and allowance rules in [`domain.md`](domain.md), including the editable open-period voucher date and immutable creation timestamp.
4. Each operational interface's search button opens the popup list for its own document type — sales, purchases, or vouchers — with previous/next navigation. Each type keeps its correction rules: saved sales invoices allow viewing and returns only; purchase invoices use Delta adjustments or returns; vouchers follow permissions and approved rules.
5. Account statements open per account with chronological movements and document references; double-clicking a movement opens the original document per permissions.

## Terminal pairing and revocation

1. An owner or trusted user reauthenticates on the Main Pharmacy Computer and starts a five-minute, one-use pairing session.
2. The terminal discovers the main service or connects by location, generates a non-exported keypair, and presents the proposed identity. Both screens show a fingerprint phrase for the user to compare.
3. The user confirms the physical terminal and allocates an available paid seat. The local CA issues a pharmacy/device certificate; the terminal then requires individual user login.
4. The system fails closed and audits replays, excess attempts, mismatch, expiry, missing entitlement, or cancellation.
5. Revocation on the main service immediately blocks that device offline and ends its sessions. Replacement requires a new pairing. Disaster recovery creates a new CA/trust domain and re-pairs all terminals.

## Subscription expiry and renewal

The owner/admin sees the expiry and grace dates before disruption; ordinary cashiers do not receive repetitive disruptive warnings. Under the proposed default rule (pending client approval — see [`open-decisions.md`](open-decisions.md)), paid capabilities continue through seven inclusive grace days, except for new terminal pairing unless explicitly licensed, and at 00:00 on day eight under Trusted Breev Time Breev stops new paid work and the UI states why. Queued or stopped provider work and all history remain visible. Core-compatible drafts can still complete on the Main Pharmacy Computer; paid-only drafts remain preserved read-only or are explicitly converted. Free Core, backup/export/restore, and renewal remain usable. A validated renewed licence re-enables capabilities without reinstalling Breev or changing data.

## One-Way Sync and future Cloud Commands

For One-Way Sync, the local publisher claims committed outbox rows, sends a versioned batch, and retries with the same identities. Cloud commits inbox deduplication and its read projection together, then acknowledges a durable local checkpoint. A failure creates a visible backlog/dead-letter state and never delays local posting. Cloud views show freshness and have no edit control.

A future Cloud Command remains `Pending` until the local API receives it, verifies entitlement/tenant/requester/field ownership/expiry/expected version, and applies it as an ordinary audited local command. A mismatch becomes `Conflict` with Base, Current Local, and Requested Cloud. Resolution requires a new authorized local decision. Posted operational facts are never eligible.

## Patient consent, clinical evaluation, and messaging

1. Keep the sale anonymous unless identity is necessary or a Patient Profile is explicitly offered/selected.
2. For optional use, present the purpose-specific bilingual notice and destination/provider/region context. Record grant, denial, or withdrawal as an immutable event. Do not infer consent or extend it to another purpose.
3. Before sensitive access or external send, recheck current staff permission, purpose/basis, patient/representative scope, consent/opt-out, destination, retention/hold, provider/jurisdiction gate, and entitlement.
4. Run clinical evaluation only with approved entered facts, product mapping, fresh signed licensed content, and versioned rules. Otherwise, show `Not Evaluated`. Never suppress Regulatory Hard Blocks.
5. In the paid follow-up interface: select the patient, select the message template (or, with permission, add a new template from the interface), then send immediately or schedule for an approved time. Enabled message types — invoice delivery, medication-depletion reminders, birthday greetings, reserved-item availability, price-change notices — depend on the plan and the client-approved final list. Follow-up lists order by due time, and completed actions leave the list; a reservation clears after its availability message is sent or delivered.
6. Queue only an approved current template for WhatsApp. Send-time failure, withdrawal, Do Not Disturb, number change, provider outage, policy block, or paid expiry cancels or stops the optional send without affecting the sale. Authenticated callbacks update delivery evidence idempotently.
