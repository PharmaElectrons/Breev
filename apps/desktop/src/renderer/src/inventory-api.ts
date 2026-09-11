import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityDenialSchema,
  inventoryDenialSchema,
  inventoryAllocationPreviewContract,
  inventoryBatchExpiryCorrectionContract,
  inventoryBatchExpiryCorrectionPath,
  inventoryBatchListContract,
  inventoryBatchListPath,
  inventoryBatchSafetyReviewContract,
  inventoryBatchSafetyRunContract,
  inventoryBatchSafetyStatusContract,
  inventoryBatchStatusChangeContract,
  inventoryBatchStatusChangePath,
  inventoryItemListContract,
  inventoryMovementHistoryContract,
  inventoryMovementHistoryPath,
  inventoryReviewPreferencesReadContract,
  inventoryReviewPreferencesSchema,
  inventoryReviewPreferencesUpdateContract,
  inventorySensitiveExportContract,
  inventorySensitiveExportSchema,
  licensingDenialSchema,
  type InventoryItem,
  type InventoryAllocationPreview,
  type InventoryAllocationPreviewRequest,
  type InventoryBatch,
  type InventoryBatchExpiryCorrectionRequest,
  type InventoryBatchSafetyReview,
  type InventoryBatchSafetyStatus,
  type InventoryBatchStatusChangeRequest,
  type InventoryMovement,
  type InventoryReviewPreferences,
  type InventoryReviewPreferencesUpdateRequest,
  type InventorySensitiveExport,
  type InventorySensitiveExportRequest,
  type InventoryDenial,
} from "@breev/contracts/local-rest";

import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";

interface PayloadParser<T> {
  parse(payload: unknown): T;
}

export class InventoryApiDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: InventoryDenial,
  ) {
    super(denial.code);
    this.name = "InventoryApiDenied";
  }
}

export interface InventoryItemsResponse {
  readonly fields: { readonly valuation: "granted" | "denied" };
  readonly items: InventoryItem[];
}

export async function requestInventoryItems(
  baseUrl: string,
): Promise<InventoryItemsResponse> {
  return await requestJson(
    baseUrl,
    inventoryItemListContract.path,
    inventoryItemListContract.method,
    200,
    inventoryItemListContract.responses[200],
  );
}

export async function requestInventoryMovements(
  baseUrl: string,
  productId: string,
): Promise<{
  readonly movements: InventoryMovement[];
  readonly productDisplayName: string;
  readonly productId: string;
}> {
  return await requestJson(
    baseUrl,
    inventoryMovementHistoryPath(productId),
    inventoryMovementHistoryContract.method,
    200,
    inventoryMovementHistoryContract.responses[200],
  );
}

export async function listBatches(
  baseUrl: string,
  productId: string,
): Promise<{
  readonly batches: InventoryBatch[];
  readonly businessDate: string;
}> {
  return await requestJson(
    baseUrl,
    inventoryBatchListPath(productId),
    inventoryBatchListContract.method,
    200,
    inventoryBatchListContract.responses[200],
  );
}

export async function previewAllocation(
  baseUrl: string,
  body: InventoryAllocationPreviewRequest,
): Promise<InventoryAllocationPreview> {
  return await requestJson(
    baseUrl,
    inventoryAllocationPreviewContract.path,
    inventoryAllocationPreviewContract.method,
    200,
    inventoryAllocationPreviewContract.responses[200],
    body,
  );
}

export async function changeBatchStatus(
  baseUrl: string,
  batchId: string,
  body: InventoryBatchStatusChangeRequest,
): Promise<InventoryBatch> {
  return await requestJson(
    baseUrl,
    inventoryBatchStatusChangePath(batchId),
    inventoryBatchStatusChangeContract.method,
    201,
    inventoryBatchStatusChangeContract.responses[201],
    body,
  );
}

export async function correctBatchExpiry(
  baseUrl: string,
  batchId: string,
  body: InventoryBatchExpiryCorrectionRequest,
): Promise<InventoryBatch> {
  return await requestJson(
    baseUrl,
    inventoryBatchExpiryCorrectionPath(batchId),
    inventoryBatchExpiryCorrectionContract.method,
    201,
    inventoryBatchExpiryCorrectionContract.responses[201],
    body,
  );
}

export async function readBatchSafetyStatus(
  baseUrl: string,
): Promise<InventoryBatchSafetyStatus> {
  return await requestJson(
    baseUrl,
    inventoryBatchSafetyStatusContract.path,
    inventoryBatchSafetyStatusContract.method,
    200,
    inventoryBatchSafetyStatusContract.responses[200],
  );
}

export async function triggerBatchSafetyRun(
  baseUrl: string,
): Promise<InventoryBatchSafetyStatus> {
  return await requestJson(
    baseUrl,
    inventoryBatchSafetyRunContract.path,
    inventoryBatchSafetyRunContract.method,
    202,
    inventoryBatchSafetyRunContract.responses[202],
    {},
  );
}

export async function readBatchSafetyReview(
  baseUrl: string,
  month?: string,
): Promise<InventoryBatchSafetyReview> {
  const path =
    month === undefined
      ? inventoryBatchSafetyReviewContract.path
      : `${inventoryBatchSafetyReviewContract.path}?month=${encodeURIComponent(month)}`;
  return await requestJson(
    baseUrl,
    path,
    inventoryBatchSafetyReviewContract.method,
    200,
    inventoryBatchSafetyReviewContract.responses[200],
  );
}

export async function requestInventoryReviewPreferences(
  baseUrl: string,
): Promise<InventoryReviewPreferences> {
  return await requestJson(
    baseUrl,
    inventoryReviewPreferencesReadContract.path,
    inventoryReviewPreferencesReadContract.method,
    200,
    inventoryReviewPreferencesSchema,
  );
}

export async function updateInventoryReviewPreferences(
  baseUrl: string,
  body: InventoryReviewPreferencesUpdateRequest,
): Promise<InventoryReviewPreferences> {
  return await requestJson(
    baseUrl,
    inventoryReviewPreferencesUpdateContract.path,
    inventoryReviewPreferencesUpdateContract.method,
    200,
    inventoryReviewPreferencesSchema,
    body,
  );
}

export async function exportInventorySensitiveData(
  baseUrl: string,
  body: InventorySensitiveExportRequest,
): Promise<InventorySensitiveExport> {
  return await requestJson(
    baseUrl,
    inventorySensitiveExportContract.path,
    inventorySensitiveExportContract.method,
    201,
    inventorySensitiveExportSchema,
    body,
  );
}

export function newInventoryIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function requestJson<T>(
  baseUrl: string,
  requestPath: string,
  method: string,
  successStatus: number,
  parser: PayloadParser<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(new URL(requestPath, baseUrl), {
    ...(body === undefined
      ? {
          cache: "no-store" as const,
          credentials: "omit" as const,
          headers: { Accept: "application/json" },
          method,
        }
      : {
          body: JSON.stringify(body),
          cache: "no-store" as const,
          credentials: "omit" as const,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
          },
          method,
        }),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== successStatus)
    throw await denialFromResponse(response);
  return parser.parse(await response.json());
}

async function denialFromResponse(response: Response): Promise<Error> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new Error(`Local API returned status ${String(response.status)}`);
  }
  const inventory = inventoryDenialSchema.safeParse(payload);
  if (inventory.success) {
    return new InventoryApiDenied(response.status, inventory.data);
  }
  const identity = identityDenialSchema.safeParse(payload);
  if (identity.success)
    return new IdentityApiDenied(response.status, identity.data);
  const licensing = licensingDenialSchema.safeParse(payload);
  if (licensing.success)
    return new LicensingApiDenied(response.status, licensing.data);
  return new Error(`Local API returned status ${String(response.status)}`);
}
