import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityDenialSchema,
  purchaseDraftCreateContract,
  purchaseDraftDiscardContract,
  purchaseDraftDiscardPath,
  purchaseDraftHeaderPath,
  purchaseDraftListContract,
  purchaseDraftResultSchema,
  purchaseDraftSchema,
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
  type PurchaseDraftCreateRequest,
  type PurchaseDraftDiscardRequest,
  type PurchaseDraftResult,
  type PurchaseDraftUpdateRequest,
  type PurchasingDenial,
  type Supplier,
  type SupplierArchiveRequest,
  type SupplierCreateRequest,
  type SupplierEditRequest,
  type SupplierMergeRequest,
} from "@breev/contracts/local-rest";
import { IdentityApiDenied } from "./identity-api";

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

export function newPurchasingIdempotencyKey(): string {
  return crypto.randomUUID();
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
  return new Error(`Local API returned status ${response.status}`);
}
