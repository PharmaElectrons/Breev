import type { PurchaseAdjustmentHeaderComparison } from "@breev/contracts/local-rest";
import { usePreferences } from "./preferences-provider";
import { purchasingMessages } from "./purchasing-messages";

export function PurchaseAdjustmentHeaderComparisonTable({
  comparison,
}: {
  readonly comparison: PurchaseAdjustmentHeaderComparison;
}): React.JSX.Element | null {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const rows = [
    ...(comparison.before.supplierId === comparison.after.supplierId
      ? []
      : [
          {
            label: copy.supplier,
            before: comparison.before.supplierNameSnapshot,
            after: comparison.after.supplierNameSnapshot,
          },
        ]),
    ...(comparison.before.supplierInvoiceNumber ===
    comparison.after.supplierInvoiceNumber
      ? []
      : [
          {
            label: copy.supplierDocketNumber,
            before: comparison.before.supplierInvoiceNumber,
            after: comparison.after.supplierInvoiceNumber,
          },
        ]),
  ];
  if (rows.length === 0) return null;
  return (
    <table className="delta-summary-table adjustment-header-comparison">
      <thead>
        <tr>
          <th scope="col">{copy.comparisonField}</th>
          <th scope="col">{copy.comparisonBefore}</th>
          <th scope="col">{copy.comparisonAfter}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>
              <bdi>{row.before}</bdi>
            </td>
            <td>
              <bdi>{row.after}</bdi>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
