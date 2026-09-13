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
  countSessionCompletionPath,
  countSessionLinesPath,
  countSessionListContract,
  countSessionPath,
  countSessionReadContract,
  countSessionStartContract,
  countSessionCompleteContract,
  countVarianceApplicationPath,
  countLineRecordContract,
  countVarianceApplyContract,
  inventoryItemListContract,
  inventoryMovementHistoryContract,
  inventoryMovementHistoryPath,
  inventoryReviewPreferencesReadContract,
  inventoryReviewPreferencesSchema,
  inventoryReviewPreferencesUpdateContract,
  inventorySensitiveExportContract,
  inventorySensitiveExportSchema,
  licensingDenialSchema,
  reorderBasketReadContract,
  reorderItemAddContract,
  reorderItemConfirmContract,
  reorderItemConfirmationsPath,
  reorderItemPath,
  reorderItemRemoveContract,
  reorderItemRemovalsPath,
  reorderItemReturnsPath,
  reorderItemReturnContract,
  reorderItemUpdateContract,
  reorderItemsPath,
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
  type CountSession,
  type CountSessionSummary,
  type CountLine,
  type CountSessionCompleteRequest,
  type CountSessionListQuery,
  type CountSessionStartRequest,
  type CountLineRecordRequest,
  type CountVarianceApplyRequest,
  type ReorderItem,
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

export async function startCountSession(
  baseUrl: string,
  body: CountSessionStartRequest,
): Promise<CountSession> {
  return await requestJson(
    baseUrl,
    countSessionStartContract.path,
    countSessionStartContract.method,
    201,
    countSessionStartContract.responses[201],
    body,
  );
}

export async function listCountSessions(
  baseUrl: string,
  query: CountSessionListQuery = {},
): Promise<{
  readonly sessions: CountSessionSummary[];
}> {
  const search =
    query.status === undefined
      ? ""
      : `?status=${encodeURIComponent(query.status)}`;
  return await requestJson(
    baseUrl,
    `${countSessionListContract.path}${search}`,
    countSessionListContract.method,
    200,
    countSessionListContract.responses[200],
  );
}

export async function readCountSession(
  baseUrl: string,
  sessionId: string,
): Promise<CountSession> {
  return await requestJson(
    baseUrl,
    countSessionPath(sessionId),
    countSessionReadContract.method,
    200,
    countSessionReadContract.responses[200],
  );
}

export async function recordCountLine(
  baseUrl: string,
  sessionId: string,
  body: CountLineRecordRequest,
): Promise<{
  readonly line: CountLine;
  readonly session: CountSessionSummary;
}> {
  return await requestJson(
    baseUrl,
    countSessionLinesPath(sessionId),
    countLineRecordContract.method,
    201,
    countLineRecordContract.responses[201],
    body,
  );
}

export async function applyCountVariance(
  baseUrl: string,
  sessionId: string,
  lineId: string,
  body: CountVarianceApplyRequest,
): Promise<{
  readonly line: CountLine;
  readonly session: CountSessionSummary;
}> {
  return await requestJson(
    baseUrl,
    countVarianceApplicationPath(sessionId, lineId),
    countVarianceApplyContract.method,
    201,
    countVarianceApplyContract.responses[201],
    body,
  );
}

export async function completeCountSession(
  baseUrl: string,
  sessionId: string,
  body: CountSessionCompleteRequest,
): Promise<CountSessionSummary> {
  return await requestJson(
    baseUrl,
    countSessionCompletionPath(sessionId),
    countSessionCompleteContract.method,
    200,
    countSessionCompleteContract.responses[200],
    body,
  );
}

export interface ReorderBasketQuery {
  readonly status?: "basket" | "ordered";
}

export interface ReorderItemAddRequest {
  readonly idempotencyKey: string;
  readonly productId: string;
}

export interface ReorderItemUpdateRequest {
  readonly expectedVersion: string;
  readonly idempotencyKey: string;
  readonly quantity: string;
}

export interface ReorderItemTransitionRequest {
  readonly expectedVersion: string;
  readonly idempotencyKey: string;
}

export async function readReorderBasket(
  baseUrl: string,
  query: ReorderBasketQuery = {},
): Promise<{ readonly items: ReorderItem[] }> {
  const search =
    query.status === undefined
      ? ""
      : `?status=${encodeURIComponent(query.status)}`;
  return await requestJson(
    baseUrl,
    `${reorderBasketReadContract.path}${search}`,
    reorderBasketReadContract.method,
    200,
    reorderBasketReadContract.responses[200],
  );
}

export async function addReorderItem(
  baseUrl: string,
  body: ReorderItemAddRequest,
): Promise<{
  readonly item: ReorderItem;
  readonly outcome: "added" | "updated" | "already-ordered";
}> {
  return await requestJson(
    baseUrl,
    reorderItemsPath(),
    reorderItemAddContract.method,
    200,
    reorderItemAddContract.responses[200],
    body,
  );
}

export async function updateReorderItemQuantity(
  baseUrl: string,
  itemId: string,
  body: ReorderItemUpdateRequest,
): Promise<{ readonly item: ReorderItem }> {
  return await requestJson(
    baseUrl,
    reorderItemPath(itemId),
    reorderItemUpdateContract.method,
    200,
    reorderItemUpdateContract.responses[200],
    body,
  );
}

export async function removeReorderItem(
  baseUrl: string,
  itemId: string,
  body: ReorderItemTransitionRequest,
): Promise<{ readonly itemId: string; readonly removedAt: string }> {
  return await requestJson(
    baseUrl,
    reorderItemRemovalsPath(itemId),
    reorderItemRemoveContract.method,
    200,
    reorderItemRemoveContract.responses[200],
    body,
  );
}

export async function confirmReorderItem(
  baseUrl: string,
  itemId: string,
  body: ReorderItemTransitionRequest,
): Promise<{ readonly item: ReorderItem }> {
  return await requestJson(
    baseUrl,
    reorderItemConfirmationsPath(itemId),
    reorderItemConfirmContract.method,
    200,
    reorderItemConfirmContract.responses[200],
    body,
  );
}

export async function returnReorderItem(
  baseUrl: string,
  itemId: string,
  body: ReorderItemTransitionRequest,
): Promise<{ readonly item: ReorderItem }> {
  return await requestJson(
    baseUrl,
    reorderItemReturnsPath(itemId),
    reorderItemReturnContract.method,
    200,
    reorderItemReturnContract.responses[200],
    body,
  );
}

export function newInventoryIdempotencyKey(): string {
  return crypto.randomUUID();
}

export interface InventoryCommandAttempt {
  readonly fingerprint: string;
  readonly idempotencyKey: string;
}

export function inventoryCommandAttempt(
  previous: InventoryCommandAttempt | null,
  fingerprint: string,
  createKey: () => string = newInventoryIdempotencyKey,
): InventoryCommandAttempt {
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, idempotencyKey: createKey() };
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
