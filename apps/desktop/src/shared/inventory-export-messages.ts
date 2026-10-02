/** Human CSV presentation only. Numeric values and source facts stay canonical. */
export const inventoryExportMessages = {
  en: {
    headers: [
      "Pharmacy ID",
      "Exported at (UTC)",
      "Product ID",
      "Item",
      "Status",
      "Balance (inventory units)",
      "Value (fils)",
      "Average unit cost (fils)",
      "Minimum level",
      "Maximum level",
      "Reorder point",
      "Batch count",
      "Supplier count",
    ],
    states: { active: "Active", archived: "Archived", merged: "Merged" },
  },
  ar: {
    headers: [
      "معرّف الصيدلية",
      "وقت التصدير (UTC)",
      "معرّف الصنف",
      "الصنف",
      "الحالة",
      "الرصيد (وحدات المخزون)",
      "القيمة (فلس)",
      "متوسط تكلفة الوحدة (فلس)",
      "الحد الأدنى",
      "الحد الأقصى",
      "نقطة إعادة الطلب",
      "عدد الدفعات",
      "عدد الموردين",
    ],
    states: { active: "نشط", archived: "مؤرشف", merged: "مدمج" },
  },
} as const;
