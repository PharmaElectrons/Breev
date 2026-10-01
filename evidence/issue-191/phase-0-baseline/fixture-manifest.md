# Deterministic synthetic fixture manifest

The packaged acceptance fixture is owned by
`apps/desktop/test/acceptance/seed.ts`. Each pass creates a new pharmacy through
the public identity endpoint, then creates all Supplier, Product, Purchase,
batch, Inventory, Count, and reorder facts through the same local REST contract
used by the desktop renderer.

| Required family | Deterministic coverage |
|---|---|
| Bilingual Products, search, and barcodes | `Panadol Extra GSK` is created through the packaged UI with Arabic search name `بنادول اكسترا` and barcode `5000167000101`. `Cold Extra Relief`, `Vitamin Extra Daily`, and a non-Extra control make the complete `extra` result set knowable. All other Products use reserved synthetic `50001670001xx` values. |
| Packaging and exact units | Every seeded Product uses `Strip` as the integer base unit and `Pack × 4`; `Unit Pack Item` buys by Pack. The scenario purchases one Pack and records `2 packs + 1 strip` as exactly 9 strips. |
| Pricing modes and rounding | `Margin Item Plain` is 80,000 fils at 20% with rounding off. Separate Products cover nearest 250/500/1,000 IQD, an off-midpoint 250-IQD case, and By Price. `Panel Detail Item` has distinct retail and wholesale prices. |
| Supplier allowance and terms | `Al-Nahrain Medical`, 2.5% allowance effective 2026-01-01, terms `Net 30`. |
| Cash and debt Purchase Drafts | Packaged UI flows exercise the Cash context; REST-seeded posting candidates use Debt. The real-PostgreSQL posting suite independently proves both atomic settlement contexts. |
| Batches and expiry | `Review Stock Item` has a 2029-05-31 batch. `Fefo Batch Item` has 2027-06-30 and 2029-12-31 lots. All use synthetic lot `ACCEPTANCE-LOT`. |
| Adjustment and Return | `M2-ADJ-1` contains `Adjusted Line Item` quantity 4 and `Silent Line Item` quantity 2. `M2-BLOCK-1` supplies the invalid-Delta candidate. Clause 3 changes 4→8, posts +4, then creates a separate Return of 1. |
| Inventory and Count | `Review Stock Item` and `Unit Pack Item` carry min 10, max 60, reorder 20. The packaged flow reads Inventory/batches and completes the deterministic 9-strip Count scenario. |
| Reorder basket and Ordered Items | The same thresholded Products exercise inventory-side addition, editable quantity, confirmation to Ordered Items, return to basket, restart durability, and Sales-side addition without mutating the Sale Draft. |
| Authorized and denied actors | The packaged pass uses a synthetic Owner. The disposable real-PostgreSQL authorization fixtures create denied/custom roles for Purchasing, Count, reorder, and Sale Draft commands and assert audited 403 responses. |

The acceptance fixture is reset for every locale/theme pass. Generated UUIDv7
identifiers, local ports, database role passwords, and device credentials are
runtime-only and are intentionally excluded from evidence.
