import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  inventoryReportPath,
  inventoryReportSchema,
  inventoryReportExportSchema,
  inventoryReportDenialSchema,
  identityDenialSchema,
  licensingDenialSchema,
  inventoryReportProtectedExportContract,
  type InventoryReport,
  type InventoryReportExport,
  type InventoryReportKind,
  type InventoryReportQuery,
  type InventoryReportProtectedExportRequest,
  inventoryReportActivityPageSchema,
  type InventoryReportActivityPage,
} from "@breev/contracts/local-rest";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
export class ReportApiDenied extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}
async function reportRequest(
  baseUrl: string,
  path: string,
  body?: InventoryReportProtectedExportRequest,
): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
          }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const identity = identityDenialSchema.safeParse(payload);
    if (identity.success)
      throw new IdentityApiDenied(response.status, identity.data);
    const licensing = licensingDenialSchema.safeParse(payload);
    if (licensing.success)
      throw new LicensingApiDenied(response.status, licensing.data);
    const report = inventoryReportDenialSchema.safeParse(payload);
    throw new ReportApiDenied(
      report.success ? report.data.code : "unavailable",
    );
  }
  return payload;
}
export async function readInventoryReport(
  baseUrl: string,
  kind: InventoryReportKind,
  query: Partial<InventoryReportQuery> = {},
): Promise<InventoryReport> {
  return inventoryReportSchema.parse(
    await reportRequest(
      baseUrl,
      `${inventoryReportPath(kind)}?${new URLSearchParams({ query: JSON.stringify(query) }).toString()}`,
    ),
  );
}
export async function exportInventoryReport(
  baseUrl: string,
  kind: InventoryReportKind,
  query: InventoryReportQuery,
): Promise<InventoryReportExport> {
  return inventoryReportExportSchema.parse(
    await reportRequest(
      baseUrl,
      `${inventoryReportPath(kind)}/export?${new URLSearchParams({ query: JSON.stringify(query) }).toString()}`,
    ),
  );
}
export async function readInventoryReportActivity(
  baseUrl: string,
  kind: InventoryReportKind,
  query: InventoryReportQuery,
  rowId: string,
  page = 1,
): Promise<InventoryReportActivityPage> {
  return inventoryReportActivityPageSchema.parse(
    await reportRequest(
      baseUrl,
      `${inventoryReportPath(kind)}/activity?${new URLSearchParams({ query: JSON.stringify({ query, rowId, page, pageSize: 50 }) }).toString()}`,
    ),
  );
}
export async function exportProtectedInventoryReport(
  baseUrl: string,
  body: InventoryReportProtectedExportRequest,
): Promise<InventoryReportExport> {
  return inventoryReportExportSchema.parse(
    await reportRequest(
      baseUrl,
      inventoryReportProtectedExportContract.path,
      body,
    ),
  );
}
