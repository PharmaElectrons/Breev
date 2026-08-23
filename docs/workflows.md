# Critical workflows

These workflows are user-visible contracts. The local API controls every business transition. The renderer controls only presentation, focus, and temporary interaction state.

## Common interaction rules

- A keyboard-wedge scanner that ends input with Enter works without a mouse. On validation failure, Breev keeps the relevant value and focus and announces the error. On success, focus moves to the documented next control.
- Escape closes only the top non-destructive popover or dialog, then returns focus to the control that opened it. Breev requires explicit confirmation before discarding a populated draft.
- Dialogs trap focus and return it to the control that opened them. Async completion always leaves a control focused. RTL may mirror the layout, but it never changes the logical entry order.
- Handling an unknown product or quickly creating a patient keeps the active draft intact. On success, Breev attaches the new record and returns to the unresolved line. Cancel changes nothing.
- Each command includes a draft version and idempotency key. After a timeout or restart, a retry returns the existing outcome or a clear rejection. The client never guesses whether posting succeeded.
- Breev will not finalize function keys, duplicate-scan behavior, or fractional-quantity policy until the team observes them with pharmacists, Windows, browsers, and certified scanners.

## Start and connect

1. Electron loads only the packaged UI and shows `Starting`, `Connecting`, `Ready`, `Main unavailable`, `Incompatible version`, or `Repair required`. It never silently falls back to a second datastore.
2. On the Main Pharmacy Computer, Windows services keep PostgreSQL and the local API running, not the user's Electron window. On a terminal, discovery finds a candidate main service but does not establish trust.
3. The client establishes the approved TLS/device channel, checks health/schema/API version, then authenticates the individual user.
4. The API derives pharmacy, device, permission, and entitlement context. The renderer receives allowed navigation/actions and explicit denial/expiry states.
5. Internet loss changes only cloud/provider status. LAN loss blocks an Additional POS Terminal; the Main Pharmacy Computer continues local work. No terminal creates an independent offline database.

## Purchase and receive

1. Open or resume a server-durable Purchase Draft. Select the supplier, date/reference, cash/debt context, and supplier discount outside the repeated line path.
2. Repeat exactly: **Item/Barcode → Quantity → Cost → Selling Price → Expiry → Enter (next row)**. Enter validates and commits that draft row, then focuses the next Item/Barcode field. Optional controls — unit, lot, margin, special pricing, or notes — may be reachable but must not interrupt this sequence unless the pharmacist/legal product-class rule requires resolution before posting.
3. Unknown item opens quick Product creation without losing the row or draft. Product packaging converts the selected purchase unit to Inventory Units.
4. Review gross/discount/net, batches/expiry, tender/payable effect, warnings, and the accountant-approved preview. Posting requires a separate explicit action. Enter on Expiry never posts the document.
5. The API locks and revalidates the draft, allocates a number, and atomically posts the snapshots, batches, movements/value, cash/payable, balanced journal, audit, idempotency result, and outbox.
6. On success, Breev shows the immutable purchase and starts a new draft. On rejection, Breev keeps the draft and identifies the field/rule. A supplier Return follows the correction flow. No one edits or deletes a posted purchase.

### OCR-assisted entry

An upload creates one source-hashed job. Provider output and highlighted locations fill only an OCR Draft. A human confirms or corrects every critical field and explicitly resolves unknown products, suppliers, packages, lots, and totals; keyboard navigation must visit every low-confidence or invalid cell before Post is enabled. Breev recalculates locally. The result then follows the ordinary Purchase Draft flow. If the pharmacy is offline, the quota is exhausted, the provider fails, the paid plan expires, or OCR rejects the document, manual entry remains available and Breev keeps the drafts.

## Sell and settle

1. Open or resume a server-durable Sale Draft with the scan/search field focused.
2. Scan or search to add or select a product/package. Edit the allowed unit, integer quantity, and authorized selling price/discount, then repeat. An unknown product opens quick creation without losing lines.
3. Optionally attach or create a Patient Profile. Anonymous remains the default. Patient work never changes sale lines.
4. Before checkout, compare every changed draft price with the current price/version and total impact. Refresh is the default. Keeping an old price requires permission and a reason. The server always revalidates current stock, FEFO batch eligibility, expiry/recall/quarantine, restriction, tax, cost, and posting rules.
5. Review totals and cash, credit, or mixed settlement. Post is an explicit authorized action. Negative stock and Regulatory Hard Blocks stop posting without override; the durable draft remains.
6. One transaction posts the sale snapshots, physical and valuation movements, tender/receivable/Cash Box, balanced journal, audit, idempotency result, and outbox.
7. Printing and drawer pulse occur after commit. Breev links a normal drawer opening to its cash transaction. Manual opening requires named permission and audit. A printing or drawer failure shows a recoverable reprint/drawer state and never rolls back or reposts the sale. On success, focus returns to a new sale's scan field.

## Count, block, and dispose stock

### Count

1. Start/resume a Count Session and focus Barcode/Item.
2. Repeat Barcode/Item → package/unit → physical count → Enter.
3. Show recorded value, converted Inventory Unit count, variance, and required reason/evidence/approval. Applying a variance posts a movement; it does not edit Product or Batch quantity.
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

## Terminal pairing and revocation

1. An owner or trusted user reauthenticates on the Main Pharmacy Computer and starts a five-minute, one-use pairing session.
2. The terminal discovers the main service or connects by location, generates a non-exported keypair, and presents the proposed identity. Both screens show a fingerprint phrase for the user to compare.
3. The user confirms the physical terminal and allocates an available paid seat. The local CA issues a pharmacy/device certificate; the terminal then requires individual user login.
4. The system fails closed and audits replays, excess attempts, mismatch, expiry, missing entitlement, or cancellation.
5. Revocation on the main service immediately blocks that device offline and ends its sessions. Replacement requires a new pairing. Disaster recovery creates a new CA/trust domain and re-pairs all terminals.

## Subscription expiry and renewal

The owner/admin sees the expiry and grace dates before disruption; ordinary cashiers do not receive repetitive disruptive warnings. Paid capabilities continue through seven inclusive grace days, except for new terminal pairing unless explicitly licensed. At 00:00 on day eight under Trusted Breev Time, Breev stops new paid work and the UI states why. Queued or stopped provider work and all history remain visible. Core-compatible drafts can still complete on the Main Pharmacy Computer; paid-only drafts remain preserved read-only or are explicitly converted. Free Core, backup/export/restore, and renewal remain usable. A validated renewed licence re-enables capabilities without reinstalling Breev or changing data.

## One-Way Sync and future Cloud Commands

For One-Way Sync, the local publisher claims committed outbox rows, sends a versioned batch, and retries with the same identities. Cloud commits inbox deduplication and its read projection together, then acknowledges a durable local checkpoint. A failure creates a visible backlog/dead-letter state and never delays local posting. Cloud views show freshness and have no edit control.

A future Cloud Command remains `Pending` until the local API receives it, verifies entitlement/tenant/requester/field ownership/expiry/expected version, and applies it as an ordinary audited local command. A mismatch becomes `Conflict` with Base, Current Local, and Requested Cloud. Resolution requires a new authorized local decision. Posted operational facts are never eligible.

## Patient consent, clinical evaluation, and messaging

1. Keep the sale anonymous unless identity is necessary or a Patient Profile is explicitly offered/selected.
2. For optional use, present the purpose-specific bilingual notice and destination/provider/region context. Record grant, denial, or withdrawal as an immutable event. Do not infer consent or extend it to another purpose.
3. Before sensitive access or external send, recheck current staff permission, purpose/basis, patient/representative scope, consent/opt-out, destination, retention/hold, provider/jurisdiction gate, and entitlement.
4. Run clinical evaluation only with approved entered facts, product mapping, fresh signed licensed content, and versioned rules. Otherwise, show `Not Evaluated`. Never suppress Regulatory Hard Blocks.
5. Queue only an approved current template for WhatsApp. Send-time failure, withdrawal, number change, provider outage, policy block, or paid expiry cancels or stops the optional send without affecting the sale. Authenticated callbacks update delivery evidence idempotently.
