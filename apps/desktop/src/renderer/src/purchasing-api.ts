import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityDenialSchema,
  licensingDenialSchema,
  purchaseDraftCreateContract,
  purchaseDraftDiscardContract,
  purchaseDraftDiscardPath,
  purchaseDraftHeaderPath,
  purchaseDraftListContract,
  purchaseDraftPath,
  purchaseDraftDetailSchema,
  purchaseDraftPostingsPath,
  purchaseDraftReadContract,
  purchaseDraftResultSchema,
  purchaseDraftRowCommitContract,
  purchaseDraftRowCommitResultSchema,
  purchaseDraftRowsPath,
  purchaseDraftSchema,
  purchaseEntryPreferencesReadContract,
  purchaseEntryPreferencesSchema,
  purchaseEntryPreferencesUpdateContract,
  purchasePostContract,
  purchasePostRequestSchema,
  purchasePostResultSchema,
  purchasingDenialSchema,
  supplierArchiveContract,
  supplierArchivePath,
  supplierCreateContract,
  supplierEditContract,
  supplierListContract,
  supplierMergeContract,
  supplierMergePath,
  supplierPath,
  supplierSchema,
  type PurchaseDraft,
  type PurchaseDraftDetail,
  type PurchaseDraftCreateRequest,
  type PurchaseDraftDiscardRequest,
  type PurchaseDraftResult,
  type PurchaseDraftRowCommitRequest,
  type PurchaseDraftRowCommitResult,
  type PurchaseDraftUpdateRequest,
  type PurchaseEntryPreferences,
  type PurchaseEntryPreferencesUpdateRequest,
  type PurchasePostRequest,
  type PurchasePostResult,
  type PurchasingDenial,
  type Supplier,
  type SupplierArchiveRequest,
  type SupplierCreateRequest,
  type SupplierEditRequest,
  type SupplierMergeRequest,
} from "@breev/contracts/local-rest";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";

interface Parser<T> {
  parse(payload: unknown): T;
}
export class PurchasingApiDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: PurchasingDenial,
  ) {
    super(denial.code);
    this.name = "PurchasingApiDenied";
  }
}

export const requestSuppliers = async (
  baseUrl: string,
): Promise<{ suppliers: Supplier[] }> =>
  await requestJson(
    baseUrl,
    supplierListContract.path,
    "GET",
    200,
    supplierListContract.responses[200],
  );
export const createSupplier = async (
  baseUrl: string,
  body: SupplierCreateRequest,
): Promise<Supplier> =>
  await requestJson(
    baseUrl,
    supplierCreateContract.path,
    "POST",
    201,
    supplierSchema,
    body,
  );
export const editSupplier = async (
  baseUrl: string,
  id: string,
  body: SupplierEditRequest,
): Promise<Supplier> =>
  await requestJson(
    baseUrl,
    supplierPath(id),
    supplierEditContract.method,
    200,
    supplierSchema,
    body,
  );
export const archiveSupplier = async (
  baseUrl: string,
  id: string,
  body: SupplierArchiveRequest,
): Promise<Supplier> =>
  await requestJson(
    baseUrl,
    supplierArchivePath(id),
    supplierArchiveContract.method,
    201,
    supplierSchema,
    body,
  );
export const mergeSupplier = async (
  baseUrl: string,
  id: string,
  body: SupplierMergeRequest,
): Promise<Supplier> =>
  await requestJson(
    baseUrl,
    supplierMergePath(id),
    supplierMergeContract.method,
    201,
    supplierSchema,
    body,
  );
export const requestPurchaseDrafts = async (
  baseUrl: string,
): Promise<{ drafts: PurchaseDraft[] }> =>
  await requestJson(
    baseUrl,
    purchaseDraftListContract.path,
    "GET",
    200,
    purchaseDraftListContract.responses[200],
  );
export const requestPurchaseDraft = async (
  baseUrl: string,
  id: string,
): Promise<PurchaseDraftDetail> =>
  await requestJson(
    baseUrl,
    purchaseDraftPath(id),
    purchaseDraftReadContract.method,
    200,
    purchaseDraftDetailSchema,
  );
export const requestPurchaseEntryPreferences = async (
  baseUrl: string,
): Promise<PurchaseEntryPreferences> =>
  await requestJson(
    baseUrl,
    purchaseEntryPreferencesReadContract.path,
    purchaseEntryPreferencesReadContract.method,
    200,
    purchaseEntryPreferencesSchema,
  );
export const updatePurchaseEntryPreferences = async (
  baseUrl: string,
  body: PurchaseEntryPreferencesUpdateRequest,
): Promise<PurchaseEntryPreferences> =>
  await requestJson(
    baseUrl,
    purchaseEntryPreferencesUpdateContract.path,
    purchaseEntryPreferencesUpdateContract.method,
    200,
    purchaseEntryPreferencesSchema,
    body,
  );
export const commitPurchaseDraftRow = async (
  baseUrl: string,
  id: string,
  body: PurchaseDraftRowCommitRequest,
): Promise<PurchaseDraftRowCommitResult> =>
  await requestJson(
    baseUrl,
    purchaseDraftRowsPath(id),
    purchaseDraftRowCommitContract.method,
    201,
    purchaseDraftRowCommitResultSchema,
    body,
  );
export const createPurchaseDraft = async (
  baseUrl: string,
  body: PurchaseDraftCreateRequest,
): Promise<PurchaseDraftResult> =>
  await requestJson(
    baseUrl,
    purchaseDraftCreateContract.path,
    "POST",
    201,
    purchaseDraftResultSchema,
    body,
  );
export const updatePurchaseDraft = async (
  baseUrl: string,
  id: string,
  body: PurchaseDraftUpdateRequest,
): Promise<PurchaseDraftResult> =>
  await requestJson(
    baseUrl,
    purchaseDraftHeaderPath(id),
    "PUT",
    200,
    purchaseDraftResultSchema,
    body,
  );
export const discardPurchaseDraft = async (
  baseUrl: string,
  id: string,
  body: PurchaseDraftDiscardRequest,
): Promise<PurchaseDraft> =>
  await requestJson(
    baseUrl,
    purchaseDraftDiscardPath(id),
    purchaseDraftDiscardContract.method,
    201,
    purchaseDraftSchema,
    body,
  );

export const postPurchase = async (
  baseUrl: string,
  draftId: string,
  body: PurchasePostRequest,
): Promise<PurchasePostResult> =>
  await requestJson(
    baseUrl,
    purchaseDraftPostingsPath(draftId),
    purchasePostContract.method,
    201,
    purchasePostResultSchema,
    body,
  );

export function newPurchasingIdempotencyKey(): string {
  return crypto.randomUUID();
}

export interface PurchasingCommandAttempt {
  readonly fingerprint: string;
  readonly idempotencyKey: string;
}

export interface PendingPurchasePost {
  readonly draftId: string;
  readonly expectedVersion: string;
  readonly idempotencyKey: string;
}

interface PurchasingAttemptAddress {
  readonly hash: string;
  replace(hash: string): void;
}

const PURCHASE_POST_ATTEMPT_PREFIX = "#/purchases/posting/";

export function readPendingPurchasePost(
  address: PurchasingAttemptAddress,
): PendingPurchasePost | null {
  if (!address.hash.startsWith(PURCHASE_POST_ATTEMPT_PREFIX)) return null;
  const [draftId, expectedVersion, ...extra] = address.hash
    .slice(PURCHASE_POST_ATTEMPT_PREFIX.length)
    .split("/");
  const request = purchasePostRequestSchema.safeParse({
    expectedVersion,
    idempotencyKey: draftId,
  });
  if (
    extra.length > 0 ||
    typeof draftId !== "string" ||
    !purchaseDraftSchema.shape.id.safeParse(draftId).success ||
    !request.success
  ) {
    address.replace("#/purchases");
    return null;
  }
  return {
    draftId,
    expectedVersion: request.data.expectedVersion,
    idempotencyKey: request.data.idempotencyKey,
  };
}

export function rememberPurchasePost(
  address: PurchasingAttemptAddress,
  draftId: string,
  expectedVersion: string,
): PendingPurchasePost {
  const pending = readPendingPurchasePost(address);
  if (pending !== null) return pending;
  const next = purchasePostRequestSchema.parse({
    expectedVersion,
    idempotencyKey: draftId,
  });
  const value = { draftId, ...next };
  address.replace(
    `${PURCHASE_POST_ATTEMPT_PREFIX}${draftId}/${next.expectedVersion}`,
  );
  return value;
}

export function clearPendingPurchasePost(
  address: PurchasingAttemptAddress,
): void {
  address.replace("#/purchases");
}

export function purchasingCommandAttempt(
  previous: PurchasingCommandAttempt | null,
  fingerprint: string,
  createKey: () => string = newPurchasingIdempotencyKey,
): PurchasingCommandAttempt {
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, idempotencyKey: createKey() };
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  method: string,
  successStatus: number,
  parser: Parser<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    credentials: "omit",
    headers:
      body === undefined
        ? { Accept: "application/json" }
        : {
            Accept: "application/json",
            "Content-Type": "application/json",
            [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
          },
    method,
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== successStatus) throw await denial(response);
  return parser.parse(await response.json());
}

async function denial(response: Response): Promise<Error> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new Error(`Local API returned status ${response.status}`);
  }
  const purchasing = purchasingDenialSchema.safeParse(payload);
  if (purchasing.success)
    return new PurchasingApiDenied(response.status, purchasing.data);
  const identity = identityDenialSchema.safeParse(payload);
  if (identity.success)
    return new IdentityApiDenied(response.status, identity.data);
  const licensing = licensingDenialSchema.safeParse(payload);
  if (licensing.success)
    return new LicensingApiDenied(response.status, licensing.data);
  return new Error(`Local API returned status ${response.status}`);
}
