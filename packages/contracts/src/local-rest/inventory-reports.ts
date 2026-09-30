import { z } from "zod";

export const INVENTORY_REPORT_KINDS = [
  "quantity",
  "value",
  "average-cost",
  "batches-expiry",
  "consumption",
  "alerts",
  "stocktake-movements",
] as const;
export const inventoryReportKindSchema = z.enum(INVENTORY_REPORT_KINDS);
export type InventoryReportKind = z.infer<typeof inventoryReportKindSchema>;

export const INVENTORY_REPORT_COLUMNS = [
  "item",
  "unit",
  "openingQuantity",
  "periodQuantity",
  "activityQuantity",
  "closingQuantity",
  "openingValueFils",
  "periodValueFils",
  "activityValueFils",
  "closingValueFils",
  "openingAverageCostScaled",
  "closingAverageCostScaled",
  "batch",
  "expiry",
  "status",
  "alert",
  "availability",
  "consumedQuantity",
  "consumptionPer30Days",
  "observedQuantity",
  "countedQuantity",
  "actor",
  "postedAt",
  "businessDate",
  "source",
] as const;
export const inventoryReportColumnSchema = z.enum(INVENTORY_REPORT_COLUMNS);
export type InventoryReportColumn = z.infer<typeof inventoryReportColumnSchema>;
export const INVENTORY_REPORT_SENSITIVE_COLUMNS: readonly InventoryReportColumn[] =
  [
    "openingValueFils",
    "periodValueFils",
    "activityValueFils",
    "closingValueFils",
    "openingAverageCostScaled",
    "closingAverageCostScaled",
  ];
const positionColumns = [
  "item",
  "unit",
  "openingQuantity",
  "periodQuantity",
  "activityQuantity",
  "closingQuantity",
] as const;
export const INVENTORY_REPORT_DEFINITIONS: Readonly<
  Record<
    InventoryReportKind,
    {
      readonly columns: readonly InventoryReportColumn[];
      readonly groups: readonly InventoryReportColumn[];
    }
  >
> = {
  quantity: { columns: positionColumns, groups: ["item"] },
  value: {
    columns: [
      ...positionColumns,
      "openingValueFils",
      "periodValueFils",
      "activityValueFils",
      "closingValueFils",
    ],
    groups: ["item"],
  },
  "average-cost": {
    columns: [
      ...positionColumns,
      "openingAverageCostScaled",
      "closingAverageCostScaled",
    ],
    groups: ["item"],
  },
  "batches-expiry": {
    columns: [
      ...positionColumns,
      "batch",
      "expiry",
      "status",
      "actor",
      "postedAt",
      "businessDate",
      "source",
    ],
    groups: ["item", "status", "expiry"],
  },
  consumption: {
    columns: [...positionColumns, "consumedQuantity", "consumptionPer30Days"],
    groups: ["item"],
  },
  alerts: {
    columns: [
      "item",
      "unit",
      "closingQuantity",
      "batch",
      "expiry",
      "alert",
      "availability",
      "actor",
      "postedAt",
      "businessDate",
      "source",
    ],
    groups: ["item", "alert"],
  },
  "stocktake-movements": {
    columns: [
      "item",
      "unit",
      "observedQuantity",
      "countedQuantity",
      "activityQuantity",
      "activityValueFils",
      "actor",
      "postedAt",
      "businessDate",
      "source",
    ],
    groups: ["item", "actor", "source"],
  },
};
const integer = z
  .string()
  .regex(/^(?:0|-?[1-9][0-9]*)$/u)
  .max(80);
const instant = z.iso.datetime();
export const inventoryReportQuerySchema = z
  .strictObject({
    from: instant.optional(),
    to: instant.optional(),
    actorId: z.uuidv7().optional(),
    businessFrom: z.iso.date().optional(),
    businessTo: z.iso.date().optional(),
    filters: z
      .array(
        z.strictObject({
          column: inventoryReportColumnSchema,
          operator: z.enum(["contains", "eq", "gte", "lte"]),
          value: z.string().min(1).max(726),
        }),
      )
      .max(12)
      .default([]),
    sort: inventoryReportColumnSchema.default("item"),
    direction: z.enum(["ascending", "descending"]).default("ascending"),
    groupBy: inventoryReportColumnSchema.optional(),
    columns: z
      .array(inventoryReportColumnSchema)
      .min(1)
      .max(INVENTORY_REPORT_COLUMNS.length)
      .refine((v) => new Set(v).size === v.length)
      .optional(),
    windowDays: z
      .union([z.literal(30), z.literal(60), z.literal(90)])
      .default(90),
    page: z.number().int().min(1).max(100_000).default(1),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .superRefine((q, ctx) => {
    if (
      (q.from === undefined) !== (q.to === undefined) ||
      (q.from !== undefined &&
        q.to !== undefined &&
        Date.parse(q.from) >= Date.parse(q.to))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "Provide a nonempty half-open UTC interval",
      });
    }
    if (
      q.businessFrom !== undefined &&
      q.businessTo !== undefined &&
      q.businessFrom > q.businessTo
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["businessFrom"],
        message: "Invalid business date interval",
      });
    }
  });
export type InventoryReportQuery = z.infer<typeof inventoryReportQuerySchema>;
export function inventoryReportQueryFor(kind: InventoryReportKind) {
  const definition = INVENTORY_REPORT_DEFINITIONS[kind];
  return inventoryReportQuerySchema.superRefine((q, ctx) => {
    for (const column of [
      q.sort,
      ...(q.columns ?? []),
      ...q.filters.map((f) => f.column),
    ]) {
      if (!definition.columns.includes(column))
        ctx.addIssue({
          code: "custom",
          message: "Unsupported report column",
          path: ["columns"],
        });
    }
    if (q.groupBy !== undefined && !definition.groups.includes(q.groupBy))
      ctx.addIssue({
        code: "custom",
        message: "Unsupported grouping",
        path: ["groupBy"],
      });
    if (kind !== "consumption" && q.windowDays !== 90)
      ctx.addIssue({
        code: "custom",
        message: "Consumption window is not applicable",
        path: ["windowDays"],
      });
    for (const filter of q.filters) {
      const numeric = /Quantity|Fils|Scaled|Per30Days/u.test(filter.column);
      if (
        numeric
          ? filter.operator === "contains" ||
            !integer.safeParse(filter.value).success
          : filter.operator === "gte" || filter.operator === "lte"
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Invalid column filter",
          path: ["filters"],
        });
      }
    }
  });
}
export const inventoryReportSourceSchema = z.strictObject({
  documentId: z.uuidv7(),
  documentType: z.enum([
    "purchase-invoice",
    "purchase-adjustment",
    "purchase-return",
    "count-session",
  ]),
  originalDocumentId: z.uuidv7().nullable(),
  label: z.string().min(1).max(256),
  openable: z.boolean(),
});
export type InventoryReportSource = z.infer<typeof inventoryReportSourceSchema>;
export const inventoryReportActivitySchema = z.strictObject({
  id: z.uuidv7(),
  quantity: integer,
  valueFils: integer.nullable(),
  postedAt: instant,
  businessDate: z.iso.date().nullable(),
  actorId: z.uuidv7().nullable(),
  actor: z.string().min(1).max(96),
  source: inventoryReportSourceSchema.nullable(),
  reason: z.enum([
    "purchase-receipt",
    "purchase-adjustment",
    "purchase-return",
    "count-variance",
    "expiry-amendment",
    "expired",
    "recalled",
    "quarantined",
  ]),
});
export type InventoryReportActivity = z.infer<
  typeof inventoryReportActivitySchema
>;
export const inventoryReportCellsSchema = z.strictObject({
  item: z.string().max(726).nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  openingQuantity: integer.optional(),
  periodQuantity: integer.optional(),
  activityQuantity: integer.optional(),
  closingQuantity: integer.optional(),
  openingValueFils: integer.nullable().optional(),
  periodValueFils: integer.nullable().optional(),
  activityValueFils: integer.nullable().optional(),
  closingValueFils: integer.nullable().optional(),
  openingAverageCostScaled: integer.nullable().optional(),
  closingAverageCostScaled: integer.nullable().optional(),
  batch: z.string().max(256).nullable().optional(),
  expiry: z.iso.date().nullable().optional(),
  status: z.enum(["eligible", "expired", "recalled", "quarantined"]).optional(),
  alert: z
    .enum(["expired", "recalled", "quarantined", "historical-policy"])
    .optional(),
  availability: z
    .enum(["available", "historical-policy-unavailable"])
    .optional(),
  consumedQuantity: integer.optional(),
  consumptionPer30Days: integer.optional(),
  observedQuantity: integer.optional(),
  countedQuantity: integer.optional(),
  actor: z.string().max(96).nullable().optional(),
  postedAt: instant.nullable().optional(),
  businessDate: z.iso.date().nullable().optional(),
  source: z.string().max(256).nullable().optional(),
});
export const inventoryReportRowSchema = z.strictObject({
  id: z.string().min(1).max(100),
  productId: z.uuidv7(),
  batchId: z.uuidv7().nullable(),
  cells: inventoryReportCellsSchema,
  activities: z.array(inventoryReportActivitySchema),
  source: inventoryReportSourceSchema.nullable(),
  movementIds: z.array(z.uuidv7()),
});
export type InventoryReportRow = z.infer<typeof inventoryReportRowSchema>;
export const inventoryReportSchema = z.strictObject({
  kind: inventoryReportKindSchema,
  pharmacyId: z.uuidv7(),
  capturedAt: instant,
  timeZone: z.string().min(1).max(96),
  query: inventoryReportQuerySchema.safeExtend({ from: instant, to: instant }),
  dateBasis: z.literal("immutable-posting-time"),
  balanceBasis: z.literal("all-pharmacy-activity"),
  sensitivity: z.enum(["valuation", "redacted"]),
  columns: z.array(inventoryReportColumnSchema),
  actors: z.array(
    z.strictObject({ id: z.uuidv7(), displayName: z.string().min(1).max(96) }),
  ),
  rows: z.array(inventoryReportRowSchema),
  totalRows: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  groups: z.array(
    z.strictObject({
      key: z.string().nullable(),
      productId: z.uuidv7().nullable(),
      rowCount: z.number().int().nonnegative(),
      totals: z.partialRecord(inventoryReportColumnSchema, integer),
    }),
  ),
  explanations: z.array(
    z.enum([
      "historical-label-unavailable",
      "business-date-unavailable",
      "historical-policy-unavailable",
      "no-eligible-demand",
      "working-default-columns",
      "activity-filter-does-not-filter-balances",
    ]),
  ),
});
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
export const inventoryReportExportSchema = inventoryReportSchema
  .extend({ exportedAt: instant })
  .refine(
    (r) => !r.hasMore && r.totalRows === r.rows.length,
    "An export must contain every filtered row",
  );
export type InventoryReportExport = z.infer<typeof inventoryReportExportSchema>;
export const inventoryReportProtectedExportRequestSchema = z.strictObject({
  kind: inventoryReportKindSchema,
  query: inventoryReportQuerySchema,
  challengeId: z.uuidv7(),
  idempotencyKey: z.uuid(),
});
export type InventoryReportProtectedExportRequest = z.infer<
  typeof inventoryReportProtectedExportRequestSchema
>;
export const inventoryReportDenialSchema = z.strictObject({
  status: z.literal("denied"),
  code: z.enum([
    "query-invalid",
    "future-cutoff",
    "sensitive-query-denied",
    "export-too-large",
    "report-too-large",
    "owner-role-required",
    "idempotency-conflict",
  ]),
  requestId: z.uuidv7(),
});
export const inventoryReportPath = (kind: InventoryReportKind): string =>
  `/reports/inventory/${kind}`;
