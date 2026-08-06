# Keyboard and Focus Workflows

This file distinguishes **confirmed sequences** from key bindings that still require usability testing. The previous scaffold's F1/F2/F3/F4/F12 bindings had no supporting source and are therefore not treated as requirements.

## Global rules

- A scanner that types a barcode and sends Enter must work without mouse interaction.
- Enter advances only after the current field validates; errors retain focus and are announced visibly.
- Escape closes the top non-destructive popover/modal and restores focus to its opener. Discarding a populated draft requires explicit confirmation.
- Focus must never fall behind an open modal or disappear after an async result/error.
- RTL changes visual layout, not the logical order of the high-speed data-entry pipeline.
- Permissions/entitlements can disable an action but must give an actionable explanation without trapping keyboard focus.
- Exact global function-key bindings are **proposed later**, after observing pharmacists and avoiding browser/OS/scanner conflicts.

## Purchase entry — confirmed sequence

```text
Item or barcode
  Enter → Quantity
  Enter → Cost price
  Enter → Selling price
  Enter → Expiry date
  Enter → commit validated row and focus Item/barcode on a new row
```

Rules:

- Supplier, invoice date/reference, and payment/debt context are set before posting but do not interrupt every row.
- Supplier default discount and before/after-discount values are visible during review; their accounting treatment awaits Q-007.
- Optional columns such as unit, return quantity, margin, special pricing, lot, or notes may be reachable, but cannot break the confirmed primary Enter sequence.
- Unknown item opens quick product definition; after save/cancel, focus returns to the same purchase row.
- OCR populates a reviewable draft. Keyboard navigation must visit low-confidence/invalid cells before Post is enabled.
- Posting is a distinct explicit command; Enter on the final expiry must not post the invoice.

## POS sale — confirmed interaction order

1. Barcode/search field is the repeat focus target.
2. Known item adds a line; repeated scan follows the approved duplicate-line policy.
3. Unknown barcode opens quick Product; unknown name in Pick Item opens it with Enter or Add.
4. The active row exposes unit (box/strip/other approved unit), quantity plus/minus/direct entry, price override subject to permission, and discount.
5. Keypad `+`/`-` semantics shown by the prototype must not be frozen until labels and discount/expense behavior are tested; invoice discount is also a separate field per the latest clarification.
6. Quick Patient modal returns focus to the sale and preserves all lines.
7. Payment review precedes an explicit authorized Post/Print action.
8. On success, focus returns to barcode/search for the next draft; on failure, the existing draft remains and focus moves to the actionable error/field.

Open details: duplicate barcode behavior, decimal/whole quantities by unit, hotkeys, price-below-cost approval, payment shortcut, and receipt reprint shortcut.

## Quick stock count — confirmed loop

```text
Barcode/item
  Enter → unit/count
  Enter → variance/reason when needed
  Enter → authorized adjustment movement
  success → refocus Barcode/item
```

- One count session accepts many products; the modal/page does not close after each item.
- Count input converts exact packaging units to the inventory unit.
- Variance does not directly overwrite a product quantity.

## Dialog return-focus requirements

| Invocation | On successful save | On cancel |
|---|---|---|
| Unknown product from sale | Select newly created product and return to current line/unit | Return to unresolved barcode/search text |
| Unknown product from purchase | Select product and return to Quantity | Return to unresolved Item/barcode |
| Quick patient from sale | Attach patient and return to sale review/search | Return to patient control; invoice unchanged |
| Price/discount override | Apply authorized value and return to line | Restore original value and line focus |
| Permission/manager approval | Retry the pending command once | Return to the blocked action without mutating data |

## Verification matrix for later phases

Each high-speed workflow must be tested with Arabic/RTL and English/LTR, light/dark, scanner-like rapid input, slow async response, offline state, validation error, permission denial, entitlement denial, duplicate submission, app restart, and minimum supported Windows hardware.
